import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Plugin, PluginKey } from 'prosemirror-state';
import { parseDocx } from '../docx/parser';
import {
  applyRealDocChanges,
  type ApplyRealDocChangesOptions,
  type RealDocChangeOperation,
} from '../docx/realDocumentChangeStrategy';
import { getEditedParagraphIdsFromTransaction } from '../prosemirror/transactionParagraphTracker';
import type { Document } from '../types/document';
import { toArrayBuffer } from '../utils/docxInput';
import { DocxEditor, type DocxEditorProps, type DocxEditorRef } from './DocxEditor';
import {
  areDocumentsSaveEquivalent,
  cloneArrayBuffer,
  cloneDocumentForBaseline,
} from './docSaveEquivalence';
import { buildDirectXmlBaselineSnapshot } from './directXmlBaselineSnapshot';

const PARAGRAPH_TRACKER_PLUGIN_KEY = new PluginKey('direct-xml-paragraph-tracker');

export interface DirectXmlOperationContext {
  currentDocument: Document;
  baselineDocument: Document;
  /**
   * Latest baseline DOCX bytes that direct XML operations should patch against.
   * This can differ from baselineDocument.originalBuffer after repeated saves.
   */
  baselineBuffer?: ArrayBuffer;
  editedParagraphIds?: string[];
}

export type DirectXmlSaveMode = 'strict' | 'bestEffort';
export type DirectXmlFallbackReason =
  | 'missing-baseline'
  | 'missing-operation-builder'
  | 'empty-operation-plan'
  | 'operation-builder-error'
  | 'direct-apply-error';

export type DirectXmlSavePath = 'direct-xml' | 'model-fallback' | 'model-only' | 'baseline-noop';

export interface DirectXmlSaveModeEvent {
  path: DirectXmlSavePath;
  mode: DirectXmlSaveMode;
  reason?: DirectXmlFallbackReason;
  hasBaselineDocument: boolean;
  hasBaselineBuffer: boolean;
  hasOperationBuilder: boolean;
  editedParagraphIdsCount: number;
  operationsCount?: number;
  errorMessage?: string;
}

export function resolveDirectXmlSaveMode(args: {
  directXmlSaveMode?: DirectXmlSaveMode;
  fallbackToModelSaveOnUnsupported?: boolean;
}): DirectXmlSaveMode {
  const { directXmlSaveMode, fallbackToModelSaveOnUnsupported } = args;
  if (directXmlSaveMode) return directXmlSaveMode;
  if (typeof fallbackToModelSaveOnUnsupported === 'boolean') {
    return fallbackToModelSaveOnUnsupported ? 'bestEffort' : 'strict';
  }
  return 'bestEffort';
}

interface BuildDirectXmlOperationsWithFallbackArgs {
  buildDirectXmlOperations: (
    context: DirectXmlOperationContext
  ) => RealDocChangeOperation[] | Promise<RealDocChangeOperation[]>;
  context: DirectXmlOperationContext;
  mode: DirectXmlSaveMode;
}

interface BuildDirectXmlOperationsWithFallbackResult {
  operations: RealDocChangeOperation[] | null;
  fallbackReason?: DirectXmlFallbackReason;
  errorMessage?: string;
}

export async function buildDirectXmlOperationsWithFallback(
  args: BuildDirectXmlOperationsWithFallbackArgs
): Promise<BuildDirectXmlOperationsWithFallbackResult> {
  try {
    const operations = await args.buildDirectXmlOperations(args.context);
    return { operations };
  } catch (error) {
    if (args.mode === 'bestEffort') {
      return {
        operations: null,
        fallbackReason: 'operation-builder-error',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
}

export interface DirectXmlDocxEditorProps extends Omit<DocxEditorProps, 'onSave'> {
  onSave?: (buffer: ArrayBuffer) => void;
  /**
   * Enable direct OOXML save strategy.
   * Default: true
   */
  useDirectXmlSave?: boolean;
  /**
   * Build direct OOXML operations for the current document state.
   * Required when useDirectXmlSave is true.
   */
  buildDirectXmlOperations?: (
    context: DirectXmlOperationContext
  ) => RealDocChangeOperation[] | Promise<RealDocChangeOperation[]>;
  /**
   * Direct XML save policy.
   * - 'bestEffort': try direct XML, fallback to model save on unsupported/errors
   * - 'strict': fail when direct XML cannot proceed
   * Default: 'bestEffort'
   */
  directXmlSaveMode?: DirectXmlSaveMode;
  /**
   * Structured callback for save-path and fallback diagnostics.
   */
  onSaveModeEvent?: (event: DirectXmlSaveModeEvent) => void;
  /**
   * Options passed to applyRealDocChanges.
   */
  directXmlSaveOptions?: ApplyRealDocChangesOptions;
  /**
   * Legacy compatibility option.
   * Prefer `directXmlSaveMode`.
   */
  fallbackToModelSaveOnUnsupported?: boolean;
}

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}

export const DirectXmlDocxEditor = forwardRef<DocxEditorRef, DirectXmlDocxEditorProps>(
  function DirectXmlDocxEditor(
    {
      onSave,
      onError,
      useDirectXmlSave = true,
      buildDirectXmlOperations,
      directXmlSaveMode,
      onSaveModeEvent,
      directXmlSaveOptions,
      fallbackToModelSaveOnUnsupported,
      externalPlugins,
      documentBuffer,
      document: initialDocument,
      ...restProps
    },
    ref
  ) {
    const innerRef = useRef<DocxEditorRef>(null);
    const baselineLoadTokenRef = useRef(0);
    const baselineDocumentRef = useRef<Document | null>(
      initialDocument ? cloneDocumentForBaseline(initialDocument) : null
    );
    const baselineBufferRef = useRef<ArrayBuffer | null>(
      initialDocument?.originalBuffer ? cloneArrayBuffer(initialDocument.originalBuffer) : null
    );
    const editedParagraphIdsRef = useRef<Set<string>>(new Set());
    const effectiveSaveMode = useMemo(
      () => resolveDirectXmlSaveMode({ directXmlSaveMode, fallbackToModelSaveOnUnsupported }),
      [directXmlSaveMode, fallbackToModelSaveOnUnsupported]
    );

    useEffect(() => {
      if (!documentBuffer) {
        return;
      }

      const loadToken = baselineLoadTokenRef.current + 1;
      baselineLoadTokenRef.current = loadToken;
      baselineDocumentRef.current = null;
      baselineBufferRef.current = null;
      editedParagraphIdsRef.current = new Set();

      (async () => {
        try {
          const normalizedBuffer = await toArrayBuffer(documentBuffer);
          if (baselineLoadTokenRef.current !== loadToken) {
            return;
          }

          baselineBufferRef.current = cloneArrayBuffer(normalizedBuffer);
          const parsed = await parseDocx(cloneArrayBuffer(normalizedBuffer));
          if (baselineLoadTokenRef.current !== loadToken) {
            return;
          }

          baselineDocumentRef.current = cloneDocumentForBaseline(parsed);
          baselineBufferRef.current = parsed.originalBuffer
            ? cloneArrayBuffer(parsed.originalBuffer)
            : cloneArrayBuffer(normalizedBuffer);
        } catch (error) {
          if (baselineLoadTokenRef.current !== loadToken) {
            return;
          }
          baselineDocumentRef.current = null;
          onError?.(
            toError(
              error,
              'Failed to parse baseline DOCX for direct XML save. Falling back may be required.'
            )
          );
        }
      })();
    }, [documentBuffer, onError]);

    useEffect(() => {
      if (documentBuffer) {
        return;
      }

      if (initialDocument) {
        baselineLoadTokenRef.current += 1;
        baselineDocumentRef.current = cloneDocumentForBaseline(initialDocument);
        baselineBufferRef.current = initialDocument.originalBuffer
          ? cloneArrayBuffer(initialDocument.originalBuffer)
          : null;
        editedParagraphIdsRef.current = new Set();
        return;
      }

      baselineLoadTokenRef.current += 1;
      baselineDocumentRef.current = null;
      baselineBufferRef.current = null;
      editedParagraphIdsRef.current = new Set();
    }, [initialDocument, documentBuffer]);

    const paragraphTrackerPlugin = useMemo(
      () =>
        new Plugin({
          key: PARAGRAPH_TRACKER_PLUGIN_KEY,
          state: {
            init: () => null,
            apply: (transaction, value, _oldState, newState) => {
              if (!transaction.docChanged) {
                return value;
              }

              const editedParagraphIds = getEditedParagraphIdsFromTransaction(
                transaction,
                newState
              );
              const accumulator = editedParagraphIdsRef.current;
              for (const paraId of editedParagraphIds) {
                accumulator.add(paraId);
              }
              return value;
            },
          },
        }),
      []
    );

    const mergedPlugins = useMemo(() => {
      const plugins = externalPlugins ? [...externalPlugins] : [];
      plugins.push(paragraphTrackerPlugin);
      return plugins;
    }, [externalPlugins, paragraphTrackerPlugin]);

    const refreshBaselineAfterSave = useCallback(
      async (document: Document | null, savedBuffer: ArrayBuffer) => {
        const saveToken = baselineLoadTokenRef.current + 1;
        baselineLoadTokenRef.current = saveToken;

        const snapshot = await buildDirectXmlBaselineSnapshot({
          currentDocument: document,
          savedBuffer,
        });
        if (baselineLoadTokenRef.current !== saveToken) {
          return;
        }

        if (snapshot.hydrationError) {
          console.warn(
            '[DirectXmlDocxEditor] Failed to rehydrate baseline from saved bytes; using current in-memory snapshot',
            snapshot.hydrationError
          );
        }

        baselineDocumentRef.current = snapshot.baselineDocument;
        baselineBufferRef.current = snapshot.baselineBuffer;
        editedParagraphIdsRef.current = new Set();
      },
      []
    );

    const saveWithModelPipeline = useCallback(async (): Promise<ArrayBuffer | null> => {
      const inner = innerRef.current;
      if (!inner) {
        return null;
      }

      const saved = await inner.save();
      if (!saved) {
        return null;
      }

      const currentDocument = inner.getDocument();
      await refreshBaselineAfterSave(currentDocument, saved);
      onSave?.(saved);
      return saved;
    }, [onSave, refreshBaselineAfterSave]);

    const buildSaveEventBase = useCallback(
      (overrides: Partial<DirectXmlSaveModeEvent> = {}): DirectXmlSaveModeEvent => ({
        path: 'direct-xml',
        mode: effectiveSaveMode,
        hasBaselineDocument: !!baselineDocumentRef.current,
        hasBaselineBuffer: !!baselineBufferRef.current,
        hasOperationBuilder: !!buildDirectXmlOperations,
        editedParagraphIdsCount: editedParagraphIdsRef.current.size,
        ...overrides,
      }),
      [buildDirectXmlOperations, effectiveSaveMode]
    );

    const emitSaveModeEvent = useCallback(
      (event: DirectXmlSaveModeEvent) => {
        onSaveModeEvent?.(event);
      },
      [onSaveModeEvent]
    );

    const fallbackToModelSave = useCallback(
      async (reason: DirectXmlFallbackReason, context: Partial<DirectXmlSaveModeEvent> = {}) => {
        const event = buildSaveEventBase({
          path: 'model-fallback',
          reason,
          ...context,
        });
        console.warn('[DirectXmlDocxEditor] Falling back to model save', event);
        emitSaveModeEvent(event);
        return saveWithModelPipeline();
      },
      [buildSaveEventBase, emitSaveModeEvent, saveWithModelPipeline]
    );

    const saveWithDirectXmlPipeline = useCallback(async (): Promise<ArrayBuffer | null> => {
      const inner = innerRef.current;
      if (!inner) {
        return null;
      }

      const currentDocument = inner.getDocument();
      if (!currentDocument) {
        return null;
      }

      const baselineDocument = baselineDocumentRef.current;
      const baselineBuffer = baselineBufferRef.current;
      if (!baselineDocument || !baselineBuffer) {
        if (effectiveSaveMode === 'bestEffort') {
          return fallbackToModelSave('missing-baseline');
        }
        throw new Error(
          'Direct XML save requires a baseline DOCX buffer and baseline parsed document'
        );
      }

      if (!buildDirectXmlOperations) {
        if (effectiveSaveMode === 'bestEffort') {
          return fallbackToModelSave('missing-operation-builder');
        }
        throw new Error('Direct XML save is enabled but buildDirectXmlOperations is not provided');
      }

      const operationBuildResult = await buildDirectXmlOperationsWithFallback({
        buildDirectXmlOperations,
        mode: effectiveSaveMode,
        context: {
          currentDocument,
          baselineDocument,
          baselineBuffer: cloneArrayBuffer(baselineBuffer),
          editedParagraphIds: [...editedParagraphIdsRef.current],
        },
      });
      if (!operationBuildResult.operations) {
        return fallbackToModelSave(
          operationBuildResult.fallbackReason ?? 'operation-builder-error',
          {
            errorMessage: operationBuildResult.errorMessage,
          }
        );
      }
      const operations = operationBuildResult.operations;

      if (operations.length === 0) {
        if (areDocumentsSaveEquivalent(currentDocument, baselineDocument)) {
          const untouchedBuffer = cloneArrayBuffer(baselineBuffer);
          await refreshBaselineAfterSave(currentDocument, untouchedBuffer);
          emitSaveModeEvent(
            buildSaveEventBase({
              path: 'baseline-noop',
              operationsCount: 0,
            })
          );
          onSave?.(untouchedBuffer);
          return untouchedBuffer;
        }
        if (effectiveSaveMode === 'bestEffort') {
          return fallbackToModelSave('empty-operation-plan', { operationsCount: 0 });
        }
        throw new Error(
          'Direct XML save produced no operations for a modified document. Refusing to fall back silently.'
        );
      }

      let result: Awaited<ReturnType<typeof applyRealDocChanges>>;
      try {
        result = await applyRealDocChanges(cloneArrayBuffer(baselineBuffer), operations, {
          strict: true,
          ...directXmlSaveOptions,
        });
      } catch (error) {
        if (effectiveSaveMode === 'bestEffort') {
          return fallbackToModelSave('direct-apply-error', {
            operationsCount: operations.length,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }

      await refreshBaselineAfterSave(currentDocument, result.buffer);
      emitSaveModeEvent(
        buildSaveEventBase({
          path: 'direct-xml',
          operationsCount: operations.length,
        })
      );
      onSave?.(result.buffer);
      return result.buffer;
    }, [
      buildDirectXmlOperations,
      buildSaveEventBase,
      directXmlSaveOptions,
      effectiveSaveMode,
      emitSaveModeEvent,
      fallbackToModelSave,
      onSave,
      refreshBaselineAfterSave,
    ]);

    const handleSave = useCallback(async (): Promise<ArrayBuffer | null> => {
      try {
        if (!useDirectXmlSave) {
          emitSaveModeEvent(
            buildSaveEventBase({
              path: 'model-only',
            })
          );
          return saveWithModelPipeline();
        }
        return saveWithDirectXmlPipeline();
      } catch (error) {
        onError?.(toError(error, 'Failed to save document'));
        return null;
      }
    }, [
      buildSaveEventBase,
      emitSaveModeEvent,
      onError,
      saveWithDirectXmlPipeline,
      saveWithModelPipeline,
      useDirectXmlSave,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        getAgent: () => innerRef.current?.getAgent() || null,
        getDocument: () => innerRef.current?.getDocument() || null,
        getEditorRef: () => innerRef.current?.getEditorRef() || null,
        save: handleSave,
        setZoom: (zoom: number) => innerRef.current?.setZoom(zoom),
        getZoom: () => innerRef.current?.getZoom() ?? 1,
        focus: () => innerRef.current?.focus(),
        getCurrentPage: () => innerRef.current?.getCurrentPage() ?? 1,
        getTotalPages: () => innerRef.current?.getTotalPages() ?? 1,
        scrollToPage: (pageNumber: number) => innerRef.current?.scrollToPage(pageNumber),
        openPrintPreview: () => innerRef.current?.openPrintPreview(),
        print: () => innerRef.current?.print(),
      }),
      [handleSave]
    );

    return (
      <DocxEditor
        ref={innerRef}
        {...restProps}
        documentBuffer={documentBuffer}
        document={initialDocument}
        onError={onError}
        onSave={undefined}
        externalPlugins={mergedPlugins}
      />
    );
  }
);
