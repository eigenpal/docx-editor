// A drawing group (`wpg:wgp`, CT_WordprocessingGroup; ECMA-376 Part 1, 20.4.2.39) that paints without
// one of its members still renders, but not as authored. The support report of the package
// and the live editor both say so: the drawing is `partial`, with a `projection-diagnostic`
// issue whose detail is `group-member-not-shown`. A group whose members all paint is `native`.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { observeUnsupportedElements, type UnsupportedElement } from '../index.ts';
import { inspectDrawingSupport, readOoxmlPackage } from '../../store/index.ts';
import { A, WPS, previewDocument } from '../../store/__tests__/drawing-support-fixtures.ts';

const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const PT = 12_700;

function bar(y: number, hex: string): string {
  return (
    '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
    `<a:xfrm><a:off x="0" y="${y * PT}"/><a:ext cx="${100 * PT}" cy="${10 * PT}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>`
  );
}

/** A member that paint cannot represent. */
const FRAME_MEMBER =
  '<wpg:graphicFrame><wpg:cNvPr id="9" name="Frame"/><wpg:cNvFrPr/><wpg:xfrm>' +
  '<a:off x="0" y="0"/><a:ext cx="100" cy="100"/></wpg:xfrm></wpg:graphicFrame>';

/** An inline group, 100pt x 50pt. */
function group(members: string): string {
  const cx = 100 * PT;
  const cy = 50 * PT;
  return (
    `<w:drawing xmlns:wpg="${WPG}" xmlns:a="${A}" xmlns:wps="${WPS}"><wp:inline>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Group" descr="Sample group"/>` +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="${cx}" cy="${cy}"/></a:xfrm></wpg:grpSpPr>` +
    `${members}</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>`
  );
}

function inspect(content: string) {
  const read = readOoxmlPackage(previewDocument(content));
  if (!read.ok) throw new Error(read.reason);
  return inspectDrawingSupport(read.package);
}

/** The drawings that the live editor offers to a host as not fully supported. */
function liveElements(content: string): { elements: UnsupportedElement[]; fills: string[] } {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: previewDocument(content),
    unsupportedElementRules: [{ includePartial: true }],
  });
  let elements: UnsupportedElement[] = [];
  const stop = observeUnsupportedElements(container, (hosts) => {
    elements = hosts.map((host) => host.unsupported);
  });
  try {
    const fills = Array.from(container.querySelectorAll('.docx-drawing svg path'), (path) =>
      String(path.getAttribute('fill'))
    );
    return { elements, fills };
  } finally {
    stop();
    editor.destroy();
    container.remove();
  }
}

const TEXTBOX_MEMBER =
  '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr>' +
  `<a:xfrm><a:off x="0" y="${30 * PT}"/><a:ext cx="${100 * PT}" cy="${20 * PT}"/></a:xfrm>` +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
  '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Label</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
  '<wps:bodyPr/></wps:wsp>';

const PARTLY_PAINTED = group(bar(0, 'FF0000') + FRAME_MEMBER + bar(20, '00FF00'));
const WHOLE = group(bar(0, 'FF0000') + bar(20, '00FF00'));

test('the package report marks a group that paints without a member as partial', () => {
  const report = inspect(PARTLY_PAINTED);
  expect(report.complete).toBe(true);
  expect(report.entries).toHaveLength(1);
  const entry = report.entries[0]!;
  expect(entry.state).toBe('projected');
  expect(entry.support).toBe('partial');
  expect(entry.graphicKind).toBe('group');
  expect(entry.issues).toEqual([
    expect.objectContaining({ code: 'projection-diagnostic', detail: 'group-member-not-shown' }),
  ]);
  // The issue names the member, not the drawing.
  expect(entry.issues[0]!.nodeId).not.toBe(entry.nodeId);
  expect(entry.issues[0]!.nodeId.startsWith(`${entry.drawingNodeId}.`)).toBe(true);
});

test('the package report names each member that a group paints without', () => {
  const entry = inspect(group(bar(0, 'FF0000') + FRAME_MEMBER + FRAME_MEMBER)).entries[0]!;
  expect(entry.support).toBe('partial');
  expect(entry.issues.map((issue) => issue.detail)).toEqual([
    'group-member-not-shown',
    'group-member-not-shown',
  ]);
  expect(new Set(entry.issues.map((issue) => issue.nodeId)).size).toBe(2);
});

test('a group whose members all paint is native in the report and in the editor', () => {
  const entry = inspect(WHOLE).entries[0]!;
  expect(entry.state).toBe('projected');
  expect(entry.support).toBe('native');
  expect(entry.issues).toEqual([]);
  const live = liveElements(WHOLE);
  expect(live.elements).toEqual([]);
  expect(live.fills).toEqual(['#FF0000', '#00FF00']);
});

test('a group whose only member cannot paint is unrendered', () => {
  const entry = inspect(group(FRAME_MEMBER)).entries[0]!;
  expect(entry.state).toBe('placeholder');
  expect(entry.support).toBe('unrendered');
  expect(entry.issues.map((issue) => issue.detail)).toContain('group-member-not-shown');
});

test('the live editor offers a group that paints without a member as partial', () => {
  const live = liveElements(PARTLY_PAINTED);
  // The members that can paint still paint.
  expect(live.fills).toEqual(['#FF0000', '#00FF00']);
  expect(live.elements).toHaveLength(1);
  const element = live.elements[0]!;
  expect(element.support).toBe('partial');
  expect(element.graphicKind).toBe('group');
  expect(element.label).toBe('Sample group');
  expect(element.drawingIssues).toEqual([
    expect.objectContaining({
      code: 'projection-diagnostic',
      detail: 'group-member-not-shown',
      nodeId: element.nodeId,
    }),
  ]);
});

test('the package report covers a group with a text box member', () => {
  const entry = inspect(group(bar(0, 'FF0000') + FRAME_MEMBER + TEXTBOX_MEMBER)).entries[0]!;
  expect(entry.support).toBe('partial');
  expect(entry.issues.map((issue) => issue.detail)).toEqual(['group-member-not-shown']);
});
