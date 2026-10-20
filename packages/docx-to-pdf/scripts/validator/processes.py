# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Bound, monitor, and reap only child processes created for a validation stage."""
import os
import signal
import subprocess
import time

import psutil


def run_owned(command, log, stop, timeout=90, max_rss_mb=2048, cwd=None, env=None, disk_guard=None):
    started = time.monotonic()
    peak = 0
    owned = {}
    next_disk_check = started
    with log.open('wb') as output:
        process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT,
                                   cwd=cwd, env={**os.environ, **(env or {})}, start_new_session=True)
        parent = psutil.Process(process.pid)
        try:
            while True:
                try:
                    for child in [parent, *parent.children(recursive=True)]:
                        owned[(child.pid, child.create_time())] = child
                except psutil.NoSuchProcess:
                    pass
                rss = 0
                for child in list(owned.values()):
                    try:
                        if child.is_running():
                            rss += child.memory_info().rss
                    except psutil.NoSuchProcess:
                        pass
                peak = max(peak, rss)
                if stop.is_set():
                    raise InterruptedError('Validation stopped')
                if time.monotonic() - started > timeout:
                    raise TimeoutError(f'Stage exceeded {timeout}s')
                if rss > max_rss_mb * 1024 * 1024:
                    raise MemoryError(f'Stage exceeded {max_rss_mb} MiB RSS')
                if disk_guard and time.monotonic() >= next_disk_check:
                    disk_guard()
                    next_disk_check = time.monotonic() + 1
                if process.poll() is not None:
                    if process.returncode:
                        raise RuntimeError(f'Stage exited with code {process.returncode}; see {log.name}')
                    break
                stop.wait(0.1)
        except BaseException as error:
            error.resources = dict(elapsedSeconds=round(time.monotonic() - started, 3),
                                   peakRssBytes=peak, rssSamplingIntervalMs=100)
            raise
        finally:
            # Interrupt first so disposable-profile helpers can run their own finally blocks.
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGINT)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
            for child in reversed(list(owned.values())):
                try:
                    if child.is_running():
                        child.kill()  # psutil checks process identity before signalling.
                except psutil.NoSuchProcess:
                    pass
            # Also catch same-session children created between monitor samples.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            psutil.wait_procs(list(owned.values()), timeout=2)
    return dict(elapsedSeconds=round(time.monotonic() - started, 3),
                peakRssBytes=peak, rssSamplingIntervalMs=100)
