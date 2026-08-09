// Display-text collection for `w:fldSimple` results.
//
// The outer simple field is one model unit; this module only decides what glyphs that unit
// paints. Allowlisted PAGE / NUMPAGES / SECTIONPAGES evaluate from a page context. Nested
// allowlisted page fields inside a non-page simple field (complex markers or another
// `w:fldSimple`) evaluate live too — concatenating their cached digits would stamp one sheet's
// number onto every page after detection had already requested a per-sheet context. Other
// nested field instructions stay inert.

import {
  fldSimpleInstr,
  hardBreakText,
  isFieldChrome,
  isFldSimple,
  type OoxmlNode,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';
import {
  allowlistedPageField,
  consumeScanNode,
  createFieldParseState,
  ingestInstrTextBounded,
  isCollectingInstruction,
  isFldChar,
  isInstrText,
  MAX_STORY_FIELD_SCAN_DEPTH,
  onFldCharBegin,
  onFldCharEnd,
  onFldCharSeparate,
  type AllowlistedPageField,
  type FieldScanBudget,
} from './field-instruction.ts';
import { projectPageFieldValue, type FieldPageContext } from './field-page-furniture.ts';
import { resolveRunStyle, type ResolvedRunStyle, type ThemeFonts } from './run-style.ts';
import {
  MAX_REVISION_DEPTH,
  isRevisionWrapper,
  revisionAttributionOf,
  revisionsAreDeletion,
  revisionsVisible,
  withRevision,
  type RevisionAttribution,
  type RevisionDisplayMode,
} from './revision-projection.ts';

/** Optional per-run merge of inherited + direct `rPr` (character styles, defaults). */
export type SimpleFieldRunCascader = (
  inherited: readonly OoxmlProperty[],
  direct: readonly OoxmlProperty[]
) => readonly OoxmlProperty[];

export interface SimpleFieldDisplay {
  readonly text: string;
  readonly resultProps: readonly OoxmlProperty[] | undefined;
  readonly resultStyle: ResolvedRunStyle | undefined;
}

function propertiesOfRunContainer(container: OoxmlNode | undefined): OoxmlProperty[] {
  if (!container || container.kind === 'textValue') return [];
  const props: OoxmlProperty[] = [];
  for (const child of container.children) {
    if (child.kind === 'textValue') continue;
    const attributes: Record<string, string> = {};
    for (const entry of child.attributes) attributes[entry.localName] = entry.value;
    props.push(
      Object.keys(attributes).length > 0
        ? { localName: child.localName, attributes }
        : { localName: child.localName }
    );
  }
  return props;
}

function runPropertiesOf(
  run: OoxmlNode,
  inherited: readonly OoxmlProperty[],
  cascadeRuns?: SimpleFieldRunCascader
): OoxmlProperty[] {
  const direct = propertiesOfRunContainer(
    run.kind === 'run' ? run.children.find((grand) => grand.kind === 'runProperties') : undefined
  );
  if (cascadeRuns) return [...cascadeRuns(inherited, direct)];
  return inherited.length === 0 ? direct : [...inherited, ...direct];
}

function modelTextOfRunChild(grand: OoxmlNode): string {
  if (grand.kind === 'text' || grand.kind === 'deletedText') {
    let text = '';
    for (const value of grand.children) if (value.kind === 'textValue') text += value.value;
    return text;
  }
  if (grand.kind === 'tab') return '\t';
  if (grand.kind === 'hardBreak') return hardBreakText(grand);
  return '';
}

/**
 * Collect the painted text/style for one `w:fldSimple`, evaluating nested allowlisted page
 * fields when a page context is supplied.
 *
 * Does not decide outer-field visibility or model offsets — the caller owns those.
 */
export function collectSimpleFieldDisplay(args: {
  readonly simple: OoxmlNode;
  readonly depth: number;
  readonly pageContext?: FieldPageContext;
  readonly budget: FieldScanBudget;
  readonly revisions: readonly RevisionAttribution[];
  readonly displayMode: RevisionDisplayMode;
  readonly inheritedRunProperties: readonly OoxmlProperty[];
  readonly cascadeRuns?: SimpleFieldRunCascader;
  readonly themeFonts?: ThemeFonts;
}): SimpleFieldDisplay {
  const {
    simple,
    depth,
    pageContext,
    budget,
    revisions,
    displayMode,
    inheritedRunProperties,
    cascadeRuns,
    themeFonts,
  } = args;

  let text = '';
  let resultProps: readonly OoxmlProperty[] | undefined;
  let resultStyle: ResolvedRunStyle | undefined;

  const nested = createFieldParseState();
  let liveNestedKind: AllowlistedPageField | null = null;
  let skipCachedNestedResult = false;
  let nestedResultSeen = false;
  let nestedResultVisible = false;

  const captureStyle = (props: readonly OoxmlProperty[], style: ResolvedRunStyle): void => {
    if (resultProps) return;
    resultProps = props;
    resultStyle = style;
  };

  const finishLiveNested = (): void => {
    if (!liveNestedKind || !pageContext) return;
    if (nestedResultSeen && !nestedResultVisible) return;
    text += projectPageFieldValue(liveNestedKind, pageContext);
  };

  const collect = (node: OoxmlNode, nodeDepth: number, local: readonly RevisionAttribution[]) => {
    if (node.kind === 'textValue' || nodeDepth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    for (const child of node.children) {
      if (child.kind === 'textValue') continue;
      if (!consumeScanNode(budget)) return;
      if (child.kind === 'run') {
        const props = runPropertiesOf(child, inheritedRunProperties, cascadeRuns);
        const style = resolveRunStyle(props, themeFonts);
        for (const grand of child.children) {
          if (grand.kind === 'runProperties') continue;

          if (isFldChar(grand, 'begin')) {
            onFldCharBegin(nested);
            if (nested.nesting === 1) {
              liveNestedKind = null;
              skipCachedNestedResult = false;
              nestedResultSeen = false;
              nestedResultVisible = false;
            }
            continue;
          }
          if (isInstrText(grand)) {
            if (isCollectingInstruction(nested)) {
              ingestInstrTextBounded(nested, grand, budget, nodeDepth + 1);
            }
            continue;
          }
          if (isFldChar(grand, 'separate')) {
            const kind = onFldCharSeparate(nested);
            if (kind && pageContext) {
              liveNestedKind = kind;
              skipCachedNestedResult = true;
              nestedResultSeen = false;
              nestedResultVisible = false;
            } else {
              liveNestedKind = null;
              skipCachedNestedResult = false;
            }
            continue;
          }
          if (isFldChar(grand, 'end')) {
            if (nested.nesting === 1 && skipCachedNestedResult) finishLiveNested();
            onFldCharEnd(nested);
            liveNestedKind = null;
            skipCachedNestedResult = false;
            nestedResultSeen = false;
            nestedResultVisible = false;
            continue;
          }

          if (isFieldChrome(grand)) continue;

          const value = modelTextOfRunChild(grand);
          if (value.length === 0) continue;
          const deleted = revisionsAreDeletion(local);
          const suppressed =
            style.hidden ||
            !revisionsVisible(local, displayMode) ||
            (grand.kind === 'deletedText' && !deleted);
          if (skipCachedNestedResult) {
            nestedResultSeen = true;
            if (!suppressed) {
              nestedResultVisible = true;
              captureStyle(props, style);
            }
            continue;
          }
          if (suppressed) continue;
          captureStyle(props, style);
          text += value;
        }
        continue;
      }
      if (isFldSimple(child)) {
        const nestedKind = allowlistedPageField(fldSimpleInstr(child) ?? '');
        if (nestedKind && pageContext) {
          if (!revisionsVisible(local, displayMode)) continue;
          const beforeLen = text.length;
          collect(child, nodeDepth + 1, local);
          text = text.slice(0, beforeLen);
          text += projectPageFieldValue(nestedKind, pageContext);
          continue;
        }
        collect(child, nodeDepth + 1, local);
        continue;
      }
      if (child.kind === 'hyperlink') {
        collect(child, nodeDepth + 1, local);
        continue;
      }
      if (isRevisionWrapper(child) && local.length < MAX_REVISION_DEPTH) {
        const attribution = revisionAttributionOf(child);
        collect(child, nodeDepth + 1, attribution ? withRevision(local, attribution) : local);
        continue;
      }
      collect(child, nodeDepth + 1, local);
    }
  };

  collect(simple, depth, revisions);
  if (skipCachedNestedResult) {
    liveNestedKind = null;
    skipCachedNestedResult = false;
  }

  return { text, resultProps, resultStyle };
}
