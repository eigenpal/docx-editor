import { paragraphFragmentsOf } from '../layout/semantic-record-queries.ts';
import { paragraphContentBounds } from '../layout/paragraph-content-bounds.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';
import type { LocatedChange } from './document-refresh-changes.ts';
import type { RefreshHost } from './document-refresh-host.ts';
import type {
  ClearRefreshHighlightsOptions,
  RefreshHighlightAnimation,
  RefreshHighlightOptions,
} from './document-refresh-types.ts';

const DEFAULT_COLOR = 'var(--doc-refresh-highlight-color)';
const DEFAULT_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)';

function numberOption(value: number | undefined, fallback: number, name: string, max = Infinity) {
  const number = value ?? fallback;
  if (!Number.isFinite(number) || number < 0 || number > max)
    throw new RangeError(
      max === Infinity
        ? `${name} must be a finite, nonnegative number.`
        : `${name} must be finite and between 0 and ${max}.`
    );
  return number;
}
function durationOf(animation: boolean | RefreshHighlightAnimation | undefined, fallback = 180) {
  if (
    animation !== undefined &&
    typeof animation !== 'boolean' &&
    (typeof animation !== 'object' || animation === null || Array.isArray(animation))
  )
    throw new TypeError('animation must be a boolean or a durationMs settings object.');
  return animation === false
    ? 0
    : numberOption(
        typeof animation === 'object' ? animation.durationMs : undefined,
        animation === true || typeof animation === 'object' ? 180 : fallback,
        'animation.durationMs',
        10000
      );
}

interface Band {
  element: HTMLDivElement;
  paragraphId: string;
  animation?: Animation;
  target: number;
  exiting: boolean;
}

/** Keyed presentation nodes survive selection, zoom, and virtualization without replaying motion. */
export function createRefreshHighlights(
  editor: DocxEditorInstance,
  host: RefreshHost,
  onTimeout: () => void
) {
  let selected: readonly LocatedChange[] = [];
  const bands = new Map<string, Band>();
  let seen = new Set<string>();
  let observer: MutationObserver | null = null;
  let media: MediaQueryList | null = null;
  let color = DEFAULT_COLOR;
  let opacity = 0.14;
  let padding = 4;
  let radius = 6;
  let duration = 180;
  let easing = DEFAULT_EASING;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerVersion = 0;
  const stopTimer = () => {
    timerVersion++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const stop = (band: Band) => {
    if (band.animation) {
      band.animation.onfinish = null;
      band.animation.cancel();
      band.animation = undefined;
    }
  };
  const remove = (key: string, band: Band) => {
    stop(band);
    band.element.remove();
    if (bands.get(key) === band) bands.delete(key);
  };
  const reducedMotion = () => {
    if (!media) {
      media =
        host
          .container()
          ?.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
      media?.addEventListener('change', motionChanged);
    }
    return media?.matches ?? false;
  };
  const releaseMedia = () => {
    media?.removeEventListener('change', motionChanged);
    media = null;
  };
  function motionChanged() {
    if (!media?.matches) return;
    for (const [key, band] of bands) {
      stop(band);
      if (band.exiting) remove(key, band);
    }
    if (!bands.size) releaseMedia();
  }
  const fade = (
    key: string,
    band: Band,
    target: number,
    milliseconds: number,
    entering = false
  ) => {
    if (!entering && band.target === target && !band.exiting) return;
    const view = band.element.ownerDocument.defaultView;
    const current = entering
      ? 0
      : Number.parseFloat(view?.getComputedStyle(band.element).opacity ?? String(band.target));
    stop(band);
    band.target = target;
    band.element.style.opacity = String(target);
    const effectiveDuration = reducedMotion() ? Math.min(milliseconds, 125) : milliseconds;
    if (effectiveDuration === 0 || typeof band.element.animate !== 'function') {
      if (band.exiting) remove(key, band);
      return;
    }
    try {
      const animation = band.element.animate(
        [{ opacity: Number.isFinite(current) ? current : target }, { opacity: target }],
        { duration: effectiveDuration, easing }
      );
      band.animation = animation;
      animation.onfinish = () => {
        if (band.animation !== animation) return;
        band.animation = undefined;
        if (band.exiting) remove(key, band);
        if (!bands.size) releaseMedia();
      };
    } catch {
      // A host's invalid easing token cannot prevent highlighting or cleanup.
      if (band.exiting) remove(key, band);
    }
  };
  const paint = () => {
    observer?.disconnect();
    const surface = host.surface();
    const container = host.container();
    if (!surface || !container || selected.length === 0) return;
    easing =
      container.ownerDocument.defaultView
        ?.getComputedStyle(container)
        .getPropertyValue('--doc-motion-ease-out')
        .trim() || DEFAULT_EASING;
    const ids = new Set(selected.map((entry) => entry.paragraphId));
    const scale = editor.getRenderScale();
    const zoom = editor.snapshot().zoom;
    const keep = new Set<string>();
    const presented = new Set<string>();
    for (const page of surface.layout().pages) {
      const parent = container.querySelector<HTMLElement>(
        `[data-page-index="${page.index}"] > .docx-page-content`
      );
      if (!parent) continue;
      for (const paragraph of paragraphFragmentsOf(page)) {
        if (!ids.has(paragraph.paragraphId)) continue;
        const key = `${page.index}:${paragraph.id}`;
        keep.add(key);
        const box = paragraphContentBounds(paragraph);
        // Exclude paragraph before/after spacing, while retaining the paragraph's full width.
        let top = paragraph.lines.length && !paragraph.clipToBox ? Infinity : box.y;
        let bottom =
          paragraph.lines.length && !paragraph.clipToBox ? -Infinity : box.y + box.height;
        for (const line of paragraph.clipToBox ? [] : paragraph.lines) {
          top = Math.min(top, line.box.y);
          bottom = Math.max(bottom, line.box.y + line.box.height);
        }
        const inset = paragraph.clipToBox ? 0 : padding * zoom;
        const marginX = page.contentBox.x - page.box.x;
        const marginY = page.contentBox.y - page.box.y;
        const left = Math.max(-marginX * scale, box.x * scale - inset);
        const right = Math.min(
          (page.box.width - marginX) * scale,
          (box.x + box.width) * scale + inset
        );
        top = Math.max(-marginY * scale, top * scale - inset);
        bottom = Math.min((page.box.height - marginY) * scale, bottom * scale + inset);
        let band = bands.get(key);
        if (band && band.element.parentElement !== parent) {
          remove(key, band);
          band = undefined;
        }
        const created = !band;
        if (!band) {
          const element = container.ownerDocument.createElement('div');
          element.setAttribute('data-docx-marker', '');
          element.setAttribute('data-docx-refresh-highlight', '');
          element.setAttribute('contenteditable', 'false');
          element.setAttribute('aria-hidden', 'true');
          element.style.cssText = 'position:absolute;pointer-events:none;border:0;outline:0;';
          band = { element, paragraphId: paragraph.paragraphId, target: -1, exiting: false };
          bands.set(key, band);
          parent.append(element);
        }
        const returning = band.exiting;
        band.exiting = false;
        if (returning) band.target = -1;
        Object.assign(band.element.style, {
          backgroundColor: color,
          borderRadius: `${radius * zoom}px`,
          left: `${left}px`,
          top: `${top}px`,
          width: `${Math.max(0, right - left)}px`,
          height: `${Math.max(0, bottom - top)}px`,
        });
        fade(
          key,
          band,
          opacity,
          created && seen.has(paragraph.paragraphId) ? 0 : duration,
          created
        );
        presented.add(paragraph.paragraphId);
      }
    }
    for (const id of presented) seen.add(id);
    for (const [key, band] of bands) {
      if (keep.has(key)) continue;
      if (!band.element.isConnected || ids.has(band.paragraphId) || duration === 0) {
        remove(key, band);
      } else if (!band.exiting) {
        band.exiting = true;
        fade(key, band, 0, duration);
      }
    }
    observer ??= new MutationObserver(paint);
    observer.observe(container, { childList: true, subtree: true });
  };
  const clear = () => {
    stopTimer();
    selected = [];
    seen.clear();
    observer?.disconnect();
    for (const [key, band] of bands) remove(key, band);
    releaseMedia();
  };
  const hide = (options: ClearRefreshHighlightsOptions = {}) => {
    const milliseconds = durationOf(options.animation, duration);
    stopTimer();
    selected = [];
    seen.clear();
    observer?.disconnect();
    for (const [key, band] of bands) {
      if (band.exiting && milliseconds > 0) continue;
      band.exiting = true;
      fade(key, band, 0, milliseconds);
    }
    if (!bands.size) releaseMedia();
  };
  editor.on('selectionChange', () => {
    if (selected.length) paint();
  });
  return {
    show(changes: readonly LocatedChange[], options: RefreshHighlightOptions = {}) {
      // Validate the complete request before changing visible presentation.
      const nextOpacity = numberOption(options.opacity, 0.14, 'opacity', 1);
      const nextPadding = numberOption(options.padding, 4, 'padding');
      const nextRadius = numberOption(options.borderRadius, 6, 'borderRadius');
      const nextDuration = durationOf(options.animation);
      const nextTimeout =
        options.timeoutMs === null
          ? null
          : numberOption(options.timeoutMs, 3000, 'timeoutMs', 2147483647);
      const nextColor = options.color ?? DEFAULT_COLOR;
      const css = host.container()?.ownerDocument.defaultView?.CSS;
      if (
        typeof nextColor !== 'string' ||
        !nextColor.trim() ||
        (css?.supports && !css.supports('color', nextColor))
      )
        throw new TypeError('color must be a CSS color or var() expression.');
      const previous = new Set(selected.map((entry) => entry.paragraphId));
      seen = new Set([...seen].filter((id) => previous.has(id)));
      color = nextColor;
      opacity = nextOpacity;
      padding = nextPadding;
      radius = nextRadius;
      duration = nextDuration;
      selected = changes;
      if (duration === 0) for (const band of bands.values()) stop(band);
      if (!selected.length) {
        clear();
        return;
      }
      paint();
      stopTimer();
      if (nextTimeout !== null) {
        const version = timerVersion;
        timer = setTimeout(() => {
          if (version !== timerVersion) return;
          timer = undefined;
          hide();
          onTimeout();
        }, nextTimeout);
      }
    },
    hide,
    clear,
    repaint: paint,
  };
}
