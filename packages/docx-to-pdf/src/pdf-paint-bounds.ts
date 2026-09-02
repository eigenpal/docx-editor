/** Maximum page width or height in points (~200 inches). @public */
export const HARD_MAX_PAGE_DIMENSION_PT = 14_400;

/** Maximum paint commands per document export. @public */
export const HARD_MAX_PAINT_COMMANDS = 2_000_000;

/** Maximum physical pages in one PDF export. @public */
export const HARD_MAX_PDF_PAGES = 10_000;

/** Maximum encoded PDF size in bytes. @public */
export const HARD_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Maximum unique fidelity diagnostics retained for one export. @public */
export const HARD_MAX_FIDELITY_DIAGNOSTICS = 10_000;

/** Maximum absolute coordinate magnitude in points. @public */
export const HARD_MAX_COORDINATE_PT = 1_000_000;

/** Maximum link target string length. @public */
export const HARD_MAX_LINK_TARGET_LENGTH = 8_192;

/** Maximum destination name length. @public */
export const HARD_MAX_DESTINATION_NAME_LENGTH = 512;

/** Maximum PDF Info metadata string length. @public */
export const HARD_MAX_METADATA_VALUE_LENGTH = 4_096;

/** Maximum text span payload length. @public */
export const HARD_MAX_TEXT_SPAN_LENGTH = 65_536;

/** Typed failure for out-of-range paint-command values. @public */
export class PdfPaintValidationError extends Error {
  constructor(
    readonly field: string,
    readonly detail: string
  ) {
    super(`Invalid PDF paint value for ${field}: ${detail}`);
    this.name = 'PdfPaintValidationError';
  }
}

function reject(field: string, detail: string): never {
  throw new PdfPaintValidationError(field, detail);
}

/** Returns true when a number is finite and within the paint coordinate envelope. @internal */
export function isBoundedCoordinate(value: number): boolean {
  return (
    Number.isFinite(value) && Math.abs(value) <= HARD_MAX_COORDINATE_PT && !Object.is(value, -0)
  );
}

/** Validates a finite coordinate in points. @public */
export function validateCoordinate(field: string, value: number): number {
  if (!Number.isFinite(value)) {
    reject(field, 'must be a finite number');
  }
  if (Object.is(value, -0)) {
    reject(field, 'must not be negative zero');
  }
  if (Math.abs(value) > HARD_MAX_COORDINATE_PT) {
    reject(field, `must be within ±${HARD_MAX_COORDINATE_PT} points`);
  }
  return value;
}

/** Validates a strictly positive page dimension in points. @public */
export function validatePageDimension(field: string, value: number): number {
  const coordinate = validateCoordinate(field, value);
  if (coordinate <= 0) {
    reject(field, 'must be greater than zero');
  }
  if (coordinate > HARD_MAX_PAGE_DIMENSION_PT) {
    reject(field, `must be at most ${HARD_MAX_PAGE_DIMENSION_PT} points`);
  }
  return coordinate;
}

/** Validates a non-negative page index below {@link HARD_MAX_PDF_PAGES}. @public */
export function validatePageIndex(value: number): number {
  const coordinate = validateCoordinate('pageIndex', value);
  if (!Number.isInteger(coordinate) || coordinate < 0) {
    reject('pageIndex', 'must be a non-negative integer');
  }
  if (coordinate >= HARD_MAX_PDF_PAGES) {
    reject('pageIndex', `must be less than ${HARD_MAX_PDF_PAGES}`);
  }
  return coordinate;
}

/** Validates a page count in `0..=HARD_MAX_PDF_PAGES`. @public */
export function validatePageCount(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || Object.is(value, -0)) {
    reject('pageCount', 'must be a non-negative integer');
  }
  if (value < 0) {
    reject('pageCount', 'must be a non-negative integer');
  }
  if (value > HARD_MAX_PDF_PAGES) {
    reject('pageCount', `must be at most ${HARD_MAX_PDF_PAGES}`);
  }
  return value;
}

/** Validates an encoded-output budget in `1..=HARD_MAX_OUTPUT_BYTES`. @public */
export function validateOutputByteLimit(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || Object.is(value, -0)) {
    reject('outputBytes', 'must be a positive integer');
  }
  if (value < 1) {
    reject('outputBytes', 'must be a positive integer');
  }
  if (value > HARD_MAX_OUTPUT_BYTES) {
    reject('outputBytes', `must be at most ${HARD_MAX_OUTPUT_BYTES} bytes`);
  }
  return value;
}

/** Validates a non-negative line width in points. @public */
export function validateLineWidth(value: number): number {
  const coordinate = validateCoordinate('lineWidth', value);
  if (coordinate < 0) {
    reject('lineWidth', 'must be non-negative');
  }
  return coordinate;
}

/** Validates a bounded string field. @public */
export function validateBoundedString(field: string, value: string, maxLength: number): string {
  if (typeof value !== 'string') {
    reject(field, 'must be a string');
  }
  if (value.length > maxLength) {
    reject(field, `must be at most ${maxLength} characters`);
  }
  return value;
}

/** Validates an opaque RGBA color token (#RRGGBB or #RRGGBBAA). @public */
export function validateColor(value: string): string {
  const color = validateBoundedString('color', value, 9);
  if (!/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(color)) {
    reject('color', 'must be #RRGGBB or #RRGGBBAA');
  }
  return color.toUpperCase();
}

/** Validates a bounded command list length. @public */
export function validateCommandCount(count: number): number {
  if (!Number.isFinite(count) || !Number.isInteger(count) || Object.is(count, -0)) {
    reject('commandCount', 'must be a non-negative integer');
  }
  if (count < 0) {
    reject('commandCount', 'must be a non-negative integer');
  }
  if (count > HARD_MAX_PAINT_COMMANDS) {
    reject('commandCount', `must be at most ${HARD_MAX_PAINT_COMMANDS}`);
  }
  return count;
}
