import { WML_NAMESPACE_URI, type OoxmlPart } from '@docx-editor.dev/core/store';
import { isElementRecord, type EncodedAttribute, type LogicalId } from './contract.ts';
import { collectKind, paragraphWithText, runWithText, textWith } from './fixtures.ts';
import type { Replica } from './replicas.ts';

const W = WML_NAMESPACE_URI;

export function insertText(
  replica: Replica,
  part: OoxmlPart,
  value: string,
  offset: number,
  text: string
): void {
  replica.backend.insertText(textWith(part, value).id, offset, text);
}

export function setParagraphAttribute(
  replica: Replica,
  part: OoxmlPart,
  paragraphText: string,
  attribute: EncodedAttribute
): void {
  replica.backend.setAttribute(paragraphWithText(part, paragraphText).id, attribute);
}

export function addRunMark(
  replica: Replica,
  part: OoxmlPart,
  runText: string,
  localName: 'b' | 'i'
): LogicalId {
  const run = runWithText(part, runText);
  const rPr = run.children.find((child) => child.kind === 'runProperties');
  if (!rPr || rPr.kind === 'textValue') throw new Error('run properties missing');
  const markId = replica.mint.take();
  replica.doc.transact(() => {
    replica.backend.createElement({
      logicalId: markId,
      kind: 'generic',
      namespaceUri: W,
      localName,
      prefix: 'w',
      attributes: [],
      bindings: [],
    });
    replica.backend.spliceChildren(rPr.id, rPr.children.length, 0, [markId]);
  });
  return markId;
}

export function splitParagraph(
  replica: Replica,
  part: OoxmlPart,
  value: string,
  offset: number
): LogicalId {
  const text = textWith(part, value);
  const rest = value.slice(offset);
  const paragraphId = findParentKind(replica, text.id, 'paragraph');
  const bodyId = replica.backend.parentOf(paragraphId);
  if (!bodyId) throw new Error('body missing');
  const body = replica.backend.record(bodyId);
  if (!body || !isElementRecord(body)) throw new Error('body has no children');
  const index = body.childIds.indexOf(paragraphId) + 1;
  let created: LogicalId = '';
  replica.doc.transact(() => {
    replica.backend.deleteText(text.id, offset, value.length - offset);
    created = insertParagraph(replica, bodyId, index, rest);
  });
  return created;
}

export function joinParagraphs(
  replica: Replica,
  part: OoxmlPart,
  first: string,
  second: string
): void {
  const firstText = textWith(part, first);
  const secondText = textWith(part, second);
  const secondParagraph = findParentKind(replica, secondText.id, 'paragraph');
  const bodyId = replica.backend.parentOf(secondParagraph);
  if (!bodyId) throw new Error('body missing');
  const body = replica.backend.record(bodyId);
  if (!body || !isElementRecord(body)) throw new Error('body has no children');
  replica.doc.transact(() => {
    if (replica.backend.kind === 'registry') {
      replica.backend.joinNodes(
        findParentKind(replica, firstText.id, 'paragraph'),
        secondParagraph
      );
      return;
    }
    replica.backend.insertText(firstText.id, first.length, second);
    replica.backend.spliceChildren(bodyId, body.childIds.indexOf(secondParagraph), 1, []);
  });
}

export function deleteParagraph(replica: Replica, part: OoxmlPart, value: string): void {
  const paragraphId = findParentKind(replica, textWith(part, value).id, 'paragraph');
  const bodyId = replica.backend.parentOf(paragraphId);
  if (!bodyId) throw new Error('body missing');
  const body = replica.backend.record(bodyId);
  if (!body || !isElementRecord(body)) throw new Error('body has no children');
  if (replica.backend.kind === 'registry') replica.backend.tombstone(paragraphId);
  else replica.backend.spliceChildren(bodyId, body.childIds.indexOf(paragraphId), 1, []);
}

export function insertTableRow(replica: Replica, part: OoxmlPart): LogicalId {
  const table = collectKind(part, 'table')[0];
  if (!table) throw new Error('table missing');
  const rowId = replica.mint.take();
  replica.doc.transact(() => {
    const cellId = replica.mint.take();
    const paragraphId = replica.mint.take();
    const runId = replica.mint.take();
    const textElId = replica.mint.take();
    const textId = replica.mint.take();
    replica.backend.createElement(element(rowId, 'tableRow', 'tr'));
    replica.backend.createElement(element(cellId, 'tableCell', 'tc'));
    replica.backend.createElement(element(paragraphId, 'paragraph', 'p'));
    replica.backend.createElement(element(runId, 'run', 'r'));
    replica.backend.createElement(element(textElId, 'text', 't'));
    replica.backend.createText(textId, 'Row');
    replica.backend.spliceChildren(textElId, 0, 0, [textId]);
    replica.backend.spliceChildren(runId, 0, 0, [textElId]);
    replica.backend.spliceChildren(paragraphId, 0, 0, [runId]);
    replica.backend.spliceChildren(cellId, 0, 0, [paragraphId]);
    replica.backend.spliceChildren(rowId, 0, 0, [cellId]);
    replica.backend.spliceChildren(table.id, table.children.length, 0, [rowId]);
  });
  return rowId;
}

export function moveRun(
  replica: Replica,
  part: OoxmlPart,
  runText: string,
  destParagraphText: string,
  destIndex: number
): LogicalId {
  const run = runWithText(part, runText);
  replica.backend.moveNode(run.id, paragraphWithText(part, destParagraphText).id, destIndex);
  return run.id;
}

export function insertParagraph(
  replica: Replica,
  bodyId: LogicalId,
  index: number,
  text: string
): LogicalId {
  const paragraphId = replica.mint.take();
  const runId = replica.mint.take();
  const textElId = replica.mint.take();
  const textId = replica.mint.take();
  replica.backend.createElement(element(paragraphId, 'paragraph', 'p'));
  replica.backend.createElement(element(runId, 'run', 'r'));
  replica.backend.createElement(element(textElId, 'text', 't'));
  replica.backend.createText(textId, text);
  replica.backend.spliceChildren(textElId, 0, 0, [textId]);
  replica.backend.spliceChildren(runId, 0, 0, [textElId]);
  replica.backend.spliceChildren(paragraphId, 0, 0, [runId]);
  replica.backend.spliceChildren(bodyId, index, 0, [paragraphId]);
  return paragraphId;
}

function element(logicalId: LogicalId, kind: string, localName: string) {
  return {
    logicalId,
    kind,
    namespaceUri: W,
    localName,
    prefix: 'w' as const,
    attributes: [] as const,
    bindings: [] as const,
  };
}

function findParentKind(replica: Replica, start: LogicalId, kind: string): LogicalId {
  let current: LogicalId | null = start;
  while (current) {
    const record = replica.backend.record(current);
    if (record && record.kind === kind) return current;
    current = replica.backend.parentOf(current);
  }
  throw new Error(`${kind} parent missing`);
}
