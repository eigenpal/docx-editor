import type {
  Body,
  DocxEditorRuntime,
  RequestContext,
  Paragraph,
  Range,
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
export interface WriterState {
  bytes?: Uint8Array;
  browserVersion?: string;
  paragraphs: Map<string, string>;
  inspected: Map<string, Set<number>>;
  completed: string[];
  /** The application checks the saved baseline before each progressive write. */
  beforeCommit?: () => Promise<void>;
  afterCommit?: () => Promise<void>;
}
const states = new WeakMap<DocxEditorRuntime, WriterState>();
export function stateFor(runtime: DocxEditorRuntime): WriterState {
  let state = states.get(runtime);
  if (!state) {
    state = { paragraphs: new Map(), inspected: new Map(), completed: [] };
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
export function invalidate(state: WriterState) {
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
  body: Body
): Promise<Map<string, Paragraph>> {
  const collection = body.paragraphs;
  collection.load('items');
  await context.sync();
  for (const p of collection.items) p.load(['uniqueLocalId', 'text']);
  await context.sync();
  return new Map(collection.items.map((p) => [p.uniqueLocalId, p]));
}
export function checkedParagraph(
  map: Map<string, Paragraph>,
  id: string,
  state: WriterState,
  story: Story
) {
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
  const map = await paragraphMap(context, body);
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
