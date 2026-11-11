import argparse
import fcntl
import hashlib
import json
import os
import re
import secrets
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image
from playwright.sync_api import sync_playwright

# Muse（muse.ai）没有接口，全部走专用的无头浏览器：一次打开浏览器，新开侧聊天发任务、等它画完、从云电脑文件库下载、删掉侧聊天。
# 网页结构（改版后先查这里）：输入框 textarea[aria-label="Message"]，附件 input[type=file]，发送 button[aria-label="Send"]，
# 都在 [data-hatch-composer-chrome] 里；消息 [data-message-item]（data-message-role=user|assistant）；工作中有 button「Stop」或 [aria-busy=true]；
# 图片附件卡片的名字在缩略图 img 的 alt 上；侧聊天行 [data-testid=hatch-thread-row]（第 0 行是主聊天），右键菜单 Rename / Delete；
# 待确认在 button「Approvals」标签页；文件库 /library/files，根目录是云电脑的 /home/hatch，下载按钮叫「Download」。
BASE = "https://muse.ai"
PROFILE = Path(os.environ.get("IMAGE_GEN_MUSE_PROFILE", Path.home() / ".config" / "imagegen-swarm" / "muse-browser"))
REMOTE_DIR = "/home/hatch/workspace/imagegen-swarm"
RATIOS = ("1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9")
THREAD_RE = re.compile(r"/thread/([0-9a-f-]{36})")
IDLE_SECONDS = 8


@contextmanager
def browser(headless=True):
    # 同一个资料夹同一时刻只能一个浏览器打开：加锁排队
    PROFILE.mkdir(parents=True, exist_ok=True)
    with open(PROFILE.parent / f"{PROFILE.name}.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        proxy = None
        value = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
        if value:
            parts = urlsplit(value)
            proxy = {"server": f"{parts.scheme}://{parts.hostname}" + (f":{parts.port}" if parts.port else "")}
            if parts.username:
                proxy.update(username=parts.username, password=parts.password or "")
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(str(PROFILE), headless=headless, viewport={"width": 1280, "height": 860},
                                                           accept_downloads=True, proxy=proxy)
            try:
                yield context.pages[0] if context.pages else context.new_page()
            finally:
                context.close()


def wait_for(page, check, seconds, what):
    deadline = time.monotonic() + seconds
    while True:
        value = check()
        if value:
            return value
        if time.monotonic() > deadline:
            raise RuntimeError(f"{seconds} 秒内{what}")
        page.wait_for_timeout(500)


def composer(page):
    return page.locator('textarea[aria-label="Message"]').first


def open_url(page, url):
    page.goto(url, wait_until="domcontentloaded")
    if "/library/" in url:
        page.get_by_test_id("hatch-library-allfiles-panel").wait_for(timeout=45000)
        return
    wait_for(page, lambda: composer(page).count() and composer(page).is_visible(), 45,
             f"看不到消息输入框（没登录就先运行 --login）：{page.url}")
    page.wait_for_timeout(1500)


def messages(page):
    return page.evaluate("""() => [...document.querySelectorAll('[data-message-item]')].map(e => ({
        role: e.dataset.messageRole, text: e.innerText.replace(/^(You:|Assistant message:\\s*)/, '').trim()}))""")


def busy(page):
    return page.get_by_role("button", name="Stop", exact=True).count() > 0 or page.locator("[aria-busy=true]").count() > 0


def thread_id(page):
    match = THREAD_RE.search(page.url)
    return match.group(1) if match else None


def chats_panel(page):
    nav = page.get_by_role("navigation", name="Side chats")
    if nav.count() == 0 or not nav.is_visible():
        page.get_by_role("button", name="Chats").click()
        nav.wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(800)


def side_chats(page):
    # 逐行点开读编号（第 0 行是主聊天，不碰）
    open_url(page, BASE + "/")
    result = []
    chats_panel(page)
    rows = page.get_by_test_id("hatch-thread-row")
    index = 1
    # 列表可能在读的过程中变短（别处刚删了侧聊天）：每一行之前重新数
    while index < rows.count():
        row = rows.nth(index)
        index += 1
        title = row.inner_text().strip().split("\n")[0]
        row.evaluate("e => e.click()")
        page.wait_for_function("() => location.pathname.startsWith('/thread/')", timeout=15000)
        result.append({"id": thread_id(page), "title": title})
        chats_panel(page)
    return result


def row_menu(page, chat, item):
    open_url(page, f"{BASE}/thread/{chat}")
    chats_panel(page)
    row = page.locator('[data-testid=hatch-thread-row][aria-current=page]')
    if row.count() != 1 or "Main chat" in row.inner_text():
        raise RuntimeError(f"当前行不是侧聊天 {chat}，不动它")
    row.dispatch_event("contextmenu", {"bubbles": True, "button": 2, "clientX": 150, "clientY": 150})
    page.get_by_role("menuitem", name=item).click()


def rename(page, chat, title):
    row_menu(page, chat, "Rename")
    # 改名框会被消息框抢焦点：直接设值并发输入、回车事件（React 受控输入框的做法）
    page.get_by_test_id("hatch-thread-rename-input").evaluate("""(e, title) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, title);
        e.dispatchEvent(new Event('input', {bubbles: true}));
        e.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true}));
    }""", title)
    page.wait_for_timeout(1500)


def delete(page, chat):
    # 还在回答的侧聊天删不掉：先点 Stop 等它停下；同一浏览器里侧聊天列表要过十几秒才刷新，
    # 所以直接打开它的地址核对，显示 Something went wrong、没有消息就是删掉了；没删掉就再点一次删除
    for _ in range(2):
        open_url(page, f"{BASE}/thread/{chat}")
        stop = page.get_by_role("button", name="Stop", exact=True)
        if stop.count():
            stop.click()
            wait_for(page, lambda: not busy(page), 30, "Muse 没停下")
        row_menu(page, chat, "Delete")
        confirm = page.get_by_role("button", name="Delete", exact=True)
        if confirm.count():
            confirm.last.click()
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            page.wait_for_timeout(3000)
            page.goto(f"{BASE}/thread/{chat}", wait_until="domcontentloaded")
            page.wait_for_timeout(3000)
            if not messages(page) and "Something went wrong" in page.evaluate("document.body.innerText"):
                return
    raise RuntimeError(f"Muse 侧聊天 {chat} 删不掉")


COMPOSER = r'''() => {
    const chrome = document.querySelector('[data-hatch-composer-chrome]');
    if (!chrome) return null;
    const cards = [...chrome.querySelectorAll('button[aria-label="Remove attachment"]')].map(remove => {
        const card = remove.closest('div');
        return {names: [...card.querySelectorAll('img[alt]')].map(n => n.getAttribute('alt')),
                progress: !!card.querySelector('[role=status], [role=progressbar], [aria-busy="true"], progress')};
    });
    const send = chrome.querySelector('button[aria-label="Send"]');
    return {cards, ready: !!send && !send.disabled};
}'''
SENT_IMAGES = r'''before => {
    const entry = [...document.querySelectorAll('[data-message-item]')].slice(before).find(n => n.dataset.messageRole === 'user');
    return entry ? [...entry.querySelectorAll('button.hatch-chat-groupable-bubble img[alt]')].map(n => n.getAttribute('alt')) : null;
}'''
# Approvals 面板里每个以 Allow 开头的按钮，往上找到同时含 Deny 的最小容器，读出请求说明
APPROVALS = r'''() => [...document.querySelectorAll('button')].filter(b => /^allow\b/i.test(b.textContent.trim())).map(b => {
    let node = b.parentElement;
    while (node && !/\bDeny\b/.test(node.innerText)) node = node.parentElement;
    return {label: b.textContent.trim(), detail: node ? node.innerText.trim() : ''};
})'''


def send(page, text, images):
    open_url(page, BASE + "/thread/new")
    if page.evaluate(COMPOSER)["cards"]:
        raise RuntimeError("输入框里已有别的附件，未发送")
    names = [image.name for image in images]
    for count, image in enumerate(images, 1):
        page.locator("[data-hatch-composer-chrome] input[type=file]").first.set_input_files(str(image))

        def uploaded(count=count, name=image.name):
            state = page.evaluate(COMPOSER)
            shown = [n for card in state["cards"] for n in card["names"]]
            return len(state["cards"]) == count and name in shown and state["ready"] and not any(c["progress"] for c in state["cards"])
        wait_for(page, uploaded, 120, f"图片 {image.name} 没上传完")
    before = len(messages(page))
    composer(page).click(force=True)
    composer(page).fill(text)
    page.locator('[data-hatch-composer-chrome] button[aria-label="Send"]').click()
    wait_for(page, lambda: len(messages(page)) > before, 30, "消息没发出去")
    if names:
        wait_for(page, lambda: sorted(page.evaluate(SENT_IMAGES, before) or []) == sorted(names), 60, f"已发送消息里没看到全部图片 {names}")
    wait_for(page, lambda: thread_id(page), 60, "没拿到侧聊天编号")
    return thread_id(page), before


def approvals(page):
    tab = page.get_by_role("button", name="Approvals", exact=True)
    if tab.count() == 0:
        return []
    tab.click()
    page.wait_for_timeout(500)
    return page.evaluate(APPROVALS)


def wait_done(page, since, deadline, approved, cancel_file):
    # 持续空闲满 IDLE_SECONDS 才算做完（回复生成中 Stop 会短暂消失）；待确认只批准指向本轮保存目录的请求。
    # 调用方（抢活脚本）要取消时会建 cancel_file：看到就按出错流程走，删掉侧聊天再退出
    idle = None
    while True:
        if cancel_file and Path(cancel_file).exists():
            raise RuntimeError("cancelled: another engine finished this image first")
        asks = approvals(page)
        if asks:
            if not all(REMOTE_DIR in a["detail"] for a in asks):
                raise RuntimeError(f"Muse 停在待确认上，请求与本轮文件无关，不代点：{json.dumps(asks, ensure_ascii=False)[:1500]}")
            label = next(a["label"] for a in asks if a["label"] in ("Allow once", "Allow"))
            page.get_by_role("button", name=label, exact=True).first.click()
            approved.extend(a["detail"] for a in asks)
            idle = None
            continue
        replied = any(m["role"] == "assistant" and m["text"] for m in messages(page)[since:])
        if busy(page) or not replied:
            idle = None
        elif idle is None:
            idle = time.monotonic()
        elif time.monotonic() - idle >= IDLE_SECONDS:
            return messages(page)[since:]
        if time.monotonic() > deadline:
            raise RuntimeError("Muse 超时没做完")
        page.wait_for_timeout(3000)


def download(page, remote, folder):
    open_url(page, BASE + "/library/files")
    panel = page.get_by_test_id("hatch-library-allfiles-panel")
    for part in remote.removeprefix("/home/hatch/").split("/"):
        panel.get_by_text(part, exact=True).first.click()
        page.wait_for_timeout(1500)
    with page.expect_download(timeout=60000) as info:
        page.get_by_role("button", name="Download", exact=True).click()
    target = folder / info.value.suggested_filename
    info.value.save_as(str(target))
    return target


def fingerprint(file):
    # 解码后像素的 sha256，换格式也认得出是同一张图（和 imgtool.py 的 fp 一致）
    with Image.open(file) as image:
        rgba = image.convert("RGBA")
        return hashlib.sha256(f"{rgba.width}x{rgba.height}".encode() + rgba.tobytes()).hexdigest()


def generate(args):
    start = time.monotonic()
    prompt = (Path(args.prompt_file).read_text(encoding="utf-8") if args.prompt_file else args.prompt).strip()
    if not prompt:
        raise ValueError("empty prompt")
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".muse-image-", dir=out.parent) as tmp:
        work = Path(tmp)
        refs, ref_hashes = [], set()
        for index, ref in enumerate(args.ref, 1):
            # 参考图换成唯一上传名，云端同名文件不会被改名
            staged = work / f"ref{index}-{secrets.token_hex(6)}{Path(ref).suffix}"
            staged.write_bytes(Path(ref).read_bytes())
            ref_hashes.add(fingerprint(staged))
            refs.append(staged)
        remote = f"{REMOTE_DIR}/img-{int(time.time() * 1000)}-{secrets.token_hex(4)}.png"
        text = ("运行环境：你在自己的云端电脑上运行，读不到用户本机的文件。\n"
                "任务：用你自己的出图工具生成 1 张图，只调用一次出图工具，不要上网找图，不要复制或改用任何现成图片。\n"
                f"画面比例 {args.aspect}。" + (f"附件 {'、'.join(r.name for r in refs)} 是参考图，按提示词参照它们。" if refs else "") + "\n"
                f"提示词（两行标记之间的原文，逐字使用，不改写、不增减）：\n<<<PROMPT\n{prompt}\nPROMPT>>>\n"
                f"生成后把图片存成 PNG：{remote}（目录不存在就先建）。最后一条回复单独一行写「产出文件：{remote}」。\n"
                "不要等用户批准；出图工具失败或做不了就写明原因后结束，不要交别的图。")
        approved = []
        with browser() as page:
            existing = {c["id"] for c in side_chats(page)}
            chat = None
            try:
                chat, since = send(page, text, refs)
                # Muse 会去掉标题两头的空格
                rename(page, chat, (args.title or f"imagegen-swarm：{prompt[:24]}").strip())
                open_url(page, f"{BASE}/thread/{chat}")
                replies = wait_done(page, since, start + args.timeout / 1000, approved, args.cancel_file)
                last = next((m["text"] for m in reversed(replies) if m["role"] == "assistant"), "")
                if remote not in re.findall(r"产出文件[:：]\s*(\S+)", last):
                    raise RuntimeError(f"Muse 没交出 {remote}；最后回复：{last[-1500:]}")
                saved = download(page, remote, work)
                if fingerprint(saved) in ref_hashes:
                    raise RuntimeError("stale output: matches a reference image")
                with Image.open(saved) as image:
                    image.save(out, "PNG")
                    width, height = image.width, image.height
            except BaseException as error:
                # 失败也删掉本轮侧聊天；发送中途失败时编号可能还没拿到，按前后差集找出本轮新建的；删不掉时两个原因一起报
                try:
                    for c in ([{"id": chat}] if chat else [c for c in side_chats(page) if c["id"] not in existing]):
                        delete(page, c["id"])
                except Exception as cleanup:
                    raise RuntimeError(f"{error}；另外：{cleanup}") from error
                raise
            delete(page, chat)
    return {"status": "ok", "path": str(out), "engine": "muse", "source_path": remote, "width": width, "height": height,
            "aspect": args.aspect, "approved": approved, "bytes": out.stat().st_size, "elapsed_seconds": round(time.monotonic() - start)}


def main():
    parser = argparse.ArgumentParser(prog="muse-image.py")
    parser.add_argument("--prompt")
    parser.add_argument("--prompt-file")
    parser.add_argument("--out")
    parser.add_argument("--ref", action="append", default=[])
    parser.add_argument("--aspect", default="1:1", choices=RATIOS)
    parser.add_argument("--title", help="侧聊天标题，用户在 Muse 里看得见")
    parser.add_argument("--timeout", type=float, default=900000, help="毫秒")
    parser.add_argument("--cancel-file", help="这个文件出现时放弃本张、删掉侧聊天后退出（抢活脚本用）")
    parser.add_argument("--login", action="store_true", help="打开有界面的浏览器，让用户自己登录 Muse")
    parser.add_argument("--list-chats", action="store_true", help="列出侧聊天（体检和测试用）")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if args.login:
        with browser(headless=False) as page:
            page.goto(BASE + "/", wait_until="domcontentloaded")
            composer(page).wait_for(state="visible", timeout=0)
        print(json.dumps({"status": "ok", "logged_in": True}))
        return
    if args.list_chats:
        with browser() as page:
            print(json.dumps({"status": "ok", "chats": side_chats(page)}, ensure_ascii=False))
        return
    if not args.out or bool(args.prompt) == bool(args.prompt_file):
        parser.error("require --out and exactly one of --prompt / --prompt-file")
    if Path(args.out).suffix.lower() != ".png":
        parser.error("--out extension must be .png")
    try:
        print(json.dumps(generate(args), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"status": "error", "engine": "muse", "reason": str(error)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
