// Shared header/footer assembly for every semantic-layout host.

import {
  resolveRelationship,
  type HeadlessDocumentView,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import { layoutHeaderFooterStory } from './hf-layout.ts';
import { type HeaderFooterVariantName, type PageFurniture } from './page-furniture-insets.ts';
import { enumerateDocumentSections, geometryOfSection } from './section-properties.ts';
import type { NumberingIndex } from './numbering-index.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import type { PendingLine } from './pending-line.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** Page furniture supplied to semantic layout. @public */
export interface DocumentFurnitureSource {
  furniture(): PageFurniture | undefined;
  sectionFurniture(): readonly (PageFurniture | undefined)[];
}

/** Inputs that remain valid for the lifetime of one furniture source. @public */
export interface CreateDocumentFurnitureSourceOptions {
  readonly view: HeadlessDocumentView;
  readonly measurer: TextMeasurer;
  readonly producer: string;
  readonly cache: ParagraphLayoutCache<readonly PendingLine[]>;
  readonly styleCascade?: () => StyleCascadeTable | undefined;
  readonly numberingIndex?: () => NumberingIndex;
  readonly defaultTabStopPt?: number;
  readonly displayMode?: RevisionDisplayMode;
  readonly inlineDrawingLayoutForPart?: (
    partName: string
  ) => InlineDrawingLayoutContext | undefined;
  readonly drawingLayoutTokenForPart?: (partName: string) => string;
  readonly drawingTokenForParagraphForPart?: (partName: string, paragraph: OoxmlNode) => string;
  readonly projectLinkForPart?: (
    partName: string
  ) => import('./field-pieces.ts').HyperlinkProjector | undefined;
  readonly projectFieldLink?: import('./field-pieces.ts').FieldLinkProjector;
}

const HEADER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

function headerFooterRIdIndex(view: HeadlessDocumentView): Map<string, string> {
  const pkg = view.currentPackage();
  const index = new Map<string, string>();
  for (const record of pkg.relationships.get(pkg.mainDocumentPart) ?? []) {
    if (record.type !== HEADER_REL && record.type !== FOOTER_REL) continue;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) continue;
    if (!index.has(resolved.target.partName)) index.set(resolved.target.partName, record.id);
  }
  return index;
}

function stampStoryRId(
  story: ReturnType<typeof layoutHeaderFooterStory>,
  rId: string
): ReturnType<typeof layoutHeaderFooterStory> {
  if (story.rId === rId) return story;
  return {
    ...story,
    rId,
    withPageContext: (context) => stampStoryRId(story.withPageContext(context), rId),
  };
}

/** Build section-aware header/footer layout from a neutral document view. @public */
export function createDocumentFurnitureSource(
  options: CreateDocumentFurnitureSourceOptions
): DocumentFurnitureSource {
  const {
    view,
    measurer,
    producer,
    cache,
    styleCascade,
    numberingIndex,
    defaultTabStopPt,
    displayMode,
    inlineDrawingLayoutForPart,
    drawingLayoutTokenForPart,
    drawingTokenForParagraphForPart,
    projectLinkForPart,
    projectFieldLink,
  } = options;

  const memo = new WeakMap<
    object,
    {
      width: number;
      pageHeight: number;
      marginTop: number;
      marginBottom: number;
      marginLeft: number;
      marginRight: number;
      producer: string;
      drawingLayoutToken: string;
      linkRelsEpoch: string;
      numberingIndex: NumberingIndex | undefined;
      styleCascade: StyleCascadeTable | undefined;
      story: ReturnType<typeof layoutHeaderFooterStory>;
    }
  >();
  let rIds = new Map<string, string>();
  let rIdRevision = -1;

  const rIdOf = (partName: string): string | undefined => {
    if (rIdRevision !== view.packageRevision()) {
      rIdRevision = view.packageRevision();
      rIds = headerFooterRIdIndex(view);
    }
    return rIds.get(partName);
  };

  const storyOf = (
    part: OoxmlPart,
    width: number,
    geometry: ReturnType<typeof geometryOfSection>
  ): ReturnType<typeof layoutHeaderFooterStory> => {
    const drawingLayoutToken = drawingLayoutTokenForPart?.(part.name) ?? '';
    const pkg = view.currentPackage();
    const linkRelsEpoch = [
      ...(pkg.relationships.get(part.name) ?? []).map(
        (record) => `${record.id}>${record.rawTarget}|${record.targetMode}`
      ),
      ...pkg.externalTargets
        .filter((record) => record.ownerPart === part.name)
        .map((record) => `${record.id}>${record.rawTarget}|${record.sinkSafe ? 1 : 0}`),
    ].join(';');
    const numbering = numberingIndex?.();
    const styles = styleCascade?.();
    const projectLink = projectLinkForPart?.(part.name);
    const cached = memo.get(part);
    if (
      cached &&
      cached.width === width &&
      cached.pageHeight === geometry.height &&
      cached.marginTop === geometry.margin.top &&
      cached.marginBottom === geometry.margin.bottom &&
      cached.marginLeft === geometry.margin.left &&
      cached.marginRight === geometry.margin.right &&
      cached.producer === producer &&
      cached.drawingLayoutToken === drawingLayoutToken &&
      cached.linkRelsEpoch === linkRelsEpoch &&
      cached.numberingIndex === numbering &&
      cached.styleCascade === styles
    ) {
      return cached.story;
    }

    const baseline = layoutHeaderFooterStory(
      part,
      width,
      measurer,
      producer,
      cache,
      styles,
      undefined,
      undefined,
      defaultTabStopPt,
      displayMode,
      inlineDrawingLayoutForPart?.(part.name),
      drawingTokenForParagraphForPart
        ? (paragraph) => drawingTokenForParagraphForPart(part.name, paragraph)
        : undefined,
      undefined,
      {
        pageNumber: 1,
        pageWidth: geometry.width,
        pageHeight: geometry.height,
        marginLeft: geometry.margin.left,
        marginRight: geometry.margin.right,
        marginTop: geometry.margin.top,
        marginBottom: geometry.margin.bottom,
      },
      view.documentProperties(),
      {
        ...(numbering ? { numberingIndex: numbering } : {}),
        ...(projectLink ? { projectLink } : {}),
        ...(projectFieldLink ? { projectFieldLink } : {}),
      }
    );
    const rId = rIdOf(part.name);
    const story = rId ? stampStoryRId(baseline, rId) : baseline;
    memo.set(part, {
      width,
      pageHeight: geometry.height,
      marginTop: geometry.margin.top,
      marginBottom: geometry.margin.bottom,
      marginLeft: geometry.margin.left,
      marginRight: geometry.margin.right,
      producer,
      drawingLayoutToken,
      linkRelsEpoch,
      numberingIndex: numbering,
      styleCascade: styles,
      story,
    });
    return story;
  };

  const furnitureFromParts = (
    parts: ReturnType<HeadlessDocumentView['headerFooterPartsBySection']>[number] | undefined,
    geometry: ReturnType<typeof geometryOfSection>
  ): PageFurniture | undefined => {
    if (!parts || (parts.headers.size === 0 && parts.footers.size === 0)) return undefined;
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const map = (source: ReadonlyMap<HeaderFooterVariantName, OoxmlPart>) => {
      const stories = new Map<
        HeaderFooterVariantName,
        ReturnType<typeof layoutHeaderFooterStory>
      >();
      for (const [variant, part] of source) stories.set(variant, storyOf(part, width, geometry));
      return stories;
    };
    return {
      titlePage: parts.titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: map(parts.headers),
      footers: map(parts.footers),
    };
  };

  const sectionFurniture = (): readonly (PageFurniture | undefined)[] => {
    const sections = enumerateDocumentSections(view.part(), displayMode);
    const bySection = view.headerFooterPartsBySection();
    return sections.map((section, index) =>
      furnitureFromParts(bySection[index], geometryOfSection(section.properties))
    );
  };

  return {
    sectionFurniture,
    furniture() {
      const all = sectionFurniture();
      return all[all.length - 1];
    },
  };
}
