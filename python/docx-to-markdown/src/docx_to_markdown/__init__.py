"""Convert DOCX to Markdown with Word-faithful pages.

Example::

    from docx_to_markdown import convert

    result = convert("contract.docx")
    print(result.markdown)
    for page in result.pages:
        print(page["pageNumber"], len(page["markdown"]))
"""

from __future__ import annotations

import base64
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Sequence, Union

from ._runtime import ConversionError, RuntimeNotFoundError, run, runtime_path
from .fonts import FontFace, font_family, font_requests

__all__ = [
    "ConversionError",
    "FontFace",
    "FontFaceError",
    "ImageSyntax",
    "MarkdownResult",
    "MediaAsset",
    "RuntimeNotFoundError",
    "convert",
    "font_family",
    "runtime_path",
]

__version__ = "0.1.0"

DisplayMode = Literal["all-markup", "proposed", "original"]
FontPolicy = Literal["best-effort", "strict"]
ImageSyntax = Literal["markdown", "html"]
Source = Union[str, "os.PathLike[str]", bytes, bytearray, memoryview]


@dataclass(frozen=True)
class FontFaceError:
    """A font file the converter could not admit. The export still ran without it."""

    path: str
    reason: str


@dataclass(frozen=True)
class MediaAsset:
    """One unique image, with its bytes and every page occurrence."""

    id: str
    path: str
    url: str
    mime_type: str
    bytes: bytes
    pixel_width: int
    pixel_height: int
    occurrences: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class MarkdownResult:
    """One conversion. ``raw`` holds the converter's full JSON result."""

    markdown: str
    pages: list[dict[str, Any]]
    warnings: list[dict[str, Any]]
    media: list[MediaAsset]
    font_resolution: dict[str, Any] | None
    font_errors: list[FontFaceError]
    review_artifacts: list[dict[str, Any]]
    review_bindings: list[dict[str, Any]]
    pagination: dict[str, Any]
    raw: dict[str, Any]

    @property
    def page_count(self) -> int:
        return len(self.pages)


def convert(
    source: Source,
    *,
    fonts: Sequence[FontFace] = (),
    font_policy: FontPolicy = "best-effort",
    google_fonts: bool = False,
    images: Union[bool, ImageSyntax] = False,
    display_mode: DisplayMode = "all-markup",
    timeout: float | None = 300,
) -> MarkdownResult:
    """Convert one DOCX file or byte string to Markdown.

    Args:
        source: A path to a ``.docx`` file, or its bytes.
        fonts: Font files to measure with, first wins. They take precedence over the
            bundled Word substitutes. Register each under the family name the document uses.
        font_policy: ``"strict"`` fails the conversion when a requested family is missing
            a face or a font origin fails. ``"best-effort"`` paginates with approximations
            and reports them in ``warnings`` and ``font_resolution``.
        google_fonts: Fetch families the local fonts cannot serve from Google Fonts.
            Needs network access.
        images: ``True`` extracts images and links them with Markdown syntax.
            ``"html"`` uses ``<img>`` tags that keep displayed sizes.
        display_mode: How tracked changes are projected. ``"all-markup"`` keeps every
            pending insertion and deletion visible.
        timeout: Seconds before the conversion is abandoned, or ``None`` to wait.
    """
    if font_policy not in ("best-effort", "strict"):
        raise ValueError("font_policy must be 'best-effort' or 'strict'")
    if display_mode not in ("all-markup", "proposed", "original"):
        raise ValueError("display_mode must be 'all-markup', 'proposed', or 'original'")
    if images not in (True, False, "markdown", "html"):
        raise ValueError("images must be a bool, 'markdown', or 'html'")

    request: dict[str, Any] = {
        "fonts": font_requests(fonts),
        "fontPolicy": font_policy,
        "googleFonts": bool(google_fonts),
        "images": {"syntax": images} if isinstance(images, str) else bool(images),
        "displayMode": display_mode,
    }

    if isinstance(source, (bytes, bytearray, memoryview)):
        with tempfile.TemporaryDirectory(prefix="docx-to-markdown-") as scratch:
            path = Path(scratch, "document.docx")
            path.write_bytes(bytes(source))
            payload = run({**request, "docx": str(path)}, timeout=timeout)
    else:
        path = Path(os.fspath(source))
        if not path.is_file():
            raise FileNotFoundError(path)
        payload = run({**request, "docx": str(path.resolve())}, timeout=timeout)

    return _to_result(payload)


def _to_result(payload: dict[str, Any]) -> MarkdownResult:
    raw = payload["result"]
    bytes_by_id = {
        entry["id"]: base64.b64decode(entry["bytes"]) for entry in payload.get("mediaBytes", [])
    }
    media = [
        MediaAsset(
            id=asset["id"],
            path=asset["path"],
            url=asset["url"],
            mime_type=asset["mimeType"],
            bytes=bytes_by_id.get(asset["id"], b""),
            pixel_width=asset["pixelWidth"],
            pixel_height=asset["pixelHeight"],
            occurrences=list(asset.get("occurrences", [])),
        )
        for asset in raw.get("media", [])
    ]
    return MarkdownResult(
        markdown=raw["markdown"],
        pages=list(raw.get("pages", [])),
        warnings=list(raw.get("warnings", [])),
        media=media,
        font_resolution=raw.get("fontResolution"),
        font_errors=[FontFaceError(e["path"], e["reason"]) for e in payload.get("fontErrors", [])],
        review_artifacts=list(raw.get("reviewArtifacts", [])),
        review_bindings=list(raw.get("reviewBindings", [])),
        pagination=dict(raw.get("pagination", {})),
        raw=raw,
    )
