import type { AutomationSpanRef } from './operations.ts';
import type { AutomationHandle } from './protocol.ts';

/** Table, picture, field, break, and list authoring transport operations. */
export type AutomationAuthoringOperation =
  | { readonly op: 'getFields'; readonly span: AutomationSpanRef }
  | {
      readonly op: 'getField' | 'deleteField' | 'updateFieldResult';
      readonly field: AutomationHandle;
    }
  | { readonly op: 'setFieldCode'; readonly field: AutomationHandle; readonly code: string }
  | {
      readonly op: 'insertField';
      readonly span: AutomationSpanRef;
      readonly location: 'Before' | 'After' | 'Start' | 'End' | 'Replace';
      readonly fieldType?: string;
      readonly text?: string;
      readonly removeFormatting?: boolean;
    }
  | { readonly op: 'getTables'; readonly scope: AutomationSpanRef }
  | { readonly op: 'getTable' | 'getTableRows'; readonly table: AutomationHandle }
  | { readonly op: 'getTableCells'; readonly row: AutomationHandle }
  | {
      readonly op: 'getTableCell';
      readonly table: AutomationHandle;
      readonly rowIndex: number;
      readonly cellIndex: number;
    }
  | { readonly op: 'getTableCellProperties' | 'getTableCellBody'; readonly cell: AutomationHandle }
  | {
      readonly op: 'updateTable';
      readonly table: AutomationHandle;
      readonly mutation: Exclude<import('./tables.ts').AutomationTableMutation, { kind: 'cell' }>;
    }
  | {
      readonly op: 'updateTableCell';
      readonly cell: AutomationHandle;
      readonly properties: Omit<
        Extract<import('./tables.ts').AutomationTableMutation, { kind: 'cell' }>,
        'kind' | 'cellId'
      >;
    }
  | {
      readonly op: 'insertTable';
      readonly span: AutomationSpanRef;
      readonly location: 'Before' | 'After';
      readonly rowCount: number;
      readonly columnCount: number;
      readonly values?: readonly (readonly string[])[];
    }
  | { readonly op: 'getInlinePictures'; readonly span: AutomationSpanRef }
  | { readonly op: 'getInlinePicture'; readonly picture: AutomationHandle }
  | {
      readonly op: 'setInlinePicture';
      readonly picture: AutomationHandle;
      readonly properties: import('./pictures.ts').AutomationInlinePictureWrite;
    }
  | { readonly op: 'deleteInlinePicture'; readonly picture: AutomationHandle }
  | {
      readonly op: 'insertInlinePicture';
      readonly span: AutomationSpanRef;
      readonly base64: string;
      readonly location: 'Before' | 'After' | 'Start' | 'End' | 'Replace';
    }
  | {
      readonly op: 'insertBreak';
      readonly span: AutomationSpanRef;
      readonly breakType: string;
      readonly location: string;
    }
  | { readonly op: 'startNewList'; readonly paragraph: AutomationHandle }
  | {
      readonly op: 'attachToList';
      readonly paragraph: AutomationHandle;
      readonly listId: number;
      readonly level: number;
    }
  | { readonly op: 'detachFromList'; readonly paragraph: AutomationHandle }
  | {
      readonly op: 'setListLevelFormat';
      readonly list: AutomationHandle;
      readonly level: number;
      readonly format: import('./list-authoring.ts').AutomationListLevelFormat;
    }
  | {
      readonly op: 'getRange';
      readonly span: AutomationSpanRef;
      readonly location: 'Whole' | 'Content' | 'Start' | 'End' | 'Before' | 'After';
    };
