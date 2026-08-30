#!/usr/bin/env python3
"""Own and inspect a real X11 clipboard for the Linux desktop E2E test."""

from __future__ import annotations

import argparse
import os
import stat
import sys
from pathlib import Path

import gi

gi.require_version("Gdk", "3.0")
gi.require_version("GdkPixbuf", "2.0")
gi.require_version("Gtk", "3.0")
from gi.repository import Gdk, GdkPixbuf, Gtk  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402


FIXTURE_SIZE = (2048, 1536)


def clipboard() -> Gtk.Clipboard:
    display = Gdk.Display.get_default()
    if display is None:
        raise RuntimeError("the isolated X display is unavailable")
    return Gtk.Clipboard.get_for_display(display, Gdk.SELECTION_CLIPBOARD)


def create_fixture(path: Path) -> None:
    """Create a sizeable, deterministic, opaque RGBA image.

    The image is large enough to exercise clipboard transfer and PNG encoding,
    while broad colour blocks keep the test fast on software-rendered CI hosts.
    """

    width, height = FIXTURE_SIZE
    image = Image.new("RGBA", FIXTURE_SIZE, (19, 31, 47, 255))
    draw = ImageDraw.Draw(image)
    colours = (
        (231, 76, 60, 255),
        (46, 204, 113, 255),
        (52, 152, 219, 255),
        (241, 196, 15, 255),
        (155, 89, 182, 255),
        (26, 188, 156, 255),
    )
    band = width // len(colours)
    for index, colour in enumerate(colours):
        left = index * band
        right = width if index == len(colours) - 1 else (index + 1) * band
        draw.rectangle((left, 0, right - 1, height - 1), fill=colour)
    # Asymmetric markers catch dimensions, orientation, and channel swaps.
    draw.rectangle((17, 23, 211, 197), fill=(3, 7, 251, 255))
    draw.rectangle((width - 293, height - 181, width - 29, height - 31), fill=(247, 11, 83, 255))
    draw.line((0, height - 1, width - 1, 0), fill=(255, 255, 255, 255), width=11)
    image.save(path, format="PNG")


def serve_text(value: str) -> None:
    selection = clipboard()
    selection.set_text(value, -1)
    print("READY", flush=True)
    Gtk.main()


def serve_image(path: Path) -> None:
    pixbuf = GdkPixbuf.Pixbuf.new_from_file(str(path))
    selection = clipboard()
    selection.set_image(pixbuf)
    print("READY", flush=True)
    Gtk.main()


def read_text() -> None:
    value = clipboard().wait_for_text()
    if value is None:
        raise RuntimeError("the X11 clipboard does not contain text")
    sys.stdout.write(value)


def verify_staged(fixture: Path, staged: Path) -> None:
    if not staged.is_file():
        raise RuntimeError(f"staged PNG does not exist: {staged}")
    mode = stat.S_IMODE(os.stat(staged).st_mode)
    if mode != 0o600:
        raise RuntimeError(f"staged PNG mode is {mode:o}, expected 600")

    with Image.open(fixture) as expected_image:
        expected = expected_image.convert("RGBA")
        with Image.open(staged) as actual_image:
            actual = actual_image.convert("RGBA")
            if actual.size != expected.size:
                raise RuntimeError(
                    f"staged PNG size is {actual.size}, expected {expected.size}"
                )
            if actual.tobytes() != expected.tobytes():
                raise RuntimeError("staged PNG pixels differ from the X11 clipboard image")

    print(f"VERIFIED {staged} {expected.width}x{expected.height} mode=600")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create-image")
    create.add_argument("path", type=Path)

    text = subparsers.add_parser("serve-text")
    text.add_argument("value")

    image = subparsers.add_parser("serve-image")
    image.add_argument("path", type=Path)

    subparsers.add_parser("read-text")

    verify = subparsers.add_parser("verify-staged")
    verify.add_argument("fixture", type=Path)
    verify.add_argument("staged", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "create-image":
        create_fixture(args.path)
    elif args.command == "serve-text":
        serve_text(args.value)
    elif args.command == "serve-image":
        serve_image(args.path)
    elif args.command == "read-text":
        read_text()
    elif args.command == "verify-staged":
        verify_staged(args.fixture, args.staged)
    else:  # pragma: no cover - argparse makes this unreachable.
        raise AssertionError(args.command)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # Keep shell diagnostics concise and actionable.
        print(f"clipboard fixture error: {error}", file=sys.stderr)
        raise SystemExit(1)
