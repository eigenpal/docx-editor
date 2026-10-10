"""Wheel hook: require the vendored runtime and tag the wheel for its platform only.

The package holds no compiled Python. Its executable is a Bun binary, so the wheel
is tagged ``py3-none-<platform>``: any CPython 3 on that platform, not one ABI.
"""

from __future__ import annotations

import os
import platform
import sys
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

# Override for cross-builds, for example `manylinux_2_28_aarch64`.
PLATFORM_ENV = "DOCX_TO_MARKDOWN_WHEEL_PLATFORM"


def platform_tag() -> str:
    override = os.environ.get(PLATFORM_ENV)
    if override:
        return override
    machine = platform.machine().lower()
    if sys.platform.startswith("linux"):
        arch = {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}
        # Bun's glibc builds require glibc 2.17 or newer (bun.sh/docs/installation).
        return f"manylinux_2_17_{arch[machine]}"
    if sys.platform == "darwin":
        arch = "arm64" if machine in ("arm64", "aarch64") else "x86_64"
        # Bun requires macOS 13.0 or later (bun.sh/docs/installation).
        return f"macosx_13_0_{arch}"
    if sys.platform == "win32":
        return "win_amd64"
    raise RuntimeError(f"unsupported build platform {sys.platform}/{machine}")


class VendoredRuntimeHook(BuildHookInterface):
    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict) -> None:
        vendor = Path(self.root, "src", "docx_to_markdown", "_vendor")
        binaries = [p for p in vendor.glob("docx-to-markdown*") if p.is_file()]
        fonts = list(vendor.glob("fonts/*.[ot]tf"))
        if not binaries or not fonts:
            raise RuntimeError(
                "src/docx_to_markdown/_vendor is missing the runtime. "
                "Run `bun run build:runtime` in python/docx-to-markdown first."
            )
        build_data["pure_python"] = False
        build_data["tag"] = f"py3-none-{platform_tag()}"
