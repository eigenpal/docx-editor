"""Command line: ``docx-to-markdown INPUT.docx [-o OUT.md]``."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from . import ConversionError, Converter, FontFace, __version__


def _font(spec: str) -> FontFace | str:
    """``PATH`` alone reads family, weight, and style from the file (a directory is
    scanned). ``PATH:FAMILY[:WEIGHT[:STYLE]]`` registers one file under a document's
    family name. A Windows drive letter is allowed in PATH."""
    parts = spec.rsplit(":", 3)
    # Re-join a drive letter split off the path, as in C:\fonts\Aptos.ttf:Aptos.
    while len(parts) > 2 and len(parts[0]) == 1 and parts[0].isalpha():
        parts = [parts[0] + ":" + parts[1], *parts[2:]]
    if len(parts) == 1 or (len(parts) == 2 and len(parts[0]) == 1 and parts[0].isalpha()):
        return spec
    path, family = parts[0], parts[1]
    weight = int(parts[2]) if len(parts) > 2 and parts[2] else 400
    style = parts[3] if len(parts) > 3 and parts[3] else "normal"
    try:
        return FontFace(path, family, weight, style)  # type: ignore[arg-type]
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="docx-to-markdown",
        description="Convert DOCX files to Markdown with Word-faithful pages.",
    )
    parser.add_argument("inputs", nargs="+", type=Path, metavar="INPUT.docx")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Markdown file to write (one input only). Default: stdout.",
    )
    parser.add_argument(
        "--bundle",
        type=Path,
        metavar="DIR",
        help="Write document.md, document.json, and media/ into DIR "
        "(a subdirectory per input when there are several).",
    )
    parser.add_argument("--json", action="store_true", help="Print the full JSON result instead.")
    parser.add_argument(
        "--images",
        nargs="?",
        const="markdown",
        choices=("markdown", "html"),
        help="Extract images; 'html' keeps displayed sizes. Needs --bundle to save the files.",
    )
    parser.add_argument(
        "--font",
        action="append",
        default=[],
        type=_font,
        metavar="PATH[:FAMILY[:WEIGHT[:STYLE]]]",
        help="A font file or directory to measure with; family, weight, and style are "
        "read from each file. Add :FAMILY to register a file under the name the "
        "document uses. Repeatable.",
    )
    parser.add_argument("--strict", action="store_true", help="Fail when a font is missing.")
    parser.add_argument(
        "--google-fonts", action="store_true", help="Fetch missing families from Google Fonts."
    )
    parser.add_argument(
        "--display-mode",
        choices=("all-markup", "proposed", "original"),
        default="all-markup",
        help="How tracked changes are projected.",
    )
    parser.add_argument("--timeout", type=float, default=300, help="Seconds per file.")
    parser.add_argument("-q", "--quiet", action="store_true", help="Hide warnings.")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.output and len(args.inputs) > 1:
        parser.error("--output takes one input; use --bundle for several")
    if args.json and args.output:
        parser.error("--json prints to stdout; drop --output")

    converter = Converter(
        fonts=args.font,
        font_policy="strict" if args.strict else "best-effort",
        google_fonts=args.google_fonts,
        images=args.images or False,
        display_mode=args.display_mode,
        timeout=args.timeout,
    )
    status = 0
    with converter:
        for source in args.inputs:
            try:
                result = converter.convert(source)
            except FileNotFoundError:
                print(f"{source}: no such file", file=sys.stderr)
                status = 1
                continue
            except ConversionError as exc:
                print(f"{source}: {exc.message} [{exc.code}]", file=sys.stderr)
                status = 1
                continue
            if not args.quiet:
                for error in result.font_errors:
                    print(f"{source}: font {error.path}: {error.reason}", file=sys.stderr)
                for warning in result.warnings:
                    where = f" (page {warning.page_number})" if warning.page_number else ""
                    print(f"{source}: {warning.code}{where}: {warning.message}", file=sys.stderr)
            if args.bundle:
                target = args.bundle if len(args.inputs) == 1 else args.bundle / source.stem
                result.write(target)
                if not args.quiet:
                    print(f"{source}: {result.page_count} pages -> {target}", file=sys.stderr)
            elif args.json:
                import json

                sys.stdout.write(json.dumps(result.raw, ensure_ascii=False))
                sys.stdout.write("\n")
            elif args.output:
                args.output.write_text(result.markdown, encoding="utf-8")
            else:
                sys.stdout.write(result.markdown)
                if not result.markdown.endswith("\n"):
                    sys.stdout.write("\n")
    return status


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
