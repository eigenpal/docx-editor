import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createTestEditor as createEditor } from './create-test-editor.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/contracts/editor';
import {
  createEmptyModel,
  writeDocx,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type ParagraphRecord,
} from '@docx-editor.dev/core-contract/store';
import { IDENTITY_HOST_METRICS } from '../coordinate-mapper.ts';
import { INPUT_HOST_MIN_WIDTH_PX, INPUT_HOST_MIN_HEIGHT_PX } from '@docx-editor.dev/core-contract/binding';

const HUMAN = ORIGIN_IDS.mutationHuman;

function hostWithBody(body: HTMLElement, scroll: HTMLElement): EditorHost {
  return {
    getBodyHostEl: () => body,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => scroll,
    getInteractionHostMetrics: () => IDENTITY_HOST_METRICS,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
  };
}

describe('frame-driven input host placement', () => {
  test('createEditor mounts clipped input host with viewport-bounded fallback placement', () => {
    const model = createEmptyModel();
    const p1 = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
    const store = new DocumentStore(model);
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'hello' }));
    const bytes = writeDocx(store.currentModel);

    const body = document.createElement('div');
    const scroll = document.createElement('div');
    scroll.style.width = '640px';
    scroll.style.height = '480px';
    scroll.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        width: 640,
        height: 480,
        top: 0,
        left: 0,
        right: 640,
        bottom: 480,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.append(scroll);
    scroll.append(body);

    const editor = createEditor({ host: hostWithBody(body, scroll), document: bytes });
    expect(body.querySelector('[data-docx-input-host-clip]')).not.toBeNull();
    editor.relayout();
    const clip = body.querySelector('[data-docx-input-host-clip]') as HTMLElement;
    expect(clip.style.opacity).toBe('0');
    expect(clip.style.pointerEvents).toBe('none');

    const left = parseFloat(clip.style.left);
    const top = parseFloat(clip.style.top);
    const width = parseFloat(clip.style.width);
    const height = parseFloat(clip.style.height);
    const viewport = scroll.getBoundingClientRect();
    expect(left).toBeGreaterThanOrEqual(viewport.x);
    expect(top).toBeGreaterThanOrEqual(viewport.y);
    expect(width).toBeGreaterThanOrEqual(INPUT_HOST_MIN_WIDTH_PX);
    expect(height).toBeGreaterThanOrEqual(INPUT_HOST_MIN_HEIGHT_PX);
    expect(left + width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
    expect(top + height).toBeLessThanOrEqual(viewport.y + viewport.height + 1);

    const focus = editor.focus();
    expect(focus.ok).toBe(true);
    if (focus.ok) expect(focus.frameId).toEqual(editor.getInteractionFrame().id);

    editor.destroy();
    scroll.remove();
  });

  test('read-only editor focus returns typed readOnly outcome', () => {
    const scroll = document.createElement('div');
    const body = document.createElement('div');
    document.body.append(scroll);
    scroll.append(body);
    const editor = createEditor({
      host: hostWithBody(body, scroll),
      document: writeDocx(createEmptyModel()),
      mode: 'view',
    });
    const outcome = editor.focus();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('readOnly');
    editor.destroy();
    scroll.remove();
  });
});
