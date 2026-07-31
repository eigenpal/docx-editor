/**
 * OOXML highlight color name <-> hex mapping. Used by both adapter
 * toolbars when serialising highlight selections to the
 * `w:highlight` attribute (which only accepts named colors).
 *
 * Lifted from packages/react/src/components/toolbarUtils.ts so both
 * sides share the same canonical table.
 * @packageDocumentation
 * @public
 */

export const HIGHLIGHT_HEX_TO_NAME: Record<string, string> = {
  FFFF00: 'yellow',
  '00FF00': 'green',
  '00FFFF': 'cyan',
  FF00FF: 'magenta',
  '0000FF': 'blue',
  FF0000: 'red',
  '00008B': 'darkBlue',
  '008080': 'darkCyan',
  '008000': 'darkGreen',
  '800080': 'darkMagenta',
  '8B0000': 'darkRed',
  '808000': 'darkYellow',
  '808080': 'darkGray',
  C0C0C0: 'lightGray',
  '000000': 'black',
  FFFFFF: 'white',
};

export function mapHexToHighlightName(hex: string): string | null {
  const normalized = hex.replace(/^#/, '').toUpperCase();
  return HIGHLIGHT_HEX_TO_NAME[normalized] || null;
}
