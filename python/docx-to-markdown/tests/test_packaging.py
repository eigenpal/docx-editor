"""The wheel carries every license the executable depends on."""

from pathlib import Path

import pytest

from docx_to_markdown import runtime_path

VENDOR = Path(runtime_path()).parent
LICENSES = VENDOR / "licenses"
PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def test_package_license_files_exist():
    assert (
        (PACKAGE_ROOT / "LICENSE").read_text(encoding="utf-8").lstrip().startswith("Apache License")
    )
    assert "Apache License, Version 2.0" in (PACKAGE_ROOT / "NOTICE").read_text(encoding="utf-8")


def test_vendored_licenses_are_complete():
    names = {p.name for p in LICENSES.iterdir()}
    for required in (
        "THIRD_PARTY_NOTICES.md",
        "bun-LICENSE.md",
        "harfbuzz-COPYING.txt",
        "OFL-Carlito.txt",
        "OFL-Caladea.txt",
        "LICENSE-Liberation.txt",
        "GUST-FONT-LICENSE.txt",
    ):
        assert required in names, f"missing {required}"


@pytest.mark.parametrize(
    "package",
    ["harfbuzzjs", "fflate", "fast-xml-parser", "prosemirror-model", "bidi-js"],
)
def test_notices_cover_bundled_packages(package):
    notices = (LICENSES / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    assert f"### {package} " in notices
    assert "Permission is hereby granted" in notices


def test_notices_name_the_runtime_and_shaper():
    notices = (LICENSES / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    assert "## Bun runtime" in notices
    assert "JavaScriptCore" in notices
    assert "## HarfBuzz" in notices
    assert "Old MIT" in notices


def test_every_font_file_has_a_license():
    fonts = {p.stem.split("-")[0] for p in (VENDOR / "fonts").iterdir()}
    texts = {p.name for p in LICENSES.iterdir()}
    expected = {
        "Carlito": "OFL-Carlito.txt",
        "Caladea": "OFL-Caladea.txt",
        "LiberationSans": "LICENSE-Liberation.txt",
        "LiberationSerif": "LICENSE-Liberation.txt",
        "LiberationMono": "LICENSE-Liberation.txt",
        "TeXGyreAdventor": "GUST-FONT-LICENSE.txt",
    }
    assert fonts == set(expected)
    for family, license_file in expected.items():
        assert license_file in texts, f"{family} needs {license_file}"


def test_version_matches_the_npm_package():
    import json

    import docx_to_markdown

    manifest = PACKAGE_ROOT.parents[1] / "packages" / "docx-to-markdown" / "package.json"
    expected = json.loads(manifest.read_text(encoding="utf-8"))["version"]
    assert docx_to_markdown.__version__ == expected
