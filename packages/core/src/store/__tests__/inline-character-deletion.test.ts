// Deleting text across a symbol or hyphen (issue #1071).
//
// `w:sym`, `w:noBreakHyphen` and `w:softHyphen` have no model width. A deletion whose range
// spans one removes it, or strikes it when the deletion is tracked. A range that only touches
// one at its edge leaves it in place.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
import { planRevisionBatch } from '../store/revision-batch.ts';

const W = WML_NAMESPACE_URI;

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphId(part: OoxmlPart): string {
  const find = (node: OoxmlNode): string | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'paragraph') return node.id;
    for (const child of node.children) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  return find(part.root)!;
}

function paragraphXml(part: OoxmlPart): string {
  return serializeOoxmlPart(part).match(/<w:p>.*<\/w:p>/)![0];
}

function remove(body: string, start: number, end: number, tracked = false): OoxmlPart {
  const part = load(body);
  const result = applyTreeOp(part, {
    op: 'deleteText',
    paragraphId: paragraphId(part),
    start,
    end,
    ...(tracked ? { revision: { author: 'Writer', date: '2026-10-03T00:00:00Z' } } : {}),
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const ONE_RUN =
  '<w:p><w:r><w:t xml:space="preserve">the then</w:t><w:noBreakHyphen/>' +
  '<w:t>applicable rate</w:t><w:softHyphen/><w:t>s</w:t></w:r></w:p>';
const OWN_RUNS =
  '<w:p><w:r><w:t>co</w:t></w:r><w:r><w:noBreakHyphen/></w:r><w:r><w:sym w:font="Symbol" ' +
  'w:char="F0B7"/></w:r><w:r><w:t>signer</w:t></w:r></w:p>';

describe('deleting across zero-width characters', () => {
  test('removes a hyphen inside the range and keeps one outside it', () => {
    const xml = paragraphXml(remove(ONE_RUN, 5, 18));
    expect(xml).not.toContain('noBreakHyphen');
    expect(xml).toContain('<w:softHyphen/>');
  });

  test('keeps a hyphen at either edge of the range', () => {
    expect(paragraphXml(remove(ONE_RUN, 4, 8))).toContain('noBreakHyphen');
    expect(paragraphXml(remove(ONE_RUN, 8, 18))).toContain('noBreakHyphen');
  });

  test('removes symbols and hyphens in runs of their own, with the emptied runs', () => {
    const xml = paragraphXml(remove(OWN_RUNS, 1, 3));
    expect(xml).not.toContain('noBreakHyphen');
    expect(xml).not.toContain('w:sym');
    expect(xml.match(/<w:r>/g)).toHaveLength(2);
  });

  test('a tracked deletion strikes them, and accepting removes them', () => {
    for (const body of [ONE_RUN, OWN_RUNS]) {
      const [start, end] = body === ONE_RUN ? [5, 18] : [1, 3];
      const tracked = remove(body, start, end, true);
      const struck = paragraphXml(tracked)
        .match(/<w:del\b.*?<\/w:del>/g)!
        .join('');
      expect(struck).toContain('noBreakHyphen');
      if (body === OWN_RUNS) expect(struck).toContain('w:sym');
      const batch = planRevisionBatch(tracked, 'accept');
      const accepted = applyTreeOp(tracked, batch.ops[0]!);
      if (!accepted.ok) throw new Error(accepted.reason);
      expect(paragraphXml(accepted.part)).not.toContain('noBreakHyphen');
    }
  });
});
