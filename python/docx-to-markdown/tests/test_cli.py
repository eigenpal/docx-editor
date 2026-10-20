import json
import subprocess
import sys

import pytest

from docx_to_markdown.cli import _font, main


def test_stdout_markdown(narrow_pages, capsys):
    assert main([str(narrow_pages), "-q"]) == 0
    out = capsys.readouterr().out
    assert out.strip()


def test_output_file(narrow_pages, tmp_path):
    target = tmp_path / "out.md"
    assert main([str(narrow_pages), "-o", str(target), "-q"]) == 0
    assert target.read_text(encoding="utf-8").strip()


def test_json_output(narrow_pages, capsys):
    assert main([str(narrow_pages), "--json", "-q"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert len(payload["pages"]) == 15


def test_bundle_with_images(narrow_pages, tmp_path):
    assert main([str(narrow_pages), "--bundle", str(tmp_path / "b"), "--images", "-q"]) == 0
    assert (tmp_path / "b" / "document.md").is_file()
    assert (tmp_path / "b" / "document.json").is_file()


def test_several_inputs_need_bundle(narrow_pages, tmp_path):
    with pytest.raises(SystemExit):
        main([str(narrow_pages), str(narrow_pages), "-o", str(tmp_path / "x.md")])
    assert (
        main([str(narrow_pages), str(narrow_pages), "--bundle", str(tmp_path / "many"), "-q"]) == 0
    )
    assert (tmp_path / "many" / narrow_pages.stem / "document.md").is_file()


def test_missing_input_reports_and_continues(narrow_pages, tmp_path, capsys):
    status = main([str(tmp_path / "absent.docx"), str(narrow_pages), "-q"])
    assert status == 1
    captured = capsys.readouterr()
    assert "absent.docx" in captured.err
    assert captured.out.strip()


def test_font_spec_parsing():
    face = _font("/fonts/Aptos-Bold.ttf:Aptos:700")
    assert (face.path, face.family, face.weight, face.style) == (
        "/fonts/Aptos-Bold.ttf",
        "Aptos",
        700,
        "normal",
    )
    face = _font("C:\\fonts\\Aptos.ttf:Aptos::italic")
    assert (face.path, face.weight, face.style) == ("C:\\fonts\\Aptos.ttf", 400, "italic")


def test_module_entry_point(narrow_pages):
    completed = subprocess.run(
        [sys.executable, "-m", "docx_to_markdown", str(narrow_pages), "-q"],
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr.decode()
    assert completed.stdout.strip()


def test_font_spec_path_only_scans_directory(narrow_pages, font_assets, capsys):
    from docx_to_markdown.cli import _font

    assert _font(str(font_assets)) == str(font_assets)
    assert _font("C:\\fonts") == "C:\\fonts"
    assert main([str(narrow_pages), "--font", str(font_assets), "-q"]) == 0
    assert capsys.readouterr().out.strip()
