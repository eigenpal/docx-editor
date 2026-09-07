// Run-child model text and run-property collection, shared by the field walks.
//
// `piecesOfParagraph` and the `w:fldSimple` display collector both flatten runs and must
// agree, character for character, with `paragraphTextOf` about what a run child is worth —
// a disagreement is an offset bug. Keeping the vocabulary in one module keeps them agreeing
// by construction.

import { hardBreakText, type OoxmlNode, type OoxmlProperty } from '@docx-editor.dev/core/store';
import { runTextOutlineProperty } from './run-text-outline.ts';

/** Optional per-run merge of inherited + direct `rPr` (character styles, defaults). */
export type RunPropertyCascader = (
  inherited: readonly OoxmlProperty[],
  direct: readonly OoxmlProperty[]
) => readonly OoxmlProperty[];

/** Model text contributed by one typed run child (same vocabulary as `paragraphTextOf`). */
export function modelTextOfRunChild(grand: OoxmlNode): string {
  // `w:delText` holds real characters at a real position, so it counts in the model offset
  // space exactly like `w:t`. Whether it is LAID OUT is a separate question, answered by the
  // enclosing revision and the display mode.
  if (grand.kind === 'text' || grand.kind === 'deletedText') {
    let text = '';
    for (const value of grand.children) if (value.kind === 'textValue') text += value.value;
    return text;
  }
  if (grand.kind === 'tab') return '\t';
  if (grand.kind === 'hardBreak') return hardBreakText(grand);
  return '';
}

export function propertiesOfRunContainer(container: OoxmlNode | undefined): OoxmlProperty[] {
  if (!container || container.kind === 'textValue') return [];
  const props: OoxmlProperty[] = [];
  for (const child of container.children) {
    if (child.kind === 'textValue') continue;
    if (child.localName === 'textOutline') {
      const outline = runTextOutlineProperty(child);
      if (outline) props.push(outline);
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const entry of child.attributes) attributes[entry.localName] = entry.value;
    const hasAttributes = Object.keys(attributes).length > 0;
    if (child.localName === 'rPrChange' || child.localName === 'pPrChange') {
      const revisionProperty: OoxmlProperty & { readonly revisionNodeId: string } = hasAttributes
        ? { localName: child.localName, attributes, revisionNodeId: child.id }
        : { localName: child.localName, revisionNodeId: child.id };
      props.push(revisionProperty);
      continue;
    }
    props.push(
      hasAttributes ? { localName: child.localName, attributes } : { localName: child.localName }
    );
  }
  return props;
}

export function runPropertiesOf(
  run: OoxmlNode,
  inherited: readonly OoxmlProperty[],
  cascadeRuns?: RunPropertyCascader
): OoxmlProperty[] {
  const direct = propertiesOfRunContainer(
    run.kind === 'run' ? run.children.find((grand) => grand.kind === 'runProperties') : undefined
  );
  if (cascadeRuns) return [...cascadeRuns(inherited, direct)];
  return inherited.length === 0 ? direct : [...inherited, ...direct];
}
