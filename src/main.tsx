/**
 * Main entry point for the DOCX editor application
 */
import React, { useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { DirectXmlDocxEditor as DocxEditor } from './components/DirectXmlDocxEditor';
import type { Document, HeaderFooter } from './types/document';
import { serializeDocument } from './docx/serializer/documentSerializer';
import { serializeHeaderFooter } from './docx/serializer/headerFooterSerializer';
import { openDocxXml } from './docx/rawXmlEditor';
import { resolveRelativePath } from './docx/relsParser';
import type { RealDocChangeOperation } from './docx/realDocumentChangeStrategy';
import { buildTargetedDocumentXmlPatch } from './docx/directXmlPlanBuilder';
import './index.css';

async function buildDirectXmlOperationPlan(context: {
  currentDocument: Document;
  baselineDocument: Document;
  editedParagraphIds?: string[];
}): Promise<RealDocChangeOperation[]> {
  const { currentDocument, baselineDocument, editedParagraphIds } = context;
  const operations: RealDocChangeOperation[] = [];

  const currentDocumentXml = serializeDocument(currentDocument);
  const baselineDocumentXml = serializeDocument(baselineDocument);
  if (currentDocumentXml !== baselineDocumentXml) {
    let documentXmlForSave = currentDocumentXml;

    const originalBuffer = baselineDocument.originalBuffer;
    if (originalBuffer) {
      try {
        const rawEditor = await openDocxXml(originalBuffer.slice(0));
        const rawBaselineDocumentXml = await rawEditor.getXml('word/document.xml');
        const targetedPatch = buildTargetedDocumentXmlPatch({
          baselineDocument,
          currentDocument,
          baselineDocumentXml: rawBaselineDocumentXml,
          candidateParagraphIds: editedParagraphIds,
        });
        if (targetedPatch) {
          documentXmlForSave = targetedPatch.xml;
        }
      } catch (error) {
        console.warn(
          'Failed to build targeted document.xml patch, falling back to full document.xml serialization',
          error
        );
      }
    }

    operations.push({
      type: 'set-xml',
      path: 'word/document.xml',
      xml: documentXmlForSave,
    });
  }

  const relationships = currentDocument.package.relationships;
  if (!relationships) {
    return operations;
  }

  const seenParts = new Set<string>();

  const appendHeaderFooterOps = (
    refs: { rId: string }[] | undefined,
    map: Map<string, HeaderFooter> | undefined,
    baselineMap: Map<string, HeaderFooter> | undefined
  ): void => {
    if (!refs || !map) return;

    for (const ref of refs) {
      const relationship = relationships.get(ref.rId);
      const headerFooter = map.get(ref.rId);
      if (!relationship || !headerFooter || relationship.targetMode === 'External') {
        continue;
      }

      const partPath = resolveRelativePath('word/_rels/document.xml.rels', relationship.target);
      if (seenParts.has(partPath)) {
        continue;
      }
      seenParts.add(partPath);

      const currentXml = serializeHeaderFooter(headerFooter);
      const baselineHeaderFooter = baselineMap?.get(ref.rId);
      if (baselineHeaderFooter) {
        const baselineXml = serializeHeaderFooter(baselineHeaderFooter);
        if (currentXml === baselineXml) {
          continue;
        }
      }

      operations.push({
        type: 'set-xml',
        path: partPath,
        xml: currentXml,
      });
    }
  };

  const collectAllSectionRefs = (kind: 'header' | 'footer'): Array<{ rId: string }> => {
    const refs: Array<{ rId: string }> = [];
    const seenRels = new Set<string>();
    const append = (items: Array<{ rId: string }> | undefined) => {
      if (!items) return;
      for (const item of items) {
        if (seenRels.has(item.rId)) continue;
        seenRels.add(item.rId);
        refs.push(item);
      }
    };

    for (const section of currentDocument.package.document.sections ?? []) {
      append(
        kind === 'header'
          ? section.properties.headerReferences
          : section.properties.footerReferences
      );
    }

    const finalSectionProperties = currentDocument.package.document.finalSectionProperties;
    append(
      kind === 'header'
        ? finalSectionProperties?.headerReferences
        : finalSectionProperties?.footerReferences
    );

    return refs;
  };

  appendHeaderFooterOps(
    collectAllSectionRefs('header'),
    currentDocument.package.headers,
    baselineDocument.package.headers
  );
  appendHeaderFooterOps(
    collectAllSectionRefs('footer'),
    currentDocument.package.footers,
    baselineDocument.package.footers
  );

  return operations;
}

/**
 * Main App component that provides file loading and editor functionality.
 */
function App() {
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file selection
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      setDocumentBuffer(buffer);
      setFileName(file.name);
    } catch (error) {
      console.error('Failed to read file:', error);
    }
  }, []);

  // Handle creating a new document
  const handleNew = useCallback(() => {
    setDocumentBuffer(null);
    setFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header with file controls */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid #e0e0e0',
          backgroundColor: '#f5f5f5',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={handleFileChange}
          style={{ fontSize: '14px' }}
        />
        {documentBuffer && (
          <>
            <span style={{ color: '#666', fontSize: '14px' }}>{fileName || 'Document loaded'}</span>
            <button
              onClick={handleNew}
              style={{
                padding: '4px 12px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              New
            </button>
          </>
        )}
      </div>

      {/* Editor area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DocxEditor
          documentBuffer={documentBuffer}
          useDirectXmlSave={true}
          buildDirectXmlOperations={buildDirectXmlOperationPlan}
          showToolbar={true}
          showVariablePanel={true}
          showZoomControl={true}
          showPageNumbers={true}
          onError={(error) => console.error('Editor error:', error)}
        />
      </div>
    </div>
  );
}

// Mount the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}

export { App };
