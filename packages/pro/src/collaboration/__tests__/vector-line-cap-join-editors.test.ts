/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import { createFixedMeasurer } from '../../../../core/src/layout/fixed-measurer.ts';
import {
  mountPaginatedSurface,
  type PaginatedSurface,
} from '../../../../core/src/editor/paginated-surface.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

function source() {
  return zipDocument(`<w:p><w:r><w:t>AB</w:t></w:r></w:p>
    <w:p xmlns:a="${A}" xmlns:wp="${WP}" xmlns:wps="${WPS}">
      <w:r><w:drawing><wp:inline><wp:extent cx="127000" cy="127000"/>
      <wp:docPr id="1" name="Shared source line"/>
      <a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:spPr>
      <a:prstGeom prst="line"/><a:noFill/>
      <a:ln w="25400" cap="rnd"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:bevel/></a:ln>
      </wps:spPr></wps:wsp></a:graphicData></a:graphic>
      </wp:inline></w:drawing></w:r></w:p>`);
}

interface View {
  surface: PaginatedSurface;
  container: HTMLElement;
}

function mount(peer: Peer): View {
  // The harness's original store/port must not remain attached alongside an editor.
  peer.detach();
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, peer.room.document, {
    scale: 1,
    measurer: createFixedMeasurer(),
    collaborationModel: { session: peer.room.session },
  });
  if (!opened.ok) throw new Error(`${opened.reason}: ${opened.detail ?? ''}`);
  expect(opened.surface.collaborationSession()).toBe(peer.room.session);
  return { surface: opened.surface, container };
}

function select(view: View, start: number, end = start) {
  const paragraphId = view.surface.session.paragraphIds()[0]!;
  view.surface.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

function xml(view: View): string {
  return strFromU8(unzipSync(view.surface.save())['word/document.xml']!);
}

function painted(view: View) {
  const paths = [...view.container.querySelectorAll('svg path[stroke="#112233"]')];
  expect(paths).toHaveLength(1);
  const path = paths[0]!;
  expect(path.getAttribute('stroke-linecap')).toBe('round');
  expect(path.getAttribute('stroke-linejoin')).toBe('bevel');
  return {
    path: path.getAttribute('d'),
    cap: path.getAttribute('stroke-linecap'),
    join: path.getAttribute('stroke-linejoin'),
    width: path.getAttribute('stroke-width'),
  };
}

function expectShared(left: View, right: View, text: string) {
  // These are the editor-owned stores actually attached to the two sessions;
  // the detached harness stores are deliberately not used for convergence.
  expect(left.surface.session.bodyText().split('\n')[0]).toBe(text);
  expect(right.surface.session.bodyText().split('\n')[0]).toBe(text);
  expect(xml(left)).toBe(xml(right));
  for (const view of [left, right]) {
    expect(xml(view)).toContain('cap="rnd"');
    expect(xml(view)).toContain('<a:bevel');
  }
  expect(painted(left)).toEqual(painted(right));
}

function destroy(view: View) {
  view.surface.destroy();
  view.container.remove();
}

test('two real shared editors preserve source cap and join through concurrent text, undo and deletion', async () => {
  const harness = createPeerHarness('vector-cap-join-real-editors');
  const views: View[] = [];
  try {
    const { alice, bob, pause, resume } = await harness.pair(source());
    const left = mount(alice),
      right = mount(bob);
    views.push(left, right);
    expectShared(left, right, 'AB');
    const originalPaint = painted(left);
    pause();
    select(left, 0);
    select(right, 2);
    left.surface.type('L');
    right.surface.type('R');
    resume();
    expectShared(left, right, 'LABR');
    left.surface.undo();
    expectShared(left, right, 'ABR');
    left.surface.redo();
    expectShared(left, right, 'LABR');
    pause();
    select(left, 1, 3);
    select(right, 2);
    left.surface.deleteForward();
    right.surface.type('X');
    resume();
    expectShared(left, right, 'LXR');
    expect(painted(left)).toEqual(originalPaint);
  } finally {
    for (const view of views) destroy(view);
    harness.cleanup();
  }
}, 10000);

test('surviving real editor and a fresh join retain cap and join after peer teardown and save', async () => {
  const harness = createPeerHarness('vector-cap-join-peer-lifecycle');
  const views: View[] = [];
  try {
    const { alice, bob } = await harness.pair(source());
    const left = mount(alice),
      right = mount(bob);
    views.push(left, right);
    select(left, 0);
    left.surface.type('L');
    expectShared(left, right, 'LAB');
    destroy(left);
    views.splice(views.indexOf(left), 1);
    select(right, 3);
    right.surface.type('C');
    expect(right.surface.session.bodyText().split('\n')[0]).toBe('LABC');
    const joined = await harness.join(bob, 'charlie');
    const third = mount(joined);
    views.push(third);
    expectShared(right, third, 'LABC');
    const coldContainer = document.createElement('div');
    document.body.append(coldContainer);
    const cold = mountPaginatedSurface(coldContainer, right.surface.save(), {
      scale: 1,
      measurer: createFixedMeasurer(),
    });
    if (!cold.ok) throw new Error(`${cold.reason}: ${cold.detail ?? ''}`);
    const reopened = { surface: cold.surface, container: coldContainer };
    views.push(reopened);
    expectShared(right, reopened, 'LABC');
    expect(cold.surface.collaborationSession()).toBeNull();
  } finally {
    for (const view of views) destroy(view);
    harness.cleanup();
  }
}, 10000);
