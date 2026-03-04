import type { Document, Endnote, Footnote, HeaderFooter, Relationship } from '../types/document';
import { buildTargetedDocumentXmlPatch, buildTargetedNotesXmlPatch } from './directXmlPlanBuilder';
import { resolveRelativePath } from './relsParser';
import { openDocxXml } from './rawXmlEditor';
import type { RealDocChangeOperation } from './realDocumentChangeStrategy';
import { serializeHeaderFooter } from './serializer/headerFooterSerializer';
import { serializeEndnotes, serializeFootnotes } from './serializer/notesSerializer';
import { serializeDocument } from './serializer/documentSerializer';

export interface BuildDirectXmlOperationPlanContext {
  currentDocument: Document;
  baselineDocument: Document;
  /**
   * Latest baseline DOCX bytes to patch against.
   * Prefer this over baselineDocument.originalBuffer when available.
   */
  baselineBuffer?: ArrayBuffer;
  editedParagraphIds?: string[];
}

export interface DirectXmlOperationPlanDiagnostics {
  targetedPatchUsed: boolean;
  targetedPatchChangedParagraphs: number | null;
  fallbackReason: string | null;
  operationCount: number;
  operationPaths: string[];
}

export interface BuildDirectXmlOperationPlanOptions {
  onDiagnostics?: (diagnostics: DirectXmlOperationPlanDiagnostics) => void;
}

function collectAllSectionRefs(
  document: Document,
  kind: 'header' | 'footer'
): Array<{ rId: string }> {
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

  for (const section of document.package.document.sections ?? []) {
    append(
      kind === 'header' ? section.properties.headerReferences : section.properties.footerReferences
    );
  }

  const finalSectionProperties = document.package.document.finalSectionProperties;
  append(
    kind === 'header'
      ? finalSectionProperties?.headerReferences
      : finalSectionProperties?.footerReferences
  );

  return refs;
}

const DOCUMENT_RELS_PATH = 'word/_rels/document.xml.rels';
const DOCUMENT_PART_PATH = 'word/document.xml';
const REL_TYPE_HEADER =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const REL_TYPE_FOOTER =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const REL_TYPE_FOOTNOTES =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const REL_TYPE_ENDNOTES =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes';
const CONTENT_TYPE_HEADER =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const CONTENT_TYPE_FOOTER =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
const CONTENT_TYPE_FOOTNOTES =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
const CONTENT_TYPE_ENDNOTES =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml';

function findRelationshipByType(
  relationships: Map<string, Relationship> | undefined,
  relationshipType: string
): { rId: string; relationship: Relationship } | null {
  if (!relationships) return null;
  for (const [rId, relationship] of relationships.entries()) {
    if (relationship.type !== relationshipType) continue;
    return { rId, relationship };
  }
  return null;
}

function toPartName(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function toDocumentRelationshipTarget(path: string): string {
  return path.startsWith('word/') ? path.slice('word/'.length) : path;
}

function collectUsedPartPathsByRelationshipType(args: {
  currentRelationships: Map<string, Relationship> | undefined;
  baselineRelationships: Map<string, Relationship> | undefined;
  relationshipType: string;
}): Set<string> {
  const usedPartPaths = new Set<string>();
  const append = (relationships: Map<string, Relationship> | undefined) => {
    if (!relationships) return;
    for (const relationship of relationships.values()) {
      if (relationship.type !== args.relationshipType) continue;
      if (relationship.targetMode === 'External') continue;
      usedPartPaths.add(resolveRelativePath(DOCUMENT_RELS_PATH, relationship.target));
    }
  };

  append(args.currentRelationships);
  append(args.baselineRelationships);
  return usedPartPaths;
}

function collectUsedRelationshipIds(args: {
  currentRelationships: Map<string, Relationship> | undefined;
  baselineRelationships: Map<string, Relationship> | undefined;
}): Set<string> {
  const usedRelationshipIds = new Set<string>();
  const append = (relationships: Map<string, Relationship> | undefined) => {
    if (!relationships) return;
    for (const rId of relationships.keys()) {
      usedRelationshipIds.add(rId);
    }
  };

  append(args.currentRelationships);
  append(args.baselineRelationships);
  return usedRelationshipIds;
}

function allocateRelationshipId(preferredId: string, usedRelationshipIds: Set<string>): string {
  if (!usedRelationshipIds.has(preferredId)) {
    usedRelationshipIds.add(preferredId);
    return preferredId;
  }

  let index = 1;
  let candidate = `${preferredId}_${index}`;
  while (usedRelationshipIds.has(candidate)) {
    index += 1;
    candidate = `${preferredId}_${index}`;
  }
  usedRelationshipIds.add(candidate);
  return candidate;
}

function allocateNextHeaderFooterPartPath(
  kind: 'header' | 'footer',
  usedPartPaths: Set<string>
): string {
  const prefix = kind === 'header' ? 'word/header' : 'word/footer';
  let index = 1;
  let candidate = `${prefix}${index}.xml`;
  while (usedPartPaths.has(candidate)) {
    index += 1;
    candidate = `${prefix}${index}.xml`;
  }
  usedPartPaths.add(candidate);
  return candidate;
}

export async function buildDirectXmlOperationPlan(
  context: BuildDirectXmlOperationPlanContext,
  options: BuildDirectXmlOperationPlanOptions = {}
): Promise<RealDocChangeOperation[]> {
  const { currentDocument, baselineDocument, editedParagraphIds } = context;
  const operations: RealDocChangeOperation[] = [];
  const baselineBuffer = context.baselineBuffer ?? baselineDocument.originalBuffer;
  let baselineRawEditor: Awaited<ReturnType<typeof openDocxXml>> | null = null;
  const diagnostics: DirectXmlOperationPlanDiagnostics = {
    targetedPatchUsed: false,
    targetedPatchChangedParagraphs: null,
    fallbackReason: null,
    operationCount: 0,
    operationPaths: [],
  };

  const finalize = (): RealDocChangeOperation[] => {
    diagnostics.operationCount = operations.length;
    diagnostics.operationPaths = operations.map((op) => ('path' in op ? op.path : 'n/a'));
    options.onDiagnostics?.(diagnostics);
    return operations;
  };

  const currentDocumentXml = serializeDocument(currentDocument);
  const baselineDocumentXml = serializeDocument(baselineDocument);
  const getBaselineRawEditor = async (): Promise<Awaited<
    ReturnType<typeof openDocxXml>
  > | null> => {
    if (!baselineBuffer) return null;
    if (!baselineRawEditor) {
      baselineRawEditor = await openDocxXml(baselineBuffer.slice(0));
    }
    return baselineRawEditor;
  };

  if (currentDocumentXml !== baselineDocumentXml) {
    let documentXmlForSave = currentDocumentXml;

    if (baselineBuffer) {
      try {
        const rawEditor = await getBaselineRawEditor();
        if (!rawEditor) {
          diagnostics.fallbackReason = 'missing-baseline-buffer';
          operations.push({
            type: 'set-xml',
            path: 'word/document.xml',
            xml: documentXmlForSave,
          });
          return finalize();
        }
        const rawBaselineDocumentXml = await rawEditor.getXml('word/document.xml');
        const targetedPatch = buildTargetedDocumentXmlPatch({
          baselineDocument,
          currentDocument,
          baselineDocumentXml: rawBaselineDocumentXml,
          candidateParagraphIds: editedParagraphIds,
        });
        if (targetedPatch) {
          diagnostics.targetedPatchUsed = true;
          diagnostics.targetedPatchChangedParagraphs = targetedPatch.changedParagraphIds.length;
          documentXmlForSave = targetedPatch.xml;
        } else {
          diagnostics.fallbackReason = 'targeted-patch-returned-null';
        }
      } catch (error) {
        diagnostics.fallbackReason =
          error instanceof Error
            ? `targeted-patch-error:${error.message}`
            : 'targeted-patch-error:unknown';
        console.warn(
          'Failed to build targeted document.xml patch, falling back to full document.xml serialization',
          error
        );
      }
    } else {
      diagnostics.fallbackReason = 'missing-baseline-buffer';
    }

    operations.push({
      type: 'set-xml',
      path: 'word/document.xml',
      xml: documentXmlForSave,
    });
  }

  const relationships = currentDocument.package.relationships;
  const baselineRelationships = baselineDocument.package.relationships;
  const seenParts = new Set<string>();
  const removedParts = new Set<string>();
  const removedRelationships = new Set<string>();
  const upsertedRelationships = new Set<string>();
  const ensuredContentTypeOverrides = new Set<string>();
  const usedRelationshipIds = collectUsedRelationshipIds({
    currentRelationships: relationships,
    baselineRelationships,
  });

  const appendHeaderFooterOps = (args: {
    kind: 'header' | 'footer';
    relationshipType: string;
    contentType: string;
    currentRefs: { rId: string }[] | undefined;
    currentMap: Map<string, HeaderFooter> | undefined;
    baselineRefs: { rId: string }[] | undefined;
    baselineMap: Map<string, HeaderFooter> | undefined;
  }): void => {
    const currentRefIds = new Set((args.currentRefs ?? []).map((ref) => ref.rId));
    const currentPartPaths = new Set<string>();
    const usedPartPaths = collectUsedPartPathsByRelationshipType({
      currentRelationships: relationships,
      baselineRelationships,
      relationshipType: args.relationshipType,
    });

    const currentEntries: Array<{
      rId: string;
      desiredTarget: string;
      partPath: string;
      headerFooter: HeaderFooter;
      baselineRelationship: Relationship | null;
      baselineHeaderFooter: HeaderFooter | null;
    }> = [];

    for (const ref of args.currentRefs ?? []) {
      const headerFooter = args.currentMap?.get(ref.rId);
      if (!headerFooter) {
        continue;
      }

      const currentRelationship = relationships?.get(ref.rId);
      const baselineRelationship = baselineRelationships?.get(ref.rId) ?? null;

      let desiredTarget: string;
      let partPath: string;
      if (currentRelationship && currentRelationship.targetMode !== 'External') {
        desiredTarget = currentRelationship.target;
        partPath = resolveRelativePath(DOCUMENT_RELS_PATH, desiredTarget);
      } else if (baselineRelationship && baselineRelationship.targetMode !== 'External') {
        desiredTarget = baselineRelationship.target;
        partPath = resolveRelativePath(DOCUMENT_RELS_PATH, desiredTarget);
      } else {
        partPath = allocateNextHeaderFooterPartPath(args.kind, usedPartPaths);
        desiredTarget = toDocumentRelationshipTarget(partPath);
      }

      currentPartPaths.add(partPath);
      currentEntries.push({
        rId: ref.rId,
        desiredTarget,
        partPath,
        headerFooter,
        baselineRelationship,
        baselineHeaderFooter: args.baselineMap?.get(ref.rId) ?? null,
      });
    }

    for (const entry of currentEntries) {
      const baselineRelationship = entry.baselineRelationship;
      const baselineHasInternalRelationship =
        !!baselineRelationship && baselineRelationship.targetMode !== 'External';
      const baselinePartPath = baselineHasInternalRelationship
        ? resolveRelativePath(DOCUMENT_RELS_PATH, baselineRelationship.target)
        : null;
      const relationshipNeedsUpsert =
        !baselineHasInternalRelationship || baselineRelationship.target !== entry.desiredTarget;

      if (relationshipNeedsUpsert && !upsertedRelationships.has(entry.rId)) {
        upsertedRelationships.add(entry.rId);
        operations.push({
          type: 'upsert-relationship',
          ownerPartPath: DOCUMENT_PART_PATH,
          id: entry.rId,
          relationshipType: args.relationshipType,
          target: entry.desiredTarget,
        });
      }

      if (!baselineHasInternalRelationship || baselinePartPath !== entry.partPath) {
        const normalizedPartName = toPartName(entry.partPath);
        if (!ensuredContentTypeOverrides.has(normalizedPartName)) {
          ensuredContentTypeOverrides.add(normalizedPartName);
          operations.push({
            type: 'ensure-content-type-override',
            partName: normalizedPartName,
            contentType: args.contentType,
          });
        }
      }

      if (seenParts.has(entry.partPath)) {
        continue;
      }
      seenParts.add(entry.partPath);

      const currentXml = serializeHeaderFooter(entry.headerFooter);
      if (
        entry.baselineHeaderFooter &&
        baselinePartPath === entry.partPath &&
        !relationshipNeedsUpsert
      ) {
        const baselineXml = serializeHeaderFooter(entry.baselineHeaderFooter);
        if (currentXml === baselineXml) {
          continue;
        }
      }

      operations.push({
        type: 'set-xml',
        path: entry.partPath,
        xml: currentXml,
      });
    }

    for (const baselineRef of args.baselineRefs ?? []) {
      if (currentRefIds.has(baselineRef.rId)) continue;

      const baselineRelationship = baselineRelationships?.get(baselineRef.rId);
      if (!baselineRelationship || baselineRelationship.targetMode === 'External') {
        continue;
      }

      if (!removedRelationships.has(baselineRef.rId)) {
        removedRelationships.add(baselineRef.rId);
        operations.push({
          type: 'remove-relationship',
          ownerPartPath: DOCUMENT_PART_PATH,
          id: baselineRef.rId,
          allowMissing: true,
        });
      }

      const baselinePartPath = resolveRelativePath(DOCUMENT_RELS_PATH, baselineRelationship.target);
      if (currentPartPaths.has(baselinePartPath) || removedParts.has(baselinePartPath)) {
        continue;
      }
      removedParts.add(baselinePartPath);

      operations.push({
        type: 'remove-part',
        path: baselinePartPath,
      });
      operations.push({
        type: 'remove-content-type-override',
        partName: toPartName(baselinePartPath),
        allowMissing: true,
      });
    }
  };

  appendHeaderFooterOps({
    kind: 'header',
    relationshipType: REL_TYPE_HEADER,
    contentType: CONTENT_TYPE_HEADER,
    currentRefs: collectAllSectionRefs(currentDocument, 'header'),
    currentMap: currentDocument.package.headers,
    baselineRefs: collectAllSectionRefs(baselineDocument, 'header'),
    baselineMap: baselineDocument.package.headers,
  });
  appendHeaderFooterOps({
    kind: 'footer',
    relationshipType: REL_TYPE_FOOTER,
    contentType: CONTENT_TYPE_FOOTER,
    currentRefs: collectAllSectionRefs(currentDocument, 'footer'),
    currentMap: currentDocument.package.footers,
    baselineRefs: collectAllSectionRefs(baselineDocument, 'footer'),
    baselineMap: baselineDocument.package.footers,
  });

  const appendNotesOps = async (args: {
    kind: 'footnote' | 'endnote';
    relationshipType: string;
    contentType: string;
    currentNotes: Footnote[] | Endnote[];
    baselineNotes: Footnote[] | Endnote[];
  }): Promise<void> => {
    const currentXml =
      args.kind === 'footnote'
        ? serializeFootnotes(args.currentNotes as Footnote[])
        : serializeEndnotes(args.currentNotes as Endnote[]);
    const baselineXml =
      args.kind === 'footnote'
        ? serializeFootnotes(args.baselineNotes as Footnote[])
        : serializeEndnotes(args.baselineNotes as Endnote[]);
    const currentRelationshipEntry = findRelationshipByType(relationships, args.relationshipType);
    const baselineRelationshipEntry = findRelationshipByType(
      baselineRelationships,
      args.relationshipType
    );
    const currentHasNotes = args.currentNotes.length > 0;
    const resolvedCurrentRelationship = (() => {
      if (
        currentRelationshipEntry &&
        currentRelationshipEntry.relationship.targetMode !== 'External'
      ) {
        return {
          rId: currentRelationshipEntry.rId,
          target: currentRelationshipEntry.relationship.target,
        };
      }
      if (!currentHasNotes) {
        return null;
      }
      if (
        baselineRelationshipEntry &&
        baselineRelationshipEntry.relationship.targetMode !== 'External'
      ) {
        return {
          rId: baselineRelationshipEntry.rId,
          target: baselineRelationshipEntry.relationship.target,
        };
      }

      const preferredRId = args.kind === 'footnote' ? 'rIdFootnotes' : 'rIdEndnotes';
      const defaultTarget = args.kind === 'footnote' ? 'footnotes.xml' : 'endnotes.xml';
      return {
        rId: allocateRelationshipId(preferredRId, usedRelationshipIds),
        target: defaultTarget,
      };
    })();

    if (!resolvedCurrentRelationship) {
      if (
        !baselineRelationshipEntry ||
        baselineRelationshipEntry.relationship.targetMode === 'External'
      ) {
        return;
      }

      if (!removedRelationships.has(baselineRelationshipEntry.rId)) {
        removedRelationships.add(baselineRelationshipEntry.rId);
        operations.push({
          type: 'remove-relationship',
          ownerPartPath: DOCUMENT_PART_PATH,
          id: baselineRelationshipEntry.rId,
          allowMissing: true,
        });
      }

      const baselinePartPath = resolveRelativePath(
        DOCUMENT_RELS_PATH,
        baselineRelationshipEntry.relationship.target
      );
      if (removedParts.has(baselinePartPath)) {
        return;
      }
      removedParts.add(baselinePartPath);

      operations.push({
        type: 'remove-part',
        path: baselinePartPath,
      });
      operations.push({
        type: 'remove-content-type-override',
        partName: toPartName(baselinePartPath),
        allowMissing: true,
      });
      return;
    }

    const currentPartPath = resolveRelativePath(
      DOCUMENT_RELS_PATH,
      resolvedCurrentRelationship.target
    );

    const baselineHasInternalRelationship =
      !!baselineRelationshipEntry &&
      baselineRelationshipEntry.relationship.targetMode !== 'External';
    const relationshipChanged =
      !baselineRelationshipEntry ||
      baselineRelationshipEntry.relationship.targetMode === 'External' ||
      baselineRelationshipEntry.rId !== resolvedCurrentRelationship.rId ||
      baselineRelationshipEntry.relationship.target !== resolvedCurrentRelationship.target;
    const baselinePartPath = baselineHasInternalRelationship
      ? resolveRelativePath(DOCUMENT_RELS_PATH, baselineRelationshipEntry.relationship.target)
      : null;
    const partPathChanged = baselinePartPath !== currentPartPath;

    if (relationshipChanged) {
      operations.push({
        type: 'upsert-relationship',
        ownerPartPath: DOCUMENT_PART_PATH,
        id: resolvedCurrentRelationship.rId,
        relationshipType: args.relationshipType,
        target: resolvedCurrentRelationship.target,
        targetMode: undefined,
      });

      if (
        baselineRelationshipEntry &&
        baselineRelationshipEntry.relationship.targetMode !== 'External' &&
        baselineRelationshipEntry.rId !== resolvedCurrentRelationship.rId &&
        !removedRelationships.has(baselineRelationshipEntry.rId)
      ) {
        removedRelationships.add(baselineRelationshipEntry.rId);
        operations.push({
          type: 'remove-relationship',
          ownerPartPath: DOCUMENT_PART_PATH,
          id: baselineRelationshipEntry.rId,
          allowMissing: true,
        });
      }

      if (baselinePartPath && partPathChanged && !removedParts.has(baselinePartPath)) {
        removedParts.add(baselinePartPath);
        operations.push({
          type: 'remove-part',
          path: baselinePartPath,
        });
        operations.push({
          type: 'remove-content-type-override',
          partName: toPartName(baselinePartPath),
          allowMissing: true,
        });
      }
    }

    if (!baselineHasInternalRelationship || partPathChanged) {
      operations.push({
        type: 'ensure-content-type-override',
        partName: toPartName(currentPartPath),
        contentType: args.contentType,
      });
    }

    if (seenParts.has(currentPartPath)) {
      return;
    }

    if (
      baselineRelationshipEntry &&
      baselineRelationshipEntry.relationship.targetMode !== 'External'
    ) {
      const baselinePartPathFromRelationship = resolveRelativePath(
        DOCUMENT_RELS_PATH,
        baselineRelationshipEntry.relationship.target
      );
      if (
        baselinePartPathFromRelationship === currentPartPath &&
        baselineXml === currentXml &&
        !relationshipChanged
      ) {
        return;
      }
    }

    let notesXmlForSave = currentXml;
    if (baselinePartPath && baselineBuffer) {
      try {
        const rawEditor = await getBaselineRawEditor();
        if (rawEditor?.hasPart(baselinePartPath)) {
          const rawBaselineNotesXml = await rawEditor.getXml(baselinePartPath);
          const targetedPatch = buildTargetedNotesXmlPatch({
            kind: args.kind,
            baselineNotes: args.baselineNotes,
            currentNotes: args.currentNotes,
            baselineNotesXml: rawBaselineNotesXml,
          });
          if (targetedPatch) {
            notesXmlForSave = targetedPatch.xml;
          }
        }
      } catch (error) {
        console.warn(
          `Failed to build targeted ${args.kind}s XML patch, falling back to full ${args.kind}s.xml serialization`,
          error
        );
      }
    }

    seenParts.add(currentPartPath);
    operations.push({
      type: 'set-xml',
      path: currentPartPath,
      xml: notesXmlForSave,
    });
  };

  await appendNotesOps({
    kind: 'footnote',
    relationshipType: REL_TYPE_FOOTNOTES,
    contentType: CONTENT_TYPE_FOOTNOTES,
    currentNotes: currentDocument.package.footnotes ?? [],
    baselineNotes: baselineDocument.package.footnotes ?? [],
  });
  await appendNotesOps({
    kind: 'endnote',
    relationshipType: REL_TYPE_ENDNOTES,
    contentType: CONTENT_TYPE_ENDNOTES,
    currentNotes: currentDocument.package.endnotes ?? [],
    baselineNotes: baselineDocument.package.endnotes ?? [],
  });

  return finalize();
}
