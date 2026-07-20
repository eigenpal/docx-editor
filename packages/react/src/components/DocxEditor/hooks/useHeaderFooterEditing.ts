import { useCallback, useMemo, useState } from 'react';
import type {
  Document,
  HeaderFooter,
  BlockContent,
  HeaderFooterType,
  SectionProperties,
} from '@docx-editor.dev/core/types/document';
import { resolveHeaderFooter } from '@docx-editor.dev/core/flow-model';
import { proseDocToBlocks } from '@docx-editor.dev/core/prosemirror/conversion';
import {
  removeHeaderFooterForSection,
  updateSectionPropertiesAt,
} from '@docx-editor.dev/core/utils/removeHeaderFooterForSection';
import type { InlineHeaderFooterEditorRef } from '../../InlineHeaderFooterEditor';

export interface HeaderFooterClickTarget {
  rId: string | null;
  variant: HeaderFooterType;
  sectionIndex: number;
}

/**
 * Owns the inline header/footer editing mode: which slot is being
 * edited (`hfEditPosition`), whether the first-page variant applies
 * (`hfEditIsFirstPage`), the resolved header/footer content for the
 * current section, plus the double-click → edit, save, remove, and
 * "click out" workflows.
 *
 * Empty headers/footers are materialised on first double-click so the
 * user can start typing — the helper writes the new HeaderFooter into
 * `package.headers` / `package.footers` and registers the relationship
 * so the serializer picks it up (#274).
 */
export function useHeaderFooterEditing({
  document,
  pushDocument,
  hfEditorRef,
  containerRef,
  initialSectionProperties,
  finalSectionProperties,
  hfEditPosition,
  setHfEditPosition,
  hfEditIsFirstPage,
  setHfEditIsFirstPage,
}: {
  document: Document | null;
  pushDocument: (doc: Document) => void;
  hfEditorRef: React.RefObject<InlineHeaderFooterEditorRef | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  initialSectionProperties: SectionProperties | undefined;
  finalSectionProperties: SectionProperties | undefined;
  // State + setters live in the parent so `getActiveEditorView` (declared
  // before this hook is called) can read `hfEditPosition` for routing.
  hfEditPosition: 'header' | 'footer' | null;
  setHfEditPosition: React.Dispatch<React.SetStateAction<'header' | 'footer' | null>>;
  hfEditIsFirstPage: boolean;
  setHfEditIsFirstPage: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [hfEditRId, setHfEditRId] = useState<string | null>(null);
  const [hfEditSectionIndex, setHfEditSectionIndex] = useState<number | null>(null);
  const { headerContent, footerContent, firstPageHeaderContent, firstPageFooterContent } =
    useMemo(() => {
      const { header, footer, firstHeader, firstFooter } = resolveHeaderFooter(
        document ?? null,
        finalSectionProperties ?? initialSectionProperties
      );
      return {
        headerContent: header,
        footerContent: footer,
        firstPageHeaderContent: firstHeader,
        firstPageFooterContent: firstFooter,
      };
    }, [document, initialSectionProperties, finalSectionProperties]);

  const activeHf = useMemo(() => {
    if (!hfEditPosition || !hfEditRId) return null;
    const bag = hfEditPosition === 'header' ? document?.package.headers : document?.package.footers;
    return bag?.get(hfEditRId) ?? null;
  }, [document, hfEditPosition, hfEditRId]);

  const handleHeaderFooterDoubleClick = useCallback(
    (position: 'header' | 'footer', pageNumber?: number, target?: HeaderFooterClickTarget) => {
      // No scroll-to-page-1 — the HF content is shared across all pages by
      // `r:id`, so the painter renders the same edits on every page in real
      // time. Whichever page the user double-clicked, the chrome bar floats
      // over THAT page's header and edits propagate visually to all others.
      const body = document?.package?.document;
      const sectionIndex = target?.sectionIndex ?? Math.max(0, (body?.sections?.length ?? 1) - 1);
      const sectProps = body?.sections?.[sectionIndex]?.properties ?? body?.finalSectionProperties;
      const variant =
        target?.variant ??
        (sectProps?.titlePg === true && (pageNumber ?? 1) === 1 ? 'first' : 'default');
      const isFirstPage = variant === 'first';
      const bag = position === 'header' ? document?.package?.headers : document?.package?.footers;
      const hf = target?.rId ? (bag?.get(target.rId) ?? null) : null;
      setHfEditIsFirstPage(isFirstPage);
      setHfEditSectionIndex(sectionIndex);
      if (hf) {
        setHfEditRId(target?.rId ?? null);
        setHfEditPosition(position);
        return;
      }

      // Materialise an empty header/footer so the user can start typing.
      if (!document?.package) return;
      const pkg = document.package;
      const sectionProps =
        pkg.document?.sections?.[sectionIndex]?.properties ?? pkg.document?.finalSectionProperties;
      if (!sectionProps) return;

      const hdrFtrType = variant;
      let suffix = 1;
      let rId = `rId_new_${position}_${hdrFtrType}_${suffix}`;
      while (pkg.headers?.has(rId) || pkg.footers?.has(rId) || pkg.relationships?.has(rId)) {
        rId = `rId_new_${position}_${hdrFtrType}_${++suffix}`;
      }
      const emptyHf: HeaderFooter = {
        type: position === 'header' ? 'header' : 'footer',
        hdrFtrType,
        content: [{ type: 'paragraph', content: [] }],
      };

      const mapKey = position === 'header' ? 'headers' : 'footers';
      const newMap = new Map(pkg[mapKey] ?? []);
      newMap.set(rId, emptyHf);

      const refKey = position === 'header' ? 'headerReferences' : 'footerReferences';
      const newRef = { type: hdrFtrType, rId };

      // Register the rel so the serializer wires up content types + doc rels (#274).
      const existingRels = pkg.relationships;
      const usedTargets = new Set<string>();
      for (const rel of existingRels?.values() ?? []) {
        if (rel.target) usedTargets.add(rel.target);
      }
      let targetNum = 1;
      while (usedTargets.has(`${position}${targetNum}.xml`)) targetNum++;
      const relType =
        position === 'header'
          ? 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header'
          : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
      const newRelationships = new Map(existingRels);
      newRelationships.set(rId, {
        id: rId,
        type: relType,
        target: `${position}${targetNum}.xml`,
      });

      const updatedBody = updateSectionPropertiesAt(pkg.document, sectionIndex, (properties) => ({
        ...properties,
        [refKey]: [
          ...(properties[refKey] ?? []).filter((entry) => entry.type !== hdrFtrType),
          newRef,
        ],
      }));
      const newDoc: Document = {
        ...document,
        package: {
          ...pkg,
          [mapKey]: newMap,
          relationships: newRelationships,
          document: updatedBody,
        },
      };
      pushDocument(newDoc);
      setHfEditRId(rId);
      setHfEditSectionIndex(sectionIndex);
      setHfEditPosition(position);
    },
    [
      headerContent,
      footerContent,
      firstPageHeaderContent,
      firstPageFooterContent,
      document,
      pushDocument,
      setHfEditPosition,
      setHfEditIsFirstPage,
      setHfEditRId,
      setHfEditSectionIndex,
    ]
  );

  const handleHeaderFooterSave = useCallback(
    (content: BlockContent[]) => {
      if (!hfEditPosition || !document?.package) {
        setHfEditPosition(null);
        setHfEditRId(null);
        setHfEditSectionIndex(null);
        return;
      }

      const pkg = document.package;
      const mapKey = hfEditPosition === 'header' ? 'headers' : 'footers';
      const map = pkg[mapKey];

      if (hfEditRId && map) {
        const existing = map.get(hfEditRId);
        const updated: HeaderFooter = {
          type: hfEditPosition,
          hdrFtrType: existing?.hdrFtrType ?? (hfEditIsFirstPage ? 'first' : 'default'),
          ...existing,
          content,
          verbatimXml: undefined,
        };
        const newMap = new Map(map);
        newMap.set(hfEditRId, updated);

        const newDoc: Document = {
          ...document,
          package: {
            ...pkg,
            [mapKey]: newMap,
          },
        };
        pushDocument(newDoc);
      }

      setHfEditPosition(null);
      setHfEditRId(null);
      setHfEditSectionIndex(null);
    },
    [
      hfEditPosition,
      hfEditIsFirstPage,
      hfEditRId,
      document,
      pushDocument,
      setHfEditPosition,
      setHfEditRId,
      setHfEditSectionIndex,
    ]
  );

  const handleBodyClick = useCallback(() => {
    if (!hfEditPosition) return;
    // Save current HF contents (if dirty) then close.
    const view = hfEditorRef.current?.getView();
    if (view) {
      const blocks = proseDocToBlocks(view.state.doc);
      handleHeaderFooterSave(blocks);
    } else {
      setHfEditPosition(null);
      setHfEditRId(null);
      setHfEditSectionIndex(null);
    }
  }, [
    hfEditPosition,
    handleHeaderFooterSave,
    hfEditorRef,
    setHfEditPosition,
    setHfEditRId,
    setHfEditSectionIndex,
  ]);

  const handleRemoveHeaderFooter = useCallback(() => {
    if (!hfEditPosition || !document?.package) {
      setHfEditPosition(null);
      setHfEditRId(null);
      setHfEditSectionIndex(null);
      return;
    }

    const pkg = document.package;

    if (hfEditRId) {
      const sectionIndex =
        hfEditSectionIndex ?? Math.max(0, (pkg.document.sections?.length ?? 1) - 1);
      const newDoc = removeHeaderFooterForSection(
        document,
        hfEditPosition,
        sectionIndex,
        hfEditRId
      );
      pushDocument(newDoc);
    }

    setHfEditPosition(null);
    setHfEditRId(null);
    setHfEditSectionIndex(null);
  }, [
    hfEditPosition,
    hfEditRId,
    hfEditSectionIndex,
    document,
    pushDocument,
    setHfEditPosition,
    setHfEditRId,
    setHfEditSectionIndex,
  ]);

  const getHfTargetElement = useCallback(
    (pos: 'header' | 'footer'): HTMLElement | null => {
      const pagesContainer = containerRef.current?.querySelector('.paged-editor__pages');
      if (!pagesContainer) return null;
      const className = pos === 'header' ? '.layout-page-header' : '.layout-page-footer';
      const candidates = pagesContainer.querySelectorAll<HTMLElement>(className);
      if (!hfEditRId) return candidates[0] ?? null;
      return Array.from(candidates).find((element) => element.dataset.hfRId === hfEditRId) ?? null;
    },
    [containerRef, hfEditRId]
  );

  return {
    headerContent,
    footerContent,
    firstPageHeaderContent,
    firstPageFooterContent,
    activeHf,
    hfEditRId,
    handleHeaderFooterDoubleClick,
    handleHeaderFooterSave,
    handleBodyClick,
    handleRemoveHeaderFooter,
    getHfTargetElement,
  };
}
