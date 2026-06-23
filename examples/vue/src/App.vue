<template>
  <div class="preview-banner" role="status">
    <span>This is a <strong>preview deployment</strong>. The released editor lives at</span>
    <a href="https://docx-editor.dev" target="_blank" rel="noopener">docx-editor.dev ↗</a>
  </div>
  <div class="app">
    <main class="main">
      <DocxEditor
        ref="editorRef"
        :document-buffer="documentBuffer"
        :document="currentDocument"
        :show-toolbar="true"
        :show-help-menu="showHelpMenu"
        :document-name="fileName"
        :fonts="customFonts"
        :watermark-presets="['SAMPLE', 'DEMO ONLY', 'PREVIEW', 'NOT FOR DISTRIBUTION']"
        :i18n="editorLocale"
        :color-mode="colorMode"
        @change="handleDocumentChange"
        @error="handleError"
        @ready="handleReady"
        @rename="(n: string) => (fileName = n)"
      >
        <template #title-bar-left>
          <div class="title-bar-left-group">
            <BrandLogo />
            <span class="switcher" role="tablist" aria-label="Adapter">
              <a :href="reactHref" role="tab" :aria-selected="false" class="pill">React</a>
              <a :href="vueHref" role="tab" :aria-selected="true" class="pill active">Vue</a>
            </span>
            <ExampleSwitcher current="Vue" />
          </div>
        </template>
        <template #title-bar-right>
          <div
            class="theme-toggle"
            role="radiogroup"
            aria-label="Color theme"
            @mousedown.stop
          >
            <button
              type="button"
              role="radio"
              class="theme-toggle__opt"
              :class="{ 'is-selected': colorMode === 'light' }"
              :aria-checked="colorMode === 'light'"
              title="Light mode"
              @click="colorMode = 'light'"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            </button>
            <button
              type="button"
              role="radio"
              class="theme-toggle__opt"
              :class="{ 'is-selected': colorMode === 'dark' }"
              :aria-checked="colorMode === 'dark'"
              title="Dark mode"
              @click="colorMode = 'dark'"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
            </button>
          </div>
          <label class="btn btn-primary">
            <input
              type="file"
              accept=".docx"
              @change="handleFileSelect"
              class="file-input"
            />
            Open
          </label>
          <button class="btn" @click="handleNew">New</button>
          <button class="btn" @click="handleSave">Save</button>
          <span v-if="status" class="status">{{ status }}</span>
        </template>
      </DocxEditor>
      <AgentPanel
        v-if="showAgentPanel"
        :closed="agentClosed"
        @close="agentClosed = true"
      >
        <div data-testid="agent-panel-content" class="agent-panel-body">
          <AgentChatLog
            :messages="messages"
            :loading="loading"
            :humanize-tool-name="getToolDisplayName"
            :auto-scroll="true"
          />
          <AgentComposer
            v-model="input"
            :disabled="loading"
            @submit="sendMessage"
          />
        </div>
      </AgentPanel>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onBeforeUnmount, onMounted } from 'vue';
import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-editor-vue';
import { de as deLocale } from '@eigenpal/docx-editor-i18n';
import ExampleSwitcher from '../../shared/ExampleSwitcher.vue';
import BrandLogo from '../../shared/BrandLogo.vue';
import { createEmptyDocument, findStartPosForParaId } from '@eigenpal/docx-editor-core';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import { setSuggestionMode } from '@eigenpal/docx-editor-core/prosemirror/plugins';
import {
  acceptChangeById,
  rejectChangeById,
  acceptAllChanges,
  rejectAllChanges,
  addRowBelow,
  deleteRow,
} from '@eigenpal/docx-editor-core/prosemirror/commands';
import type { Node as PMNode } from 'prosemirror-model';

const randomAuthorVue = `Docx Editor User ${Math.floor(Math.random() * 900) + 100}`;
import {
  AgentPanel,
  AgentChatLog,
  AgentComposer,
  type AgentMessage,
} from '@eigenpal/docx-editor-agents/vue';
import { getToolDisplayName } from '@eigenpal/docx-editor-agents/vue';

function extractDocumentText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const maybeText = (value as { text?: unknown }).text;
  if (typeof maybeText === 'string') return maybeText;
  return Object.values(value)
    .map((child) =>
      Array.isArray(child)
        ? child.map((item) => extractDocumentText(item)).join('')
        : extractDocumentText(child)
    )
    .join('');
}

// Adapter switcher: parity preview (`build:parity`) serves both demos
// from the same origin under `/react/` + `/vue/`. In dev each adapter
// has its own port (5173 React, 5174 Vue) and `import.meta.env.DEV`
// is true, so we hop ports for the React link.
const reactHref = import.meta.env.DEV ? 'http://localhost:5173/' : '/react/';
const vueHref = import.meta.env.DEV ? 'http://localhost:5174/' : '/vue/';

const editorRef = ref<DocxEditorRef | null>(null);
const documentBuffer = ref<ArrayBuffer | null>(null);
const currentDocument = ref<Document | null>(null);
const fileName = ref('sample.docx');
const status = ref('');
const colorMode = ref<'light' | 'dark'>('light');

// E2E hook: ?customFonts=1 wires a custom-font registration against the
// bundled fixture so the Vue Playwright suite can verify the `fonts` prop.
const customFonts = computed(() => {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  if (params.get('customFonts') !== '1') return undefined;
  return [
    { family: 'E2E Custom Font', src: '/e2e-fixtures/inter-regular.woff2' },
    { family: 'E2E Custom Font', src: '/e2e-fixtures/inter-bold.woff2', weight: 700 },
  ];
});

// E2E hook: `?locale=de` mounts the editor with the German i18n pack so
// the Playwright suite can assert localized tooltips / context-menu text.
const editorLocale = computed(() => {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  return params.get('locale') === 'de' ? deLocale : undefined;
});

// Agent panel — opt-in via `?agentPanel=1` like the React demo. Keeps the
// live preview clean and gives Playwright parity tests a stable toggle.
// `?agentTimeline=…` also opens the panel since the timeline only renders
// inside it.
const showAgentPanel = computed(() => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('agentPanel') === '1' || params.has('agentTimeline')) return true;
  return import.meta.env.VITE_DOCX_EDITOR_AGENT_PANEL === '1';
});

// E2E hook: `?hideHelpMenu=1` hides the Help menu (parity with the React prop).
const showHelpMenu = computed(() => {
  if (typeof window === 'undefined') return true;
  return new URLSearchParams(window.location.search).get('hideHelpMenu') !== '1';
});

// AgentTimeline fixture for E2E parity. Mirrors examples/vite App.tsx so a
// single Playwright spec can drive both adapters with the same query string.
const timelineFixture = computed<AgentMessage[] | null>(() => {
  if (typeof window === 'undefined') return null;
  const mode = new URLSearchParams(window.location.search).get('agentTimeline');
  if (!mode) return null;
  const isStreaming = mode === 'streaming';
  if (mode === 'long') {
    const calls: NonNullable<AgentMessage['toolCalls']> = [
      { id: 't1', name: 'read_document', status: 'done', result: '...' },
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `t${i + 2}`,
        name: 'add_comment',
        status: 'done' as const,
        result: `Comment ${i + 1} added.`,
      })),
    ];
    return [
      { id: 'u1', role: 'user', text: 'Roast everything.' },
      {
        id: 'a1',
        role: 'assistant',
        text: 'Done — 7 comments.',
        status: 'done',
        toolCalls: calls,
      },
    ];
  }
  return [
    { id: 'u1', role: 'user', text: 'Roast my doc.' },
    {
      id: 'a1',
      role: 'assistant',
      text: isStreaming ? '' : 'Done — left 3 comments.',
      status: isStreaming ? 'streaming' : 'done',
      toolCalls: [
        { id: 't1', name: 'read_document', status: 'done', result: '...' },
        { id: 't2', name: 'add_comment', status: 'done', result: 'Comment 1 added.' },
        {
          id: 't3',
          name: 'add_comment',
          status: isStreaming ? 'running' : 'done',
          result: isStreaming ? undefined : 'Comment 2 added.',
        },
      ],
    },
  ];
});

const baseMessages = ref<AgentMessage[]>([]);
const messages = computed<AgentMessage[]>(() => timelineFixture.value ?? baseMessages.value);
const input = ref('');
const loading = ref(false);
const agentClosed = ref(false);

function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  baseMessages.value.push({ id: `u-${Date.now()}`, role: 'user', text });
  input.value = '';
  // Stub assistant reply — the demo doesn't call a real model. Replace
  // this with `useAgentBridge` + your transport in your own app.
  loading.value = true;
  setTimeout(() => {
    baseMessages.value.push({
      id: `a-${Date.now()}`,
      role: 'assistant',
      text: 'BYO chat goes here. Wire `useAgentBridge` + your transport to make this real.',
      status: 'done',
    });
    loading.value = false;
  }, 600);
}

onMounted(async () => {
  const params = new URLSearchParams(window.location.search);
  const isE2E =
    params.get('e2e') === '1' ||
    import.meta.env.MODE === 'test' ||
    import.meta.env.VITE_DOCX_EDITOR_E2E === '1';
  if (isE2E) {
    window.__DOCX_EDITOR_E2E__ = {
      // Raw body EditorView — lets specs build precise PM states (e.g. a line
      // with mixed font sizes) without driving the toolbar UI.
      getView: () => (editorRef.value?.getEditorRef() as any)?.getView?.() ?? null,
      getPmStartForParaId: (paraId: string) => {
        const state = (editorRef.value?.getEditorRef() as any)?.getState?.();
        if (!state || !paraId) return null;
        return findStartPosForParaId(state.doc, paraId);
      },
      getSelectionAnchor: () => {
        const state = (editorRef.value?.getEditorRef() as any)?.getState?.();
        return state?.selection.anchor ?? null;
      },
      getTextblockEndForParaId: (paraId: string) => {
        const state = (editorRef.value?.getEditorRef() as any)?.getState?.();
        if (!state || !paraId) return null;
        const start = findStartPosForParaId(state.doc, paraId);
        if (start == null) return null;
        const node = state.doc.nodeAt(start);
        return node?.isTextblock === true ? start + 1 + node.content.size : null;
      },
      getFirstTextblockParaId: () => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return null;
        let found: string | null = null;
        view.state.doc.descendants((node: any) => {
          if (node.isTextblock && node.attrs?.paraId) {
            found = String(node.attrs.paraId);
            return false;
          }
          return true;
        });
        return found;
      },
      getLastTextblockParaId: () => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return null;
        let found: string | null = null;
        view.state.doc.descendants((node: any) => {
          if (node.isTextblock && node.attrs?.paraId) found = String(node.attrs.paraId);
          return true;
        });
        return found;
      },
      scrollToParaId: (paraId: string) => editorRef.value?.scrollToParaId(paraId) ?? false,
      scrollToPosition: (pmPos: number) => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return;
        view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(view.state.doc.resolve(pmPos))));
      },
      getDocSize: () => {
        const state = (editorRef.value?.getEditorRef() as any)?.getState?.();
        return state?.doc.content.size ?? null;
      },
      highlightRange: (from: number, to: number) => {
        editorRef.value?.highlightRange(from, to);
      },
      scrollToCommentId: (commentId: number) =>
        editorRef.value?.scrollToCommentId(commentId) ?? false,
      scrollToChangeId: (revisionId: number) =>
        editorRef.value?.scrollToChangeId(revisionId) ?? false,
      scrollToPage: (pageNumber: number) => {
        document
          .querySelector<HTMLElement>(`.paged-editor__page[data-page-number="${pageNumber}"]`)
          ?.scrollIntoView({ block: 'start' });
      },
      getTotalPages: () => editorRef.value?.getTotalPages() ?? 0,
      getCurrentPage: () => editorRef.value?.getCurrentPage() ?? 0,
      // Collect every paragraph paraId from the host-facing Document model
      // (getDocument()), regardless of nesting — used to assert getDocument()
      // stays in sync with PM paraIds (#746).
      getDocumentParaIds: () => {
        const ids: (string | null)[] = [];
        JSON.stringify(editorRef.value?.getDocument() ?? null, (k, v) => {
          if (k === 'paraId') ids.push(v as string | null);
          return v;
        });
        return ids;
      },
      saveByteLength: async () => {
        const buffer = await editorRef.value?.save();
        return buffer?.byteLength ?? null;
      },
      agentAddComment: (opts) =>
        editorRef.value?.addComment({
          paraId: opts.paraId,
          text: opts.text,
          author: opts.author ?? 'E2E',
          search: opts.search,
        }) ?? null,
      agentProposeChange: (opts) =>
        editorRef.value?.proposeChange({
          paraId: opts.paraId,
          search: opts.search,
          replaceWith: opts.replaceWith,
          author: opts.author ?? 'E2E',
        }) ?? false,
      agentReplyComment: (commentId: number, text: string, author = 'E2E') =>
        editorRef.value?.replyToComment(commentId, text, author) ?? null,
      agentResolveComment: (commentId: number) => editorRef.value?.resolveComment(commentId),
      agentFind: (query: string) => editorRef.value?.findInDocument(query) ?? [],
      agentSelection: () => editorRef.value?.getSelectionInfo() ?? null,
      agentGetCommentCount: () => editorRef.value?.getComments().length ?? 0,
      agentOnContentChangeCount: 0,
      agentOnSelectionChangeCount: 0,
      agentSubscribeContentChange: () => {
        const hook = window.__DOCX_EDITOR_E2E__;
        if (!hook) return () => undefined;
        return (
          editorRef.value?.onContentChange(() => {
            hook.agentOnContentChangeCount = (hook.agentOnContentChangeCount ?? 0) + 1;
          }) ?? (() => undefined)
        );
      },
      agentSubscribeSelectionChange: () => {
        const hook = window.__DOCX_EDITOR_E2E__;
        if (!hook) return () => undefined;
        return (
          editorRef.value?.onSelectionChange(() => {
            hook.agentOnSelectionChangeCount = (hook.agentOnSelectionChangeCount ?? 0) + 1;
          }) ?? (() => undefined)
        );
      },
      agentApplyFormatting: (opts) => editorRef.value?.applyFormatting(opts) ?? false,
      agentSetParagraphStyle: (opts) => editorRef.value?.setParagraphStyle(opts) ?? false,
      agentGetPageContent: (pageNumber: number) => editorRef.value?.getPageContent(pageNumber) ?? null,
      agentGetDocumentText: () => extractDocumentText(editorRef.value?.getDocument()),
      // Tracked structural revisions (#614) — mirror of the React demo hooks
      // so the same Playwright spec can run against this adapter.
      setSuggestionMode: (active: boolean, authorOverride?: string) => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return false;
        setSuggestionMode(active, view.state, view.dispatch, authorOverride ?? randomAuthorVue);
        return true;
      },
      getParagraphRevisionAt: (index: number) => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return null;
        let count = 0;
        let out: { pPrIns: unknown; pPrDel: unknown } | null = null;
        view.state.doc.descendants((node: PMNode) => {
          if (out != null) return false;
          if (node.type.name !== 'paragraph') return true;
          if (count === index) {
            out = {
              pPrIns: (node.attrs as Record<string, unknown>).pPrIns ?? null,
              pPrDel: (node.attrs as Record<string, unknown>).pPrDel ?? null,
            };
            return false;
          }
          count += 1;
          return true;
        });
        return out;
      },
      acceptChangeById: (revisionId: number) => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return false;
        return acceptChangeById(revisionId)(view.state, view.dispatch);
      },
      rejectChangeById: (revisionId: number) => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return false;
        return rejectChangeById(revisionId)(view.state, view.dispatch);
      },
      acceptAllChanges: () => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return false;
        return acceptAllChanges()(view.state, view.dispatch);
      },
      rejectAllChanges: () => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return false;
        return rejectAllChanges()(view.state, view.dispatch);
      },
      getParagraphAttrs: (index: number) => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return null;
        let count = 0;
        let out: Record<string, unknown> | null = null;
        view.state.doc.descendants((node: PMNode) => {
          if (out != null) return false;
          if (node.type.name !== 'paragraph') return true;
          if (count === index) {
            out = { ...node.attrs };
            return false;
          }
          count += 1;
          return true;
        });
        return out;
      },
      plantParagraphPropertyChange: (revisionId: number, prior: unknown) => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return false;
        let firstParaPos: number | null = null;
        let firstPara: PMNode | null = null;
        view.state.doc.descendants((node: PMNode, pos: number) => {
          if (firstParaPos != null) return false;
          if (node.type.name === 'paragraph') {
            firstParaPos = pos;
            firstPara = node;
            return false;
          }
          return true;
        });
        if (firstParaPos == null || firstPara == null) return false;
        view.dispatch(
          view.state.tr.setNodeMarkup(firstParaPos, undefined, {
            ...(firstPara as PMNode).attrs,
            pPrChange: [
              {
                type: 'paragraphPropertyChange',
                info: { id: revisionId, author: 'Jane', date: new Date().toISOString() },
                previousFormatting: prior,
              },
            ],
          })
        );
        return true;
      },
      plantSimpleTable: () => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return false;
        const { schema } = view.state;
        const cellPara = schema.node('paragraph', {}, [schema.text('A')]);
        const cell = schema.node('tableCell', { colspan: 1, rowspan: 1 }, [cellPara]);
        const row = schema.node('tableRow', {}, [cell]);
        const table = schema.node('table', {}, [row]);
        view.dispatch(view.state.tr.replaceSelectionWith(table));
        return true;
      },
      countTableRows: () => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return 0;
        let count = 0;
        let inFirstTable = false;
        view.state.doc.descendants((node: PMNode) => {
          if (node.type.name === 'table') {
            if (inFirstTable) return false;
            inFirstTable = true;
            return true;
          }
          if (inFirstTable && node.type.name === 'tableRow') count += 1;
          return false;
        });
        return count;
      },
      focusFirstTableCell: () => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return false;
        let target: number | null = null;
        view.state.doc.descendants((node: PMNode, pos: number) => {
          if (target != null) return false;
          if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
            target = pos + 2;
            return false;
          }
          return true;
        });
        if (target == null) return false;
        // Use the constructor on the live selection to avoid a direct
        // `prosemirror-state` dependency in the demo's package.json.
        const SelectionCtor = (view.state.selection as any).constructor;
        const tr = view.state.tr.setSelection(SelectionCtor.near(view.state.doc.resolve(target)));
        view.dispatch(tr);
        view.focus();
        return true;
      },
      plantTableRowInsertion: (revisionId: number) => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return false;
        let rowPos: number | null = null;
        let rowNode: PMNode | null = null;
        view.state.doc.descendants((node: PMNode, pos: number) => {
          if (rowPos != null) return false;
          if (node.type.name === 'tableRow') {
            rowPos = pos;
            rowNode = node;
            return false;
          }
          return true;
        });
        if (rowPos == null || rowNode == null) return false;
        view.dispatch(
          view.state.tr.setNodeMarkup(rowPos, undefined, {
            ...(rowNode as PMNode).attrs,
            trIns: { revisionId, author: 'Jane', date: new Date().toISOString() },
          })
        );
        return true;
      },
      getFirstTableRowAttrs: () => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return null;
        let out: Record<string, unknown> | null = null;
        view.state.doc.descendants((node: PMNode) => {
          if (out != null) return false;
          if (node.type.name === 'tableRow') {
            out = { ...node.attrs };
            return false;
          }
          return true;
        });
        return out;
      },
      addRowBelow: () => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return false;
        return addRowBelow(view.state, view.dispatch);
      },
      deleteCurrentRow: () => {
        const view = (editorRef.value?.getEditorRef() as any)?.getView?.();
        if (!view) return false;
        return deleteRow(view.state, view.dispatch);
      },
    };
  }

  // Under E2E with ?empty=1, boot empty so tests get a deterministic,
  // known starting document instead of racing the async fixture fetch.
  // Mirrors the React demo's behavior in examples/vite/src/App.tsx.
  if (isE2E && params.get('empty') === '1') {
    currentDocument.value = createEmptyDocument();
    fileName.value = 'Untitled.docx';
    return;
  }

  try {
    const res = await fetch(`${import.meta.env.BASE_URL}sample.docx`);
    const buffer = await res.arrayBuffer();
    documentBuffer.value = buffer;
    fileName.value = 'sample.docx';
  } catch {
    currentDocument.value = createEmptyDocument();
    fileName.value = 'Untitled.docx';
  }
});

onBeforeUnmount(() => {
  delete window.__DOCX_EDITOR_E2E__;
});

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  status.value = 'Loading...';
  file
    .arrayBuffer()
    .then((buffer) => {
      currentDocument.value = null;
      documentBuffer.value = buffer;
      fileName.value = file.name;
      status.value = '';
    })
    .catch(() => {
      status.value = 'Error loading file';
    });
}

function handleNew() {
  documentBuffer.value = null;
  currentDocument.value = createEmptyDocument();
  fileName.value = 'Untitled.docx';
  status.value = '';
}

async function handleSave() {
  if (!editorRef.value) return;

  try {
    status.value = 'Saving...';
    const buffer = await editorRef.value.save();
    if (buffer) {
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.value || 'document.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      status.value = 'Saved!';
      setTimeout(() => {
        status.value = '';
      }, 2000);
    }
  } catch {
    status.value = 'Save failed';
  }
}

function handleDocumentChange(_doc: Document) {
  // no-op — could track dirty state here
}

function handleError(error: Error) {
  console.error('Editor error:', error);
  status.value = `Error: ${error.message}`;
}

function handleReady() {
  console.log('Editor ready');
}
</script>

<style>
.preview-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 16px;
  background: #fef3c7;
  color: #92400e;
  border-bottom: 1px solid #fde68a;
  font-size: 13px;
  font-weight: 500;
}
.preview-banner a {
  color: #92400e;
  text-decoration: underline;
  text-decoration-color: #fcd34d;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: #f8fafc;
}

.header {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  gap: 12px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
}

.title-bar-left-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.switcher {
  display: inline-flex;
  background: var(--doc-bg-subtle);
  padding: 3px;
  border-radius: 8px;
  border: 1px solid var(--doc-border);
}

.pill {
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--doc-text-muted);
  text-decoration: none;
  border-radius: 5px;
  transition:
    background 0.15s,
    color 0.15s;
}

.pill.active {
  background: var(--doc-surface);
  color: var(--doc-text);
  box-shadow: 0 1px 2px var(--doc-shadow-subtle);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.title {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  margin: 0;
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.file-name {
  font-size: 13px;
  color: #64748b;
  padding: 4px 10px;
  background: #f1f5f9;
  border-radius: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.btn {
  padding: 6px 12px;
  background: var(--doc-surface);
  border: 1px solid var(--doc-border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--doc-text);
  white-space: nowrap;
}

/* Fumadocs-style segmented light/dark toggle (mirrors the React demo). */
.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 9999px;
  border: 1px solid var(--doc-border);
  background: var(--doc-bg-subtle);
}
.theme-toggle__opt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 9999px;
  cursor: pointer;
  background: transparent;
  color: var(--doc-text-subtle);
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.theme-toggle__opt.is-selected {
  background: var(--doc-surface);
  color: var(--doc-text);
  box-shadow: 0 1px 2px var(--doc-shadow-subtle);
}

.btn:hover {
  background: var(--doc-bg-hover);
}

.btn-primary {
  background: var(--doc-text);
  color: var(--doc-on-primary);
  border-color: var(--doc-text);
  cursor: pointer;
}

.btn-primary:hover {
  background: #1e293b;
}

.file-input {
  display: none;
}

.status {
  font-size: 12px;
  color: var(--doc-text-muted);
  padding: 4px 8px;
  background: var(--doc-bg-subtle);
  border-radius: 4px;
}

.main {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.agent-panel-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
