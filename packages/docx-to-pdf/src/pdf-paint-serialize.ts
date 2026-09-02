import { validateCommandCount, validateCoordinate } from './pdf-paint-bounds.ts';
import type { PdfPaintCommand, PdfPaintPlan } from './pdf-paint-types.ts';

const NUMERIC_PRECISION = 6;

function formatNumber(value: number): string {
  const bounded = validateCoordinate('serialize', value);
  if (Object.is(bounded, -0)) {
    return '0';
  }
  if (Number.isInteger(bounded)) {
    return String(bounded);
  }
  return bounded.toFixed(NUMERIC_PRECISION).replace(/\.?0+$/, '');
}

function serializeRect(rect: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): string {
  return [
    formatNumber(rect.x),
    formatNumber(rect.y),
    formatNumber(rect.width),
    formatNumber(rect.height),
  ].join(',');
}

function serializeLinkTarget(
  target: Extract<PdfPaintCommand, { readonly kind: 'link' }>['target']
): string {
  if (target.kind === 'external') {
    return `external:${target.href}`;
  }
  return `internal:${target.destination}`;
}

/** Serializes one paint command to a deterministic line. @public */
export function serializePdfPaintCommand(command: PdfPaintCommand): string {
  switch (command.kind) {
    case 'beginPage':
      return [
        'beginPage',
        command.pageIndex,
        formatNumber(command.width),
        formatNumber(command.height),
      ].join('\t');
    case 'saveState':
      return 'saveState';
    case 'restoreState':
      return 'restoreState';
    case 'clipRect':
      return ['clipRect', serializeRect(command.rect)].join('\t');
    case 'fillRect':
      return ['fillRect', serializeRect(command.rect), command.color].join('\t');
    case 'strokeRect':
      return [
        'strokeRect',
        serializeRect(command.rect),
        command.color,
        formatNumber(command.lineWidth),
      ].join('\t');
    case 'textSpan':
      return [
        'textSpan',
        serializeRect(command.rect),
        formatNumber(command.baseline),
        command.text,
        command.style.fontFamily ?? '',
        formatNumber(command.style.fontSizePt),
        command.style.fontWeight,
        command.style.italic ? 'italic' : 'upright',
        command.style.color ?? '',
        command.style.decoration,
        formatNumber(command.style.baselineShiftPt),
      ].join('\t');
    case 'image':
      return [
        'image',
        serializeRect(command.rect),
        command.imageId,
        formatNumber(command.opacity),
      ].join('\t');
    case 'link':
      return ['link', serializeRect(command.rect), serializeLinkTarget(command.target)].join('\t');
    case 'destination':
      return ['destination', command.name, serializeRect(command.rect)].join('\t');
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}

/** Serializes a paint plan to a stable newline-delimited document. @public */
export function serializePdfPaintPlan(plan: PdfPaintPlan): string {
  validateCommandCount(plan.commands.length);
  return plan.commands.map((command) => serializePdfPaintCommand(command)).join('\n');
}
