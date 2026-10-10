import io
import json

import pytest

from docx_to_markdown import (
    ConversionError,
    Converter,
    ExportWarning,
    FontFace,
    MarkdownResult,
    Page,
    convert,
    font_family,
)


def test_bundled_fonts_paginate_like_word(narrow_pages):
    result = convert(narrow_pages)
    assert isinstance(result, MarkdownResult)
    # The Node.js library lays this fixture out on 15 pages with Carlito standing in for Calibri.
    assert result.page_count == 15
    assert result.warnings == []
    assert result.fonts_complete
    assert result.font_resolution is not None
    families = {f.family: f.coverage for f in result.font_resolution.families}
    assert families == {"Calibri": "complete"}
    face = result.font_resolution.families[0].faces[0]
    assert (face.source_family, face.via) == ("Carlito", "substitution")
    assert face.substitution is not None and face.substitution.requested.family == "Calibri"
    assert result.pagination.display_mode == "all-markup"
    assert result.review_artifacts == [] and result.review_bindings == []
    assert result.font_errors == []
    assert result.markdown.strip()
    first = result.pages[0]
    assert isinstance(first, Page)
    assert first.number == 1
    assert first.markdown.strip()
    assert [p.number for p in result.pages] == list(range(1, 16))


def test_bytes_and_file_object_match_path(narrow_pages):
    from_path = convert(narrow_pages)
    from_bytes = convert(narrow_pages.read_bytes())
    with open(narrow_pages, "rb") as handle:
        from_file = convert(handle)
    assert from_bytes.markdown == from_path.markdown == from_file.markdown
    assert from_bytes.page_count == from_path.page_count == from_file.page_count


def test_text_mode_file_object_is_rejected(narrow_pages):
    with pytest.raises(TypeError, match="binary mode"):
        convert(io.StringIO("not bytes"))
    text_handle = open(narrow_pages, encoding="utf-8", errors="ignore")  # noqa: SIM115
    with text_handle, pytest.raises(TypeError, match="binary mode"):
        convert(text_handle)
    with open(narrow_pages, "rb") as handle:
        assert convert(handle).page_count == 15


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
    assert result.font_resolution is not None
    assert len(result.font_resolution.families[0].faces) == 4


def test_unreadable_font_is_reported_not_fatal(narrow_pages, tmp_path):
    bogus = tmp_path / "missing.ttf"
    result = convert(narrow_pages, fonts=[FontFace(str(bogus), "Calibri")])
    assert [e.path for e in result.font_errors] == [str(bogus)]
    assert result.page_count == 15


def test_invalid_font_bytes_are_reported(tmp_path, narrow_pages):
    junk = tmp_path / "junk.ttf"
    junk.write_bytes(b"not a font")
    result = convert(narrow_pages, fonts=[FontFace(str(junk), "Calibri")])
    assert result.font_errors and result.font_errors[0].path.endswith("junk.ttf")


def test_missing_docx_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        convert(tmp_path / "absent.docx")


def test_corrupt_docx_raises_conversion_error():
    with pytest.raises(ConversionError) as info:
        convert(b"PK\x03\x04 definitely not a document")
    assert info.value.code == "invalid-docx"
    assert "DOCX" in info.value.message


def test_reprs_are_compact(narrow_pages):
    result = convert(narrow_pages)
    assert len(repr(result)) < 200
    assert repr(result).startswith("MarkdownResult(15 pages")
    assert repr(result.pages[0]).startswith("Page(number=1")
    assert result.missing_fonts == []


def test_option_validation(narrow_pages):
    with pytest.raises(ValueError):
        convert(narrow_pages, font_policy="lenient")
    with pytest.raises(ValueError):
        convert(narrow_pages, images="svg")
    with pytest.raises(ValueError):
        convert(narrow_pages, display_mode="final")


def test_font_face_validation():
    with pytest.raises(ValueError):
        FontFace("a.ttf", "")
    with pytest.raises(ValueError):
        FontFace("a.ttf", "X", weight=0)
    with pytest.raises(ValueError):
        FontFace("a.ttf", "X", style="oblique")


def test_write_bundle(narrow_pages, tmp_path):
    result = convert(narrow_pages, images=True)
    out = result.write(tmp_path / "bundle")
    assert (out / "document.md").read_text(encoding="utf-8") == result.markdown
    document = json.loads((out / "document.json").read_text(encoding="utf-8"))
    assert len(document["pages"]) == 15
    for asset in result.media:
        assert (out / asset.path).read_bytes() == asset.bytes


def test_display_modes_accepted(narrow_pages):
    for mode in ("all-markup", "proposed", "original"):
        assert convert(narrow_pages, display_mode=mode).page_count == 15


class TestConverter:
    def test_reuses_one_process(self, narrow_pages):
        with Converter() as converter:
            assert not converter.running
            first = converter.convert(narrow_pages)
            assert converter.running
            pid = converter._worker._process.pid
            second = converter.convert(narrow_pages.read_bytes())
            assert converter._worker._process.pid == pid
            assert first.markdown == second.markdown
            assert first.page_count == second.page_count == 15
        assert not converter.running

    def test_survives_a_failed_request(self, narrow_pages):
        with Converter() as converter:
            with pytest.raises(ConversionError):
                converter.convert(b"not a docx")
            assert converter.running
            assert converter.convert(narrow_pages).page_count == 15

    def test_per_call_overrides(self, narrow_pages):
        with Converter(display_mode="proposed") as converter:
            assert converter.convert(narrow_pages).page_count == 15
            assert converter.convert(narrow_pages, display_mode="original").page_count == 15
            with pytest.raises(TypeError):
                converter.convert(narrow_pages, colour="red")  # type: ignore[call-arg]
            with pytest.raises(ValueError):
                converter.convert(narrow_pages, images="svg")  # type: ignore[arg-type]

    def test_timeout_kills_and_restarts(self, narrow_pages):
        with Converter(timeout=0.001) as converter:
            with pytest.raises(ConversionError) as info:
                converter.convert(narrow_pages)
            assert info.value.code == "timeout"
            assert not converter.running
            assert converter.convert(narrow_pages, timeout=120).page_count == 15

    def test_warm_call_is_faster_than_cold(self, narrow_pages):
        import time

        with Converter() as converter:
            converter.convert(narrow_pages)
            t0 = time.perf_counter()
            converter.convert(narrow_pages)
            warm = time.perf_counter() - t0
        t0 = time.perf_counter()
        convert(narrow_pages)
        cold = time.perf_counter() - t0
        assert warm < cold


def test_export_warning_shape():
    warning = ExportWarning("incomplete-font", "x", 3, None)
    assert warning.page_number == 3


def test_real_world_document_converts(demo_document):
    result = convert(demo_document)
    assert result.page_count > 0
    assert result.markdown.strip()
