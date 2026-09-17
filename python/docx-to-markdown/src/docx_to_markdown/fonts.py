"""Font faces the converter measures with.

The converter paginates like Word only when it can measure the document's fonts. It
ships metric-compatible substitutes for Word's defaults (see :data:`BUNDLED_FAMILIES`).
Register any other family with :func:`font_family`, under the name the document uses.
"""

from __future__ import annotations

import json
import os
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

FontStyle = Literal["normal", "italic"]
PathLike = str | os.PathLike[str]

#: Word families the package measures with bundled metric-compatible substitutes.
BUNDLED_FAMILIES: tuple[str, ...] = (
    "Calibri",
    "Cambria",
    "Times New Roman",
    "Arial",
    "Courier New",
    "Century Gothic",
)


def _google_catalog() -> dict[str, Any]:
    path = Path(__file__).with_name("_vendor") / "google-fonts.json"
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {"revision": None, "families": [], "substitutes": {}}


def google_font_families() -> list[str]:
    """Families ``google_fonts=True`` can fetch, in alphabetical order.

    The catalog is a pinned, closed set of families that ship four static faces.
    Variable-only families such as Roboto, Open Sans, and Lato are not in it; supply
    those as files with :func:`font_family`.
    """
    return sorted(_google_catalog()["families"])


def google_font_substitutes() -> dict[str, str]:
    """Word families ``google_fonts=True`` serves through a metric-compatible catalog face."""
    return dict(_google_catalog()["substitutes"])


@dataclass(frozen=True)
class FontFace:
    """One font file, registered under the family name the document uses.

    Args:
        path: A ``.ttf`` or ``.otf`` file.
        family: The family name as the document spells it, for example ``"Aptos"``.
        weight: CSS weight, ``400`` for regular and ``700`` for bold.
        style: ``"normal"`` or ``"italic"``.
    """

    path: str
    family: str
    weight: int = 400
    style: FontStyle = "normal"

    def __post_init__(self) -> None:
        if not isinstance(self.family, str) or not self.family.strip():
            raise ValueError("family must be a nonempty name")
        if not isinstance(self.weight, int) or not 1 <= self.weight <= 1000:
            raise ValueError("weight must be an integer between 1 and 1000")
        if self.style not in ("normal", "italic"):
            raise ValueError("style must be 'normal' or 'italic'")
        object.__setattr__(self, "path", os.fspath(self.path))

    def to_request(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "family": self.family,
            "weight": self.weight,
            "style": self.style,
        }


def font_family(
    family: str,
    regular: PathLike,
    bold: PathLike | None = None,
    italic: PathLike | None = None,
    bold_italic: PathLike | None = None,
) -> list[FontFace]:
    """The static faces of one family.

    Faces you leave out are approximated from the ones given, and the font report
    says so. Supply all four for exact pagination.
    """
    faces = [FontFace(os.fspath(regular), family)]
    if bold is not None:
        faces.append(FontFace(os.fspath(bold), family, 700))
    if italic is not None:
        faces.append(FontFace(os.fspath(italic), family, 400, "italic"))
    if bold_italic is not None:
        faces.append(FontFace(os.fspath(bold_italic), family, 700, "italic"))
    return faces


FONT_EXTENSIONS = (".ttf", ".otf", ".ttc")


def font_files(
    *paths: PathLike,
    family: str | None = None,
    recursive: bool = True,
) -> list[FontFace]:
    """Faces read from font files, with family, weight, and style taken from each file.

    ``paths`` are ``.ttf``, ``.otf``, or ``.ttc`` files, or directories to scan. Pass
    ``family`` to register every face under the name the document uses instead of the
    name inside the file, for example ``font_files("carlito/", family="Calibri")``.
    Files that are not fonts are skipped; a directory with no font files raises
    ``FileNotFoundError``.
    """
    from ._sfnt import NotAFontError, read_face

    files: list[Path] = []
    for entry in paths:
        path = Path(os.fspath(entry))
        if path.is_dir():
            found = sorted(
                p
                for p in (path.rglob("*") if recursive else path.iterdir())
                if p.is_file() and p.suffix.lower() in FONT_EXTENSIONS
            )
            if not found:
                raise FileNotFoundError(f"no font files under {path}")
            files.extend(found)
        elif path.is_file():
            files.append(path)
        else:
            raise FileNotFoundError(path)

    faces: list[FontFace] = []
    for file in files:
        try:
            info = read_face(file.read_bytes())
        except NotAFontError:
            continue
        faces.append(
            FontFace(
                str(file),
                family or info.family,
                info.weight,
                "italic" if info.italic else "normal",
            )
        )
    return faces


FontsArg = FontFace | PathLike | Sequence[FontFace | PathLike]


def font_requests(fonts: FontsArg) -> list[dict[str, Any]]:
    """Normalize the ``fonts`` argument: faces as given, paths and directories scanned."""
    if isinstance(fonts, (FontFace, str, os.PathLike)):
        fonts = [fonts]
    requests: list[dict[str, Any]] = []
    for entry in fonts:
        if isinstance(entry, FontFace):
            requests.append(entry.to_request())
        elif isinstance(entry, (str, os.PathLike)):
            requests.extend(face.to_request() for face in font_files(entry))
        else:
            raise TypeError(f"fonts must hold FontFace values or paths, got {type(entry).__name__}")
    return requests
