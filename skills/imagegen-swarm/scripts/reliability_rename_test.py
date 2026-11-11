"""Muse rename is cosmetic: a failing dialog must not stop generation."""
import importlib.util
import sys
import types
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
spec = importlib.util.spec_from_file_location("muse_image_under_test", here / "muse-image.py")
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


if __name__ == "__main__":
    test_timeout_skips_and_dismisses()
    test_success_does_not_dismiss()
    test_dismiss_failure_still_continues()
    print("rename tests ok")
