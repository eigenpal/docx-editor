import { Suspense, lazy } from 'react';
import type {
  Document,
  FootnoteProperties,
  EndnoteProperties,
  SectionProperties,
  Watermark,
} from '@eigenpal/docx-editor-core/types/document';
import { setTableProperties } from '@eigenpal/docx-editor-core/prosemirror/commands';
import type { EditorView } from 'prosemirror-view';
import type { useFindReplace } from '../../hooks/useFindReplace';
import type { useHyperlinkDialog, HyperlinkData } from '../dialogs/HyperlinkDialog';
import type { FindMatch, FindOptions, FindResult } from '../dialogs/FindReplaceDialog';
import type { ImagePositionData } from '../dialogs/ImagePositionDialog';
import type { ImagePropertiesData } from '../dialogs/ImagePropertiesDialog';

// Same lazy() imports as the parent — pulled in here so the dialog chunk
// is owned by this component instead of the orchestrator. `lazy()` runs at
// module load, so co-locating with the JSX keeps the code-split boundary.
const FindReplaceDialog = lazy(() => import('../dialogs/FindReplaceDialog'));
const HyperlinkDialog = lazy(() => import('../dialogs/HyperlinkDialog'));
const TablePropertiesDialog = lazy(() =>
  import('../dialogs/TablePropertiesDialog').then((m) => ({ default: m.TablePropertiesDialog }))
);
const SplitCellDialog = lazy(() => import('../dialogs/SplitCellDialog'));
const ImagePositionDialog = lazy(() =>
  import('../dialogs/ImagePositionDialog').then((m) => ({ default: m.ImagePositionDialog }))
);
const ImagePropertiesDialog = lazy(() =>
  import('../dialogs/ImagePropertiesDialog').then((m) => ({ default: m.ImagePropertiesDialog }))
);
const FootnotePropertiesDialog = lazy(() =>
  import('../dialogs/FootnotePropertiesDialog').then((m) => ({
    default: m.FootnotePropertiesDialog,
  }))
);
const PageSetupDialog = lazy(() =>
  import('../dialogs/PageSetupDialog').then((m) => ({ default: m.PageSetupDialog }))
);
const WatermarkDialog = lazy(() =>
  import('../dialogs/WatermarkDialog').then((m) => ({ default: m.WatermarkDialog }))
);

interface PmImageContextDialogData {
  alt?: string | null;
  borderWidth?: number | null;
  borderColor?: string | null;
  borderKind?: string | null;
  width?: number | null;
  height?: number | null;
}

interface SplitCellDialogState {
  isOpen: boolean;
  initialRows: number;
  initialCols: number;
  minRows: number;
  minCols: number;
}

/**
 * All lazy-loaded dialogs rendered as a single `<Suspense>` block. Each
 * dialog is independently gated on its open flag — Suspense kicks in
 * once on first open per dialog. Co-locating the lazy() calls here keeps
 * the dialog code-split chunk pinned to this component.
 */
export function DocxEditorDialogs({
  findReplace,
  findResultRef,
  onFind,
  onFindNext,
  onFindPrevious,
  onReplace,
  onReplaceAll,
  hyperlinkDialog,
  onHyperlinkSubmit,
  onHyperlinkRemove,
  tablePropsOpen,
  onTablePropsClose,
  pmTableContext,
  getActiveEditorView,
  splitCellDialogState,
  onSplitCellDialogClose,
  onSplitCellDialogApply,
  imagePositionOpen,
  onImagePositionClose,
  onApplyImagePosition,
  imagePropsOpen,
  onImagePropsClose,
  onApplyImageProperties,
  pmImageContext,
  showPageSetup,
  onPageSetupClose,
  onPageSetupApply,
  showWatermark,
  onWatermarkClose,
  onWatermarkApply,
  currentWatermark,
  watermarkPresets,
  document,
  footnotePropsOpen,
  onFootnotePropsClose,
  onApplyFootnoteProperties,
}: {
  // Find/Replace
  findReplace: ReturnType<typeof useFindReplace>;
  findResultRef: React.RefObject<FindResult | null>;
  onFind: (searchText: string, options: FindOptions) => FindResult | null;
  onFindNext: () => FindMatch | null;
  onFindPrevious: () => FindMatch | null;
  onReplace: (replaceText: string) => boolean;
  onReplaceAll: (searchText: string, replaceText: string, options: FindOptions) => number;
  // Hyperlink
  hyperlinkDialog: ReturnType<typeof useHyperlinkDialog>;
  onHyperlinkSubmit: (data: HyperlinkData) => void;
  onHyperlinkRemove: () => void;
  // Table properties
  tablePropsOpen: boolean;
  onTablePropsClose: () => void;
  pmTableContext: { table?: { attrs?: Record<string, unknown> } } | null | undefined;
  getActiveEditorView: () => EditorView | null | undefined;
  // Split cell
  splitCellDialogState: SplitCellDialogState;
  onSplitCellDialogClose: () => void;
  onSplitCellDialogApply: (rows: number, cols: number) => void;
  // Image position / properties
  imagePositionOpen: boolean;
  onImagePositionClose: () => void;
  onApplyImagePosition: (data: ImagePositionData) => void;
  imagePropsOpen: boolean;
  onImagePropsClose: () => void;
  onApplyImageProperties: (data: ImagePropertiesData) => void;
  pmImageContext: PmImageContextDialogData | null | undefined;
  // Page setup
  showPageSetup: boolean;
  onPageSetupClose: () => void;
  onPageSetupApply: (props: Partial<SectionProperties>) => void;
  // Watermark
  showWatermark: boolean;
  onWatermarkClose: () => void;
  onWatermarkApply: (watermark: Watermark | null) => void;
  currentWatermark: Watermark | undefined;
  watermarkPresets?: readonly string[];
  document: Document | null;
  // Footnote properties
  footnotePropsOpen: boolean;
  onFootnotePropsClose: () => void;
  onApplyFootnoteProperties: (footnotePr: FootnoteProperties, endnotePr: EndnoteProperties) => void;
}) {
  return (
    <Suspense fallback={null}>
      {findReplace.state.isOpen && (
        <FindReplaceDialog
          isOpen={findReplace.state.isOpen}
          onClose={findReplace.close}
          onFind={onFind}
          onFindNext={onFindNext}
          onFindPrevious={onFindPrevious}
          onReplace={onReplace}
          onReplaceAll={onReplaceAll}
          initialSearchText={findReplace.state.searchText}
          replaceMode={findReplace.state.replaceMode}
          currentResult={findResultRef.current}
        />
      )}
      {hyperlinkDialog.state.isOpen && (
        <HyperlinkDialog
          isOpen={hyperlinkDialog.state.isOpen}
          onClose={hyperlinkDialog.close}
          onSubmit={onHyperlinkSubmit}
          onRemove={hyperlinkDialog.state.isEditing ? onHyperlinkRemove : undefined}
          initialData={hyperlinkDialog.state.initialData}
          selectedText={hyperlinkDialog.state.selectedText}
          isEditing={hyperlinkDialog.state.isEditing}
        />
      )}
      {tablePropsOpen && (
        <TablePropertiesDialog
          isOpen={tablePropsOpen}
          onClose={onTablePropsClose}
          onApply={(props) => {
            const view = getActiveEditorView();
            if (view) {
              setTableProperties(props)(view.state, view.dispatch);
            }
          }}
          currentProps={pmTableContext?.table?.attrs}
        />
      )}
      {splitCellDialogState.isOpen && (
        <SplitCellDialog
          isOpen={splitCellDialogState.isOpen}
          onClose={onSplitCellDialogClose}
          onApply={onSplitCellDialogApply}
          initialRows={splitCellDialogState.initialRows}
          initialCols={splitCellDialogState.initialCols}
          minRows={splitCellDialogState.minRows}
          minCols={splitCellDialogState.minCols}
        />
      )}
      {imagePositionOpen && (
        <ImagePositionDialog
          isOpen={imagePositionOpen}
          onClose={onImagePositionClose}
          onApply={onApplyImagePosition}
        />
      )}
      {imagePropsOpen && (
        <ImagePropertiesDialog
          isOpen={imagePropsOpen}
          onClose={onImagePropsClose}
          onApply={onApplyImageProperties}
          currentData={
            pmImageContext
              ? {
                  alt: pmImageContext.alt ?? undefined,
                  borderWidth: pmImageContext.borderWidth ?? undefined,
                  borderColor: pmImageContext.borderColor ?? undefined,
                  borderKind: pmImageContext.borderKind ?? undefined,
                  width: pmImageContext.width ?? undefined,
                  height: pmImageContext.height ?? undefined,
                }
              : undefined
          }
        />
      )}
      {showPageSetup && (
        <PageSetupDialog
          isOpen={showPageSetup}
          onClose={onPageSetupClose}
          onApply={onPageSetupApply}
          currentProps={document?.package.document?.finalSectionProperties}
        />
      )}
      {showWatermark && (
        <WatermarkDialog
          isOpen={showWatermark}
          onClose={onWatermarkClose}
          onApply={onWatermarkApply}
          current={currentWatermark}
          presets={watermarkPresets}
        />
      )}
      {footnotePropsOpen && (
        <FootnotePropertiesDialog
          isOpen={footnotePropsOpen}
          onClose={onFootnotePropsClose}
          onApply={onApplyFootnoteProperties}
          footnotePr={document?.package.document?.finalSectionProperties?.footnotePr}
          endnotePr={document?.package.document?.finalSectionProperties?.endnotePr}
        />
      )}
    </Suspense>
  );
}
