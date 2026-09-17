from docx_to_markdown import (
    BUNDLED_FAMILIES,
    google_font_families,
    google_font_substitutes,
)


def test_google_catalog_is_shipped():
    families = google_font_families()
    assert len(families) > 50
    assert families == sorted(families)
    assert "Fira Sans" in families
    # Variable-only on google/fonts, so outside the pinned static catalog.
    assert "Roboto" not in families


def test_google_substitutes_cover_word_defaults():
    substitutes = google_font_substitutes()
    assert substitutes.get("Calibri") == "Carlito"
    assert set(substitutes) <= set(BUNDLED_FAMILIES) | set(substitutes)


def _with_family(docx, family):
    """A copy of ``docx`` whose every run names ``family``."""
    import io
    import re
    import zipfile

    tag = f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}" w:cs="{family}"/>'
    out = io.BytesIO()
    with zipfile.ZipFile(docx) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                text = data.decode("utf-8")
                text = re.sub(r"<w:rPr>", "<w:rPr>" + tag, text)
                text = re.sub(r"<w:r>(?!<w:rPr>)", "<w:r><w:rPr>" + tag + "</w:rPr>", text)
                data = text.encode("utf-8")
            zout.writestr(item, data)
    return out.getvalue()


def test_unserved_family_is_reported(narrow_pages):
    from docx_to_markdown import convert

    result = convert(_with_family(narrow_pages, "Roboto"))
    assert result.missing_fonts == ["Roboto"]
    assert not result.fonts_complete
    assert [w.code for w in result.warnings] == ["incomplete-font"]


def test_google_fallback_serves_catalog_family(narrow_pages, network):
    from docx_to_markdown import convert

    without = convert(_with_family(narrow_pages, "Fira Sans"))
    assert without.missing_fonts == ["Fira Sans"]
    with_google = convert(_with_family(narrow_pages, "Fira Sans"), google_fonts=True)
    assert with_google.missing_fonts == []
    assert with_google.fonts_complete
    faces = next(f for f in with_google.font_resolution["families"] if f["family"] == "Fira Sans")
    assert {face["via"] for face in faces["faces"]} == {"direct"}
    assert with_google.page_count != without.page_count
