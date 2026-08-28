#!/usr/bin/env python3
"""Resolve a word-features.ts conflict by replaying THEIRS' tail onto OURS' prose.

Local scratch tool for this rebase only; never committed. `ours` is main's evolving
prose, `theirs` is this branch's edit to the same field. The branch only ever changed the
resolver sentences at the end, so the resolution is: keep main's prefix, take the branch's
tail from the first sentence both sides disagree on.
"""
import pathlib
import sys


def main() -> int:
    path = pathlib.Path('docs/site/data/word-features.ts')
    text = path.read_text()
    start = text.index('<<<<<<< HEAD')
    mid = text.index('=======', start)
    end = text.index('>>>>>>>', mid)
    ours = text[text.index('\n', start) + 1 : mid]
    theirs = text[text.index('\n', mid) + 1 : end]
    marker = sys.argv[1]

    assert ours.count(marker) == 1, f'marker not unique in ours: {ours.count(marker)}'
    assert theirs.count(marker) == 1, f'marker not unique in theirs: {theirs.count(marker)}'
    resolved = ours[: ours.index(marker)] + theirs[theirs.index(marker) :]

    line_end = text.index('\n', end) + 1
    path.write_text(text[:start] + resolved + text[line_end:])
    print('resolved word-features.ts')
    return 0


if __name__ == '__main__':
    sys.exit(main())
