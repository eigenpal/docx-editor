import pytest

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
    fira = with_google.font_resolution.family("Fira Sans")
    assert fira is not None and {face.via for face in fira.faces} == {"direct"}
    assert with_google.page_count != without.page_count


def test_read_face_from_bundled_files(font_assets):
    from docx_to_markdown._sfnt import read_face

    bold = read_face((font_assets / "Carlito-Bold.ttf").read_bytes())
    assert (bold.family, bold.weight, bold.italic, bold.variable) == ("Carlito", 700, False, False)
    italic = read_face((font_assets / "Carlito-Italic.ttf").read_bytes())
    assert (italic.family, italic.weight, italic.italic) == ("Carlito", 400, True)
    otf = read_face((font_assets / "TeXGyreAdventor-BoldItalic.otf").read_bytes())
    assert (otf.family, otf.weight, otf.italic) == ("TeX Gyre Adventor", 700, True)


def test_read_face_rejects_non_fonts():
    import pytest

    from docx_to_markdown._sfnt import NotAFontError, read_face

    with pytest.raises(NotAFontError):
        read_face(b"not a font at all")


def test_font_files_scans_a_directory(font_assets):
    from docx_to_markdown import font_files

    faces = font_files(font_assets)
    assert len(faces) == 24
    families = {f.family for f in faces}
    assert {"Carlito", "Caladea", "Liberation Sans", "TeX Gyre Adventor"} <= families
    carlito = sorted((f.weight, f.style) for f in faces if f.family == "Carlito")
    assert carlito == [(400, "italic"), (400, "normal"), (700, "italic"), (700, "normal")]
    aliased = font_files(font_assets / "Carlito-Regular.ttf", family="Calibri")
    assert [(f.family, f.weight) for f in aliased] == [("Calibri", 400)]


def test_font_files_skips_non_fonts_and_rejects_empty(tmp_path):
    import pytest

    from docx_to_markdown import font_files

    (tmp_path / "notes.ttf").write_bytes(b"junk")
    assert font_files(tmp_path) == []
    with pytest.raises(FileNotFoundError):
        font_files(tmp_path / "empty")
    (tmp_path / "empty").mkdir()
    with pytest.raises(FileNotFoundError):
        font_files(tmp_path / "empty")


def test_convert_accepts_a_font_directory(narrow_pages, font_assets):
    from docx_to_markdown import convert, font_files

    doc = _with_family(narrow_pages, "Carlito")

    def carlito_ids(result):
        carlito = result.font_resolution.family("Carlito")
        assert carlito is not None
        return sorted(face.id or "" for face in carlito.faces)

    # The bundled substitutes already serve Carlito, from their packaged files.
    assert all(i.startswith("default-fonts:") for i in carlito_ids(convert(doc)))
    # A scanned directory takes precedence: the same faces now come from caller bytes.
    scanned = convert(doc, fonts=font_assets)
    assert scanned.fonts_complete
    assert all(i.startswith("bytes:Carlito#") for i in carlito_ids(scanned))
    # A single file path works, and aliasing serves a family nothing else can.
    assert convert(doc, fonts=font_assets / "Carlito-Regular.ttf").fonts_complete
    roboto = _with_family(narrow_pages, "Roboto")
    assert convert(roboto).missing_fonts == ["Roboto"]
    partial = convert(
        roboto, fonts=font_files(font_assets / "Carlito-Regular.ttf", family="Roboto")
    )
    assert partial.missing_fonts == ["Roboto"]  # one face is partial coverage, by design
    four = [font_assets / f"Carlito-{s}.ttf" for s in ("Regular", "Bold", "Italic", "BoldItalic")]
    aliased = convert(roboto, fonts=font_files(*four, family="Roboto"))
    assert aliased.missing_fonts == []
    assert aliased.fonts_complete


def test_fonts_accepts_a_mixed_list(narrow_pages, font_assets, tmp_path):
    import shutil

    from docx_to_markdown import FontFace, convert, font_files

    serif = tmp_path / "serif"
    serif.mkdir()
    for file in font_assets.glob("LiberationSerif-*.ttf"):
        shutil.copy(file, serif)
    fonts = [
        serif,
        font_assets / "LiberationMono-Regular.ttf",
        *font_files(font_assets / "Carlito-Regular.ttf", family="Calibri"),
        FontFace(str(font_assets / "Caladea-Bold.ttf"), "Cambria", 700),
    ]
    result = convert(narrow_pages, fonts=fonts)
    assert result.fonts_complete
    calibri = result.font_resolution.family("Calibri")
    assert calibri is not None
    regular = next(x for x in calibri.faces if x.weight == 400 and x.style == "normal")
    assert (regular.id or "").startswith("bytes:Calibri")  # the aliased file, not the bundled one
    with pytest.raises(TypeError):
        convert(narrow_pages, fonts=[42])  # type: ignore[list-item]
