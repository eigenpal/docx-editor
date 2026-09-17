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


@pytest.fixture(scope="session")
def network():
    """Opt in to tests that reach Google Fonts with DOCX_TO_MARKDOWN_NETWORK_TESTS=1."""
    import os

    if os.environ.get("DOCX_TO_MARKDOWN_NETWORK_TESTS") != "1":
        pytest.skip("set DOCX_TO_MARKDOWN_NETWORK_TESTS=1 to run tests that fetch fonts")


@pytest.fixture(scope="session")
def reviewed_document() -> Path:
    """A small document with comments and tracked changes."""
    return REPO / "e2e" / "fixtures" / "reviewer-filter.docx"


@pytest.fixture(scope="session")
def demo_document() -> Path:
    """A real-world document whose theme lacks optional font schemes."""
    return REPO / "e2e" / "fixtures" / "demo.docx"
