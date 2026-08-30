// Shared footnote/endnote assembly for browser and headless layout.

import {
  relationshipTargetIn,
  type HeadlessDocumentView,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  authoredDocumentEndnoteProperties,
  authoredDocumentFootnoteProperties,
  authoredEndnotePropertiesFromSectPr,
  authoredFootnotePropertiesFromSectPr,
  resolveEndnoteProperties,
  resolveFootnoteProperties,
  settingsPartOf,
} from '../store/package/note-properties.ts';
import { collectNoteReferences, resolveNotesPart } from '../store/package/note-references.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import { layoutHeaderFooterStory } from './hf-layout.ts';
import { enumerateDocumentSectionsBounded } from './section-properties.ts';
import type { NotesLayoutInput } from './note-pagination.ts';
import { paragraphSectionNode } from './section-properties.ts';
import { storyBlocks } from './story-roots.ts';
import type { NumberingIndex } from './numbering-index.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';

/** Inputs for projecting notes through the same semantic layout pass. @public */
export interface CreateDocumentNotesInputOptions {
  readonly view: HeadlessDocumentView;
  readonly measurer: TextMeasurer;
  readonly producer: string;
  readonly cache: Parameters<typeof layoutHeaderFooterStory>[4];
  readonly styleCascade?: () => StyleCascadeTable | undefined;
  readonly numberingIndex?: () => NumberingIndex;
  readonly defaultTabStopPt?: number;
  readonly inlineDrawingLayoutForPart?: (
    partName: string
  ) => InlineDrawingLayoutContext | undefined;
  readonly drawingTokenForParagraphForPart?: (partName: string, paragraph: OoxmlNode) => string;
  readonly drawingLayoutEpochForPart?: (partName: string) => string;
  readonly projectLinkForPart?: NotesLayoutInput['projectLinkForPart'];
  readonly projectFieldLink?: NotesLayoutInput['projectFieldLink'];
  readonly displayMode?: RevisionDisplayMode;
}

function sectionPropertyNodes(
  part: OoxmlPart,
  sections: ReturnType<typeof enumerateDocumentSectionsBounded>['sections'],
  truncated: boolean,
  displayMode?: RevisionDisplayMode
): readonly (OoxmlElement | undefined)[] {
  const blocks = storyBlocks(part, displayMode);
  if (!truncated) {
    return sections.map((section) => {
      if (section.blockStart === section.blockEndExclusive) return undefined;
      const block = blocks[section.blockEndExclusive - 1];
      return block?.kind === 'paragraph' ? paragraphSectionNode(block) : undefined;
    });
  }
  const nodes: (OoxmlElement | undefined)[] = [];
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue;
    const section = paragraphSectionNode(block);
    if (section) nodes.push(section);
  }
  while (nodes.length < sections.length) nodes.push(undefined);
  return nodes;
}

function relationshipEpoch(view: HeadlessDocumentView, partName: string): string {
  const pkg = view.currentPackage();
  const internal = (pkg.relationships.get(partName) ?? [])
    .map((record) => `${record.id}>${record.rawTarget}`)
    .join(',');
  const external = pkg.externalTargets
    .filter((record) => record.ownerPart === partName)
    .map((record) => `${record.id}>${record.rawTarget}|${record.sinkSafe ? 1 : 0}`)
    .join(',');
  return `${internal};${external}`;
}

/** Build note layout input from the neutral package view, or undefined when unused. @public */
export function createDocumentNotesInput(
  options: CreateDocumentNotesInputOptions
): NotesLayoutInput | undefined {
  const pkg = options.view.currentPackage();
  const footnotesPart = resolveNotesPart(pkg, 'footnote');
  const endnotesPart = resolveNotesPart(pkg, 'endnote');
  if (!footnotesPart && !endnotesPart) return undefined;
  const body = options.view.part();
  if (collectNoteReferences(body).length === 0) return undefined;

  const settings = settingsPartOf(pkg);
  const footnoteAuthored = authoredDocumentFootnoteProperties(settings);
  const endnoteAuthored = authoredDocumentEndnoteProperties(settings);
  const documentFootnoteProps = resolveFootnoteProperties(undefined, footnoteAuthored);
  const documentEndnoteProps = resolveEndnoteProperties(undefined, endnoteAuthored);
  const enumeration = enumerateDocumentSectionsBounded(body, options.displayMode);
  const sectionNodes = sectionPropertyNodes(
    body,
    enumeration.sections,
    enumeration.truncated,
    options.displayMode
  );
  const footnotePropsBySection = enumeration.sections.map((_, index) =>
    resolveFootnoteProperties(
      authoredFootnotePropertiesFromSectPr(sectionNodes[index]),
      footnoteAuthored
    )
  );
  const endnotePropsBySection = enumeration.sections.map((_, index) =>
    resolveEndnoteProperties(
      authoredEndnotePropertiesFromSectPr(sectionNodes[index]),
      endnoteAuthored
    )
  );

  const drawingsForPart = options.inlineDrawingLayoutForPart
    ? (partName: string) => {
        const inlineDrawingLayout = options.inlineDrawingLayoutForPart!(partName);
        if (!inlineDrawingLayout) return undefined;
        return {
          inlineDrawingLayout,
          ...(options.drawingTokenForParagraphForPart
            ? {
                drawingTokenForParagraph: (paragraph: OoxmlNode) =>
                  options.drawingTokenForParagraphForPart!(partName, paragraph),
              }
            : {}),
        };
      }
    : undefined;

  const noteParts = [footnotesPart, endnotesPart];
  return {
    footnotesPart,
    endnotesPart,
    footnotePropsBySection:
      footnotePropsBySection.length > 0 ? footnotePropsBySection : [documentFootnoteProps],
    endnotePropsBySection:
      endnotePropsBySection.length > 0 ? endnotePropsBySection : [documentEndnoteProps],
    documentFootnoteProps,
    documentEndnoteProps,
    measurer: options.measurer,
    producer: options.producer,
    cache: options.cache,
    styleCascade: options.styleCascade?.(),
    numberingIndex: options.numberingIndex?.(),
    defaultTabStopPt: options.defaultTabStopPt,
    displayMode: options.displayMode,
    ...(options.projectLinkForPart
      ? {
          projectLinkForPart: options.projectLinkForPart,
          linkRelsEpoch: noteParts
            .map((part) => (part ? relationshipEpoch(options.view, part.name) : ''))
            .join('\0'),
        }
      : {}),
    ...(options.projectFieldLink ? { projectFieldLink: options.projectFieldLink } : {}),
    ...(drawingsForPart ? { drawingsForPart } : {}),
    ...(drawingsForPart && options.drawingLayoutEpochForPart
      ? {
          drawingLayoutEpoch: noteParts
            .map((part) => (part ? options.drawingLayoutEpochForPart!(part.name) : ''))
            .join('\0'),
        }
      : {}),
  };
}

/** Resolve a relationship in a non-body story for shared link projection. @public */
export function documentRelationshipTargetIn(
  view: HeadlessDocumentView,
  partName: string,
  relationshipId: string
): ReturnType<typeof relationshipTargetIn> {
  return relationshipTargetIn(view.currentPackage(), partName, relationshipId);
}
