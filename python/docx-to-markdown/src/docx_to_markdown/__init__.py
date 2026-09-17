"""Convert DOCX to Markdown with Word-faithful pages.

Convert one file::

    from docx_to_markdown import convert

    with open("contract.docx", "rb") as f:
        result = convert(f)
    print(result.markdown)
    for page in result.pages:
        print(page.number, page.markdown[:80])

``convert`` also takes a path or the file's bytes.

Convert many files with one warm process::

    from docx_to_markdown import Converter

    with Converter() as converter:
        for path in paths:
            result = converter.convert(path)
"""

from __future__ import annotations

import base64
import io
import json
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Any, Literal, Optional, Sequence, Union

from ._runtime import ConversionError, RuntimeNotFoundError, Worker, run_once, runtime_path
from .fonts import (
    BUNDLED_FAMILIES,
    FontFace,
    FontsArg,
    font_family,
    font_files,
    font_requests,
    google_font_families,
    google_font_substitutes,
)

__all__ = [
    "BUNDLED_FAMILIES",
    "ConversionError",
    "Converter",
    "DisplayMode",
    "ExportWarning",
    "FontFace",
    "FontFaceError",
    "FontPolicy",
    "ImageSyntax",
    "MarkdownResult",
    "MediaAsset",
    "Page",
    "RuntimeNotFoundError",
    "convert",
    "font_family",
    "font_files",
    "google_font_families",
    "google_font_substitutes",
    "runtime_path",
]

__version__ = "0.1.0"

_UNSET: Any = object()

DisplayMode = Literal["all-markup", "proposed", "original"]
FontPolicy = Literal["best-effort", "strict"]
ImageSyntax = Literal["markdown", "html"]
Source = Union[str, "os.PathLike[str]", bytes, bytearray, memoryview, IO[bytes]]


@dataclass(frozen=True, repr=False)
class Page:
    """One printed page, as Word lays it out."""

    id: str
    number: int
    markdown: str
    header_markdown: str
    footer_markdown: str
    comments: list[dict[str, Any]] = field(default_factory=list)
    tracked_changes: list[dict[str, Any]] = field(default_factory=list)

    def __repr__(self) -> str:
        return (
            f"Page(number={self.number}, {len(self.markdown)} chars, "
            f"{len(self.comments)} comments, {len(self.tracked_changes)} tracked changes)"
        )


@dataclass(frozen=True)
class ExportWarning:
    """Content the export omitted or approximated. ``code`` is stable."""

    code: str
    message: str
    page_number: Optional[int] = None
    part_name: Optional[str] = None


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

    def __repr__(self) -> str:
        return (
            f"MediaAsset(id={self.id!r}, path={self.path!r}, mime_type={self.mime_type!r}, "
            f"{self.pixel_width}x{self.pixel_height}px, {len(self.bytes)} bytes, "
            f"{len(self.occurrences)} occurrences)"
        )


@dataclass(frozen=True, repr=False)
class MarkdownResult:
    """One conversion.

    ``markdown`` is the whole document. ``pages`` carry the same text split at Word's
    page breaks, with headers and footers, for citations. ``raw`` is the converter's
    complete JSON result, including review artifacts and Markdown offsets.
    """

    markdown: str
    pages: list[Page]
    warnings: list[ExportWarning]
    media: list[MediaAsset]
    font_resolution: Optional[dict[str, Any]]
    font_errors: list[FontFaceError]
    raw: dict[str, Any]

    def __repr__(self) -> str:
        fonts = "complete" if self.fonts_complete else f"missing {self.missing_fonts}"
        return (
            f"MarkdownResult({self.page_count} pages, {len(self.markdown)} chars, "
            f"{len(self.media)} images, {len(self.warnings)} warnings, fonts {fonts})"
        )

    @property
    def page_count(self) -> int:
        return len(self.pages)

    @property
    def missing_fonts(self) -> list[str]:
        """Families the document uses that did not measure with all of their faces.

        Supply these with :func:`font_family` for page breaks that match Word.
        """
        if self.font_resolution is None:
            return []
        return [
            f["family"]
            for f in self.font_resolution.get("families", [])
            if f.get("coverage") != "complete"
        ]

    @property
    def fonts_complete(self) -> bool:
        """True when every family the document uses measured with all of its faces."""
        if self.font_resolution is None:
            return False
        if self.font_resolution.get("originFailures"):
            return False
        return all(f.get("coverage") == "complete" for f in self.font_resolution["families"])

    @property
    def review_artifacts(self) -> list[dict[str, Any]]:
        return list(self.raw.get("reviewArtifacts", []))

    @property
    def review_bindings(self) -> list[dict[str, Any]]:
        return list(self.raw.get("reviewBindings", []))

    def write(self, directory: Union[str, "os.PathLike[str]"]) -> Path:
        """Write ``document.md``, ``document.json``, and ``media/`` into a directory.

        The directory is created if needed. The layout matches the Node.js package's
        ``writeMarkdownBundle``, so image links in ``document.md`` resolve in place.
        """
        target = Path(os.fspath(directory))
        target.mkdir(parents=True, exist_ok=True)
        (target / "document.md").write_text(self.markdown, encoding="utf-8")
        (target / "document.json").write_text(
            json.dumps(self.raw, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        for asset in self.media:
            relative = Path(asset.path)
            if relative.is_absolute() or ".." in relative.parts:
                raise ConversionError("bad-media-path", f"Refusing media path {asset.path!r}")
            out = target / relative
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(asset.bytes)
        return target


def _request(
    fonts: Sequence[FontFace],
    font_policy: FontPolicy,
    google_fonts: bool,
    images: Union[bool, ImageSyntax],
    display_mode: DisplayMode,
) -> dict[str, Any]:
    if font_policy not in ("best-effort", "strict"):
        raise ValueError("font_policy must be 'best-effort' or 'strict'")
    if display_mode not in ("all-markup", "proposed", "original"):
        raise ValueError("display_mode must be 'all-markup', 'proposed', or 'original'")
    if images not in (True, False, "markdown", "html"):
        raise ValueError("images must be a bool, 'markdown', or 'html'")
    return {
        "fonts": font_requests(fonts),
        "fontPolicy": font_policy,
        "googleFonts": bool(google_fonts),
        "images": {"syntax": images} if isinstance(images, str) else bool(images),
        "displayMode": display_mode,
    }


def _with_source(source: Source, request: dict[str, Any], send) -> dict[str, Any]:
    if isinstance(source, (bytes, bytearray, memoryview)):
        data: Optional[bytes] = bytes(source)
    elif hasattr(source, "read"):
        if isinstance(source, io.TextIOBase) or "b" not in getattr(source, "mode", "b"):
            raise TypeError("open the file in binary mode: open(path, 'rb')")
        data = source.read()  # type: ignore[union-attr]
        if not isinstance(data, (bytes, bytearray)):
            raise TypeError("open the file in binary mode: open(path, 'rb')")
        data = bytes(data)
    else:
        data = None
    if data is not None:
        with tempfile.TemporaryDirectory(prefix="docx-to-markdown-") as scratch:
            path = Path(scratch, "document.docx")
            path.write_bytes(data)
            return send({**request, "docx": str(path)})
    path = Path(os.fspath(source))  # type: ignore[arg-type]
    if not path.is_file():
        raise FileNotFoundError(path)
    return send({**request, "docx": str(path.resolve())})


def _to_result(payload: dict[str, Any]) -> MarkdownResult:
    raw = payload["result"]
    bytes_by_id = {
        entry["id"]: base64.b64decode(entry["bytes"]) for entry in payload.get("mediaBytes", [])
    }
    return MarkdownResult(
        markdown=raw["markdown"],
        pages=[
            Page(
                id=p["id"],
                number=p["number"],
                markdown=p["markdown"],
                header_markdown=p.get("headerMarkdown", ""),
                footer_markdown=p.get("footerMarkdown", ""),
                comments=list(p.get("comments", [])),
                tracked_changes=list(p.get("trackedChanges", [])),
            )
            for p in raw.get("pages", [])
        ],
        warnings=[
            ExportWarning(w["code"], w["message"], w.get("pageNumber"), w.get("partName"))
            for w in raw.get("warnings", [])
        ],
        media=[
            MediaAsset(
                id=a["id"],
                path=a["path"],
                url=a["url"],
                mime_type=a["mimeType"],
                bytes=bytes_by_id.get(a["id"], b""),
                pixel_width=a["pixelWidth"],
                pixel_height=a["pixelHeight"],
                occurrences=list(a.get("occurrences", [])),
            )
            for a in raw.get("media", [])
        ],
        font_resolution=raw.get("fontResolution"),
        font_errors=[FontFaceError(e["path"], e["reason"]) for e in payload.get("fontErrors", [])],
        raw=raw,
    )


def convert(
    source: Source,
    *,
    fonts: FontsArg = (),
    font_policy: FontPolicy = "best-effort",
    google_fonts: bool = False,
    images: Union[bool, ImageSyntax] = False,
    display_mode: DisplayMode = "all-markup",
    timeout: Optional[float] = 300,
) -> MarkdownResult:
    """Convert one DOCX file to Markdown.

    Each call starts a converter process. For many files, use :class:`Converter`.

    Args:
        source: A binary file object (``open(path, "rb")``), a path, or the file's bytes.
        fonts: Font files to measure with, first wins. They take precedence over the
            bundled Word substitutes. A directory or file path is scanned and each face's
            family, weight, and style are read from the file. Use :func:`font_family` or
            :func:`font_files` with ``family=`` to register files under the name the
            document uses.
        font_policy: ``"strict"`` fails the conversion when a requested family is missing
            a face or a font origin fails. ``"best-effort"`` paginates with approximations
            and reports them in ``warnings`` and ``font_resolution``.
        google_fonts: Fetch families the local fonts cannot serve from a pinned Google
            Fonts catalog. Needs network access. :func:`google_font_families` lists what
            the catalog can serve; other families still need font files.
        images: ``True`` extracts images and links them with Markdown syntax.
            ``"html"`` uses ``<img>`` tags that keep displayed sizes.
        display_mode: How tracked changes are projected. ``"all-markup"`` keeps every
            pending insertion and deletion visible; ``"proposed"`` accepts them all;
            ``"original"`` rejects them all.
        timeout: Seconds before the conversion is abandoned, or ``None`` to wait.
    """
    request = _request(fonts, font_policy, google_fonts, images, display_mode)
    payload = _with_source(source, request, lambda r: run_once(r, timeout=timeout))
    return _to_result(payload)


class Converter:
    """A warm converter for many conversions.

    The first call starts one process; later calls reuse it, so each conversion costs
    only the layout itself. Close it with ``with`` or :meth:`close`. Options given here
    are defaults for every call and can be overridden per call.
    """

    def __init__(
        self,
        *,
        fonts: Sequence[FontFace] = (),
        font_policy: FontPolicy = "best-effort",
        google_fonts: bool = False,
        images: Union[bool, ImageSyntax] = False,
        display_mode: DisplayMode = "all-markup",
        timeout: Optional[float] = 300,
    ) -> None:
        self._defaults = dict(
            fonts=fonts if isinstance(fonts, (FontFace, str, os.PathLike)) else tuple(fonts),
            font_policy=font_policy,
            google_fonts=google_fonts,
            images=images,
            display_mode=display_mode,
        )
        _request(**self._defaults)  # validate eagerly
        self.timeout = timeout
        self._worker = Worker()

    def convert(
        self,
        source: Source,
        *,
        fonts: Optional[FontsArg] = None,
        font_policy: Optional[FontPolicy] = None,
        google_fonts: Optional[bool] = None,
        images: Optional[Union[bool, ImageSyntax]] = None,
        display_mode: Optional[DisplayMode] = None,
        timeout: Optional[float] = _UNSET,
    ) -> MarkdownResult:
        """Convert one file. Keywords match :func:`convert` and override the defaults."""
        overrides = {
            "fonts": fonts,
            "font_policy": font_policy,
            "google_fonts": google_fonts,
            "images": images,
            "display_mode": display_mode,
        }
        options = {**self._defaults, **{k: v for k, v in overrides.items() if v is not None}}
        request = _request(**options)
        wait = self.timeout if timeout is _UNSET else timeout
        payload = _with_source(source, request, lambda r: self._worker.request(r, timeout=wait))
        return _to_result(payload)

    @property
    def running(self) -> bool:
        return self._worker.running

    def close(self) -> None:
        self._worker.close()

    def __enter__(self) -> "Converter":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
