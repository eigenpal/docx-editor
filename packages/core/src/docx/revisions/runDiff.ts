import type { Run, TextContent, TextFormatting } from '../../types/document';

export type RunDiffKind = 'equal' | 'insert' | 'delete';

export interface RunDiffChunk {
  kind: RunDiffKind;
  text: string;
  runs: Run[];
}

interface CharToken {
  char: string;
  formatting?: TextFormatting;
}

interface DiffToken {
  kind: RunDiffKind;
  oldToken?: CharToken;
  newToken?: CharToken;
}

export function diffRuns(oldRuns: Run[], newRuns: Run[]): RunDiffChunk[] {
  const oldTokens = flattenRunsToCharTokens(oldRuns);
  const newTokens = flattenRunsToCharTokens(newRuns);

  if (oldTokens.length === 0 && newTokens.length === 0) {
    return [];
  }
  if (oldTokens.length === 0) {
    return [buildChunk('insert', newTokens)];
  }
  if (newTokens.length === 0) {
    return [buildChunk('delete', oldTokens)];
  }

  const lcs = buildLcsTable(oldTokens, newTokens);
  const tokens = backtrackDiffTokens(oldTokens, newTokens, lcs);
  return mergeDiffTokens(tokens);
}

export function flattenRunsToCharTokens(runs: Run[]): CharToken[] {
  const tokens: CharToken[] = [];

  for (const run of runs) {
    const text = getRunText(run);
    if (!text) continue;

    for (const char of text) {
      tokens.push({
        char,
        formatting: run.formatting,
      });
    }
  }

  return tokens;
}

function buildLcsTable(oldTokens: CharToken[], newTokens: CharToken[]): number[][] {
  const rows = oldTokens.length + 1;
  const cols = newTokens.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (oldTokens[i - 1].char === newTokens[j - 1].char) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }

  return table;
}

function backtrackDiffTokens(
  oldTokens: CharToken[],
  newTokens: CharToken[],
  lcsTable: number[][]
): DiffToken[] {
  const tokens: DiffToken[] = [];
  let i = oldTokens.length;
  let j = newTokens.length;

  while (i > 0 && j > 0) {
    const oldToken = oldTokens[i - 1];
    const newToken = newTokens[j - 1];

    if (oldToken.char === newToken.char) {
      tokens.push({ kind: 'equal', oldToken, newToken });
      i -= 1;
      j -= 1;
      continue;
    }

    if (lcsTable[i - 1][j] >= lcsTable[i][j - 1]) {
      tokens.push({ kind: 'delete', oldToken });
      i -= 1;
    } else {
      tokens.push({ kind: 'insert', newToken });
      j -= 1;
    }
  }

  while (i > 0) {
    tokens.push({ kind: 'delete', oldToken: oldTokens[i - 1] });
    i -= 1;
  }

  while (j > 0) {
    tokens.push({ kind: 'insert', newToken: newTokens[j - 1] });
    j -= 1;
  }

  tokens.reverse();
  return tokens;
}

function mergeDiffTokens(tokens: DiffToken[]): RunDiffChunk[] {
  const chunks: RunDiffChunk[] = [];
  let currentKind: RunDiffKind | null = null;
  let currentFormatting: TextFormatting | undefined;
  let buffer: CharToken[] = [];

  const flush = () => {
    if (!currentKind || buffer.length === 0) return;
    chunks.push(buildChunk(currentKind, buffer, currentFormatting));
    buffer = [];
  };

  for (const token of tokens) {
    const sourceToken = getSourceToken(token);
    if (!sourceToken) continue;

    const formattingChanged =
      serializeFormatting(currentFormatting) !== serializeFormatting(sourceToken.formatting);
    const kindChanged = currentKind !== token.kind;

    if (kindChanged || formattingChanged) {
      flush();
      currentKind = token.kind;
      currentFormatting = sourceToken.formatting;
    }

    buffer.push(sourceToken);
  }

  flush();
  return chunks;
}

function buildChunk(
  kind: RunDiffKind,
  tokens: CharToken[],
  formattingOverride?: TextFormatting
): RunDiffChunk {
  const text = tokens.map((t) => t.char).join('');
  const formatting = formattingOverride ?? tokens[0]?.formatting;

  return {
    kind,
    text,
    runs: text
      ? [
          {
            type: 'run',
            ...(formatting ? { formatting } : {}),
            content: [{ type: 'text', text } satisfies TextContent],
          },
        ]
      : [],
  };
}

function getSourceToken(token: DiffToken): CharToken | undefined {
  if (token.kind === 'delete') return token.oldToken;
  if (token.kind === 'insert') return token.newToken;
  // For equal, prefer formatting from the new side to reflect current content.
  return token.newToken ?? token.oldToken;
}

function getRunText(run: Run): string {
  return run.content
    .filter((content): content is TextContent => content.type === 'text')
    .map((content) => content.text)
    .join('');
}

function serializeFormatting(formatting: TextFormatting | undefined): string {
  return JSON.stringify(formatting ?? null);
}
