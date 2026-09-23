import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { createDocumentRefresh } from '../document-refresh.ts';
import { refreshFixture, refreshMetadata } from './document-refresh-fixture.ts';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

async function open() {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: refreshFixture() });
  disposers.push(() => {
    editor.destroy();
    container.remove();
  });
  const refresh = createDocumentRefresh(editor);
  const submission = await refresh.capture();
  await refresh.apply({
    submission,
    sequence: 1,
    bytes: refreshFixture(2),
    changes: refreshMetadata(2),
  });
  return {
    editor,
    refresh,
    submission,
    container,
    bands: () => [...container.querySelectorAll<HTMLElement>('[data-docx-refresh-highlight]')],
  };
}
function recordAnimations() {
  const calls: {
    frames: Keyframe[];
    options: KeyframeAnimationOptions;
    animation: Animation;
    cancelled: boolean;
  }[] = [];
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value(frames: Keyframe[], options: KeyframeAnimationOptions) {
      const call = { frames, options, animation: null as unknown as Animation, cancelled: false };
      call.animation = {
        onfinish: null,
        cancel() {
          call.cancelled = true;
        },
      } as unknown as Animation;
      calls.push(call);
      return call.animation;
    },
  });
  disposers.push(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original);
    else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  });
  return calls;
}

test('uses borderless padded rounded highlights and fades opacity only', async () => {
  const { refresh, bands } = await open();
  const calls = recordAnimations();
  refresh.highlightChanges();
  expect(bands()).toHaveLength(2);
  for (const band of bands()) {
    expect(band.style.border).toBe('0px');
    expect(band.style.borderRadius).toBe('6px');
    expect(Number.parseFloat(band.style.height)).toBeGreaterThan(8);
    expect(band.style.opacity).toBe('0.14');
    expect(band.getAttribute('aria-hidden')).toBe('true');
    expect(band.style.pointerEvents).toBe('none');
  }
  expect(calls).toHaveLength(2);
  expect(calls[0]!.frames).toEqual([{ opacity: 0 }, { opacity: 0.14 }]);
  expect(calls[0]!.options).toEqual({ duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
});

test('caret changes reuse nodes and zoom does not replay the entrance', async () => {
  const { editor, refresh, bands } = await open();
  const calls = recordAnimations();
  refresh.highlightChanges();
  const original = bands();
  refresh.highlightChanges();
  refresh.navigateToChange('delivery-date', { focus: true });
  expect(bands()[0] === original[0]).toBe(true);
  editor.setZoom(0.75);
  expect(calls).toHaveLength(2);
  expect(bands()[0]!.style.borderRadius).toBe('4.5px');
});

test('custom presentation changes no saved bytes and rejects invalid settings atomically', async () => {
  const { editor, refresh, bands } = await open();
  const bytes = await editor.save();
  const calls = recordAnimations();
  refresh.highlightChanges({
    color: 'rebeccapurple',
    opacity: 0.22,
    padding: 8,
    borderRadius: 12,
    animation: false,
  });
  const band = bands()[0]!;
  expect(band.style.backgroundColor).toBe('rebeccapurple');
  expect(band.style.borderRadius).toBe('12px');
  expect(band.style.opacity).toBe('0.22');
  expect(calls).toHaveLength(0);
  expect(await editor.save()).toEqual(bytes);
  expect(editor.snapshot().canUndo).toBe(false);
  for (const options of [
    { opacity: 2 },
    { padding: -1 },
    { borderRadius: NaN },
    { timeoutMs: -1 },
    { timeoutMs: Infinity },
    { timeoutMs: 2147483648 },
    { animation: { durationMs: Infinity } },
  ])
    expect(() => refresh.highlightChanges(options)).toThrow(RangeError);
  expect(bands()[0] === band).toBe(true);
  expect(band.style.opacity).toBe('0.22');
});

test('disabling animation settles an active entrance immediately', async () => {
  const { refresh, bands } = await open();
  const calls = recordAnimations();
  refresh.highlightChanges({ animation: { durationMs: 250 } });
  expect(calls[0]!.options.duration).toBe(250);
  refresh.highlightChanges({ animation: false });
  expect(calls).toHaveLength(2);
  expect(calls.every((call) => call.cancelled)).toBe(true);
  expect(bands()[0]!.style.opacity).toBe('0.14');
  refresh.clearHighlights();
  expect(bands()).toHaveLength(0);
});

test('explicit clear fades out, and showing again cancels removal without duplicate bands', async () => {
  const { refresh, bands } = await open();
  const calls = recordAnimations();
  refresh.highlightChanges();
  const original = bands()[0];
  refresh.clearHighlights({ animation: { durationMs: 220 } });
  expect(refresh.snapshot().highlightsVisible).toBe(false);
  expect(bands()).toHaveLength(2);
  const exit = calls[2]!;
  expect(exit.options.duration).toBe(220);
  expect(exit.frames[1]).toEqual({ opacity: 0 });
  const staleFinish = exit.animation.onfinish;
  refresh.highlightChanges();
  expect(bands()).toHaveLength(2);
  expect(bands()[0] === original).toBe(true);
  expect(exit.cancelled).toBe(true);
  staleFinish?.call(exit.animation, new Event('finish') as AnimationPlaybackEvent);
  expect(bands()).toHaveLength(2);
  refresh.clearHighlights({ animation: false });
  expect(bands()).toHaveLength(0);
});

test('local edits remove even exiting highlights immediately', async () => {
  const { editor, refresh, bands } = await open();
  const calls = recordAnimations();
  refresh.highlightChanges();
  refresh.clearHighlights();
  expect(bands()).toHaveLength(2);
  editor.surface!.type('Local edit');
  expect(bands()).toHaveLength(0);
  expect(calls.every((call) => call.cancelled)).toBe(true);
});

test('reduced motion shortens fades and a preference change settles active animation', async () => {
  const { editor, refresh, bands } = await open();
  const calls = recordAnimations();
  const original = window.matchMedia;
  const media = new EventTarget() as MediaQueryList;
  let reduced = true;
  Object.defineProperty(media, 'matches', { get: () => reduced });
  window.matchMedia = () => media;
  disposers.push(() => {
    window.matchMedia = original;
  });
  refresh.highlightChanges({ animation: { durationMs: 240 } });
  expect(calls[0]!.options.duration).toBe(125);
  reduced = false;
  refresh.clearHighlights();
  reduced = true;
  media.dispatchEvent(new Event('change'));
  expect(bands()).toHaveLength(0);
  expect(calls.every((call) => call.cancelled)).toBe(true);
  editor.destroy();
});

test('explicit animation settings use their defaults instead of inheriting disabled motion', async () => {
  const { refresh, bands } = await open();
  const calls = recordAnimations();
  refresh.highlightChanges({ animation: false });
  refresh.clearHighlights({ animation: {} });
  expect(calls).toHaveLength(2);
  expect(calls[0]!.options.duration).toBe(180);
  expect(bands()).toHaveLength(2);
  refresh.clearHighlights({ animation: false });
  expect(bands()).toHaveLength(0);
});

test('switching from all changes to recent changes fades only the excluded boxes', async () => {
  const { refresh, submission, bands } = await open();
  const changes = refreshMetadata(2);
  await refresh.apply({
    submission,
    sequence: 2,
    bytes: refreshFixture(2),
    changes: [changes[0]!, { ...changes[1]!, id: 'review-v2' }],
  });
  const calls = recordAnimations();
  refresh.highlightChanges({ includePrevious: true, animation: false });
  const recent = bands()[1];
  refresh.highlightChanges();
  expect(bands()).toHaveLength(2);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.frames).toEqual([{ opacity: 0.14 }, { opacity: 0 }]);
  calls[0]!.animation.onfinish?.call(
    calls[0]!.animation,
    new Event('finish') as AnimationPlaybackEvent
  );
  expect(bands()).toHaveLength(1);
  expect(bands()[0] === recent).toBe(true);
});

test('expiration clears styling and notifies subscribers while retaining change locations', async () => {
  const { refresh, bands } = await open();
  refresh.highlightChanges({ timeoutMs: 0, animation: false });
  expect(refresh.snapshot().highlightsVisible).toBe(true);
  let notifications = 0;
  const unsubscribe = refresh.subscribe(() => {
    notifications++;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(bands()).toHaveLength(0);
  expect(refresh.snapshot().highlightsVisible).toBe(false);
  expect(refresh.snapshot().phase).toBe('complete');
  expect(refresh.snapshot().changes).toHaveLength(2);
  expect(notifications).toBe(1);
  expect(refresh.snapshot().changes.every((change) => change.status === 'available')).toBe(true);
  unsubscribe();
});
