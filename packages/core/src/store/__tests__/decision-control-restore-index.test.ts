// A tracked-change decision restores the placeholder of each content control it emptied. The
// controls come from the part before the decision, found through its node index, and each
// decision makes a new part. In a long document without any control, building that index for
// every decision was most of a single decision's store time.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import { nodeIndexTestRecorder } from '../package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { restoreDecisionEmptiedControls } from '../store/content-control-prompt-restore.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const STAMP = 'w:id="1" w:author="Ada" w:date="2026-01-01T00:00:00Z"';

function partOf(body: string): OoxmlPart {
  const read = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
      ),
    })
  );
  if (!read.ok) throw new Error(read.reason);
  return read.package.parts.get('/word/document.xml')!;
}

/** The id of the first `w:ins` in the part. */
function insertionId(part: OoxmlPart): string {
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.localName === 'ins') return node.id;
    stack.push(...node.children);
  }
  throw new Error('no insertion');
}

const inserted = `<w:ins ${STAMP}><w:r><w:t>added</w:t></w:r></w:ins>`;

/** Every node of the part, depth first, for reading what a restore wrote. */
function nodesOf(part: OoxmlPart): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    out.push(node);
    if (node.kind !== 'textValue') stack.push(...node.children);
  }
  return out;
}

const control = (content: string) =>
  `<w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

describe('restoring controls after a decision', () => {
  test('reads no node index when the part holds no content control', () => {
    const before = partOf(`<w:p><w:r><w:t>Plain </w:t></w:r>${inserted}</w:p>`);
    const after = partOf('<w:p><w:r><w:t>Plain </w:t></w:r></w:p>');
    const recorder = nodeIndexTestRecorder();
    recorder.reset();
    expect(restoreDecisionEmptiedControls(before, [insertionId(before)], after)).toBe(after);
    expect(recorder.completeBuilds).toBe(0);
  });

  test('reads no node index when the decision is away from the only control', () => {
    const kept = control('<w:r><w:t>Value</w:t></w:r>');
    const before = partOf(`<w:p>${kept}</w:p><w:p><w:r><w:t>Plain </w:t></w:r>${inserted}</w:p>`);
    const after = partOf(`<w:p>${kept}</w:p><w:p><w:r><w:t>Plain </w:t></w:r></w:p>`);
    const recorder = nodeIndexTestRecorder();
    recorder.reset();
    expect(restoreDecisionEmptiedControls(before, [insertionId(before)], after)).toBe(after);
    expect(recorder.completeBuilds).toBe(0);
  });

  test('reads no node index when a block control wraps the whole body', () => {
    const before = partOf(control(`<w:p><w:r><w:t>Plain </w:t></w:r>${inserted}</w:p>`));
    const after = partOf(control('<w:p><w:r><w:t>Plain </w:t></w:r></w:p>'));
    const recorder = nodeIndexTestRecorder();
    recorder.reset();
    // A block-level control keeps no placeholder, so nothing changes.
    expect(restoreDecisionEmptiedControls(before, [insertionId(before)], after)).toBe(after);
    expect(recorder.completeBuilds).toBe(0);
  });

  test('restores the placeholder of a control the decision emptied', () => {
    // The control: a decision inside a control still finds it and writes its placeholder.
    const before = partOf(`<w:p>${control(inserted)}</w:p>`);
    const after = partOf(`<w:p>${control('')}</w:p>`);
    const restored = restoreDecisionEmptiedControls(before, [insertionId(before)], after);
    expect(restored).not.toBe(after);
    expect(
      nodesOf(restored).some((n) => n.kind !== 'textValue' && n.localName === 'showingPlcHdr')
    ).toBe(true);
  });
});
