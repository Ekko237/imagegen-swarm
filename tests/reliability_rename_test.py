"""Muse rename is cosmetic: a missing row or a failing dialog must not stop generation."""
import importlib.util
import io
import sys
import types
from contextlib import redirect_stderr
from pathlib import Path


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


def test_approval_requires_exact_output_write():
    remote = "/home/hatch/workspace/imagegen-swarm/img-1.png"
    assert muse.scoped_save_approval(f"write file {remote}", remote) is True
    assert muse.scoped_save_approval("mkdir /home/hatch/workspace/imagegen-swarm", remote) is False
    assert muse.scoped_save_approval(f"create directory {remote}", remote) is False
    assert muse.scoped_save_approval("read /home/hatch/workspace/imagegen-swarm", remote) is False
    assert muse.scoped_save_approval(f"write file {remote} and /tmp/other", remote) is False
    assert muse.scoped_save_approval(f"curl {remote}", remote) is False
    assert muse.scoped_save_approval("write file /home/hatch/workspace/imagegen-swarm/other.png", remote) is False


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


if __name__ == "__main__":
    test_profile_stays_on_the_documented_default()
    test_timeout_skips_and_dismisses()
    test_success_does_not_dismiss()
    test_dismiss_failure_still_continues()
    test_row_miss_warns_once_and_continues()
    test_choose_side_row_by_thread_id()
    test_choose_side_row_refuses_other_chats()
    test_choose_side_row_legacy_current_marker()
    test_approval_requires_exact_output_write()
    print("rename tests ok")
