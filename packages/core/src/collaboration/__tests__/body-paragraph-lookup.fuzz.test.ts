// Differential fuzz for the port's body paragraph lookup by node id. A remote caret asks it on
// every caret move, so it reads a node id map built once per body tree instead of listing every
// paragraph with its text. It must still answer exactly what that full list answers: through
// typing, splits, joins, deletions, and paraIds that go missing, invalid, lowercase,
// duplicated, or moved to an earlier paragraph after a lookup already named the later one, in
// loose paragraphs, table cells, content controls, and text boxes, beside paragraphs the reader
// demotes to generic, which still claim their id.

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createCollaborationDocumentPort } from '../document-port.ts';
import { collaborationParagraphScanRecorder, paragraphSnapshot } from '../paragraph-addresses.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { replaceNode, withPart, type OoxmlNode } from '../../store/package/index.ts';
import { paraIdOf } from '../../store/package/para-id.ts';
import { TreePackageStore } from '../../store/store/tree-package-store.ts';
import type { TreeDocOp } from '../../store/store/tree-ops.ts';

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const BODY = { kind: 'body' } as const;
/** Few ids, so duplicates are common; `null` is a missing id, `ZZZZZZZZ` an invalid one. */
const IDS = ['11111111', '22222222', '33333333', '4a4a4a4a', '4A4A4A4A', null, 'ZZZZZZZZ'] as const;

/** A small deterministic generator, so a failure names its seed. */
function random(seed: number) {
  let state = seed * 2654435761 + 1;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
  return {
    int: (below: number) => Math.floor(next() * below),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  };
}

function paragraphXml(id: string | null, text: string): string {
  const attributes = id === null ? '' : ` w14:paraId="${id}" w14:textId="${id}"`;
  return `<w:p${attributes}><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function bytes(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
        `xmlns:w14="${W14}" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>${body}<w:sectPr/>` +
        '</w:body></w:document>'
    ),
  });
}

/** A body of loose paragraphs and one table, its ids drawn from the small pool. */
function document(rng: ReturnType<typeof random>): string {
  const blocks: string[] = [];
  const count = 4 + rng.int(8);
  for (let index = 0; index < count; index += 1) {
    const shape = rng.int(8);
    if (shape === 6) {
      // A stray `w:tc` demotes the paragraph to generic: it claims its id and lists nowhere.
      blocks.push(
        paragraphXml(rng.pick(IDS), `generic ${index}`).replace('><w:r>', '><w:tc/><w:r>')
      );
    } else if (shape === 7) {
      const inner = paragraphXml(rng.pick(IDS), `text box ${index}`);
      blocks.push(
        `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>${inner}</w:txbxContent>` +
          '</v:textbox></v:shape></w:pict></w:r></w:p>'
      );
    } else if (shape === 0) {
      blocks.push(
        `<w:sdt><w:sdtContent>${paragraphXml(rng.pick(IDS), `control ${index}`)}</w:sdtContent></w:sdt>`
      );
    } else if (shape === 1) {
      const cells = [0, 1]
        .map(() => `<w:tc>${paragraphXml(rng.pick(IDS), `cell ${index}`)}</w:tc>`)
        .join('');
      blocks.push(
        `<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`
      );
    } else {
      blocks.push(paragraphXml(rng.pick(IDS), `paragraph ${index} text`));
    }
  }
  return blocks.join('');
}

function allNodeIds(node: OoxmlNode, into: string[] = []): string[] {
  into.push(node.id);
  if (node.kind !== 'textValue') for (const child of node.children) allNodeIds(child, into);
  return into;
}

function paragraphNodes(node: OoxmlNode, into: OoxmlNode[] = []): OoxmlNode[] {
  if (node.kind === 'paragraph') into.push(node);
  if (node.kind !== 'textValue') for (const child of node.children) paragraphNodes(child, into);
  return into;
}

/** Set, replace, or remove a paragraph's paraId, keeping its node id. */
function withParaId(node: OoxmlNode, id: string | null): OoxmlNode {
  if (node.kind === 'textValue') return node;
  const attributes = node.attributes.filter(
    (attribute) => !(attribute.namespaceUri === W14 && attribute.localName === 'paraId')
  );
  if (id !== null)
    attributes.push({
      kind: 'genericExtension',
      namespaceUri: W14,
      localName: 'paraId',
      prefix: 'w14',
      value: id,
    });
  return { ...node, attributes } as OoxmlNode;
}

function edit(store: TreePackageStore, rng: ReturnType<typeof random>): void {
  const part = store.bodyStore().part;
  const paragraphs = paragraphNodes(part.root);
  const target = rng.pick(paragraphs);
  const length = paragraphSnapshot(part).find((p) => p.nodeId === target.id)?.text.length ?? 0;
  const choice = rng.int(7);
  if (choice >= 5) {
    // Rename: often to an id an EARLIER paragraph's lookup would now claim.
    const id = rng.pick(IDS);
    store.transact(BODY, (context) =>
      context.applyPackage((pkg) => {
        const body = pkg.parts.get(pkg.mainDocumentPart)!;
        const replaced = replaceNode(body, target.id, withParaId(target, id), {
          deferValidation: true,
        });
        return replaced.ok ? withPart(pkg, replaced.part) : pkg;
      })
    );
    return;
  }
  const ops: TreeDocOp[] = [
    { op: 'insertText', paragraphId: target.id, offset: rng.int(length + 1), text: 'xy' },
    { op: 'deleteText', paragraphId: target.id, start: 0, end: Math.min(1, length) },
    { op: 'splitParagraph', paragraphId: target.id, offset: rng.int(length + 1) },
    {
      op: 'joinParagraphs',
      firstId: target.id,
      secondId: paragraphs[paragraphs.indexOf(target) + 1]?.id ?? target.id,
    },
    { op: 'deleteBlock', blockId: target.id },
  ];
  // A refused op (a join across cells, the last paragraph) changes nothing, which is fine.
  store.transact(BODY, (context) => context.apply(ops[choice]!));
}

test('the body paragraph lookup answers what the full paragraph list answers, through every edit', () => {
  let checked = 0;
  for (let seed = 0; seed < 300; seed += 1) {
    const rng = random(seed);
    const loaded = readOoxmlPackage(bytes(document(rng)));
    if (!loaded.ok) throw new Error(loaded.reason);
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    // Not normalized: the duplicate, missing and invalid ids stay in the live tree.
    const store = new TreePackageStore(loaded.package, main);
    const port = createCollaborationDocumentPort(store, { documentId: `fuzz-${seed}` });
    for (let step = 0; step < 30; step += 1) {
      const part = store.bodyStore().part;
      const expected = new Map(paragraphSnapshot(part).map((p) => [p.nodeId, p]));
      for (const nodeId of [...allNodeIds(part.root), `missing-${step}`]) {
        const actual = port.paragraphByNodeId(nodeId);
        const want = expected.get(nodeId) ?? null;
        if (JSON.stringify(actual) !== JSON.stringify(want)) {
          throw new Error(
            `seed ${seed} step ${step} node ${nodeId}: ${JSON.stringify(actual)} != ${JSON.stringify(want)}`
          );
        }
        checked += 1;
      }
      edit(store, rng);
    }
  }
  expect(checked).toBeGreaterThan(50_000);
}, 120_000);

test('caret lookups walk the paragraphs once per tree, not once per lookup', () => {
  const loaded = readOoxmlPackage(
    bytes(['11111111', '22222222', '33333333'].map((id) => paragraphXml(id, 'text')).join(''))
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const store = new TreePackageStore(loaded.package, main);
  const port = createCollaborationDocumentPort(store, { documentId: 'scan' });
  const target = paragraphNodes(store.bodyStore().part.root)[2]!;
  expect(paraIdOf(target)).toBe('33333333');
  const recorder = collaborationParagraphScanRecorder();
  recorder.reset();
  for (let move = 0; move < 100; move += 1) {
    expect(port.paragraphByNodeId(target.id)?.paragraphId).toBe('33333333');
  }
  expect(recorder.enumerations).toBe(1);
  // Typing elsewhere rebuilds the tree: one more walk, however many lookups follow.
  store.transact(BODY, (context) =>
    context.apply({
      op: 'insertText',
      paragraphId: paragraphNodes(store.bodyStore().part.root)[0]!.id,
      offset: 0,
      text: 'typed ',
    })
  );
  for (let move = 0; move < 100; move += 1) {
    expect(port.paragraphByNodeId(target.id)?.text).toBe('text');
  }
  expect(recorder.enumerations).toBe(2);
});

// `paragraphByStableId` re-checks a hint by the paragraph's own id only, so after an earlier
// paragraph takes that id it can keep answering the later holder, while `paragraphs()` and
// `paragraphByNodeId` follow the first claimant. Not this lookup's contract; see replication.ts.
test.todo(
  'paragraphByStableId follows the first claimant after an earlier paragraph takes its id',
  () => {
    const loaded = readOoxmlPackage(
      bytes(paragraphXml('11111111', 'first') + paragraphXml('22222222', 'second'))
    );
    if (!loaded.ok) throw new Error(loaded.reason);
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const store = new TreePackageStore(loaded.package, main);
    const port = createCollaborationDocumentPort(store, { documentId: 'hint' });
    const [first] = paragraphNodes(store.bodyStore().part.root);
    expect(port.paragraphByStableId('22222222')?.text).toBe('second');
    store.transact(BODY, (context) =>
      context.applyPackage((pkg) => {
        const body = pkg.parts.get(pkg.mainDocumentPart)!;
        const renamed = replaceNode(body, first!.id, withParaId(first!, '22222222'), {
          deferValidation: true,
        });
        return renamed.ok ? withPart(pkg, renamed.part) : pkg;
      })
    );
    const listed = port.paragraphs().find((p) => p.paragraphId === '22222222');
    expect(port.paragraphByStableId('22222222')?.nodeId).toBe(listed?.nodeId);
  }
);
