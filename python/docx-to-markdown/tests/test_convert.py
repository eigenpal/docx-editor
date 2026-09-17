import pytest

from docx_to_markdown import ConversionError, FontFace, MarkdownResult, convert, font_family


def test_bundled_fonts_paginate_like_word(narrow_pages):
    result = convert(narrow_pages)
    assert isinstance(result, MarkdownResult)
    # The Node.js library lays this fixture out on 15 pages with Carlito standing in for Calibri.
    assert result.page_count == 15
    assert result.warnings == []
    families = {f["family"]: f["coverage"] for f in result.font_resolution["families"]}
    assert families == {"Calibri": "complete"}
    assert result.font_errors == []
    assert result.markdown.strip()


def test_bytes_source_matches_path_source(narrow_pages):
    from_path = convert(narrow_pages)
    from_bytes = convert(narrow_pages.read_bytes())
    assert from_bytes.markdown == from_path.markdown
    assert from_bytes.page_count == from_path.page_count


def test_caller_fonts_take_precedence(narrow_pages, font_assets):
    carlito = font_family(
        "Calibri",
        font_assets / "Carlito-Regular.ttf",
        font_assets / "Carlito-Bold.ttf",
        font_assets / "Carlito-Italic.ttf",
        font_assets / "Carlito-BoldItalic.ttf",
    )
    result = convert(narrow_pages, fonts=carlito)
    assert result.page_count == 15
    assert result.font_errors == []
    faces = result.font_resolution["families"][0]["faces"]
    assert len(faces) == 4


def test_unreadable_font_is_reported_not_fatal(narrow_pages, tmp_path):
    bogus = tmp_path / "missing.ttf"
    result = convert(narrow_pages, fonts=[FontFace(str(bogus), "Calibri")])
    assert [e.path for e in result.font_errors] == [str(bogus)]
    assert result.page_count == 15


def test_invalid_font_bytes_are_reported(tmp_path, narrow_pages):
    junk = tmp_path / "junk.ttf"
    junk.write_bytes(b"not a font")
    result = convert(narrow_pages, fonts=[FontFace(str(junk), "Calibri")])
    assert result.font_errors and "junk.ttf" in result.font_errors[0].path


def test_missing_docx_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        convert(tmp_path / "absent.docx")


def test_corrupt_docx_raises_conversion_error():
    with pytest.raises(ConversionError):
        convert(b"PK\x03\x04 definitely not a document")


def test_font_face_validation():
    with pytest.raises(ValueError):
        FontFace("a.ttf", "")
    with pytest.raises(ValueError):
        FontFace("a.ttf", "X", weight=0)
    with pytest.raises(ValueError):
        FontFace("a.ttf", "X", style="oblique")  # type: ignore[arg-type]
