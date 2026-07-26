/**
 * Renderer run-grouping BASELINE HARNESS.
 *
 * Committed and served so the numbers are reproducible by anyone: open the demo, run
 * `await (await import('/bench/renderer-baseline.js')).run()`, and compare equivalent
 * runs. It measures the current word-per-element painter so the same harness can prove
 * what grouping changed.
 *
 * It records, per the change's baseline requirements:
 *
 *  - CORRECTNESS INVARIANTS that grouping must not move: page count, a wrapping
 *    signature, and a hash of the visible text. These are the comparison anchors — a
 *    lower node count means nothing if the text or the wrapping moved.
 *  - SIZE: layout text items, glyph runs, painted text elements, total DOM nodes.
 *  - TIMING: initial paint, selection-only update, one-character edit, scroll.
 *  - DOM IDENTITY: whether a selection-only frame recreates page content. Measured by
 *    tagging the live page elements with an expando before the operation and checking
 *    the SAME objects are still mounted after — an attribute would survive a rebuild
 *    and quietly report success.
 *  - PROVENANCE: fixture hash, viewport, user agent, hardware, warm/cold, repetitions.
 *
 * No latency thresholds are asserted anywhere. It reports raw numbers; judging them is
 * a human's job with two comparable runs in hand.
 */

const PAGES_SELECTOR = '.ep-one-surface__pages';
const CONTENT_SELECTOR = '.ep-one-surface__content';

/** Stable hash of a string — for comparing visible text between runs, not for security. */
async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function editor() {
  const e = window.__docxAdapterEditor;
  if (!e) throw new Error('window.__docxAdapterEditor is not set — is the demo mounted?');
  return e;
}

function pagesEl() {
  const el = document.querySelector(PAGES_SELECTOR);
  if (!el) throw new Error(`no ${PAGES_SELECTOR} in the document`);
  return el;
}

/**
 * What the ENGINE produced, independent of how it was painted. Grouping changes the
 * paint projection; if these move, something else broke.
 */
function engineShape() {
  const display = editor().getDisplay();
  let textItems = 0;
  let glyphRuns = 0;
  let syntheticItems = 0;
  const byKind = {};
  for (const page of display) {
    for (const item of page.items) {
      byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
      if (item.kind === 'text') {
        textItems += 1;
        glyphRuns += item.runs.length;
        if (item.synthetic) syntheticItems += 1;
      }
    }
  }
  return { pages: display.length, textItems, glyphRuns, syntheticItems, itemsByKind: byKind };
}

/**
 * A WRAPPING SIGNATURE that is independent of how many elements the text is painted in.
 *
 * Grouping merges elements, so any signature built from element boundaries would change
 * by construction and prove nothing. This buckets every text run by its baseline `y`
 * within a page — a visual line — and records that line's concatenated text. Identical
 * signatures before and after mean the same words landed on the same lines.
 */
function wrappingSignature() {
  const display = editor().getDisplay();
  const lines = [];
  for (const page of display) {
    const byY = new Map();
    for (const item of page.items) {
      if (item.kind !== 'text') continue;
      for (const run of item.runs) {
        // Round to whole pixels: sub-pixel baseline jitter is not a wrapping change.
        const y = Math.round(run.box.y);
        const bucket = byY.get(y) ?? [];
        bucket.push({ x: run.box.x, text: run.text });
        byY.set(y, bucket);
      }
    }
    for (const y of [...byY.keys()].sort((a, b) => a - b)) {
      const runs = byY.get(y).sort((a, b) => a.x - b.x);
      lines.push(`${page.index}:${y}:${runs.map((r) => r.text).join('')}`);
    }
  }
  return lines;
}

/** Everything the reader can see, in order — the text-preservation anchor. */
function visibleText() {
  return wrappingSignature()
    .map((line) => line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1))
    .join('\n');
}

function domShape() {
  const root = pagesEl();
  const all = root.querySelectorAll('*');
  const textElements = [...all].filter(
    (el) => el.children.length === 0 && (el.textContent ?? '').length > 0
  );
  return {
    totalNodes: all.length,
    textElements: textElements.length,
    pageElements: root.children.length,
    contentLayers: root.querySelectorAll(CONTENT_SELECTOR).length,
  };
}

/**
 * Wait for a painted frame — WITH A FALLBACK, because `requestAnimationFrame` does not
 * fire at all in a hidden tab.
 *
 * This is not hypothetical: under browser automation the tab is frequently
 * `visibilityState === 'hidden'`, rAF is suspended, and a plain rAF wait hangs forever.
 * The first version of this harness did exactly that and never completed a run — which
 * is the real reason it had never executed, beyond the `setSelection` defect.
 *
 * When the document is hidden the frame wait degrades to a timeout, and `run()` flags
 * every paint-complete number as unreliable rather than reporting a timer as a paint.
 */
const HIDDEN_FRAME_FALLBACK_MS = 32;
const nextPaint = () =>
  new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(done));
    setTimeout(done, HIDDEN_FRAME_FALLBACK_MS);
  });

const stats = (raw) => {
  const s = [...raw].sort((a, b) => a - b);
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    samples: s.map(r2),
    median: r2(s[Math.floor(s.length / 2)]),
    min: r2(s[0]),
    max: r2(s[s.length - 1]),
  };
};

/**
 * Two numbers per operation, deliberately.
 *
 * The first version measured only `dispatch → two chained rAFs`, which carries a fixed
 * ~16-33 ms floor set by the display refresh rate. A fast operation then reads as "one
 * frame" no matter how little work it did, the floor differs between a 60 Hz and a
 * 120 Hz machine, and after grouping the improved case bottoms out at the floor and
 * UNDERSTATES the win — on the metric this change is judged by.
 *
 * `dispatchMs` is the synchronous cost, taken before yielding. `toPaintMs` includes the
 * frame wait. `rafFloorMs` (measured separately) is what to subtract from it.
 */
async function time(label, fn, repetitions) {
  const dispatch = [];
  const toPaint = [];
  for (let i = 0; i < repetitions; i += 1) {
    const t0 = performance.now();
    await fn(i);
    dispatch.push(performance.now() - t0);
    await nextPaint();
    toPaint.push(performance.now() - t0);
  }
  return { label, repetitions, dispatchMs: stats(dispatch), toPaintMs: stats(toPaint) };
}

/** The cost of the frame wait alone, so a reader can tell work from cadence. */
async function measureRafFloor(repetitions) {
  const samples = [];
  for (let i = 0; i < repetitions; i += 1) {
    const t0 = performance.now();
    await nextPaint();
    samples.push(performance.now() - t0);
  }
  return stats(samples);
}

/**
 * Tag the live page elements with an EXPANDO, run the operation, then check the same
 * objects are still mounted. An attribute would be copied onto a rebuilt node and report
 * false success; a property on the element object cannot be.
 */
/**
 * Tag THREE tiers and report each separately.
 *
 * The first version tagged only `pagesEl().children` — the `.layout-page` shells, which
 * React keys by page index and essentially never replaces. Every one of the ~11k text
 * elements inside could be unmounted and rebuilt while that check still reported
 * `preserved: true`, and it was cited as proof that page content survives. The tier that
 * requirement 4 is actually about is the content layer and the text elements in it.
 */
function markPageContent() {
  const root = pagesEl();
  const tag = (el) => {
    const token = Symbol('baseline');
    el.__baselineToken = token;
    return { el, token };
  };
  const shells = [...root.children].map(tag);
  const contentLayers = [...root.querySelectorAll(CONTENT_SELECTOR)].map(tag);
  // A sample of leaf text elements — first, middle and last of each content layer — so a
  // rebuild anywhere in the tier is visible without tagging all 11k.
  const leaves = [];
  for (const layer of root.querySelectorAll(CONTENT_SELECTOR)) {
    const kids = [...layer.children];
    if (kids.length === 0) continue;
    for (const idx of [0, Math.floor(kids.length / 2), kids.length - 1]) {
      if (kids[idx]) leaves.push(tag(kids[idx]));
    }
  }
  return { shells, contentLayers, leaves };
}

function survived(marks) {
  for (const { el, token } of marks) {
    if (!el.isConnected) return { preserved: false, reason: 'element detached' };
    if (el.__baselineToken !== token) return { preserved: false, reason: 'element replaced' };
  }
  return { preserved: true, tagged: marks.length };
}

function pageContentSurvived(marks) {
  return {
    pageShells: survived(marks.shells),
    contentLayers: survived(marks.contentLayers),
    sampledTextElements: survived(marks.leaves),
  };
}

/** Count DOM mutations under the pages container while `fn` runs — framework-neutral. */
async function countMutations(fn) {
  const root = pagesEl();
  let added = 0;
  let removed = 0;
  let attributes = 0;
  // characterData is counted because after grouping a repaint may rewrite line text IN
  // PLACE, producing no added/removed nodes at all. Reporting only childList would read
  // as "nothing changed" while every line's text was replaced.
  let characterData = 0;
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      added += r.addedNodes.length;
      removed += r.removedNodes.length;
      if (r.type === 'attributes') attributes += 1;
      if (r.type === 'characterData') characterData += 1;
    }
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  await fn();
  await nextPaint();
  observer.disconnect();
  return { added, removed, attributes, characterData };
}

/**
 * Build a real `SemanticSelection` for a collapsed caret at `graphemeOffset` in the first
 * painted paragraph.
 *
 * The first version of this harness called `editor.setSelection(...)`, which DOES NOT
 * EXIST — `setSelection` is a COMMAND, reached through `exec`. `run()` threw on its first
 * timing and never produced a result, which is how a harness can look finished and have
 * never executed. The shape below matches `engine-editor/src/driver.ts`.
 */
function collapsedSelectionAt(graphemeOffset) {
  const e = editor();
  for (const page of e.getDisplay()) {
    for (const item of page.items) {
      if (item.kind !== 'text' || !item.semantic) continue;
      const target = (offset, affinity) => ({
        kind: 'text',
        scope: item.semantic.scope ?? { kind: 'body' },
        identity: {
          storyId: item.semantic.identity.storyId,
          blockId: item.semantic.identity.blockId,
        },
        graphemeOffset: offset,
        affinity,
      });
      const offset = Math.min(graphemeOffset, item.semantic.graphemeTo ?? graphemeOffset);
      return {
        frameId: e.getInteractionFrame().id,
        scope: item.semantic.scope ?? { kind: 'body' },
        anchor: target(offset, 'upstream'),
        head: target(offset, 'downstream'),
      };
    }
  }
  return null;
}

/** Run a selection command and REFUSE to time a refusal. A rejected command that is
 *  recorded as a fast timing is worse than no measurement. */
function applySelection(range) {
  const result = editor().exec({ type: 'setSelection', range });
  if (!result.ok) throw new Error(`setSelection refused: ${result.code} ${result.reason}`);
  return result;
}

export async function run({
  fixtureUrl = '/large-styled-text.docx',
  repetitions = 5,
  commit = 'unrecorded',
} = {}) {

  // ── Provenance ──────────────────────────────────────────────────────────────
  // WHOLE file, so it compares directly against `shasum -a 256`. The first version
  // hashed only the first 8 KB and called it `fixtureHeadHash`, which could not be
  // compared against the recorded hash and was blind to changes past byte 8192 — i.e.
  // to almost all of `word/document.xml`.
  const fixtureBuffer = await (await fetch(fixtureUrl)).arrayBuffer();
  const fixtureBytes = new Uint8Array(fixtureBuffer);
  const fixtureSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', fixtureBuffer))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // ── Load the fixture and time the first paint ────────────────────────────────
  const coldStart = performance.now();
  editor().load(fixtureBytes);
  const loadReturnedMs = Math.round((performance.now() - coldStart) * 100) / 100;
  await nextPaint();
  const initialPaintMs = Math.round((performance.now() - coldStart) * 100) / 100;

  const shape = engineShape();
  const dom = domShape();
  const signature = wrappingSignature();
  const text = visibleText();
  const rafFloorMs = await measureRafFloor(repetitions);

  // ── Selection-only: the frame that must not rebuild page content ─────────────
  const marks = markPageContent();
  const selectionMutations = await countMutations(async () => {
    const range = collapsedSelectionAt(3);
    if (range) applySelection(range);
  });
  const domIdentity = pageContentSurvived(marks);

  const selectionTiming = await time(
    'selection-only update',
    async (i) => {
      // Alternate offsets so no repetition is a no-op the engine can skip — a refused or
      // unchanged command would otherwise be timed as if it were work.
      const range = collapsedSelectionAt(i % 2 === 0 ? 2 : 5);
      if (range) applySelection(range);
    },
    repetitions,
  );

  const scroller =
    document.querySelector('.docx-editor__scroll-container') ?? pagesEl().parentElement;
  const scrollTiming = await time(
    'scroll',
    async (i) => {
      // Bounded and cycled: a monotonically increasing scrollTop hits the extent and the
      // late repetitions become no-ops.
      if (scroller) scroller.scrollTop = ((i % 5) + 1) * 600;
    },
    repetitions,
  );
  if (scroller) scroller.scrollTop = 0;

  return {
    provenance: {
      fixtureUrl,
      fixtureBytes: fixtureBytes.length,
      fixtureSha256,
      commit,
      takenAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGB: navigator.deviceMemory ?? null,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      zoom: editor().getZoom(),
      repetitions,
      // NOT a cold start: the process and JIT are warm, this is the first load OF THIS
      // FIXTURE into an already-running page.
      warmState: 'warm process, first load of this fixture',
      documentHidden: document.hidden,
      paintTimingsReliable: !document.hidden,
    },
    invariants: {
      pages: shape.pages,
      visibleTextHash: await sha256(text),
      // Whitespace-NORMALISED, because whitespace is not painted before grouping and is
      // painted after: the raw hash necessarily changes and cannot distinguish "grouping
      // added the spaces it should have" from "grouping moved the text". The raw hash is
      // kept as a within-version regression check only.
      visibleTextNormalisedHash: await sha256(text.replace(/\s+/g, ' ').trim()),
      visibleTextChars: text.length,
      wrappingSignatureHash: await sha256(signature.join('\n')),
      wrappingSignatureNormalisedHash: await sha256(
        signature.map((l) => l.replace(/\s+/g, ' ')).join('\n'),
      ),
      wrappingLines: signature.length,
    },
    size: { ...shape, ...dom },
    timings: {
      // `toPaintMs` is only meaningful with a visible tab; see `paintTimingsReliable`.
      // `dispatchMs` is synchronous and is valid either way.
      loadReturnedMs,
      initialPaintMs,
      rafFloorMs,
      selection: selectionTiming,
      scroll: scrollTiming,
      oneCharacterEdit:
        'NOT MEASURED — there is no insertText command on the contract, so a real ' +
        'character insertion only reaches the store through the hidden input host and ' +
        'cannot be driven from here. Substituting exec(toggleMark) was wrong: it ' +
        'recorded a changed:false no-op as an edit timing.',
    },
    domIdentity: { selectionOnly: domIdentity, selectionMutations },
    reactCommits:
      'NOT MEASURED — needs a <Profiler> in the demo tree exposed on window. Do not ' +
      'attribute selection cost to reconciliation without it.',
    memory: performance.memory
      ? {
          usedJSHeapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
          note:
            'Single reading with no pre/post delta and no forced GC, so it is dominated ' +
            'by uncollected garbage. Not a retained-memory measurement.',
        }
      : { note: 'performance.memory unavailable' },
  };
}
