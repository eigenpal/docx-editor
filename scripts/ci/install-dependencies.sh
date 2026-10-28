#!/usr/bin/env bash
# `bun install --frozen-lockfile` for CI, with a time limit and two retries.
#
# A normal install takes about 20 seconds. A stalled registry or tarball download can hang
# without output until the job limit cancels the whole job; one such stall once used 12 of a
# unit shard's 20 minutes. Each attempt gets three minutes, and a stall costs one attempt.
#
# Every failure is retried, including a lockfile mismatch, which fails the same way each time.
# That costs a few seconds per attempt, and telling a network failure from a real one by its
# output is not reliable.
set -u

attempts=3
limit_seconds=180

for attempt in $(seq 1 "$attempts"); do
  timeout "$limit_seconds" bun install --frozen-lockfile
  status=$?
  if [ "$status" -eq 0 ]; then
    exit 0
  fi
  if [ "$status" -eq 124 ]; then
    reason="did not finish within ${limit_seconds}s"
  else
    reason="failed with exit ${status}"
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    echo "::warning::bun install ${reason} (attempt ${attempt} of ${attempts}); retrying"
  else
    echo "::error::bun install ${reason} on all ${attempts} attempts"
    exit "$status"
  fi
done
