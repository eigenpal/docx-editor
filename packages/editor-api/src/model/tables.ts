/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { InsertLocation, VerticalAlignment } from './editing-enums.ts';
import {
  ObjectPath,
  fail,
  hydratedHandle,
  type AutomationOperation,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { ModelObject } from './model-object.ts';
import { HandleCollection, type PromisedItem } from './item-collection.ts';
import { Body } from './body.ts';
import type { AutomationSpanRef } from '../runtime/model-support.ts';

function integer(value: number, target: string, min = 0): number {
  if (!Number.isInteger(value) || value < min) fail({ code: 'InvalidArgument', target });
  return value;
}
function matrix(value: string[][], target: string): string[][] {
  if (
    !Array.isArray(value) ||
    value.some((r) => !Array.isArray(r) || r.some((c) => typeof c !== 'string'))
  )
    fail({ code: 'InvalidArgument', target });
  return value.map((r) => [...r]);
}
function location(value: 'Start' | 'End', target: string): 'start' | 'end' {
  if (value !== 'Start' && value !== 'End') fail({ code: 'InvalidArgument', target });
  return value === 'Start' ? 'start' : 'end';
}

/** A canonical rectangular table. Reads require load() and sync(). @public */
export class Table extends ModelObject implements PromisedItem {
  #rows: TableRowCollection | undefined;
  /** @internal */
  static at(context: RequestContext, label: string, address: ObjectAddress): Table {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new Table(context, ObjectPath.of(label, address.handle), false);
  }
  /** @internal */
  static promised(context: RequestContext, label: string, nullable = false): Table {
    return new Table(context, ObjectPath.pending(label), nullable);
  }
  private constructor(context: RequestContext, path: ObjectPath, nullable: boolean) {
    super(context, path, { nullable });
  }
  /** @internal */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'handle') this.path.resolveTo(address.handle);
    else this.path.resolveNull();
  }
  /** @internal */
  hydrateNull(): void {
    this.path.resolveNull();
  }
  /** Cell text by row. A write replaces the whole rectangular matrix; rich cell content refuses. */
  get values(): string[][] {
    return this.loadedProperty<string[][]>('values');
  }
  set values(value: string[][]) {
    const values = matrix(value, `${this.path.label}.values`);
    this.command('values', () => ({
      op: 'updateTable',
      table: this.path.handle(),
      mutation: { kind: 'values', values },
    }));
  }
  /** Table style display name. Writes must name an existing table style in the document. */
  get style(): string {
    return this.loadedProperty<string>('style');
  }
  set style(value: string) {
    if (typeof value !== 'string')
      fail({ code: 'InvalidArgument', target: `${this.path.label}.style` });
    this.command('style', () => ({
      op: 'updateTable',
      table: this.path.handle(),
      mutation: { kind: 'properties', styleId: value },
    }));
  }
  /** Number of consecutive leading rows repeated as table headers. */
  get headerRowCount(): number {
    return this.loadedProperty<number>('headerRowCount');
  }
  set headerRowCount(value: number) {
    integer(value, `${this.path.label}.headerRowCount`);
    this.command('headerRowCount', () => ({
      op: 'updateTable',
      table: this.path.handle(),
      mutation: { kind: 'properties', headerRowCount: value },
    }));
  }
  /** Number of rows. Load this property before reading it. */
  get rowCount(): number {
    return this.loadedProperty<number>('rowCount');
  }
  /** Number of columns in the rectangular grid. Load before reading. */
  get columnCount(): number {
    return this.loadedProperty<number>('columnCount');
  }
  /** Stable row collection. Load `items`, then sync before reading its elements. */
  get rows(): TableRowCollection {
    return (this.#rows ??= TableRowCollection.of(
      this.context,
      `${this.path.label}.rows`,
      this.path,
      () => ({
        op: 'getTableRows',
        table: this.path.handle(),
      })
    ));
  }
  /** Address a cell by zero-based row and column. Read-derived operations may share its next sync. */
  getCell(rowIndex: number, cellIndex: number): TableCell {
    const label = `${this.path.label}.getCell`;
    integer(rowIndex, label);
    integer(cellIndex, label);
    const cell = TableCell.promised(this.context, label);
    this.read(
      label,
      () => ({ op: 'getTableCell', table: this.path.handle(), rowIndex, cellIndex }),
      (value) => cell.hydrateAddress({ kind: 'handle', handle: hydratedHandle(value, label) })
    );
    return cell;
  }
  /** Add rows at an edge. Sync before configuring the returned rows; omitted values create empty cells. */
  addRows(
    insertLocation: InsertLocation.start | InsertLocation.end | 'Start' | 'End',
    rowCount: number,
    values?: string[][]
  ): TableRowCollection {
    const label = `${this.path.label}.addRows`;
    const where = location(insertLocation, label);
    integer(rowCount, label, 1);
    const copied = values === undefined ? undefined : matrix(values, label);
    const rows = TableRowCollection.of(this.context, label, this.path, () => null);
    this.commandAnswering(
      label,
      () => ({
        op: 'updateTable',
        table: this.path.handle(),
        mutation: {
          kind: 'addRows',
          location: where,
          count: rowCount,
          ...(copied ? { values: copied } : {}),
        },
      }),
      (answer) => rows.fill(answer, label)
    );
    return rows;
  }
  /** Add columns at an edge. Values are row-major; new columns initially copy the nearest edge width. */
  addColumns(
    insertLocation: InsertLocation.start | InsertLocation.end | 'Start' | 'End',
    columnCount: number,
    values?: string[][]
  ): void {
    const label = `${this.path.label}.addColumns`;
    const where = location(insertLocation, label);
    integer(columnCount, label, 1);
    const copied = values === undefined ? undefined : matrix(values, label);
    this.command('addColumns', () => ({
      op: 'updateTable',
      table: this.path.handle(),
      mutation: {
        kind: 'addColumns',
        location: where,
        count: columnCount,
        ...(copied ? { values: copied } : {}),
      },
    }));
  }
  /** Delete consecutive rows from a zero-based index. Defaults to one row. */
  deleteRows(rowIndex: number, rowCount?: number): void {
    if (rowCount === undefined) rowCount = 1;
    integer(rowIndex, this.path.label);
    integer(rowCount, this.path.label, 1);
    this.command('deleteRows', () => ({
      op: 'updateTable',
      table: this.path.handle(),
      mutation: { kind: 'deleteRows', index: rowIndex, count: rowCount },
    }));
  }
  /** Delete consecutive columns from a zero-based index. Defaults to one column. */
  deleteColumns(columnIndex: number, columnCount?: number): void {
    if (columnCount === undefined) columnCount = 1;
    integer(columnIndex, this.path.label);
    integer(columnCount, this.path.label, 1);
    this.command('deleteColumns', () => ({
      op: 'updateTable',
      table: this.path.handle(),
      mutation: { kind: 'deleteColumns', index: columnIndex, count: columnCount },
    }));
  }
  /** Delete this table and its contents through the canonical document transaction. */
  delete(): void {
    this.command('delete', () => ({
      op: 'updateTable',
      table: this.path.handle(),
      mutation: { kind: 'delete' },
    }));
  }
  protected override onLoad(request: ResolvedLoadOptions): void {
    const fields = this.selection(request, [
      'values',
      'style',
      'headerRowCount',
      'rowCount',
      'columnCount',
    ]);
    this.read(
      this.path.label,
      () => ({ op: 'getTable', table: this.path.handle() }),
      (answer) => {
        if (answer.kind !== 'table') fail({ code: 'GeneralException', target: this.path.label });
        for (const field of fields)
          this.setLoadedProperty(field, answer.table[field as keyof typeof answer.table]);
      }
    );
  }
}

/** A row with stable identity. Its cells follow document order. @public */
export class TableRow extends ModelObject implements PromisedItem {
  #cells: TableCellCollection | undefined;
  /** @internal */
  static at(context: RequestContext, label: string, address: ObjectAddress): TableRow {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new TableRow(context, ObjectPath.of(label, address.handle), false);
  }
  /** @internal */
  static promised(context: RequestContext, label: string, nullable = false): TableRow {
    return new TableRow(context, ObjectPath.pending(label), nullable);
  }
  private constructor(context: RequestContext, path: ObjectPath, nullable: boolean) {
    super(context, path, { nullable });
  }
  /** @internal */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'handle') this.path.resolveTo(address.handle);
    else this.path.resolveNull();
  }
  /** @internal */
  hydrateNull(): void {
    this.path.resolveNull();
  }
  /** Stable cell collection for this row. Load `items` and sync before reading. */
  get cells(): TableCellCollection {
    return (this.#cells ??= TableCellCollection.of(
      this.context,
      `${this.path.label}.cells`,
      this.path,
      () => ({
        op: 'getTableCells',
        row: this.path.handle(),
      })
    ));
  }
}

/** An ordinary table cell. Column width uses points and changes the whole grid column. @public */
export class TableCell extends ModelObject implements PromisedItem {
  #body: Body | undefined;
  /** @internal */
  static at(context: RequestContext, label: string, address: ObjectAddress): TableCell {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new TableCell(context, ObjectPath.of(label, address.handle), false);
  }
  /** @internal */
  static promised(context: RequestContext, label: string, nullable = false): TableCell {
    return new TableCell(context, ObjectPath.pending(label), nullable);
  }
  private constructor(context: RequestContext, path: ObjectPath, nullable: boolean) {
    super(context, path, { nullable });
  }
  /** @internal */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'handle') this.path.resolveTo(address.handle);
    else this.path.resolveNull();
  }
  /** @internal */
  hydrateNull(): void {
    this.path.resolveNull();
  }
  /** A body scoped to this cell for text, ranges, formatting, and nested table navigation. */
  get body(): Body {
    if (this.#body) return this.#body;
    const label = `${this.path.label}.body`;
    const body = Body.promisedStory(this.context, label);
    this.read(
      label,
      () => ({ op: 'getTableCellBody', cell: this.path.handle() }),
      (answer) => body.hydrateAddress({ kind: 'handle', handle: hydratedHandle(answer, label) })
    );
    this.#body = body;
    return body;
  }
  /** Plain cell text. Replacing complex content refuses; use the scoped body for targeted edits. */
  get value(): string {
    return this.loadedProperty<string>('value');
  }
  set value(value: string) {
    if (typeof value !== 'string')
      fail({ code: 'InvalidArgument', target: `${this.path.label}.value` });
    this.command('value', () => ({
      op: 'updateTableCell',
      cell: this.path.handle(),
      properties: { value: value },
    }));
  }
  /** Width in points. A write affects the whole grid column, not only this cell. */
  get columnWidth(): number {
    return this.loadedProperty<number>('columnWidth');
  }
  set columnWidth(value: number) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
      fail({ code: 'InvalidArgument', target: `${this.path.label}.columnWidth` });
    this.command('columnWidth', () => ({
      op: 'updateTableCell',
      cell: this.path.handle(),
      properties: { columnWidth: value },
    }));
  }
  /** Cell background as a supported color string. */
  get shadingColor(): string {
    return this.loadedProperty<string>('shadingColor');
  }
  set shadingColor(value: string) {
    if (typeof value !== 'string')
      fail({ code: 'InvalidArgument', target: `${this.path.label}.shadingColor` });
    this.command('shadingColor', () => ({
      op: 'updateTableCell',
      cell: this.path.handle(),
      properties: { shadingColor: value },
    }));
  }
  /** Top, Center, or Bottom. Mixed is a read state and cannot be assigned. */
  get verticalAlignment(): VerticalAlignment | 'Top' | 'Center' | 'Bottom' | 'Mixed' {
    return this.loadedProperty<VerticalAlignment | 'Top' | 'Center' | 'Bottom' | 'Mixed'>(
      'verticalAlignment'
    );
  }
  set verticalAlignment(value: VerticalAlignment | 'Top' | 'Center' | 'Bottom' | 'Mixed') {
    if (value !== 'Top' && value !== 'Center' && value !== 'Bottom')
      fail({ code: 'InvalidArgument', target: `${this.path.label}.verticalAlignment` });
    this.command('verticalAlignment', () => ({
      op: 'updateTableCell',
      cell: this.path.handle(),
      properties: { verticalAlignment: value },
    }));
  }
  protected override onLoad(request: ResolvedLoadOptions): void {
    const fields = this.selection(request, [
      'value',
      'columnWidth',
      'shadingColor',
      'verticalAlignment',
    ]);
    this.read(
      this.path.label,
      () => ({ op: 'getTableCellProperties', cell: this.path.handle() }),
      (answer) => {
        if (answer.kind !== 'tableCell')
          fail({ code: 'GeneralException', target: this.path.label });
        for (const field of fields)
          this.setLoadedProperty(field, answer.cell[field as keyof typeof answer.cell]);
      }
    );
  }
}

/** A loaded collection of Table objects. @public */
export class TableCollection extends HandleCollection<Table> {
  readonly #listing: () => AutomationOperation | null;
  /** @internal */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    listing: () => AutomationOperation | null
  ): TableCollection {
    return new TableCollection(context, ObjectPath.derived(label, owner), listing);
  }
  /** @internal */
  static over(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    scope: () => AutomationSpanRef
  ): TableCollection {
    return TableCollection.of(context, label, owner, () => ({ op: 'getTables', scope: scope() }));
  }
  private constructor(
    context: RequestContext,
    path: ObjectPath,
    listing: () => AutomationOperation | null
  ) {
    super(context, path);
    this.#listing = listing;
  }
  /** Return the first item; an empty collection raises ItemNotFound at sync. */
  getFirst(): Table {
    return this.edge('first', 'getFirst', false);
  }
  /** Return the first item or a null object. Check isNullObject after sync. */
  getFirstOrNullObject(): Table {
    return this.edge('first', 'getFirstOrNullObject', true);
  }
  protected listing(): AutomationOperation | null {
    return this.#listing();
  }
  protected itemAt(label: string, address: ObjectAddress): Table {
    return Table.at(this.context, label, address);
  }
  protected promised(label: string, nullable: boolean): Table & PromisedItem {
    return Table.promised(this.context, label, nullable);
  }
}

/** A loaded collection of TableRow objects. @public */
export class TableRowCollection extends HandleCollection<TableRow> {
  readonly #listing: () => AutomationOperation | null;
  /** @internal */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    listing: () => AutomationOperation | null
  ): TableRowCollection {
    return new TableRowCollection(context, ObjectPath.derived(label, owner), listing);
  }
  private constructor(
    context: RequestContext,
    path: ObjectPath,
    listing: () => AutomationOperation | null
  ) {
    super(context, path);
    this.#listing = listing;
  }
  /** Return the first item; an empty collection raises ItemNotFound at sync. */
  getFirst(): TableRow {
    return this.edge('first', 'getFirst', false);
  }
  /** Return the first item or a null object. Check isNullObject after sync. */
  getFirstOrNullObject(): TableRow {
    return this.edge('first', 'getFirstOrNullObject', true);
  }
  protected listing(): AutomationOperation | null {
    return this.#listing();
  }
  protected itemAt(label: string, address: ObjectAddress): TableRow {
    return TableRow.at(this.context, label, address);
  }
  protected promised(label: string, nullable: boolean): TableRow & PromisedItem {
    return TableRow.promised(this.context, label, nullable);
  }
}

/** A loaded collection of TableCell objects. @public */
export class TableCellCollection extends HandleCollection<TableCell> {
  readonly #listing: () => AutomationOperation | null;
  /** @internal */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    listing: () => AutomationOperation | null
  ): TableCellCollection {
    return new TableCellCollection(context, ObjectPath.derived(label, owner), listing);
  }
  private constructor(
    context: RequestContext,
    path: ObjectPath,
    listing: () => AutomationOperation | null
  ) {
    super(context, path);
    this.#listing = listing;
  }
  /** Return the first item; an empty collection raises ItemNotFound at sync. */
  getFirst(): TableCell {
    return this.edge('first', 'getFirst', false);
  }
  /** Return the first item or a null object. Check isNullObject after sync. */
  getFirstOrNullObject(): TableCell {
    return this.edge('first', 'getFirstOrNullObject', true);
  }
  protected listing(): AutomationOperation | null {
    return this.#listing();
  }
  protected itemAt(label: string, address: ObjectAddress): TableCell {
    return TableCell.at(this.context, label, address);
  }
  protected promised(label: string, nullable: boolean): TableCell & PromisedItem {
    return TableCell.promised(this.context, label, nullable);
  }
}
