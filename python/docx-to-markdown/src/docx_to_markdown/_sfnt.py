"""Read family, weight, and style from a TrueType or OpenType file. No dependencies."""

from __future__ import annotations

import struct
from dataclasses import dataclass

_ITALIC_WORDS = ("italic", "oblique")
_WEIGHT_WORDS = (
    ("thin", 100),
    ("hairline", 100),
    ("extralight", 200),
    ("ultralight", 200),
    ("light", 300),
    ("regular", 400),
    ("normal", 400),
    ("book", 400),
    ("medium", 500),
    ("semibold", 600),
    ("demibold", 600),
    ("extrabold", 800),
    ("ultrabold", 800),
    ("bold", 700),
    ("black", 900),
    ("heavy", 900),
)


@dataclass(frozen=True)
class FaceInfo:
    family: str
    weight: int
    italic: bool
    variable: bool


class NotAFontError(ValueError):
    pass


def _tables(data: bytes) -> dict[str, tuple[int, int]]:
    if len(data) < 12:
        raise NotAFontError("file is too short to be a font")
    tag = data[:4]
    if tag == b"ttcf":
        # A collection: read the first face.
        (offset,) = struct.unpack(">I", data[12:16])
    elif tag in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
        offset = 0
    else:
        raise NotAFontError("not a TrueType or OpenType font")
    (count,) = struct.unpack(">H", data[offset + 4 : offset + 6])
    tables: dict[str, tuple[int, int]] = {}
    pos = offset + 12
    for _ in range(count):
        if pos + 16 > len(data):
            raise NotAFontError("truncated table directory")
        name, _checksum, start, length = struct.unpack(">4sIII", data[pos : pos + 16])
        tables[name.decode("latin-1")] = (start, length)
        pos += 16
    return tables


def _name_strings(data: bytes, start: int, length: int) -> dict[int, str]:
    table = data[start : start + length]
    if len(table) < 6:
        return {}
    _fmt, count, string_offset = struct.unpack(">HHH", table[:6])
    best: dict[int, tuple[int, str]] = {}
    for i in range(count):
        rec = table[6 + i * 12 : 18 + i * 12]
        if len(rec) < 12:
            break
        platform, encoding, language, name_id, slen, soff = struct.unpack(">HHHHHH", rec)
        raw = table[string_offset + soff : string_offset + soff + slen]
        if platform == 3 and encoding in (0, 1, 10):
            rank, text = (3 if language == 0x409 else 2), raw.decode("utf-16-be", "replace")
        elif platform == 0:
            rank, text = 1, raw.decode("utf-16-be", "replace")
        elif platform == 1 and encoding == 0:
            rank, text = 0, raw.decode("mac-roman", "replace")
        else:
            continue
        if name_id not in best or best[name_id][0] < rank:
            best[name_id] = (rank, text.strip("\x00").strip())
    return {k: v[1] for k, v in best.items()}


def _weight_from_words(text: str) -> int | None:
    lowered = text.lower().replace(" ", "").replace("-", "")
    for word, weight in _WEIGHT_WORDS:
        if word in lowered:
            return weight
    return None


def read_face(data: bytes) -> FaceInfo:
    """Family, weight, and slant of the first face in ``data``."""
    tables = _tables(data)
    if "name" not in tables:
        raise NotAFontError("font has no name table")
    names = _name_strings(data, *tables["name"])
    family = names.get(16) or names.get(1)
    if not family:
        raise NotAFontError("font names no family")
    subfamily = names.get(17) or names.get(2) or ""

    weight: int | None = None
    italic = False
    if "OS/2" in tables:
        start, length = tables["OS/2"]
        os2 = data[start : start + length]
        if len(os2) >= 64:
            (us_weight,) = struct.unpack(">H", os2[4:6])
            (fs_selection,) = struct.unpack(">H", os2[62:64])
            if 1 <= us_weight <= 1000:
                weight = us_weight
            italic = bool(fs_selection & 0x01)
    if weight is None:
        weight = _weight_from_words(subfamily) or 400
    if not italic:
        italic = any(word in subfamily.lower() for word in _ITALIC_WORDS)
    return FaceInfo(family=family, weight=weight, italic=italic, variable="fvar" in tables)
