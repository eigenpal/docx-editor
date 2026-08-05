# Pipeline benchmark

Measures each stage of the one pipeline — bytes → parse → identity → store → layout →
edit/relayout → save — on a long document, so stage-level regressions show up as numbers
instead of anecdotes.

## Running it

```bash
# Build the 20x-length profiling fixture (gitignored; ~420 KB zip, 6 MB document.xml)
node scripts/create-sample-20x-fixture.mjs

# Run the staged benchmark
bun scripts/bench/pipeline-bench.ts            # table output
bun scripts/bench/pipeline-bench.ts --json     # machine-readable

# Attribute time to functions
bun --cpu-prof scripts/bench/pipeline-bench.ts # writes CPU.*.cpuprofile
```

The fixture is the demo `sample.docx` with its body repeated 20 times (bookmark ids,
hyperlink anchors and drawing ids uniquified per copy): ~12,700 paragraphs, 300 tables,
~1,800 bookmarks, 100 sections — 521 pages. The bench uses the fixed measurer so numbers
are font-independent; browser-side costs (canvas measurement, paint, React) are profiled
separately in Chrome.

## 2026-08-06 optimization pass — results

Medians of 3 runs, Apple Silicon, Bun 1.3.14, 20x fixture (521 pages).

| Stage                          | Before  | After   | Change |
| ------------------------------ | ------- | ------- | ------ |
| `readOoxmlPackage` (parse)     | 1244 ms | 770 ms  | −38%   |
| `normalizeParagraphIdentity`   | 480 ms  | 330 ms  | −31%   |
| Layout, cold                   | 911 ms  | 755 ms  | −17%   |
| Layout, no-change warm pass    | 124 ms  | 53 ms   | −57%   |
| `transact` insertText (1 char) | 30 ms   | 26 ms   | −15%   |
| Layout, incremental after edit | 125 ms  | 78 ms   | −38%   |
| `writeOoxmlPackage` (save)     | 726 ms  | 475 ms  | −35%   |
| **Total**                      | 3691 ms | 2510 ms | −32%   |

What the profiler found, and what changed:

1. **XML preflight scanned per character** (`xml-reader.ts`): `preflightForbiddenXml` did a
   `slice(i, i+10).toUpperCase()` at every index of a multi-megabyte part and re-sliced the
   whole tail for the entity regex at every `&`. Everything it can object to starts at `<`
   or `&`, so the scan now skips every other character and anchors the entity check with a
   sticky regex. ~350 ms of parse.
2. **Namespace maps copied per element** (`ooxml-tree.ts`, `ooxml-validate.ts`,
   `ooxml-serialize.ts`): parse, validate and serialize each copied the inherited
   prefix→URI map for every node, though almost no node declares namespaces. All three
   walks are copy-on-write now. This was the single largest allocation source (~400 ms of
   `new Map` in parse alone) and also speeds up every `transact`, which re-validates the
   touched part.
3. **Validation path strings built eagerly** (`ooxml-validate.ts`): issue paths are now
   derived from a shared index trail only when an issue is reported; a valid document
   reports none.
4. **Paragraph cache keys rebuilt and re-hashed per pass** (`layout-cache.ts`): `nodeToken`
   walked every paragraph subtree on every layout pass, and the joined key was a fresh
   multi-kilobyte string whose hash the JS engine had to recompute on every cache `get`.
   Tokens are now memoized per immutable paragraph/table node, and the assembled key is
   memoized per node so unchanged paragraphs hand the SAME string object back to the cache.
   In a Chrome keystroke trace on the 20x document, `ParagraphLayoutCache.get` went from
   ~129 ms per keystroke of self-time to unmeasurable.
5. **Whole-tree scans repeated per layout pass** (`semantic-layout.ts`, `toc-layout.ts`):
   `contentControlContextToken` and the three TOC paragraph-id scans ran on every pass,
   including no-change passes that reuse every page. All four are memoized per immutable
   part reference.
6. **Tables read twice per pass** (`semantic-table.ts`): `readTableStructure` is a pure
   function of an immutable node and scalar inputs, called by document-order indexing, flow
   layout and row measurement. It now carries a single-entry memo per table node.
7. **Serializer assembled strings bottom-up** (`ooxml-serialize.ts`): `serializeNode`
   builds into a shared accumulator with one final join, and `significantChildren`
   short-circuits for the (dominant) element-only child lists.
8. **Package copy per staged op** (`ooxml-package.ts`): `withPart` copies the parts map
   directly instead of spreading it through an intermediate entries array.

Not changed, deliberately: deep-freezing of the canonical tree (an invariant the store's
immutability contract and these very memos rely on), the full fail-open revalidation in
`normalizeParagraphIdentity` (kept; made cheaper by items 2–3), and every validation or
security bound — no rule was weakened, only recomputation of already-proven facts removed.

Browser (Chrome, dev server, same fixture): load-to-521-pages ≈ 7.5 s wall including Vite
module loading; keystroke-to-paint median ~300 ms before AND after — the engine's share
shrank (item 4), but dev-mode React overhead and per-revision whole-document derivations
(content-control walk, revision projection, note references, drawing projection — each a
full-tree scan per edit) dominate the interactive path. Making those derivations
incremental is the next lever, and it is a design change, not a micro-optimization.
