from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
FIXTURES = REPO / "packages" / "docx-to-markdown" / "test" / "fixtures"
FONT_ASSETS = REPO / "packages" / "fonts" / "assets"


@pytest.fixture(scope="session")
def narrow_pages() -> Path:
    return FIXTURES / "narrow-pages.docx"


@pytest.fixture(scope="session")
def font_assets() -> Path:
    return FONT_ASSETS


@pytest.fixture(scope="session", autouse=True)
def require_runtime():
    from docx_to_markdown import runtime_path

    if not runtime_path().is_file():
        pytest.skip("runtime not built; run `bun run build:runtime` first")
