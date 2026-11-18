"""Hermetic Muse rename, path and fail-closed approval checks; no browser or provider."""
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import types
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch


def install_stubs():
    playwright = types.ModuleType("playwright")
    sync_api = types.ModuleType("playwright.sync_api")
    sync_api.sync_playwright = lambda: None
    playwright.sync_api = sync_api
    sys.modules["playwright"] = playwright
    sys.modules["playwright.sync_api"] = sync_api

    pil = types.ModuleType("PIL")
    image_mod = types.ModuleType("PIL.Image")
    pil.Image = image_mod
    sys.modules["PIL"] = pil
    sys.modules["PIL.Image"] = image_mod


install_stubs()
here = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "muse_image_under_test",
    here.parent / "skills" / "imagegen-swarm" / "scripts" / "muse-image.py",
)
muse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(muse)


class Keyboard:
    def __init__(self):
        self.keys = []

    def press(self, key):
        self.keys.append(key)


def test_timeout_skips_and_dismisses():
    page = types.SimpleNamespace(keyboard=Keyboard())

    def goto(*_args, **_kwargs):
        raise TimeoutError("rename dialog timed out")

    page.goto = goto
    assert muse.rename_or_continue(page, "chat-id", "imagegen-swarm: title") is False
    assert page.keyboard.keys == ["Escape"]


def test_success_does_not_dismiss():
    called = {}
    original = muse.rename

    def fake_rename(page, chat, title, timeout=8000):
        called["chat"] = chat
        called["title"] = title
        called["timeout"] = timeout

    page = types.SimpleNamespace(keyboard=Keyboard())
    muse.rename = fake_rename
    try:
        assert muse.rename_or_continue(page, "abc", "side chat") is True
    finally:
        muse.rename = original
    assert called == {"chat": "abc", "title": "side chat", "timeout": 8000}
    assert page.keyboard.keys == []


def test_dismiss_failure_still_continues():
    page = types.SimpleNamespace(keyboard=Keyboard())

    def goto(*_args, **_kwargs):
        raise RuntimeError("dialog missing")

    def press(_key):
        raise RuntimeError("no dialog to close")

    page.goto = goto
    page.keyboard.press = press
    assert muse.rename_or_continue(page, "chat-id", "title") is False


CHAT = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


def test_row_miss_warns_once_and_continues():
    page = types.SimpleNamespace(keyboard=Keyboard())
    original = muse.rename

    def missing(_page, _chat, _title, timeout=8000):
        raise RuntimeError(f"当前行不是侧聊天 {CHAT}，不动它")

    muse.rename = missing
    err = io.StringIO()
    try:
        with redirect_stderr(err):
            assert muse.rename_or_continue(page, CHAT, "imagegen-swarm: title") is False
    finally:
        muse.rename = original
    warning = err.getvalue()
    assert warning.count("rename skipped") == 1
    assert "不动它" in warning
    assert page.keyboard.keys == ["Escape"]


def test_choose_side_row_by_thread_id():
    rows = [
        {"text": "Main chat", "ids": [OTHER], "current": True},
        {"text": "imagegen-swarm", "ids": [CHAT], "current": False},
    ]
    assert muse.choose_side_row(rows, CHAT) == 1
    # The open thread can be named by a data attribute, with the current marker on a child.
    marked = [{"text": "imagegen-swarm", "ids": [CHAT.upper()], "current": True}]
    assert muse.choose_side_row(marked, CHAT) == 0
    # Two copies of this thread: only the one marked current is safe to touch.
    copies = [
        {"text": "a", "ids": [CHAT], "current": False},
        {"text": "b", "ids": [CHAT], "current": True},
    ]
    assert muse.choose_side_row(copies, CHAT) == 1


def test_choose_side_row_refuses_other_chats():
    # A highlighted row for a different thread is not this side chat.
    foreign = [{"text": "other", "ids": [OTHER], "current": True}]
    assert muse.choose_side_row(foreign, CHAT) is None
    # Main chat is never renamed or deleted, even when it carries this id.
    main = [{"text": "Main chat\nimagegen-swarm", "ids": [CHAT], "current": True}]
    assert muse.choose_side_row(main, CHAT) is None
    # Two rows that both claim this thread, and neither is current, are ambiguous.
    both = [
        {"text": "a", "ids": [CHAT], "current": False},
        {"text": "b", "ids": [CHAT], "current": False},
    ]
    assert muse.choose_side_row(both, CHAT) is None
    # A container that lists this thread plus another is not a single chat.
    mixed = [{"text": "list", "ids": [CHAT, OTHER], "current": True}]
    assert muse.choose_side_row(mixed, CHAT) is None
    assert muse.choose_side_row([], CHAT) is None


def test_choose_side_row_legacy_current_marker():
    # Older markup had no thread id on the row, only aria-current on the open side chat.
    legacy = [
        {"text": "Main chat", "ids": [], "current": False},
        {"text": "imagegen-swarm", "ids": [], "current": True},
    ]
    assert muse.choose_side_row(legacy, CHAT) == 1
    # Two current rows, or a current Main chat, are not safe to touch.
    ambiguous = [
        {"text": "one", "ids": [], "current": True},
        {"text": "two", "ids": [], "current": True},
    ]
    assert muse.choose_side_row(ambiguous, CHAT) is None
    only_main = [{"text": "Main chat", "ids": [], "current": True}]
    assert muse.choose_side_row(only_main, CHAT) is None


# Policy fixtures only, NOT captured Muse requests or a claim about Muse's DOM/API.
# No verified live decoder exists: APPROVALS must return request=None for live cards.
REMOTE = "/home/hatch/workspace/imagegen-swarm/img-1.png"


def decoded_save(path=REMOTE, operation="save_image"):
    return {"label": "Allow once", "detail": "internal policy fixture",
            "controls": ["Deny", "Allow once"],
            "request": {"operation": operation, "paths": [path]}}


def test_approval_requires_exact_output_save():
    assert muse.scoped_save_approval(decoded_save(), REMOTE) is True
    for operation in ("read", "write_file", "modify", "delete", "run_command", "network", "unknown"):
        assert muse.scoped_save_approval(decoded_save(operation=operation), REMOTE) is False


def test_approval_refuses_directory_creation():
    for directory in (muse.REMOTE_DIR, "/home/hatch/workspace", "/tmp/imagegen-swarm", REMOTE):
        assert muse.scoped_save_approval(decoded_save(directory, "create_directory"), REMOTE) is False
        assert muse.scoped_save_approval(decoded_save(directory, "mkdir"), REMOTE) is False
    assert muse.scoped_save_approval(decoded_save(muse.REMOTE_DIR), REMOTE) is False


def test_approval_rejects_compound_requests():
    for operation in ("delete", "modify", "run_command", "read", "network"):
        compound = decoded_save()
        compound["request"]["operations"] = [{"operation": operation, "paths": ["/tmp/other"]}]
        assert muse.scoped_save_approval(compound, REMOTE) is False
        compound = decoded_save(operation=["save_image", operation])
        assert muse.scoped_save_approval(compound, REMOTE) is False
        compound = decoded_save(operation="save_image and " + operation)
        assert muse.scoped_save_approval(compound, REMOTE) is False
        compound = decoded_save()
        compound["request"] = [compound["request"], {"operation": operation, "paths": [REMOTE]}]
        assert muse.scoped_save_approval(compound, REMOTE) is False
    for key, value in (("command", "echo extra"), ("content", "modify another file"), ("arguments", {})):
        compound = decoded_save()
        compound["request"][key] = value
        assert muse.scoped_save_approval(compound, REMOTE) is False
    for paths in ([REMOTE, "/tmp/other"], [REMOTE, REMOTE], []):
        compound = decoded_save()
        compound["request"]["paths"] = paths
        assert muse.scoped_save_approval(compound, REMOTE) is False


def test_approval_rejects_command_syntax_and_extra_actions():
    for suffix in ("; echo extra", "&& echo extra", "|| echo extra", "| cat", "`id`", "$(id)",
                   "\ndelete /tmp/other", "\rmodify /tmp/other", " and delete other.png", " extra.png",
                   "\tother.png", "\x00", "\n"):
        assert muse.scoped_save_approval(decoded_save(REMOTE + suffix), REMOTE) is False
        assert muse.scoped_save_approval(decoded_save(operation="save_image" + suffix), REMOTE) is False
        # Text alone is never a permission, even with the exact path and safe-looking verb.
        unknown = {"label": "Allow once", "detail": "save " + REMOTE + suffix, "request": None}
        assert muse.scoped_save_approval(unknown, REMOTE) is False
    for path in (f'"{REMOTE}"', f"'{REMOTE}'", " " + REMOTE, REMOTE + " ", "https://host" + REMOTE):
        assert muse.scoped_save_approval(decoded_save(path), REMOTE) is False


def test_approval_rejects_mismatched_paths():
    for path in ("/home/hatch/workspace/imagegen-swarm/other.png",
                 "/home/hatch/workspace/imagegen-swarm/.attempt-img-1.png",
                 "/home/hatch/workspace/other/img-1.png",
                 "/home/hatch/workspace/imagegen-swarm/../img-1.png",
                 "~/workspace/imagegen-swarm/../../img-1.png", "/tmp/img-1.png"):
        assert muse.scoped_save_approval(decoded_save(path), REMOTE) is False


def test_approval_matches_normalized_output_path():
    for path in ("~/workspace/imagegen-swarm/img-1.png", "~hatch/workspace/imagegen-swarm/img-1.png",
                 "/home/hatch/workspace/imagegen-swarm/./img-1.png",
                 "/home/hatch/workspace/imagegen-swarm/../imagegen-swarm/img-1.png"):
        assert muse.scoped_save_approval(decoded_save(path), REMOTE) is True
    with tempfile.TemporaryDirectory(prefix="muse-path-") as directory:
        root = Path(directory)
        real, elsewhere = root / "real", root / "elsewhere"
        real.mkdir()
        elsewhere.mkdir()
        link = root / "link"
        link.symlink_to(real, target_is_directory=True)
        via_link = str(link / "img-1.png")
        via_real = str(real / "img-1.png")
        assert muse.canonical_output_path(via_link) == muse.canonical_output_path(via_real)
        assert muse.scoped_save_approval(decoded_save(via_link), via_real) is True
        link.unlink()
        link.symlink_to(elsewhere, target_is_directory=True)
        assert muse.scoped_save_approval(decoded_save(via_link), via_real) is False
        file_link = real / "alias.png"
        foreign_file = elsewhere / "other.png"
        foreign_file.touch()
        file_link.symlink_to(foreign_file)
        assert muse.scoped_save_approval(decoded_save(str(file_link)), via_real) is False
        prepared = muse.prepare_local_output(real / "new" / "out.png")
        assert prepared == muse.canonical_output_path(real / "new" / "out.png")
        assert prepared.parent.is_dir()
        assert not prepared.exists()


def test_approval_fails_closed_on_unknown_or_malformed_shape():
    for approval in (None, [], "write file " + REMOTE, {}, {"label": "Allow once", "detail": "save " + REMOTE}):
        assert muse.scoped_save_approval(approval, REMOTE) is False
    for request in (None, {}, [], "save " + REMOTE, {"operation": "save_image"}, {"paths": [REMOTE]},
                    {"operation": "save_image", "paths": REMOTE},
                    {"operation": "save_image", "paths": [None]},
                    {"operation": "save_image", "paths": [123]},
                    {"operation": "save_image", "paths": [""]},
                    {"operation": "save_image", "paths": [REMOTE], "extra": None}):
        approval = decoded_save()
        approval["request"] = request
        assert muse.scoped_save_approval(approval, REMOTE) is False


def test_approval_rejects_every_other_label():
    for label in (None, "Allow", "Allow always", "Allow Once", "Allow once ", "Deny", "", 1):
        approval = decoded_save()
        approval["label"] = label
        assert muse.scoped_save_approval(approval, REMOTE) is False


def test_approval_dom_does_not_invent_a_request_protocol():
    # Evaluate the actual extraction JS against DOM doubles, without Playwright or a browser.
    script = r'''const fs = require('node:fs');
const vm = require('node:vm');
const {source, path} = JSON.parse(fs.readFileSync(0, 'utf8'));
const results = [];
for (const hasDenyButton of [true, false]) {
    const allow = {textContent: 'Allow once'};
    const deny = {textContent: 'Deny'};
    const card = {innerText: 'save ' + path + '\nDeny\nAllow once', parentElement: null,
                  querySelectorAll: () => hasDenyButton ? [deny, allow] : [allow]};
    allow.parentElement = card;
    const document = {querySelectorAll: () => [allow]};
    results.push(vm.runInNewContext('(' + source + ')()', {document}));
}
process.stdout.write(JSON.stringify(results));'''
    result = subprocess.run(["node", "-e", script], input=json.dumps({"source": muse.APPROVALS, "path": REMOTE}),
                            text=True, capture_output=True, check=True)
    found, missing = json.loads(result.stdout)
    assert found == [{"label": "Allow once", "detail": f"save {REMOTE}\nDeny\nAllow once",
                      "controls": ["Deny", "Allow once"], "request": None}]
    assert missing == [{"label": "Allow once", "detail": "", "controls": [], "request": None}]
    for approval in found + missing:
        assert muse.scoped_save_approval(approval, REMOTE) is False


class ApprovalPage:
    def __init__(self):
        self.clicks = 0

    def get_by_role(self, role, name, exact):
        assert (role, name, exact) == ("button", "Allow once", True)
        return types.SimpleNamespace(first=self)

    def click(self):
        self.clicks += 1

    def wait_for_timeout(self, _milliseconds):
        pass


def test_wait_done_refuses_before_any_click():
    unknown = {"label": "Allow once", "detail": "save " + REMOTE, "request": None}
    mismatch = decoded_save("/tmp/other.png")
    compound = decoded_save(operation="save_image and run_command")
    wrong_label = decoded_save()
    wrong_label["label"] = "Allow always"
    for asks in ([unknown], [compound], [mismatch], [wrong_label], [decoded_save(), unknown],
                 [unknown, decoded_save()]):
        page, approved = ApprovalPage(), []
        with patch.object(muse, "approvals", return_value=asks):
            try:
                muse.wait_done(page, 0, float("inf"), approved, None, REMOTE)
            except RuntimeError as error:
                assert "approval shape was not recognized" in str(error)
                assert "was not clicked" in str(error)
            else:
                raise AssertionError("unsafe approval did not stop the job")
        assert page.clicks == 0
        assert approved == []


def test_wait_done_records_an_internally_decoded_save():
    # Policy integration only. A live unverified card never becomes decoded_save().
    page, approved = ApprovalPage(), []
    request = decoded_save()
    replies = [{"role": "assistant", "text": "done"}]
    with patch.object(muse, "approvals", side_effect=[[request], [], []]), \
         patch.object(muse, "messages", return_value=replies), \
         patch.object(muse, "busy", return_value=False), patch.object(muse, "IDLE_SECONDS", 0):
        assert muse.wait_done(page, 0, float("inf"), approved, None, REMOTE) == replies
    assert page.clicks == 1
    assert approved == [request["detail"]]


def test_wait_done_records_only_the_clicked_card():
    page, approved = ApprovalPage(), []
    first, second = decoded_save(), decoded_save()
    first["detail"], second["detail"] = "first policy fixture", "second policy fixture"
    replies = [{"role": "assistant", "text": "done"}]
    with patch.object(muse, "approvals", side_effect=[[first, second], [], []]), \
         patch.object(muse, "messages", return_value=replies), \
         patch.object(muse, "busy", return_value=False), patch.object(muse, "IDLE_SECONDS", 0):
        assert muse.wait_done(page, 0, float("inf"), approved, None, REMOTE) == replies
    assert page.clicks == 1
    assert approved == [first["detail"]]


def test_profile_stays_on_the_documented_default():
    roots = muse.profile_roots()
    assert muse.allowed_profile(roots["default"]) == roots["default"]
    assert muse.allowed_profile(roots["legacy"]) == roots["legacy"]
    assert muse.allowed_profile(roots["swarm"] / "other-profile") == (roots["swarm"] / "other-profile").resolve()
    try:
        muse.allowed_profile("/tmp/not-a-muse-profile")
    except RuntimeError:
        pass
    else:
        raise AssertionError("a profile outside the documented directories was accepted")


class FakeImage:
    """Stands in for PIL: open() reads the downloaded bytes, save() writes them to --out."""
    width, height = 4, 4

    def __init__(self, path):
        self.data = Path(path).read_bytes()

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def save(self, target, _format):
        Path(target).write_bytes(self.data)


def run_main(argv, wait_done=None, delete=None):
    """Run muse-image.py main() with every browser step faked. Returns (exit code, stdout JSON, deletes)."""
    deletes = []

    @muse.contextmanager
    def fake_browser(**_kwargs):
        yield object()

    def fake_wait_done(_page, _since, _deadline, _approved, _cancel, remote):
        return [{"role": "assistant", "text": f"产出文件：{remote}"}]

    def fake_download(_page, _remote, work):
        saved = Path(work) / "download.png"
        saved.write_bytes(b"fake png bytes")
        return saved

    def fake_delete(page, chat):
        deletes.append(chat)
        if delete:
            delete(page, chat)

    stdout, stderr = io.StringIO(), io.StringIO()
    code = 0
    with patch.object(muse, "browser", fake_browser), \
         patch.object(muse, "send", return_value=(CHAT, 0)), \
         patch.object(muse, "rename_or_continue", return_value=True), \
         patch.object(muse, "open_url", return_value=None), \
         patch.object(muse, "wait_done", wait_done or fake_wait_done), \
         patch.object(muse, "download", fake_download), \
         patch.object(muse, "fingerprint", return_value="fp"), \
         patch.object(muse, "delete", fake_delete), \
         patch.object(muse, "Image", types.SimpleNamespace(open=FakeImage), create=True), \
         patch.object(sys, "argv", ["muse-image.py", *argv]), \
         patch.object(sys, "stdout", stdout), redirect_stderr(stderr):
        try:
            muse.main()
        except SystemExit as exit_:
            code = exit_.code
    lines = stdout.getvalue().strip().splitlines()
    assert len(lines) == 1, stdout.getvalue()
    return code, json.loads(lines[0]), deletes, stderr.getvalue()


def test_cleanup_failure_after_saved_png_still_succeeds():
    def row_missing(_page, chat):
        raise RuntimeError(f"当前行不是侧聊天 {chat}，不动它")

    with tempfile.TemporaryDirectory(prefix="muse-cleanup-") as directory:
        out = Path(directory) / "out.png"
        code, result, deletes, stderr = run_main(["--prompt", "a castle", "--out", str(out)], delete=row_missing)
        assert code == 0
        assert result["status"] == "ok"
        assert result["path"] == str(muse.canonical_output_path(out, home=Path.home()))
        assert out.read_bytes() == b"fake png bytes"
        assert result["bytes"] == len(b"fake png bytes")
        assert deletes == [CHAT]
        assert len(result["warnings"]) == 1
        assert "当前行不是侧聊天" in result["warnings"][0]
        assert "side chat cleanup failed" in stderr


def test_clean_success_has_no_warnings_key():
    with tempfile.TemporaryDirectory(prefix="muse-cleanup-") as directory:
        out = Path(directory) / "out.png"
        code, result, deletes, _stderr = run_main(["--prompt", "a castle", "--out", str(out)])
        assert code == 0
        assert result["status"] == "ok"
        assert "warnings" not in result
        assert deletes == [CHAT]


def test_generation_failure_still_exits_nonzero():
    def no_image(*_args):
        raise RuntimeError("Muse 没交出图")

    def row_missing(_page, chat):
        raise RuntimeError(f"当前行不是侧聊天 {chat}，不动它")

    for delete in (None, row_missing):
        with tempfile.TemporaryDirectory(prefix="muse-cleanup-") as directory:
            out = Path(directory) / "out.png"
            code, result, deletes, _stderr = run_main(["--prompt", "a castle", "--out", str(out)],
                                                      wait_done=no_image, delete=delete)
            assert code == 1
            assert result["status"] == "error"
            assert "Muse 没交出图" in result["reason"]
            assert deletes == [CHAT]
            assert not out.exists()


def test_relative_out_resolves_against_cwd_not_home():
    with tempfile.TemporaryDirectory(prefix="muse-cwd-") as cwd, \
         tempfile.TemporaryDirectory(prefix="muse-home-") as home:
        previous = Path.cwd()
        try:
            muse.os.chdir(cwd)
            with patch.dict(muse.os.environ, {"HOME": home}):
                prepared = muse.prepare_local_output("renders/out.png")
                assert prepared == Path(cwd).resolve() / "renders" / "out.png"
                assert prepared.parent.is_dir()
                assert not (Path(home) / "renders").exists()
                # "~" still means the local home.
                assert muse.prepare_local_output("~/pics/out.png") == Path(home).resolve() / "pics" / "out.png"
                code, result, _deletes, _stderr = run_main(["--prompt", "a castle", "--out", "sub/x.png"])
                assert code == 0
                assert result["path"] == str(Path(cwd).resolve() / "sub" / "x.png")
                assert (Path(cwd) / "sub" / "x.png").is_file()
                assert not (Path(home) / "sub").exists()
        finally:
            muse.os.chdir(previous)
    # Approval paths keep resolving relative to the cloud home.
    assert muse.canonical_output_path("workspace/a.png") == muse.CLOUD_HOME / "workspace" / "a.png"


if __name__ == "__main__":
    tests = [fn for name, fn in list(globals().items()) if name.startswith("test_") and callable(fn)]
    for test in tests:
        test()
    print(f"Muse tests ok: {len(tests)}")
