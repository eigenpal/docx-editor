/** Recovery belongs to the application tool protocol, not the document model. */
export interface ToolRecovery {
  action: 'inspect' | 'revise_arguments' | 'report_limit' | 'stop';
  instruction: string;
}

export function toolRecovery(code: string, partial: boolean): ToolRecovery {
  if (code === 'Cancelled')
    return {
      action: 'stop',
      instruction: 'Stop generation. Earlier completed edits remain saved.',
    };
  if (code === 'NotSupported')
    return {
      action: 'report_limit',
      instruction:
        (partial ? 'Earlier steps remain saved. Inspect before continuing. ' : '') +
        'Report this operation limit. Complete other supported edits. Keep the selected editing mode. Do not substitute plain text for structure.',
    };
  if (partial)
    return {
      action: 'inspect',
      instruction:
        'Earlier steps remain saved. Inspect the affected content and revisions. Continue only the remaining edits; do not repeat completed steps.',
    };
  if (code === 'InvalidArgument' || code === 'ResultTooLarge')
    return {
      action: 'revise_arguments',
      instruction:
        'Correct the arguments or reduce the inspection size. Preserve the requested scope. Inspect again if the target is uncertain.',
    };
  return {
    action: 'inspect',
    instruction:
      'Inspect the affected story again. Reconsider targets and remaining edits. Split conflicting writes into separate calls. Do not replay unchanged arguments.',
  };
}
