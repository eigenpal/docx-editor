"""Locate and run the vendored converter, one-shot or as a warm worker."""

from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = 1
FONT_ASSET_ROOT_ENV = "DOCX_EDITOR_FONT_ASSET_ROOT"
RUNTIME_ENV = "DOCX_TO_MARKDOWN_RUNTIME"

_VENDOR = Path(__file__).with_name("_vendor")


class ConversionError(RuntimeError):
    """The converter refused or failed a request.

    ``code`` is stable and machine-readable, for example ``"docx-unreadable"``,
    ``"timeout"``, or ``"runtime-missing"``. ``message`` is for people.
    """

    def __init__(self, code: str, message: str, detail: Any = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.detail = detail


class RuntimeNotFoundError(ConversionError):
    """The platform executable is missing from this installation."""


def runtime_path() -> Path:
    """The converter executable this installation uses."""
    override = os.environ.get(RUNTIME_ENV)
    if override:
        return Path(override)
    name = "docx-to-markdown.exe" if sys.platform == "win32" else "docx-to-markdown"
    return _VENDOR / name


def fonts_dir() -> Path:
    """The directory of bundled Word substitute fonts."""
    return _VENDOR / "fonts"


def _binary() -> Path:
    binary = runtime_path()
    if not binary.is_file():
        raise RuntimeNotFoundError(
            "runtime-missing",
            f"No converter executable at {binary}. Reinstall docx-to-markdown for this "
            f"platform, or point {RUNTIME_ENV} at a built executable.",
        )
    return binary


def _env() -> dict[str, str]:
    env = dict(os.environ)
    env.setdefault(FONT_ASSET_ROOT_ENV, str(fonts_dir()))
    return env


def _decode(stdout: bytes, stderr: bytes, returncode: int | None) -> dict[str, Any]:
    try:
        payload = json.loads(stdout.decode("utf-8"))
    except ValueError as exc:
        text = stderr.decode("utf-8", "replace").strip()
        raise ConversionError(
            "runtime-crashed",
            f"The converter exited with status {returncode} and no JSON response",
            text[-4000:],
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


def run_once(request: dict[str, Any], *, timeout: float | None) -> dict[str, Any]:
    """Spawn the converter for one request."""
    binary = _binary()
    body = json.dumps({"protocol": PROTOCOL_VERSION, **request}).encode("utf-8")
    try:
        completed = subprocess.run(
            [str(binary)],
            input=body,
            capture_output=True,
            env=_env(),
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ConversionError("timeout", f"Conversion exceeded {timeout} seconds") from exc
    return _decode(completed.stdout, completed.stderr, completed.returncode)


class Worker:
    """One converter process that answers many requests.

    The shaper and its caches stay warm between calls, which removes the process start
    from every conversion after the first. Requests are serialized with a lock, so one
    worker is safe to share between threads; use one worker per thread for parallelism.
    """

    def __init__(self) -> None:
        self._process: subprocess.Popen[bytes] | None = None
        self._lock = threading.Lock()

    def _start(self) -> subprocess.Popen[bytes]:
        binary = _binary()
        self._process = subprocess.Popen(
            [str(binary), "--serve"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=_env(),
        )
        return self._process

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def request(self, request: dict[str, Any], *, timeout: float | None) -> dict[str, Any]:
        with self._lock:
            process = self._process
            if process is None or process.poll() is not None:
                process = self._start()
            stdin, stdout = process.stdin, process.stdout
            assert stdin is not None and stdout is not None
            body = json.dumps({"protocol": PROTOCOL_VERSION, **request}).encode("utf-8")
            timer: threading.Timer | None = None
            timed_out = False
            if timeout is not None:

                def expire() -> None:
                    nonlocal timed_out
                    timed_out = True
                    process.kill()

                timer = threading.Timer(timeout, expire)
                timer.daemon = True
                timer.start()
            try:
                try:
                    stdin.write(body + b"\n")
                    stdin.flush()
                    line = stdout.readline()
                except (BrokenPipeError, OSError):
                    line = b""
            finally:
                if timer is not None:
                    timer.cancel()
            if timed_out:
                self.close()
                raise ConversionError("timeout", f"Conversion exceeded {timeout} seconds")
            if line == b"":
                stderr = b""
                if process.poll() is not None and process.stderr is not None:
                    stderr = process.stderr.read()
                self.close()
                return _decode(b"", stderr, process.returncode)
            return _decode(line, b"", None)

    def close(self) -> None:
        process = self._process
        self._process = None
        if process is None:
            return
        try:
            if process.stdin is not None:
                process.stdin.close()
            process.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            process.kill()
            process.wait()
        finally:
            for stream in (process.stdout, process.stderr):
                if stream is not None:
                    stream.close()

    def __del__(self) -> None:
        with contextlib.suppress(Exception):
            self.close()
