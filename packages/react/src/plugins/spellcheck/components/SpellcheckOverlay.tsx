import React, { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { RenderedDomContext } from '../../../plugin-api/types';
import type { SpellcheckMisspelling } from '../prosemirror-plugin';

export interface SpellcheckOverlayProps {
  context: RenderedDomContext;
  editorView: EditorView | null;
  misspellings: SpellcheckMisspelling[];
}

type Rect = { x: number; y: number; width: number; height: number };

interface CachedMisspelling {
  misspelling: SpellcheckMisspelling;
  rects: Rect[];
}

interface UnderlineLine {
  key: string;
  rect: Rect;
  offset: { x: number; y: number };
}

const WAVE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='8' height='4' viewBox='0 0 8 4'><path d='M0 3 Q2 1 4 3 T8 3' fill='none' stroke='#ef4444' stroke-width='1.2'/></svg>";
const WAVE_URL = `url(\"data:image/svg+xml,${encodeURIComponent(WAVE_SVG)}\")`;
const TYPING_IDLE_MS = 200;

export const SpellcheckOverlay: React.FC<SpellcheckOverlayProps> = ({
  context,
  editorView,
  misspellings,
}) => {
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [lines, setLines] = useState<UnderlineLine[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const cacheRef = useRef<Map<string, CachedMisspelling>>(new Map());
  const rafRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const pendingRecomputeRef = useRef(false);
  const lastLayoutVersionRef = useRef(0);
  const typingRef = useRef(false);

  const buildKey = useCallback(
    (misspelling: SpellcheckMisspelling) =>
      `${misspelling.from}:${misspelling.to}:${misspelling.word}`,
    []
  );

  const scheduleRecompute = useCallback(
    (force: boolean) => {
      if (typingRef.current) {
        pendingRecomputeRef.current = true;
        return;
      }

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;

        if (misspellings.length === 0) {
          cacheRef.current = new Map();
          setLines([]);
          return;
        }

        const nextCache = new Map<string, CachedMisspelling>();
        const nextLines: UnderlineLine[] = [];
        const containerOffset = context.getContainerOffset();

        for (const misspelling of misspellings) {
          const key = buildKey(misspelling);
          let entry = force ? undefined : cacheRef.current.get(key);

          if (!entry) {
            entry = {
              misspelling,
              rects: context.getRectsForRange(misspelling.from, misspelling.to),
            };
          }

          nextCache.set(key, entry);

          entry.rects.forEach((rect, rectIndex) => {
            nextLines.push({
              key: `${key}-${rectIndex}`,
              rect,
              offset: containerOffset,
            });
          });
        }

        cacheRef.current = nextCache;
        setLines(nextLines);
      });
    },
    [buildKey, context, misspellings]
  );

  const enterTyping = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (!typingRef.current) {
      typingRef.current = true;
      setIsTyping(true);
      setLines([]);
    }

    pendingRecomputeRef.current = true;

    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }

    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      typingRef.current = false;
      setIsTyping(false);

      if (pendingRecomputeRef.current) {
        pendingRecomputeRef.current = false;
        scheduleRecompute(true);
      }
    }, TYPING_IDLE_MS);
  }, [scheduleRecompute]);

  useEffect(() => {
    if (!editorView?.dom) return;
    const target = editorView.dom;

    const handleBeforeInput = (event: Event) => {
      const inputEvent = event as InputEvent;
      if (!inputEvent.inputType) return;
      if (inputEvent.inputType.startsWith('insert') || inputEvent.inputType.startsWith('delete')) {
        enterTyping();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.length === 1) {
        enterTyping();
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        enterTyping();
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        enterTyping();
      }
    };

    const handleCompositionStart = () => enterTyping();
    const handleCompositionEnd = () => enterTyping();

    target.addEventListener('beforeinput', handleBeforeInput);
    target.addEventListener('keydown', handleKeyDown);
    target.addEventListener('compositionstart', handleCompositionStart);
    target.addEventListener('compositionend', handleCompositionEnd);

    return () => {
      target.removeEventListener('beforeinput', handleBeforeInput);
      target.removeEventListener('keydown', handleKeyDown);
      target.removeEventListener('compositionstart', handleCompositionStart);
      target.removeEventListener('compositionend', handleCompositionEnd);
    };
  }, [editorView, enterTyping]);

  useEffect(() => {
    const force = layoutVersion !== lastLayoutVersionRef.current;
    lastLayoutVersionRef.current = layoutVersion;
    scheduleRecompute(force);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [layoutVersion, misspellings, scheduleRecompute]);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => setLayoutVersion((v) => v + 1));
    });
    observer.observe(context.pagesContainer);
    return () => observer.disconnect();
  }, [context.pagesContainer]);

  useEffect(() => {
    const handleResize = () => {
      requestAnimationFrame(() => setLayoutVersion((v) => v + 1));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => setLayoutVersion((v) => v + 1));
  }, [context.zoom]);

  useEffect(() => {
    return () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, []);

  return (
    <>
      {!isTyping && lines.length > 0 && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {lines.map(({ key, rect, offset }) => {
            const lineHeight = 4;
            return (
              <div
                key={key}
                className="docx-spellcheck-underline"
                style={{
                  position: 'absolute',
                  left: rect.x + offset.x,
                  top: rect.y + offset.y + rect.height - lineHeight + 1,
                  width: rect.width,
                  height: lineHeight,
                  backgroundImage: WAVE_URL,
                  backgroundRepeat: 'repeat-x',
                  backgroundSize: '8px 4px',
                  pointerEvents: 'none',
                }}
              />
            );
          })}
        </div>
      )}
    </>
  );
};

export default SpellcheckOverlay;
