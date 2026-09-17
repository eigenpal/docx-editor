"""Font faces the converter measures with.

The converter paginates like Word only when it can measure the document's fonts. It
ships metric-compatible substitutes for Word's defaults (see :data:`BUNDLED_FAMILIES`).
Register any other family with :func:`font_family`, under the name the document uses.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Literal, Optional, Sequence, Union

FontStyle = Literal["normal", "italic"]
PathLike = Union[str, "os.PathLike[str]"]

#: Word families the package measures with bundled metric-compatible substitutes.
BUNDLED_FAMILIES: tuple[str, ...] = (
    "Calibri",
    "Cambria",
    "Times New Roman",
    "Arial",
    "Courier New",
    "Century Gothic",
)


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
    bold: Optional[PathLike] = None,
    italic: Optional[PathLike] = None,
    bold_italic: Optional[PathLike] = None,
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


def font_requests(fonts: Sequence[FontFace]) -> list[dict[str, Any]]:
    requests = []
    for face in fonts:
        if not isinstance(face, FontFace):
            raise TypeError(f"fonts must hold FontFace values, got {type(face).__name__}")
        requests.append(face.to_request())
    return requests
