import { useCallback, useMemo } from 'react';
import type {
  Document,
  HeaderFooter,
  BlockContent,
  SectionProperties,
} from '@eigenpal/docx-editor-core/types/document';
import { resolveHeaderFooter } from '@eigenpal/docx-editor-core/layout-bridge';
import { proseDocToBlocks } from '@eigenpal/docx-editor-core/prosemirror/conversion';
import type { InlineHeaderFooterEditorRef } from '../../InlineHeaderFooterEditor';

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

  const handleHeaderFooterDoubleClick = useCallback(
    (position: 'header' | 'footer', pageNumber?: number) => {
      // No scroll-to-page-1 — the HF content is shared across all pages by
      // `r:id`, so the painter renders the same edits on every page in real
      // time. Whichever page the user double-clicked, the chrome bar floats
      // over THAT page's header and edits propagate visually to all others.
      const sectProps = document?.package?.document?.finalSectionProperties;
      const isFirstPage = sectProps?.titlePg === true && (pageNumber ?? 1) === 1;
      const hf = isFirstPage
        ? position === 'header'
          ? firstPageHeaderContent
          : firstPageFooterContent
        : position === 'header'
          ? headerContent
          : footerContent;
      setHfEditIsFirstPage(isFirstPage);
      if (hf) {
        setHfEditPosition(position);
        return;
      }

      // Materialise an empty header/footer so the user can start typing.
      if (!document?.package) return;
      const pkg = document.package;
      const sectionProps = pkg.document?.finalSectionProperties;
      if (!sectionProps) return;

      const hdrFtrType = isFirstPage ? 'first' : 'default';
      const rId = `rId_new_${position}_${hdrFtrType}`;
      const emptyHf: HeaderFooter = {
        type: position === 'header' ? 'header' : 'footer',
        hdrFtrType,
        content: [{ type: 'paragraph', content: [] }],
      };

      const mapKey = position === 'header' ? 'headers' : 'footers';
      const newMap = new Map(pkg[mapKey] ?? []);
      newMap.set(rId, emptyHf);

      const refKey = position === 'header' ? 'headerReferences' : 'footerReferences';
      const existingRefs = sectionProps[refKey] ?? [];
      const newRef = { type: hdrFtrType as 'default' | 'first', rId };

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

      const newDoc: Document = {
        ...document,
        package: {
          ...pkg,
          [mapKey]: newMap,
          relationships: newRelationships,
          document: pkg.document
            ? {
                ...pkg.document,
                finalSectionProperties: {
                  ...sectionProps,
                  [refKey]: [...existingRefs, newRef],
                },
              }
            : pkg.document,
        },
      };
      pushDocument(newDoc);
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
    ]
  );

  const handleHeaderFooterSave = useCallback(
    (content: BlockContent[]) => {
      if (!hfEditPosition || !document?.package) {
        setHfEditPosition(null);
        return;
      }

      const pkg = document.package;
      const sectionProps = pkg.document?.finalSectionProperties;
      const refs =
        hfEditPosition === 'header'
          ? sectionProps?.headerReferences
          : sectionProps?.footerReferences;
      const targetType = hfEditIsFirstPage ? 'first' : 'default';
      const activeRef =
        refs?.find((r) => r.type === targetType) ??
        refs?.find((r) => r.type === 'default') ??
        refs?.find((r) => r.type === 'first') ??
        refs?.[0];
      const mapKey = hfEditPosition === 'header' ? 'headers' : 'footers';
      const map = pkg[mapKey];

      if (activeRef?.rId && map) {
        const existing = map.get(activeRef.rId);
        const updated: HeaderFooter = {
          type: hfEditPosition,
          hdrFtrType: activeRef.type as 'default' | 'first' | 'even',
          ...existing,
          content,
        };
        const newMap = new Map(map);
        newMap.set(activeRef.rId, updated);

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
    },
    [hfEditPosition, hfEditIsFirstPage, document, pushDocument, setHfEditPosition]
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
    }
  }, [hfEditPosition, handleHeaderFooterSave, hfEditorRef, setHfEditPosition]);

  const handleRemoveHeaderFooter = useCallback(() => {
    if (!hfEditPosition || !document?.package) {
      setHfEditPosition(null);
      return;
    }

    const pkg = document.package;
    const sectionProps = pkg.document?.finalSectionProperties;
    const refKey = hfEditPosition === 'header' ? 'headerReferences' : 'footerReferences';
    const mapKey = hfEditPosition === 'header' ? 'headers' : 'footers';
    const refs = sectionProps?.[refKey];
    const delTargetType = hfEditIsFirstPage ? 'first' : 'default';
    const activeRef =
      refs?.find((r) => r.type === delTargetType) ??
      refs?.find((r) => r.type === 'default') ??
      refs?.find((r) => r.type === 'first') ??
      refs?.[0];

    if (activeRef?.rId) {
      const newMap = new Map(pkg[mapKey] ?? []);
      newMap.delete(activeRef.rId);

      const newRefs = (refs ?? []).filter((r) => r.rId !== activeRef.rId);

      const newDoc: Document = {
        ...document,
        package: {
          ...pkg,
          [mapKey]: newMap,
          document: pkg.document
            ? {
                ...pkg.document,
                finalSectionProperties: {
                  ...sectionProps,
                  [refKey]: newRefs,
                },
              }
            : pkg.document,
        },
      };
      pushDocument(newDoc);
    }

    setHfEditPosition(null);
  }, [hfEditPosition, hfEditIsFirstPage, document, pushDocument, setHfEditPosition]);

  const getHfTargetElement = useCallback(
    (pos: 'header' | 'footer'): HTMLElement | null => {
      const pagesContainer = containerRef.current?.querySelector('.paged-editor__pages');
      if (!pagesContainer) return null;
      const className = pos === 'header' ? '.layout-page-header' : '.layout-page-footer';
      return pagesContainer.querySelector(className);
    },
    [containerRef]
  );

  return {
    headerContent,
    footerContent,
    firstPageHeaderContent,
    firstPageFooterContent,
    handleHeaderFooterDoubleClick,
    handleHeaderFooterSave,
    handleBodyClick,
    handleRemoveHeaderFooter,
    getHfTargetElement,
  };
}
