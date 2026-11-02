/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { SideContext } from './units.ts';
import type { ElementNode } from './xml-fragments.ts';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * What a section setting is when a section does not state it. Only settings with a value that
 * means "as if absent" are listed; a section field or attribute outside this table that only
 * the revised document states cannot be recorded for a reject.
 */
const DEFAULTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  pgSz: { w: '12240', h: '15840', orient: 'portrait' },
  pgMar: {
    top: '1440',
    right: '1440',
    bottom: '1440',
    left: '1440',
    header: '720',
    footer: '720',
    gutter: '0',
  },
  cols: { num: '1', space: '720', equalWidth: '1', sep: '0' },
  vAlign: { val: 'top' },
  type: { val: 'nextPage' },
  textDirection: { val: 'lrTb' },
  pgNumType: { fmt: 'decimal', start: '0' },
  lnNumType: { countBy: '0', restart: 'newPage' },
  docGrid: { type: 'default' },
  paperSrc: { first: '0', other: '0' },
};

/** On/off section fields: absent means off. */
const ON_OFF = new Set(['titlePg', 'bidi', 'rtlGutter', 'formProt', 'noEndnote']);

/**
 * Attributes a record may leave out because the restored settings make them inert: the paper
 * code is a printer hint next to the stated size, and grid pitches have no effect while the
 * grid type is the default (no grid).
 */
const INERT: Readonly<Record<string, ReadonlySet<string>>> = {
  pgSz: new Set(['code']),
  docGrid: new Set(['linePitch', 'charSpace']),
};

const attributeKey = (attribute: { namespaceUri?: string | null; localName: string }) =>
  attribute.namespaceUri === W_NS ? attribute.localName : null;

/**
 * The old settings a `w:sectPrChange` records when `revised` replaces `base` (both without
 * header and footer references). A reject restores only the fields and attributes a record
 * names and keeps the rest, so every field or attribute that only the revised side states is
 * named here with its default value. Null when one of them has no default to name: the
 * difference cannot be recorded so that a reject restores the original.
 */
export function sectionRecord(
  base: readonly ElementNode[],
  revised: readonly ElementNode[],
  side: SideContext
): string | null {
  const baseByName = new Map(
    base.filter((node) => node.namespaceUri === W_NS).map((node) => [node.localName, node])
  );
  // Record fields by name, in schema order at the end.
  const fields: { name: string; xml: string }[] = base.map((node) => ({
    name: node.namespaceUri === W_NS ? node.localName : '',
    xml: side.serialize(node),
  }));
  const add = (name: string, xml: string) => fields.push({ name, xml });
  for (const node of revised) {
    if (node.namespaceUri !== W_NS) return null;
    const name = node.localName;
    const defaults = DEFAULTS[name];
    const old = baseByName.get(name);
    if (!old) {
      if (ON_OFF.has(name)) {
        add(name, `<w:${name} w:val="0"/>`);
        continue;
      }
      // An empty field states nothing, so keeping it on reject changes nothing.
      if (node.attributes.length === 0 && node.children.length === 0) continue;
      if (!defaults || node.children.length > 0) return null;
      let attributes = name === 'docGrid' ? ' w:type="default"' : '';
      for (const attribute of node.attributes) {
        const key = attributeKey(attribute);
        if (key !== null && INERT[name]?.has(key)) continue;
        if (name === 'docGrid' && key === 'type') continue;
        const value = key === null ? undefined : defaults[key];
        if (value === undefined) return null;
        attributes += ` w:${key}="${value}"`;
      }
      add(name, `<w:${name}${attributes}/>`);
      continue;
    }
    // Attributes only the revised field states take their defaults in the record.
    const stated = new Set(old.attributes.map((attribute) => attributeKey(attribute)));
    let added = '';
    for (const attribute of node.attributes) {
      const key = attributeKey(attribute);
      if (key !== null && stated.has(key)) continue;
      if (ON_OFF.has(name) && key === 'val') {
        // A stated field without a value is on.
        added += ' w:val="1"';
        continue;
      }
      if (key !== null && INERT[name]?.has(key) && !(name === 'docGrid' && stated.has('type')))
        continue;
      const value = key === null || !defaults ? undefined : defaults[key];
      if (value === undefined) return null;
      added += ` w:${key}="${value}"`;
    }
    if (added) {
      const field = fields.find((entry) => entry.name === name);
      if (field) field.xml = field.xml.replace(/^(<[^\s/>]+)/, `$1${added}`);
    }
  }
  const rank = (name: string) => {
    const index = SECTION_ORDER.indexOf(name);
    return index < 0 ? SECTION_ORDER.length : index;
  };
  return fields
    .map((field, index) => ({ ...field, index }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.index - b.index)
    .map((field) => field.xml)
    .join('');
}

/** `w:sectPr` content order (a sequence in the schema), without header and footer references. */
const SECTION_ORDER: readonly string[] = [
  'footnotePr',
  'endnotePr',
  'type',
  'pgSz',
  'pgMar',
  'paperSrc',
  'pgBorders',
  'lnNumType',
  'pgNumType',
  'cols',
  'formProt',
  'vAlign',
  'noEndnote',
  'titlePg',
  'textDirection',
  'bidi',
  'rtlGutter',
  'docGrid',
  'printerSettings',
];
