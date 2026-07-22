/** @spike-features engine-neutral-editor-driver-contract, one-schema-backed-docx-editor-command */
/** DocxEditor namespace — spike driver vocabulary (no alternate namespace). */
export namespace DocxEditor {
  export type NonEmptyString = string & { readonly __brand: 'NonEmptyString' };
  export type NonNegativeInteger = number & { readonly __brand: 'NonNegativeInteger' };

  export interface DocRange {
    readonly storyId: NonEmptyString;
    readonly blockId: NonEmptyString;
    readonly start: NonNegativeInteger;
    readonly end: NonNegativeInteger;
  }

  export interface RunFormatting {
    readonly bold?: boolean;
    readonly italic?: boolean;
  }

  export interface BodyScope {
    readonly kind: 'body';
  }

  export type Command = {
    readonly type: 'toggleMark';
    readonly mark: 'bold' | 'italic';
    readonly scope?: BodyScope;
  };

  export type Query =
    | { readonly type: 'findText'; readonly text: NonEmptyString; readonly scope?: BodyScope }
    | { readonly type: 'selectedText'; readonly scope?: BodyScope }
    | { readonly type: 'selectionFormatting'; readonly scope?: BodyScope }
    | { readonly type: 'selection'; readonly scope?: BodyScope };

  export interface CommandResult {
    readonly status: 'applied' | 'noOp' | 'failed';
    readonly changed?: boolean;
    readonly code?: string;
    readonly reason?: string;
  }

  export type QueryResult =
    | { readonly type: 'findText'; readonly ranges: readonly DocRange[] }
    | { readonly type: 'selectedText'; readonly text: string }
    | {
        readonly type: 'selectionFormatting';
        readonly formatting: RunFormatting | null;
      }
    | { readonly type: 'selection'; readonly range: DocRange | null };

  export interface SaveResult {
    readonly status: 'saved' | 'failed';
    readonly bytes?: Uint8Array;
    readonly code?: string;
    readonly reason?: string;
  }
}

/**
 * Engine-neutral E2E driver contract.
 * Implementations MUST NOT rely on ProseMirror view access, painter selectors,
 * datasets, or window.__DOCX_EDITOR_E2E__ hooks.
 */
export interface EditorDriver {
  loadDocx(bytes: Uint8Array): Promise<void>;
  selectText(text: string): Promise<void>;
  type(text: string): Promise<void>;
  execute(command: DocxEditor.Command): Promise<DocxEditor.CommandResult>;
  query<T extends DocxEditor.Query['type']>(
    query: Extract<DocxEditor.Query, { type: T }>
  ): Promise<Extract<DocxEditor.QueryResult, { type: T }>>;
  undo(): Promise<DocxEditor.CommandResult>;
  save(): Promise<DocxEditor.SaveResult>;
}

export function nonEmptyString(value: string): DocxEditor.NonEmptyString {
  if (value.length === 0) throw new TypeError('value must be non-empty');
  return value as DocxEditor.NonEmptyString;
}

export function nonNegativeInteger(value: number): DocxEditor.NonNegativeInteger {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError('value must be a nonnegative integer');
  }
  return value as DocxEditor.NonNegativeInteger;
}

export function docRange(input: {
  storyId: string;
  blockId: string;
  start: number;
  end: number;
}): DocxEditor.DocRange {
  const start = nonNegativeInteger(input.start);
  const end = nonNegativeInteger(input.end);
  if (end < start) throw new RangeError('range end must be at or after start');
  return {
    storyId: nonEmptyString(input.storyId),
    blockId: nonEmptyString(input.blockId),
    start,
    end,
  };
}
