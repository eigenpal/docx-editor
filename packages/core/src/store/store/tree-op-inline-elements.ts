import { isValidXmlText } from '../package/sinks.ts';
import { hardBreakAttributes } from '../package/hard-break.ts';
import { NON_BREAKING_HYPHEN_TEXT, OPTIONAL_HYPHEN_TEXT } from '../package/hyphen-text.ts';
import { WML_NAMESPACE_URI, type OoxmlNode } from '../package/ooxml-tree.ts';

/**
 * A `w:t`, or a `w:delText` when the text being rebuilt was already struck.
 *
 * SPLITTING a run must not change what the run is. This built a `w:t` unconditionally, so
 * every ordinary gesture that splits a run inside a `w:del` — commenting on struck text,
 * bolding across it — silently re-labelled the deletion as live text (§17.3.3.7 requires
 * `w:delText` there), and the damage only showed when the file reached Word.
 */
export function textElement(
  nextId: () => string,
  text: string,
  kind: 'text' | 'deletedText' = 'text'
): OoxmlNode {
  const valueId = nextId();
  return {
    id: nextId(),
    kind,
    namespaceUri: WML_NAMESPACE_URI,
    localName: kind === 'deletedText' ? 'delText' : 't',
    prefix: 'w',
    namespaceBindings: [],
    // `xml:space="preserve"` is not added here: the serializer owns lexical form, and a
    // leading/trailing space is preserved by the tree regardless of the attribute.
    attributes: [],
    children: [{ id: valueId, kind: 'textValue', value: text }],
  } as unknown as OoxmlNode;
}

export function simpleElement(
  nextId: () => string,
  localName: 'tab' | 'br',
  breakKind: 'line' | 'page' = 'line'
): OoxmlNode {
  return {
    id: nextId(),
    kind: localName === 'tab' ? 'tab' : 'hardBreak',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: localName === 'br' ? [...hardBreakAttributes(breakKind)] : [],
    children: [],
  } as unknown as OoxmlNode;
}

const HYPHEN_CHARACTERS = /[\u001e\u001f]/;
const ALL_HYPHEN_CHARACTERS = /[\u001e\u001f]/g;

/** Most hyphen elements one inserted text may create, so a string cannot mint a node flood. */
export const MAX_INSERTED_HYPHENS = 4096;

/** Whether inserted text holds a character that becomes a hyphen element. */
export function holdsHyphenCharacter(text: string): boolean {
  return HYPHEN_CHARACTERS.test(text);
}

/**
 * Whether text can be inserted as run content: valid XML text, except that U+001E and U+001F
 * are allowed, up to {@link MAX_INSERTED_HYPHENS}, because they become hyphen elements.
 */
export function isInsertableText(text: string): boolean {
  return areInsertableTexts([text]);
}

/**
 * {@link isInsertableText} for texts one operation writes together: the hyphen cap covers them
 * all. Each piece between hyphens must be valid on its own, since each becomes its own `w:t`,
 * so a hyphen cannot split a surrogate pair.
 */
export function areInsertableTexts(texts: readonly string[]): boolean {
  let hyphens = 0;
  for (const text of texts) {
    if (!holdsHyphenCharacter(text)) {
      if (!isValidXmlText(text)) return false;
      continue;
    }
    hyphens += text.match(ALL_HYPHEN_CHARACTERS)?.length ?? 0;
    if (hyphens > MAX_INSERTED_HYPHENS) return false;
    if (!text.split(ALL_HYPHEN_CHARACTERS).every((piece) => isValidXmlText(piece))) return false;
  }
  return true;
}

/** A builder for one inserted run child. */
export type RunChildBuilder = (nextId: () => string) => OoxmlNode;

function hyphenElement(nextId: () => string, char: string): OoxmlNode {
  return {
    id: nextId(),
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName: char === NON_BREAKING_HYPHEN_TEXT ? 'noBreakHyphen' : 'softHyphen',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [],
  } as unknown as OoxmlNode;
}

/**
 * Run content for inserted text: `w:t` for the text, and `w:noBreakHyphen` or `w:softHyphen`
 * for each U+001E or U+001F, the characters a text read reports for those elements.
 */
export function textWithHyphenBuilders(text: string): RunChildBuilder[] {
  if (!holdsHyphenCharacter(text)) return [(nextId) => textElement(nextId, text)];
  const builders: RunChildBuilder[] = [];
  let from = 0;
  for (let index = 0; index <= text.length; index += 1) {
    const char = text[index];
    const end = index === text.length;
    if (!end && char !== NON_BREAKING_HYPHEN_TEXT && char !== OPTIONAL_HYPHEN_TEXT) continue;
    if (index > from) {
      const piece = text.slice(from, index);
      builders.push((nextId) => textElement(nextId, piece));
    }
    if (!end) builders.push((nextId) => hyphenElement(nextId, char!));
    from = index + 1;
  }
  return builders;
}

/** The nodes {@link textWithHyphenBuilders} describes, minted in order. */
export function textWithHyphens(nextId: () => string, text: string): OoxmlNode[] {
  return textWithHyphenBuilders(text).map((build) => build(nextId));
}
