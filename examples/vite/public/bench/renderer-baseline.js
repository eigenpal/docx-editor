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

/** Wait for a frame the engine has actually painted, not just a timer. */
const nextPaint = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

async function time(label, fn, repetitions) {
  const samples = [];
  for (let i = 0; i < repetitions; i += 1) {
    const t0 = performance.now();
    await fn(i);
    await nextPaint();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    label,
    repetitions,
    samples: samples.map((s) => Math.round(s * 100) / 100),
    median: Math.round(samples[Math.floor(samples.length / 2)] * 100) / 100,
    min: Math.round(samples[0] * 100) / 100,
    max: Math.round(samples[samples.length - 1] * 100) / 100,
  };
}

/**
 * Tag the live page elements with an EXPANDO, run the operation, then check the same
 * objects are still mounted. An attribute would be copied onto a rebuilt node and report
 * false success; a property on the element object cannot be.
 */
function markPageContent() {
  const marks = [];
  for (const page of pagesEl().children) {
    const token = Symbol('baseline');
    page.__baselineToken = token;
    marks.push({ page, token });
  }
  return marks;
}

function pageContentSurvived(marks) {
  const live = [...pagesEl().children];
  if (live.length !== marks.length) return { preserved: false, reason: 'page count changed' };
  for (let i = 0; i < marks.length; i += 1) {
    if (live[i] !== marks[i].page) return { preserved: false, reason: `page ${i} element replaced` };
    if (live[i].__baselineToken !== marks[i].token) {
      return { preserved: false, reason: `page ${i} lost its token` };
    }
  }
  return { preserved: true };
}

/** Count DOM mutations under the pages container while `fn` runs — framework-neutral. */
async function countMutations(fn) {
  const root = pagesEl();
  let added = 0;
  let removed = 0;
  let attributes = 0;
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      added += r.addedNodes.length;
      removed += r.removedNodes.length;
      if (r.type === 'attributes') attributes += 1;
    }
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  await fn();
  await nextPaint();
  observer.disconnect();
  return { added, removed, attributes };
}

/** Place a collapsed caret in the first paragraph that has text, via the engine. */
function caretAtStart() {
  const display = editor().getDisplay();
  for (const page of display) {
    for (const item of page.items) {
      if (item.kind === 'text' && item.semantic) return item.semantic;
    }
  }
  return null;
}

export async function run({ fixtureUrl = '/large-styled-text.docx', repetitions = 5 } = {}) {
  const e = editor();

  // ── Provenance ──────────────────────────────────────────────────────────────
  const fixtureBytes = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
  const fixtureHash = await sha256(String.fromCharCode(...fixtureBytes.subarray(0, 8192)));

  // ── COLD: load the fixture and time the first paint ──────────────────────────
  const coldStart = performance.now();
  e.load(fixtureBytes);
  await nextPaint();
  const initialPaintMs = Math.round((performance.now() - coldStart) * 100) / 100;

  const shape = engineShape();
  const dom = domShape();
  const signature = wrappingSignature();
  const text = visibleText();

  // ── WARM timings ────────────────────────────────────────────────────────────
  // Selection-only: move the caret without touching the model. This is the frame that
  // must NOT rebuild page content.
  const target = caretAtStart();
  const selectionMarks = markPageContent();
  const selectionMutations = await countMutations(async () => {
    if (target) e.setSelection({ anchor: target.from ?? target, head: target.to ?? target });
  });
  const selectionIdentity = pageContentSurvived(selectionMarks);

  const selectionTiming = await time(
    'selection-only update',
    async (i) => {
      if (!target) return;
      // Alternate ends so consecutive runs are not no-ops the engine can skip.
      const at = i % 2 === 0 ? target.from ?? target : target.to ?? target;
      e.setSelection({ anchor: at, head: at });
    },
    repetitions
  );

  const editTiming = await time(
    'one-character edit',
    async () => {
      e.exec({ type: 'toggleMark', mark: 'bold' });
    },
    repetitions
  );

  const scroller = document.querySelector('.docx-editor__scroll-container') ?? pagesEl().parentElement;
  const scrollTiming = await time(
    'scroll',
    async (i) => {
      if (scroller) scroller.scrollTop = (i + 1) * 800;
    },
    repetitions
  );
  if (scroller) scroller.scrollTop = 0;

  const memory = performance.memory
    ? {
        usedJSHeapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
        totalJSHeapMB: Math.round(performance.memory.totalJSHeapSize / 1048576),
        note: 'Chrome-only, coarse; comparable only between runs on the same browser.',
      }
    : { note: 'performance.memory unavailable in this browser' };

  return {
    provenance: {
      fixtureUrl,
      fixtureBytes: fixtureBytes.length,
      fixtureHeadHash: fixtureHash,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGB: navigator.deviceMemory ?? null,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      zoom: e.getZoom(),
      repetitions,
      warmState: 'cold load, then warm repetitions',
      takenAt: 'see commit date of the recorded baseline file',
    },
    invariants: {
      pages: shape.pages,
      visibleTextHash: await sha256(text),
      visibleTextChars: text.length,
      wrappingSignatureHash: await sha256(signature.join('\n')),
      wrappingLines: signature.length,
    },
    size: { ...shape, ...dom },
    timings: { initialPaintMs, selection: selectionTiming, edit: editTiming, scroll: scrollTiming },
    domIdentity: { selectionOnly: selectionIdentity, selectionMutations },
    memory,
  };
}
