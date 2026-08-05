import type { Hyperlink, Run, RunContent } from './types.ts';

export function getRunText(run: Run): string {
  return run.content
    .map((item) => {
      if (item.type === 'text') return item.text;
      if (item.type === 'tab') return '\t';
      if (item.type === 'break') return item.breakType === 'page' ? '\f' : '\n';
      return '';
    })
    .join('');
}

export function getHyperlinkText(link: Hyperlink): string {
  return link.children.map((run) => getRunText(run)).join('');
}

const HEADING_STYLE = /^Heading(\d+)$/i;

export function isHeadingStyle(styleId?: string): boolean {
  if (!styleId) return false;
  return HEADING_STYLE.test(styleId) || styleId === 'Title' || styleId === 'Subtitle';
}

export function parseHeadingLevel(styleId?: string): number | undefined {
  if (!styleId) return undefined;
  if (styleId === 'Title') return 1;
  if (styleId === 'Subtitle') return 2;
  const match = styleId.match(HEADING_STYLE);
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

const HIGHLIGHT_BY_HEX: Record<string, string> = {
  '#ffff00': 'yellow',
  '#00ff00': 'green',
  '#00ffff': 'cyan',
  '#ff00ff': 'magenta',
  '#0000ff': 'blue',
  '#ff0000': 'red',
  '#000080': 'darkBlue',
  '#008080': 'darkCyan',
  '#008000': 'darkGreen',
  '#800080': 'darkMagenta',
  '#800000': 'darkRed',
  '#808000': 'darkYellow',
  '#808080': 'darkGray',
  '#c0c0c0': 'lightGray',
  '#000000': 'black',
};

export function mapHexToHighlightName(hex: string): string | undefined {
  const normalized = hex.trim().toLowerCase();
  return HIGHLIGHT_BY_HEX[normalized] ?? HIGHLIGHT_BY_HEX[normalized.replace(/^#/, '#')];
}

export function pointsToHalfPoints(points: number): number {
  return Math.round(points * 2);
}

export function halfPointsToPoints(halfPoints: number): number {
  return halfPoints / 2;
}

export function makeRun(text: string, formatting?: Run['formatting']): Run {
  const content: RunContent[] = text.length > 0 ? [{ type: 'text', text }] : [];
  return { type: 'run', content, formatting };
}
