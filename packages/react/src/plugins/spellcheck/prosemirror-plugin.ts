import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { findWordBoundaries } from '@eigenpal/docx-core/utils/textSelection';
import { isCheckableWord, normalizeWord } from './utils';
import type { SpellcheckWorkerResponse } from './types';

export interface SpellcheckMisspelling {
  from: number;
  to: number;
  word: string;
}

export interface SpellcheckMenuState {
  open: boolean;
  x: number;
  y: number;
  from: number;
  to: number;
  word: string;
  suggestions: string[];
  loading: boolean;
}

export type SpellcheckStatus = 'loading' | 'ready' | 'error';

export interface SpellcheckPluginState {
  misspellings: SpellcheckMisspelling[];
  decorations: DecorationSet;
  menu: SpellcheckMenuState | null;
  status: SpellcheckStatus;
  userDictionary: Set<string>;
  isTyping: boolean;
}

export const spellcheckPluginKey = new PluginKey<SpellcheckPluginState>('spellcheck');

type SpellcheckMeta =
  | {
      type: 'spellcheck:updateWord';
      from: number;
      to: number;
      word: string;
      correct: boolean;
    }
  | { type: 'spellcheck:removeRange'; from: number; to: number }
  | { type: 'spellcheck:menuOpen'; menu: SpellcheckMenuState }
  | { type: 'spellcheck:menuClose' }
  | { type: 'spellcheck:menuUpdate'; suggestions: string[]; loading: boolean }
  | { type: 'spellcheck:addToDictionary'; word: string }
  | { type: 'spellcheck:setStatus'; status: SpellcheckStatus }
  | { type: 'spellcheck:setTyping'; isTyping: boolean };

export interface SpellcheckPluginOptions {
  debounceMs?: number;
  renderOverlay?: boolean;
}

const WORD_BOUNDARY_REGEX = /[\s\p{P}]/u;
const TYPING_IDLE_MS = 200;

function createDecorations(doc: ProseMirrorNode, misspellings: SpellcheckMisspelling[]) {
  const decorations = misspellings.map((m) =>
    Decoration.inline(m.from, m.to, { class: 'docx-spell-error' })
  );
  return DecorationSet.create(doc, decorations);
}

function mapMisspellings(
  misspellings: SpellcheckMisspelling[],
  tr: import('prosemirror-state').Transaction,
  newState: EditorState,
  skipValidation: boolean
): SpellcheckMisspelling[] {
  const mapped = misspellings.map((misspelling) => ({
    ...misspelling,
    from: tr.mapping.map(misspelling.from),
    to: tr.mapping.map(misspelling.to),
  }));

  if (skipValidation) {
    return mapped.filter((misspelling) => misspelling.from < misspelling.to);
  }

  return mapped.filter((misspelling) => {
    if (misspelling.from >= misspelling.to) return false;
    const current = newState.doc.textBetween(misspelling.from, misspelling.to, ' ');
    return normalizeWord(current) === normalizeWord(misspelling.word);
  });
}

function validateMisspellings(
  misspellings: SpellcheckMisspelling[],
  newState: EditorState
): SpellcheckMisspelling[] {
  return misspellings.filter((misspelling) => {
    if (misspelling.from >= misspelling.to) return false;
    const current = newState.doc.textBetween(misspelling.from, misspelling.to, ' ');
    return normalizeWord(current) === normalizeWord(misspelling.word);
  });
}

function getWordRangeAtPos(
  doc: ProseMirrorNode,
  pos: number
): { from: number; to: number; word: string } | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const resolved = doc.resolve(pos);
  const parent = resolved.parent;
  if (!parent.isTextblock) return null;

  const text = parent.textContent;
  if (!text) return null;

  const offset = Math.max(0, Math.min(resolved.parentOffset, text.length - 1));
  const [start, end] = findWordBoundaries(text, offset);
  if (start === end) return null;

  const word = text.slice(start, end);
  return {
    from: resolved.start() + start,
    to: resolved.start() + end,
    word,
  };
}

class SpellcheckController {
  private view: EditorView;
  private worker: Worker | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;
  private pendingChecks = new Map<string, SpellcheckMisspelling>();
  private pendingSuggestions = new Map<string, SpellcheckMenuState>();
  private deferredResults: Array<{ misspelling: SpellcheckMisspelling; correct: boolean }> = [];
  private pendingCheckPos: number | null = null;
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private isTyping = false;
  private debounceMs: number;

  constructor(view: EditorView, options: SpellcheckPluginOptions) {
    this.view = view;
    this.debounceMs = options.debounceMs ?? 200;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event) => this.handleWorkerMessage(event as MessageEvent);
    this.setStatus('ready');
  }

  setView(view: EditorView) {
    this.view = view;
  }

  destroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  notifyTyping() {
    if (!this.isTyping) {
      this.isTyping = true;
      this.setTyping(true);
    }

    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => {
      this.typingTimer = null;
      this.isTyping = false;
      this.setTyping(false);

      const pendingPos = this.pendingCheckPos;
      this.pendingCheckPos = null;
      if (pendingPos !== null) {
        this.checkWordAt(this.view, pendingPos);
      }

      if (this.deferredResults.length > 0) {
        const deduped = new Map<string, { misspelling: SpellcheckMisspelling; correct: boolean }>();
        for (const entry of this.deferredResults) {
          const key = `${entry.misspelling.from}:${entry.misspelling.to}:${entry.misspelling.word}`;
          deduped.set(key, entry);
        }
        this.deferredResults = [];
        for (const entry of deduped.values()) {
          this.updateWord(entry.misspelling, entry.correct);
        }
      }
    }, TYPING_IDLE_MS);
  }

  scheduleCheckAt(view: EditorView, pos: number) {
    if (this.isTyping) {
      this.pendingCheckPos = pos;
      return;
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.checkWordAt(view, pos);
    }, this.debounceMs);
  }

  requestSuggestions(menu: SpellcheckMenuState) {
    if (!this.worker) return;
    const id = `s_${++this.requestSeq}`;
    this.pendingSuggestions.set(id, menu);
    this.worker.postMessage({ type: 'suggest', id, word: menu.word });
  }

  private checkWordAt(view: EditorView, pos: number) {
    if (!this.worker) return;
    const range = getWordRangeAtPos(view.state.doc, pos);
    if (!range) return;

    const normalized = normalizeWord(range.word);
    if (!isCheckableWord(normalized)) return;

    const pluginState = spellcheckPluginKey.getState(view.state);
    if (pluginState?.userDictionary.has(normalized)) {
      this.updateWord(range, true);
      return;
    }

    const id = `c_${++this.requestSeq}`;
    this.pendingChecks.set(id, { from: range.from, to: range.to, word: normalized });
    this.worker.postMessage({ type: 'check', id, word: normalized });
  }

  private handleWorkerMessage(event: MessageEvent<SpellcheckWorkerResponse>) {
    const msg = event.data;
    if (msg.type === 'checkResult') {
      const pending = this.pendingChecks.get(msg.id);
      if (!pending) return;
      this.pendingChecks.delete(msg.id);
      if (this.isTyping) {
        this.deferredResults.push({ misspelling: pending, correct: msg.correct });
      } else {
        this.updateWord(pending, msg.correct);
      }
      return;
    }

    if (msg.type === 'suggestResult') {
      const pending = this.pendingSuggestions.get(msg.id);
      if (!pending) return;
      this.pendingSuggestions.delete(msg.id);
      this.updateMenuSuggestions(msg.suggestions);
      return;
    }

    if (msg.type === 'error') {
      this.setStatus('error');
    }
  }

  private updateWord(misspelling: SpellcheckMisspelling, correct: boolean) {
    const tr = this.view.state.tr.setMeta(spellcheckPluginKey, {
      type: 'spellcheck:updateWord',
      from: misspelling.from,
      to: misspelling.to,
      word: misspelling.word,
      correct,
    } satisfies SpellcheckMeta);
    this.view.dispatch(tr);
  }

  private updateMenuSuggestions(suggestions: string[]) {
    const tr = this.view.state.tr.setMeta(spellcheckPluginKey, {
      type: 'spellcheck:menuUpdate',
      suggestions,
      loading: false,
    } satisfies SpellcheckMeta);
    this.view.dispatch(tr);
  }

  private setStatus(status: SpellcheckStatus) {
    const tr = this.view.state.tr.setMeta(spellcheckPluginKey, {
      type: 'spellcheck:setStatus',
      status,
    } satisfies SpellcheckMeta);
    this.view.dispatch(tr);
  }

  private setTyping(isTyping: boolean) {
    const tr = this.view.state.tr.setMeta(spellcheckPluginKey, {
      type: 'spellcheck:setTyping',
      isTyping,
    } satisfies SpellcheckMeta);
    this.view.dispatch(tr);
  }
}

export function createSpellcheckProseMirrorPlugin(
  options: SpellcheckPluginOptions = {}
): Plugin<SpellcheckPluginState> {
  let controller: SpellcheckController | null = null;
  let lastMenuRequestKey: string | null = null;

  return new Plugin<SpellcheckPluginState>({
    key: spellcheckPluginKey,

    state: {
      init(_, _state) {
        return {
          misspellings: [],
          decorations: DecorationSet.empty,
          menu: null,
          status: 'loading',
          userDictionary: new Set<string>(),
          isTyping: false,
        } satisfies SpellcheckPluginState;
      },

      apply(tr, value, _oldState, newState) {
        let misspellings = value.misspellings;
        let menu = value.menu;
        let status = value.status;
        let userDictionary = value.userDictionary;
        let isTyping = value.isTyping;

        const meta = tr.getMeta(spellcheckPluginKey) as SpellcheckMeta | undefined;
        if (meta) {
          if (meta.type === 'spellcheck:updateWord') {
            misspellings = misspellings.filter((m) => !(m.from === meta.from && m.to === meta.to));
            if (!meta.correct) {
              misspellings = [...misspellings, { from: meta.from, to: meta.to, word: meta.word }];
            }
          }

          if (meta.type === 'spellcheck:removeRange') {
            misspellings = misspellings.filter((m) => !(m.from === meta.from && m.to === meta.to));
          }

          if (meta.type === 'spellcheck:menuOpen') {
            menu = meta.menu;
          }

          if (meta.type === 'spellcheck:menuClose') {
            menu = null;
          }

          if (meta.type === 'spellcheck:menuUpdate' && menu) {
            menu = {
              ...menu,
              suggestions: meta.suggestions,
              loading: meta.loading,
            };
          }

          if (meta.type === 'spellcheck:addToDictionary') {
            const next = new Set(userDictionary);
            next.add(meta.word);
            userDictionary = next;
            misspellings = misspellings.filter((m) => normalizeWord(m.word) !== meta.word);
          }

          if (meta.type === 'spellcheck:setStatus') {
            status = meta.status;
          }

          if (meta.type === 'spellcheck:setTyping') {
            isTyping = meta.isTyping;
          }
        }

        if (tr.docChanged) {
          misspellings = mapMisspellings(misspellings, tr, newState, isTyping);
          menu = null;
        }

        if (meta?.type === 'spellcheck:setTyping' && !isTyping) {
          misspellings = validateMisspellings(misspellings, newState);
        }

        return {
          misspellings,
          decorations: isTyping
            ? DecorationSet.empty
            : createDecorations(newState.doc, misspellings),
          menu,
          status,
          userDictionary,
          isTyping,
        };
      },
    },

    props: {
      decorations(state) {
        return spellcheckPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },

      handleTextInput(view, from, _to, text) {
        if (!controller) return false;
        controller.notifyTyping();
        if (WORD_BOUNDARY_REGEX.test(text)) {
          controller.scheduleCheckAt(view, Math.max(0, from - 1));
        }
        return false;
      },

      handleKeyDown(view, event) {
        if (!controller) return false;
        if (
          event.key.length === 1 ||
          event.key === 'Backspace' ||
          event.key === 'Delete' ||
          event.key === 'Enter' ||
          event.key === 'Tab'
        ) {
          controller.notifyTyping();
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          controller.scheduleCheckAt(view, Math.max(0, view.state.selection.from - 1));
        }
        return false;
      },

      handleDOMEvents: {
        contextmenu(view, event) {
          if (!controller) return false;
          if (event.defaultPrevented) return false;
          const coords = { left: event.clientX, top: event.clientY };
          const pos = view.posAtCoords(coords)?.pos;
          if (!pos) return false;

          const pluginState = spellcheckPluginKey.getState(view.state);
          const misspelling = pluginState?.misspellings.find((m) => pos >= m.from && pos <= m.to);

          if (!misspelling) return false;

          event.preventDefault();
          const menu: SpellcheckMenuState = {
            open: true,
            x: event.clientX,
            y: event.clientY,
            from: misspelling.from,
            to: misspelling.to,
            word: misspelling.word,
            suggestions: [],
            loading: true,
          };

          view.dispatch(
            view.state.tr.setMeta(spellcheckPluginKey, {
              type: 'spellcheck:menuOpen',
              menu,
            } satisfies SpellcheckMeta)
          );

          controller.requestSuggestions(menu);
          return true;
        },
      },
    },

    view(view) {
      controller = new SpellcheckController(view, options);
      return {
        update(newView) {
          controller = controller ?? new SpellcheckController(newView, options);
          controller.setView(newView);

          const pluginState = spellcheckPluginKey.getState(newView.state);
          if (pluginState?.menu?.open && pluginState.menu.loading) {
            const key = `${pluginState.menu.word}:${pluginState.menu.from}:${pluginState.menu.to}`;
            if (key !== lastMenuRequestKey) {
              lastMenuRequestKey = key;
              controller.requestSuggestions(pluginState.menu);
            }
          } else {
            lastMenuRequestKey = null;
          }
        },
        destroy() {
          controller?.destroy();
          controller = null;
          lastMenuRequestKey = null;
        },
      };
    },
  });
}

export function closeSpellcheckMenu(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(spellcheckPluginKey, { type: 'spellcheck:menuClose' }));
}

export function addWordToDictionary(view: EditorView, word: string): void {
  view.dispatch(
    view.state.tr.setMeta(spellcheckPluginKey, {
      type: 'spellcheck:addToDictionary',
      word: normalizeWord(word),
    } satisfies SpellcheckMeta)
  );
}

export function ignoreMisspelling(view: EditorView, from: number, to: number): void {
  view.dispatch(
    view.state.tr.setMeta(spellcheckPluginKey, {
      type: 'spellcheck:removeRange',
      from,
      to,
    } satisfies SpellcheckMeta)
  );
}
