"""Locate and run the vendored converter."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = 1
FONT_ASSET_ROOT_ENV = "DOCX_EDITOR_FONT_ASSET_ROOT"
RUNTIME_ENV = "DOCX_TO_MARKDOWN_RUNTIME"

_VENDOR = Path(__file__).with_name("_vendor")


class ConversionError(RuntimeError):
    """The converter refused or failed the request."""

    def __init__(self, code: str, message: str, detail: Any = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.detail = detail


class RuntimeNotFoundError(ConversionError):
    """The platform executable is missing from this installation."""


def runtime_path() -> Path:
    override = os.environ.get(RUNTIME_ENV)
    if override:
        return Path(override)
    name = "docx-to-markdown.exe" if sys.platform == "win32" else "docx-to-markdown"
    return _VENDOR / name


def fonts_dir() -> Path:
    return _VENDOR / "fonts"


def run(request: dict[str, Any], *, timeout: float | None) -> dict[str, Any]:
    binary = runtime_path()
    if not binary.is_file():
        raise RuntimeNotFoundError(
            "runtime-missing",
            f"No converter executable at {binary}. Reinstall docx-to-markdown for this "
            f"platform, or point {RUNTIME_ENV} at a built executable.",
        )
    env = dict(os.environ)
    env.setdefault(FONT_ASSET_ROOT_ENV, str(fonts_dir()))
    request = {"protocol": PROTOCOL_VERSION, **request}
    try:
        completed = subprocess.run(
            [str(binary)],
            input=json.dumps(request).encode("utf-8"),
            capture_output=True,
            env=env,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ConversionError("timeout", f"Conversion exceeded {timeout} seconds") from exc
    try:
        payload = json.loads(completed.stdout.decode("utf-8"))
    except ValueError as exc:
        stderr = completed.stderr.decode("utf-8", "replace").strip()
        raise ConversionError(
            "runtime-crashed",
            f"The converter exited with status {completed.returncode} and no JSON response",
            stderr[-4000:],
        ) from exc
    if "error" in payload:
        error = payload["error"]
        raise ConversionError(
            error.get("code", "export-failed"), error.get("message", ""), error.get("detail")
        )
    if payload.get("protocol") != PROTOCOL_VERSION:
        raise ConversionError(
            "protocol-mismatch",
            f"Expected protocol {PROTOCOL_VERSION}, got {payload.get('protocol')!r}",
        )
    return payload
