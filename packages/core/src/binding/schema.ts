// ProseMirror schema for the editable projection (document-engine task 6.2), COMPOSED from
// registered binding capabilities (comprehensive 3.4/3.5) rather than hardcoded. This module
// registers the base nodes (doc, text), the editable PARAGRAPH capability (paragraph node +
// bold/italic marks + its projector), and the generic READ-ONLY capability (blockEmbed atom + the
// default projector), then builds the schema. A new block kind registers a projector instead of
// editing this schema. The PM doc is a PROJECTION target, never canonical state.

import { Node as PMNode, type Schema } from 'prosemirror-model';
import {
  isUnderlineColor,
  isUnderlineVariant,
  type Block,
  type ParagraphRecord,
  type RunRecord,
  type UnderlineVariant,
} from '@docx-editor.dev/engine-core';
import {
  registerBindingNode,
  registerBindingMark,
  registerBlockProjector,
  registerDefaultBlockProjector,
  buildDocSchema,
} from './binding-capabilities.ts';

// --- base structural nodes ---
registerBindingNode('doc', { content: 'block+' });

// --- editable paragraph capability: node + marks + projector ---
registerBindingNode(
  'paragraph',
  {
    content: 'text*',
    group: 'block',
    // The authored paragraph id, threaded through so edits keep identity.
    attrs: { semId: { default: null } },
    // toDOM lets the schema also drive a live EditorView (not just headless mapping).
    toDOM(node) {
      return ['p', { 'data-sem-id': String(node.attrs.semId ?? '') }, 0];
    },
    parseDOM: [{ tag: 'p' }],
  },
  'paragraph' // reverse-mapping role: an editable text block
);

// --- generic read-only capability: a non-paragraph authored block (table, SDT, ...) projected as
// an opaque atom that carries the block's authored semId so the forward mapper maps it back to the
// exact canonical block and never flattens or mutates it. Rendered as a labeled, non-editable box.
registerBindingNode(
  'blockEmbed',
  {
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    // `text` carries a read-only PARAGRAPH's content for assistive technology.
    //
    // Partial editability (M6P.1) projects a paragraph with no lossless patch path as a
    // read-only atom. The atom had no text, and the painted pages are
    // `aria-hidden="true" role="presentation"`, so the ProseMirror projection is the ONLY
    // assistive representation of the document — which meant 21.1% of the flagship
    // fixture's body text, including every section heading, was unreachable to a screen
    // reader. Independent review measured 1,813 of 8,581 characters missing.
    //
    // Empty for a table or SDT atom, which has no text projection to lose.
    attrs: { semId: { default: null }, kind: { default: 'block' }, text: { default: '' } },
    toDOM(node) {
      const text = String(node.attrs.text ?? '');
      return [
        'div',
        {
          class: 'docx-block-embed',
          'data-sem-id': String(node.attrs.semId ?? ''),
          'data-kind': String(node.attrs.kind ?? 'block'),
          'data-block-role': 'readOnlyAtom',
          contenteditable: 'false',
        },
        // A TEXT child, built through the DOM spec rather than any HTML string, so a
        // screen reader reads the paragraph even though it cannot be edited.
        ...(text ? [text] : []),
      ];
    },
  },
  'atom' // reverse-mapping role: a read-only projected block
);
registerBindingNode('text', { group: 'inline' });

// bold/italic EXCLUDE the opaque rawRunProps capsule, so applying b/i to a capsule run REMOVES the
// capsule and materializes the modeled mark (the user's edit wins, visibly) rather than being
// discarded by the capsule.
registerBindingMark('bold', {
  excludes: 'rawRunProps',
  toDOM: () => ['strong', 0],
  parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
});
registerBindingMark('italic', {
  excludes: 'rawRunProps',
  toDOM: () => ['em', 0],
  parseDOM: [{ tag: 'em' }, { tag: 'i' }],
});
// Underline carries its ST_Underline VARIANT and colour, not just presence (D8). A boolean
// mark could only ever re-emit `w:val="single"`, so toggling underline anywhere in a
// double-underlined run would silently downgrade the author's formatting on save — which is
// exactly why the toolbar command used to refuse outright. With the variant on the mark, a
// round trip through the projection reproduces the authored `w:u`.
//
// `val` and `color` reach the DOM only as data attributes and a `text-decoration-*` pair, and
// both are validated at the parse boundary and by the DocOp validator (`isUnderlineVariant` /
// `isUnderlineColor`), so no file-derived string is interpolated unchecked into CSS.
registerBindingMark('underline', {
  attrs: { val: { default: 'single' }, color: { default: null } },
  excludes: 'rawRunProps',
  toDOM: (mark) => {
    const val = isUnderlineVariant(mark.attrs.val) ? mark.attrs.val : 'single';
    const color = isUnderlineColor(mark.attrs.color) ? mark.attrs.color : null;
    const style = `text-decoration-line:underline;text-decoration-style:${UNDERLINE_CSS_STYLE[val]}${
      color && color !== 'auto' ? `;text-decoration-color:#${color}` : ''
    }`;
    return ['u', { 'data-u-val': val, ...(color ? { 'data-u-color': color } : {}), style }, 0];
  },
  parseDOM: [
    {
      tag: 'u',
      getAttrs: (dom: HTMLElement | string) => {
        if (typeof dom === 'string') return null;
        const val = dom.getAttribute('data-u-val');
        const color = dom.getAttribute('data-u-color');
        return {
          val: isUnderlineVariant(val) ? val : 'single',
          color: isUnderlineColor(color) ? color : null,
        };
      },
    },
  ],
});

/** How each ST_Underline variant paints as a CSS `text-decoration-style`. CSS has four styles
 *  where OOXML has eighteen, so the heavy/long/word-only distinctions collapse; the authored
 *  value is what round-trips, this only decides what the projection looks like. */
const UNDERLINE_CSS_STYLE: Record<UnderlineVariant, string> = {
  single: 'solid',
  words: 'solid',
  double: 'double',
  thick: 'solid',
  dotted: 'dotted',
  dottedHeavy: 'dotted',
  dash: 'dashed',
  dashedHeavy: 'dashed',
  dashLong: 'dashed',
  dashLongHeavy: 'dashed',
  dotDash: 'dashed',
  dashDotHeavy: 'dashed',
  dotDotDash: 'dashed',
  dashDotDotHeavy: 'dashed',
  wave: 'wavy',
  wavyHeavy: 'wavy',
  wavyDouble: 'wavy',
  none: 'solid',
};
// An OPAQUE run-properties capsule mark: it carries the verbatim <w:rPr> bytes of a run whose
// formatting the model does not represent, so editing the run's TEXT preserves its rPr. Two runs
// with different capsules carry different `rpr` attrs and stay separate; identical capsules merge
// (same formatting). The capsule is opaque — the editor cannot toggle its formatting; typed text
// gets no capsule mark (default formatting). Rendered inert (a plain span carrying the bytes).
/**
 * Capsule bytes by opaque id, minted in `toDOM` — reachable only for marks that already
 * carry model-derived bytes, since `runToText` builds them from the canonical model and
 * `parseDOM` is registry-gated (an unknown ref yields no mark).
 *
 * The capsule must survive ProseMirror's DOM re-parse. Delegated `beforeinput` types let
 * the BROWSER perform the edit and PM's DOM observer reconcile it — the only input path
 * that re-parses. A word or line delete crossing a run boundary marks the capsule's mark
 * view `NODE_DIRTY`, `MarkViewDesc.parseRule()` then returns null, and with no `parseDOM`
 * rule the mark was silently dropped: the run's authored `w:rPr` was gone, `commitFromDoc`
 * did not reject (a capsule run is projectable), and the formatting was lost on save.
 * Independent security review reproduced it — a run carrying `<w:color w:val="FF0000"/>`
 * re-emitted as a bare `<w:r><w:t>`.
 *
 * The fix cannot be "parse the bytes back out of the DOM": the capsule is re-emitted
 * VERBATIM into document.xml, so accepting DOM-supplied bytes would reopen the OOXML/OLE
 * injection vector the missing `parseDOM` was there to close. Instead the DOM carries only
 * an opaque REFERENCE, and resolution goes through this registry, so the bytes never
 * travel through the DOM. The worst an attacker can do by forging a ref is re-apply a
 * capsule ALREADY present in this document — no new bytes enter the package. (And forged
 * markup does not get that far anyway: `input-policy.ts` refuses pasted HTML matching
 * `data-raw-rpr`, which `data-raw-rpr-ref` contains.)
 */
const capsuleById = new Map<string, string>();
const idByCapsule = new Map<string, string>();

/**
 * Per-realm nonce, regenerated whenever the registry is released.
 *
 * The first version numbered refs `c1`, `c2`, … in projection order, and kept them for
 * the page lifetime. Both were exploitable, and independent security review reproduced
 * it end to end: an attacker authors document A, knows their capsule lands at `c1`,
 * and a `<span data-raw-rpr-ref="c1">` pasted into VICTIM document B resolved to A's
 * bytes and was written into B's `document.xml`. `isRunPropertiesCapsule` only checks
 * "lone balanced w:rPr", so the payload can carry `w:object`/OLE — precisely the vector
 * the missing `parseDOM` had closed.
 *
 * Sequential ids let the payload be crafted offline; the nonce is generated at runtime
 * in the victim's browser, so a ref cannot be guessed ahead of time. Releasing on
 * teardown closes the other leg, where a live ref is carried out of A by a real copy.
 */
let capsuleNonce = mintNonce();

function mintNonce(): string {
  const bytes = new Uint8Array(9);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 2654435761) % 256;
  return Array.from(bytes, (b) => b.toString(36)).join('');
}

/** Mint (or reuse) the opaque id for a capsule projected from the canonical model. */
function capsuleRef(rpr: string): string {
  const existing = idByCapsule.get(rpr);
  if (existing) return existing;
  const id = `${capsuleNonce}-${idByCapsule.size + 1}`;
  idByCapsule.set(rpr, id);
  capsuleById.set(id, rpr);
  return id;
}

/**
 * Drop every capsule ref and re-nonce, so no ref minted for the previous document
 * resolves again. Called when an edit surface is destroyed — which is what happens
 * before another document is loaded into the same realm.
 */
export function releaseCapsuleRefs(): void {
  capsuleById.clear();
  idByCapsule.clear();
  capsuleNonce = mintNonce();
}

/** Test seam: the bytes a ref resolves to, or undefined for an unknown ref. */
export function resolveCapsuleRef(ref: string): string | undefined {
  return capsuleById.get(ref);
}

/**
 * The inline style that makes a capsule run LOOK like its modeled formatting.
 *
 * Every value is re-checked here rather than trusted from the attrs: a mark's attrs
 * survive a clipboard round trip through the DOM, and this builds a CSS string, which
 * CLAUDE.md requires be escaped or constrained at the boundary. Booleans and an
 * allowlisted variant/colour cannot carry a `;` or a `url(...)`, so the result is a
 * closed set of literals rather than interpolated file data.
 */
function capsuleDisplayStyle(attrs: Record<string, unknown>): string {
  const declarations: string[] = [];
  if (attrs.bold === true) declarations.push('font-weight:bold');
  if (attrs.italic === true) declarations.push('font-style:italic');
  const u = attrs.u as { val?: unknown; color?: unknown } | null;
  if (u && isUnderlineVariant(u.val) && u.val !== 'none') {
    declarations.push('text-decoration-line:underline');
    declarations.push(`text-decoration-style:${UNDERLINE_CSS_STYLE[u.val]}`);
    if (isUnderlineColor(u.color) && u.color !== 'auto') {
      declarations.push(`text-decoration-color:#${u.color}`);
    }
  }
  return declarations.join(';');
}

registerBindingMark('rawRunProps', {
  // `rpr` is the capsule's serialization authority. The rest are DISPLAY ONLY, derived from
  // the canonical run's already-validated `props` at projection time.
  //
  // Without them the capsule rendered an inert `<span>`, so EVERY run parsed from a real
  // document — which is every run with any formatting, since parsing captures its `w:rPr`
  // byte-exact — displayed as plain text. Measured on an underline fixture: ten authored
  // `w:u` variants, zero underlines on screen. Bold and italic were equally invisible.
  //
  // They cannot simply be projected as the bold/italic/underline MARKS instead: those
  // exclude `rawRunProps`, deliberately, so that toggling one on a capsule run drops the
  // capsule and materializes the user's edit. Carrying the display on the capsule keeps
  // both properties — the run looks right, and an actual toggle still wins.
  attrs: { rpr: {}, bold: { default: false }, italic: { default: false }, u: { default: null } },
  // Self-exclusion (a run has ONE rPr), and bold/italic exclude it (above) so the opaque capsule and
  // the modeled marks never coexist.
  excludes: 'rawRunProps',
  toDOM: (mark) => {
    const style = capsuleDisplayStyle(mark.attrs);
    return [
      'span',
      {
        'data-raw-rpr-ref': capsuleRef(String(mark.attrs.rpr)),
        ...(style ? { style } : {}),
      },
      0,
    ];
  },
  // Resolves ONLY through the registry above. An unrecognized ref returns false, so the
  // mark is dropped and the text parses plain — the old behavior, for anything that did
  // not come from this document's own projection.
  parseDOM: [
    {
      tag: 'span[data-raw-rpr-ref]',
      getAttrs: (dom: HTMLElement | string) => {
        if (typeof dom === 'string') return false;
        const rpr = capsuleById.get(dom.getAttribute('data-raw-rpr-ref') ?? '');
        return rpr === undefined ? false : { rpr };
      },
    },
  ],
  // SECURITY: the capsule is re-emitted VERBATIM into document.xml, and even a balanced w:rPr can
  // carry attacker OOXML (a nested w:object/OLE, duplicate attributes) that a "valid single w:rPr"
  // check cannot scrub. So capsule BYTES may only come from the ORIGINAL parsed document, never from
  // DOM. That invariant is unchanged: the DOM carries an opaque ref, and `getAttrs` resolves it
  // through a registry populated exclusively by the model projection. paragraphNodeToRuns still
  // re-validates the resulting capsule.
});

function runToText(run: RunRecord, schema: Schema): PMNode {
  // A run carrying an ownership-scoped rPr capsule projects with the opaque rawRunProps mark (which
  // already holds the full rPr, incl. b/i) instead of the modeled bold/italic marks.
  if (run.rPrCapsule) {
    const underline = run.props?.underline;
    return schema.text(run.text, [
      schema.marks.rawRunProps.create({
        rpr: run.rPrCapsule,
        bold: run.props?.bold === true,
        italic: run.props?.italic === true,
        // Display only — the capsule's own bytes are still what serializes.
        u: underline && underline.val !== 'none' ? { ...underline } : null,
      }),
    ]);
  }
  const marks = [];
  if (run.props?.bold) marks.push(schema.marks.bold.create());
  if (run.props?.italic) marks.push(schema.marks.italic.create());
  // `none` is an authored OFF, and mark ABSENCE already means "no underline" — projecting a
  // mark for it would read back as an authored single underline.
  const underline = run.props?.underline;
  if (underline && underline.val !== 'none') {
    marks.push(
      schema.marks.underline.create({ val: underline.val, color: underline.color ?? null })
    );
  }
  return schema.text(run.text, marks);
}
registerBlockProjector('paragraph', (block, schema) => {
  const p = block as ParagraphRecord;
  const inline = p.runs.filter((r) => r.text.length > 0).map((r) => runToText(r, schema));
  return schema.node('paragraph', { semId: p.id }, inline);
}); // paragraph editability is the reverse-lane fact BINDING_EDITABLE_KINDS, not a projector flag
registerDefaultBlockProjector((block: Block, schema) =>
  schema.node('blockEmbed', {
    semId: block.id,
    kind: block.kind,
    // A read-only PARAGRAPH keeps its text so assistive technology can still read it.
    // Other kinds project no text and lose nothing.
    text:
      block.kind === 'paragraph' ? (block as ParagraphRecord).runs.map((r) => r.text).join('') : '',
  })
);

// The composed ProseMirror schema — a REAL Schema built once from every capability registered
// above (a lazy Proxy stand-in was tried and rejected: it is not transparently a Schema, so PM
// identity / spread / instanceof / `state.schema === doc.type.schema` checks break). Registration
// therefore happens at module-load time: the built-ins here, plus any feature whose registration
// module is evaluated BEFORE this one. NOTE (known limitation): because this build is eager,
// registering a NEW node/mark AFTER engine-binding is imported is not yet supported (a deferred-
// build entry point is a follow-up); the current editable surface is paragraph + read-only atom.
export const docSchema: Schema = buildDocSchema();
