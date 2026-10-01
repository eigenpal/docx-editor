import type {
  Body,
  DocxEditorRuntime,
  RequestContext,
  Paragraph,
  Range,
  ParagraphCollection,
} from '@docx-editor.dev/editor-api';
import type { Story, Target } from './editing-schemas';

export class WriterError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
type ParagraphLocator =
  | { kind: 'paragraph'; index: number }
  | { kind: 'cell'; table: number; row: number; column: number; index: number }
  | { kind: 'list'; list: number; index: number };
interface InspectedParagraph {
  story: string;
  kind: Story['kind'];
  locator: ParagraphLocator;
}
export interface WriterState {
  bytes?: Uint8Array;
  browserVersion?: string;
  paragraphs: Map<string, string>;
  inspected: Map<string, Set<number>>;
  completed: string[];
  transientTargets: Map<string, InspectedParagraph>;
  nextTarget: number;
  /** The application checks the saved baseline before each progressive write. */
  beforeCommit?: () => Promise<void>;
  afterCommit?: () => Promise<void>;
}
const states = new WeakMap<DocxEditorRuntime, WriterState>();
export function stateFor(runtime: DocxEditorRuntime): WriterState {
  let state = states.get(runtime);
  if (!state) {
    state = {
      paragraphs: new Map(),
      inspected: new Map(),
      completed: [],
      transientTargets: new Map(),
      nextTarget: 0,
    };
    states.set(runtime, state);
  }
  return state;
}
export const bodyStory: Story = { kind: 'body', section: 0, variant: 'Primary' };
export function storyKey(story: Story) {
  return JSON.stringify(story);
}
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
/** Inspection tokens name public collection positions, never document internals. */
export function rememberParagraph(
  state: WriterState,
  story: Story,
  paragraph: Paragraph,
  locator: ParagraphLocator
): string {
  const storedId = paragraph.uniqueLocalId;
  const transient = !storedId || storedId.startsWith('@writer:');
  const key = storyKey(story);
  const location = JSON.stringify(locator);
  const previous = transient
    ? [...state.transientTargets].find(
        ([id, target]) =>
          target.story === key &&
          JSON.stringify(target.locator) === location &&
          state.paragraphs.get(`${key}:${id}`) === paragraph.text
      )?.[0]
    : undefined;
  const id = transient ? (previous ?? `@writer:${++state.nextTarget}`) : storedId;
  if (transient) state.transientTargets.set(id, { story: key, kind: story.kind, locator });
  state.paragraphs.set(`${storyKey(story)}:${id}`, paragraph.text);
  return id;
}
export function forgetTransientTargets(state: WriterState, kind?: 'header' | 'footer') {
  for (const [id, target] of state.transientTargets) {
    if (kind && target.kind !== kind) continue;
    state.paragraphs.delete(`${target.story}:${id}`);
    state.transientTargets.delete(id);
  }
}

export function invalidate(state: WriterState) {
  forgetTransientTargets(state);
  state.paragraphs.clear();
  state.inspected.clear();
}
export async function bodyFor(context: RequestContext, story: Story): Promise<Body> {
  if (story.kind === 'body') return context.document.body;
  const sections = context.document.sections;
  sections.load('items');
  await context.sync();
  const section = sections.items[story.section];
  if (!section) throw new WriterError('ItemNotFound', 'The section does not exist.');
  const body =
    story.kind === 'header' ? section.getHeader(story.variant) : section.getFooter(story.variant);
  body.load('text');
  await context.sync();
  return body;
}
export async function paragraphMap(
  context: RequestContext,
  body: Body,
  state?: WriterState,
  story?: Story
): Promise<Map<string, Paragraph>> {
  const collection = body.paragraphs;
  collection.load('items');
  await context.sync();
  for (const p of collection.items) p.load(['uniqueLocalId', 'text']);
  await context.sync();
  const counts = new Map<string, number>();
  for (const p of collection.items)
    counts.set(p.uniqueLocalId, (counts.get(p.uniqueLocalId) ?? 0) + 1);
  const map = new Map(
    collection.items
      .filter(
        (p) =>
          p.uniqueLocalId &&
          !p.uniqueLocalId.startsWith('@writer:') &&
          counts.get(p.uniqueLocalId) === 1
      )
      .map((p) => [p.uniqueLocalId, p])
  );
  if (!state || !story) return map;
  const targets = [...state.transientTargets].filter(
    ([, target]) => target.story === storyKey(story)
  );
  if (!targets.length) return map;
  const tables = body.tables;
  const lists = body.lists;
  const needsTables = targets.some(([, target]) => target.locator.kind === 'cell');
  const needsLists = targets.some(([, target]) => target.locator.kind === 'list');
  if (needsTables) tables.load('items');
  if (needsLists) lists.load('items');
  if (needsTables || needsLists) await context.sync();
  const collections = new Map<string, ParagraphCollection>();
  for (const [id, { locator }] of targets) {
    let paragraphs: ParagraphCollection | undefined;
    if (locator.kind === 'cell') {
      paragraphs = tables.items[locator.table]?.getCell(locator.row, locator.column).body
        .paragraphs;
    } else if (locator.kind === 'list') {
      paragraphs = lists.items[locator.list]?.paragraphs;
    }
    if (paragraphs) {
      paragraphs.load('items');
      collections.set(id, paragraphs);
    }
  }
  if (collections.size) await context.sync();
  for (const [id, { locator }] of targets) {
    const paragraphs = locator.kind === 'paragraph' ? collection : collections.get(id);
    const paragraph = paragraphs?.items[locator.index];
    if (paragraph) {
      paragraph.load(['uniqueLocalId', 'text']);
      map.set(id, paragraph);
    }
  }
  await context.sync();
  return map;
}
export function checkedParagraph(
  map: Map<string, Paragraph>,
  id: string,
  state: WriterState,
  story: Story
) {
  if (id.startsWith('@writer:') && !state.transientTargets.has(id))
    throw new WriterError(
      'StaleDocument',
      'The inspection target expired. Inspect the paragraph again.'
    );
  const p = map.get(id);
  if (!p)
    throw new WriterError(
      'ItemNotFound',
      'The paragraph no longer exists. Read the document again.'
    );
  const expected = state.paragraphs.get(`${storyKey(story)}:${id}`);
  if (expected === undefined || expected !== p.text)
    throw new WriterError(
      'StaleDocument',
      `Inspect paragraphs in this story before editing paragraph ${id}. Copy its current ID and exact text.`
    );
  return p;
}
export async function resolveTargets(
  context: RequestContext,
  body: Body,
  targets: readonly Target[],
  state: WriterState,
  story: Story
): Promise<{ paragraph: Paragraph; range: Range }[]> {
  const map = await paragraphMap(context, body, state, story);
  const result = targets.map((target) => {
    const paragraph = checkedParagraph(map, target.paragraphId, state, story);
    return { paragraph, range: paragraph.getRange('Content') };
  });
  await context.sync();
  const searches = result.map((item, i) => {
    if (!targets[i]!.search) return undefined;
    const matches = item.range.search(targets[i]!.search!, { matchCase: true });
    matches.load('items');
    return matches;
  });
  if (searches.some(Boolean)) await context.sync();
  return result.map((item, i) => {
    const matches = searches[i];
    if (!matches) return item;
    if (matches.items.length !== 1)
      throw new WriterError(
        'AmbiguousTarget',
        'The exact phrase must match once in the paragraph.'
      );
    return { paragraph: item.paragraph, range: matches.items[0]! };
  });
}
export function requireInspected(state: WriterState, story: Story, area: string, index: number) {
  if (!state.inspected.get(`${storyKey(story)}:${area}`)?.has(index))
    throw new WriterError('StaleDocument', `Inspect ${area} before editing this object.`);
}
export async function commit(context: RequestContext, state: WriterState, label: string) {
  await state.beforeCommit?.();
  await context.sync();
  state.completed.push(label);
  await state.afterCommit?.();
}

/** Tool providers can preserve optional keys with undefined values. Those are not writes. */
export function assignDefined(target: object, properties: object) {
  Object.assign(
    target,
    Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined))
  );
}
