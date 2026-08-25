import * as Y from 'yjs';
import type { OoxmlPart } from '@docx-editor.dev/core/store';
import type {
  BackendKind,
  DirtyPaths,
  ElementRecord,
  EncodedAttribute,
  EncodedBinding,
  LogicalId,
  NodeIdentityMeta,
  PartIdentity,
  RepresentationBackend,
  SharedRecord,
  TextRecord,
} from './contract.ts';
import { isElementRecord } from './contract.ts';
import { wordFacingIdsOf, yjsItemKey } from './identity.ts';
import { writePart, type SeedSink } from './seed.ts';

const LID = '__lid';
const KIND = '__kind';
const NS = '__ns';
const PREFIX = '__prefix';
const TEXT_NAME = '__text';

function attrKey(namespaceUri: string, localName: string): string {
  return `@${namespaceUri}\n${localName}`;
}

function prefixKey(namespaceUri: string, localName: string): string {
  return `^${namespaceUri}\n${localName}`;
}

function parseAttrKey(key: string): { namespaceUri: string; localName: string } | null {
  if (!key.startsWith('@')) return null;
  const split = key.slice(1).indexOf('\n');
  if (split < 0) return null;
  return { namespaceUri: key.slice(1, split + 1), localName: key.slice(split + 2) };
}

function itemKeyOf(type: Y.AbstractType<unknown> | Y.Map<unknown> | Y.XmlElement): string | null {
  const item = (type as unknown as { _item?: { id: { client: number; clock: number } } })._item;
  if (!item) return null;
  return yjsItemKey(item.id.client, item.id.clock);
}

function asTrackedType(type: Y.XmlFragment | Y.Map<string>): Y.AbstractType<unknown> {
  return type as Y.AbstractType<unknown>;
}

export class XmlBackend implements RepresentationBackend {
  readonly kind: BackendKind = 'xml';
  private readonly fragment: Y.XmlFragment;
  private readonly meta: Y.Map<string>;
  private readonly pending = new Map<string, Y.XmlElement>();
  private rootId: LogicalId | null = null;
  private mintSeq = 0;

  constructor(readonly doc: Y.Doc) {
    this.fragment = doc.getXmlFragment('spike-xml-root');
    this.meta = doc.getMap('spike-xml-part');
  }

  seed(part: OoxmlPart): void {
    this.doc.transact(() => {
      writePart(this.sink(), part);
    });
  }

  beginBulkLoad(): void {}

  endBulkLoad(): void {}

  partIdentity(): PartIdentity {
    return {
      id: String(this.meta.get('id') ?? ''),
      name: String(this.meta.get('name') ?? ''),
      contentType: String(this.meta.get('contentType') ?? ''),
    };
  }

  rootLogicalId(): LogicalId {
    if (this.rootId) return this.rootId;
    const stored = this.meta.get('rootId');
    if (typeof stored === 'string' && stored.length > 0) {
      this.rootId = stored;
      return stored;
    }
    const first = this.fragment.get(0);
    if (first instanceof Y.XmlElement) {
      const lid = first.getAttribute(LID);
      if (typeof lid === 'string') {
        this.rootId = lid;
        return lid;
      }
    }
    throw new Error('xml backend has no root');
  }

  record(logicalId: LogicalId): SharedRecord | null {
    const element = this.element(logicalId);
    if (!element) return null;
    if (element.nodeName === TEXT_NAME) return this.textRecord(element);
    return this.elementRecord(element);
  }

  parentOf(logicalId: LogicalId): LogicalId | null {
    const element = this.element(logicalId);
    const parent = element?.parent;
    if (parent instanceof Y.XmlElement) {
      const lid = parent.getAttribute(LID);
      return typeof lid === 'string' ? lid : null;
    }
    return null;
  }

  identityMeta(logicalId: LogicalId): NodeIdentityMeta | null {
    const element = this.element(logicalId);
    if (!element) return null;
    const record = this.record(logicalId);
    const attributes = record && isElementRecord(record) ? record.attributes : [];
    return {
      logicalId,
      yjsItemKey: itemKeyOf(element),
      wordFacingIds: wordFacingIdsOf(attributes),
    };
  }

  insertText(logicalId: LogicalId, offset: number, text: string): void {
    this.doc.transact(() => {
      this.textOf(logicalId).insert(offset, text);
    });
  }

  deleteText(logicalId: LogicalId, offset: number, length: number): void {
    this.doc.transact(() => {
      this.textOf(logicalId).delete(offset, length);
    });
  }

  setAttribute(logicalId: LogicalId, attribute: EncodedAttribute): void {
    this.doc.transact(() => {
      const element = this.requireElement(logicalId);
      element.setAttribute(attrKey(attribute.namespaceUri, attribute.localName), attribute.value);
      if (attribute.prefix) {
        element.setAttribute(
          prefixKey(attribute.namespaceUri, attribute.localName),
          attribute.prefix
        );
      }
    });
  }

  removeAttribute(logicalId: LogicalId, namespaceUri: string, localName: string): void {
    this.doc.transact(() => {
      const element = this.requireElement(logicalId);
      element.removeAttribute(attrKey(namespaceUri, localName));
      element.removeAttribute(prefixKey(namespaceUri, localName));
    });
  }

  createElement(record: Omit<ElementRecord, 'childIds'>): void {
    this.doc.transact(() => {
      this.pending.set(record.logicalId, this.makeElement(record));
    });
  }

  createText(logicalId: LogicalId, value: string): void {
    this.doc.transact(() => {
      this.pending.set(logicalId, this.makeText(logicalId, value));
    });
  }

  spliceChildren(
    parentId: LogicalId,
    index: number,
    deleteCount: number,
    insertIds: readonly LogicalId[]
  ): void {
    this.doc.transact(() => {
      const parent = this.requireElement(parentId);
      if (deleteCount > 0) parent.delete(index, deleteCount);
      const inserted = insertIds.map((id) => this.takeLive(id));
      if (inserted.length > 0) parent.insert(Math.min(index, this.childCount(parent)), inserted);
    });
  }

  moveNode(nodeId: LogicalId, destParentId: LogicalId, destIndex: number): void {
    this.doc.transact(() => {
      const source = this.requireElement(nodeId);
      const sourceParent = source.parent;
      const clone = this.cloneReminted(source);
      if (sourceParent instanceof Y.XmlElement) {
        const index = sourceParent.toArray().indexOf(source);
        if (index >= 0) sourceParent.delete(index, 1);
      }
      this.requireElement(destParentId).insert(destIndex, [clone]);
    });
  }

  observeDirty(onDirty: (paths: DirtyPaths) => void): () => void {
    const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
      const logicalIds = new Set<LogicalId>();
      for (const event of events) this.collectDirty(event.target, logicalIds);
      if (logicalIds.size > 0) onDirty({ logicalIds, backend: 'xml', membershipChanged: true });
    };
    this.fragment.observeDeep(handler);
    return () => this.fragment.unobserveDeep(handler);
  }

  tombstone(logicalId: LogicalId): void {
    this.doc.transact(() => {
      const element = this.element(logicalId);
      if (!element) return;
      const parent = element.parent;
      if (parent instanceof Y.XmlElement) {
        const index = parent.toArray().indexOf(element);
        if (index >= 0) parent.delete(index, 1);
      }
    });
  }

  joinNodes(survivorId: LogicalId, removedId: LogicalId): void {
    this.doc.transact(() => {
      const survivor = this.requireElement(survivorId);
      const removed = this.requireElement(removedId);
      const kids = removed
        .toArray()
        .filter((child): child is Y.XmlElement => child instanceof Y.XmlElement);
      if (kids.length > 0) {
        removed.delete(0, removed.length);
        survivor.insert(this.childCount(survivor), kids);
      }
      this.tombstone(removedId);
    });
  }

  isTombstoned(logicalId: LogicalId): boolean {
    return this.element(logicalId) === null;
  }

  replacedByOf(_logicalId: LogicalId): LogicalId | null {
    return null;
  }

  adoptedChildren(_survivorId: LogicalId): readonly LogicalId[] {
    return [];
  }

  listingParents(logicalId: LogicalId): readonly LogicalId[] {
    const parent = this.parentOf(logicalId);
    return parent ? [parent] : [];
  }

  allLogicalIds(): readonly LogicalId[] {
    const ids: LogicalId[] = [];
    const walk = (node: Y.XmlFragment | Y.XmlElement): void => {
      if (node instanceof Y.XmlElement) {
        const lid = node.getAttribute(LID);
        if (typeof lid === 'string') ids.push(lid);
      }
      for (const child of node.toArray()) {
        if (child instanceof Y.XmlElement) walk(child);
      }
    };
    walk(this.fragment);
    return ids;
  }

  trackedTypes(): readonly Y.AbstractType<unknown>[] {
    return [asTrackedType(this.fragment), asTrackedType(this.meta)];
  }

  encodeSnapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  encodeUpdate(remoteStateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, remoteStateVector);
  }

  private sink(): SeedSink {
    return {
      writePartIdentity: (part) => {
        this.meta.set('id', part.id);
        this.meta.set('name', part.name);
        this.meta.set('contentType', part.contentType);
      },
      writeElement: (node, attributes, bindings) => {
        this.pending.set(
          node.id,
          this.makeElement({
            logicalId: node.id,
            kind: node.kind,
            namespaceUri: node.namespaceUri,
            localName: node.localName,
            prefix: node.prefix,
            attributes,
            bindings,
          })
        );
      },
      writeText: (node) => {
        this.pending.set(node.id, this.makeText(node.id, node.value));
      },
      appendChild: (parentId, childId) => {
        const parent = this.requireElement(parentId);
        parent.insert(this.childCount(parent), [this.takeLive(childId)]);
      },
      setRoot: (id) => {
        this.rootId = id;
        this.meta.set('rootId', id);
        this.fragment.insert(0, [this.takeLive(id)]);
      },
    };
  }

  private makeElement(record: Omit<ElementRecord, 'childIds'>): Y.XmlElement {
    const nodeName = record.prefix ? `${record.prefix}:${record.localName}` : record.localName;
    const element = new Y.XmlElement(nodeName);
    element.setAttribute(LID, record.logicalId);
    element.setAttribute(KIND, record.kind);
    element.setAttribute(NS, record.namespaceUri);
    if (record.prefix) element.setAttribute(PREFIX, record.prefix);
    for (const attribute of record.attributes) {
      element.setAttribute(attrKey(attribute.namespaceUri, attribute.localName), attribute.value);
      if (attribute.prefix) {
        element.setAttribute(
          prefixKey(attribute.namespaceUri, attribute.localName),
          attribute.prefix
        );
      }
    }
    for (const binding of record.bindings) {
      element.setAttribute(`xmlns:${binding.prefix}`, binding.namespaceUri);
    }
    return element;
  }

  private makeText(logicalId: LogicalId, value: string): Y.XmlElement {
    const wrapper = new Y.XmlElement(TEXT_NAME);
    wrapper.setAttribute(LID, logicalId);
    wrapper.setAttribute(KIND, 'textValue');
    const text = new Y.XmlText(value);
    wrapper.insert(0, [text]);
    return wrapper;
  }

  private textRecord(element: Y.XmlElement): TextRecord {
    const logicalId = String(element.getAttribute(LID) ?? '');
    const child = element.get(0);
    const value = child instanceof Y.XmlText ? child.toString() : '';
    return { logicalId, kind: 'textValue', value };
  }

  private elementRecord(element: Y.XmlElement): ElementRecord {
    const attributes: EncodedAttribute[] = [];
    const bindings: EncodedBinding[] = [];
    const raw = element.getAttributes();
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value !== 'string') continue;
      if (key.startsWith('xmlns:')) {
        bindings.push({ prefix: key.slice(6), namespaceUri: value });
        continue;
      }
      const parsed = parseAttrKey(key);
      if (!parsed) continue;
      const prefix = raw[prefixKey(parsed.namespaceUri, parsed.localName)];
      attributes.push({
        namespaceUri: parsed.namespaceUri,
        localName: parsed.localName,
        prefix: typeof prefix === 'string' ? prefix : undefined,
        value,
      });
    }
    const childIds: LogicalId[] = [];
    element.forEach((child) => {
      if (child instanceof Y.XmlElement) {
        const lid = child.getAttribute(LID);
        if (typeof lid === 'string') childIds.push(lid);
      }
    });
    const prefix = element.getAttribute(PREFIX);
    return {
      logicalId: String(element.getAttribute(LID) ?? ''),
      kind: String(element.getAttribute(KIND) ?? 'generic'),
      namespaceUri: String(element.getAttribute(NS) ?? ''),
      localName: element.nodeName.includes(':')
        ? element.nodeName.slice(element.nodeName.indexOf(':') + 1)
        : element.nodeName,
      prefix: typeof prefix === 'string' && prefix.length > 0 ? prefix : undefined,
      attributes,
      bindings,
      childIds,
    };
  }

  private collectDirty(target: Y.AbstractType<unknown>, into: Set<LogicalId>): void {
    let current: unknown = target;
    while (current instanceof Y.XmlElement || current instanceof Y.XmlText) {
      if (current instanceof Y.XmlElement && current.doc) {
        try {
          const lid = current.getAttribute(LID);
          if (typeof lid === 'string') into.add(lid);
        } catch {
          break;
        }
      }
      current = current.parent;
    }
  }

  private textOf(logicalId: LogicalId): Y.XmlText {
    const wrapper = this.requireElement(logicalId);
    const child = wrapper.get(0);
    if (!(child instanceof Y.XmlText)) throw new Error(`no text at ${logicalId}`);
    return child;
  }

  private requireElement(logicalId: LogicalId): Y.XmlElement {
    const element = this.element(logicalId);
    if (!element) throw new Error(`xml node ${logicalId} missing`);
    return element;
  }

  private element(logicalId: LogicalId): Y.XmlElement | null {
    const pending = this.pending.get(logicalId);
    if (pending) return pending;
    return this.lookup(this.fragment, logicalId);
  }

  private lookup(node: Y.XmlFragment | Y.XmlElement, logicalId: LogicalId): Y.XmlElement | null {
    if (node instanceof Y.XmlElement && node.getAttribute(LID) === logicalId) return node;
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlElement) {
        const found = this.lookup(child, logicalId);
        if (found) return found;
      }
    }
    return null;
  }

  private takeLive(logicalId: LogicalId): Y.XmlElement {
    const pending = this.pending.get(logicalId);
    if (pending) {
      this.pending.delete(logicalId);
      return pending;
    }
    return this.requireElement(logicalId);
  }

  private childCount(element: Y.XmlElement): number {
    const prelim = (element as unknown as { _prelimContent: unknown[] | null })._prelimContent;
    if (prelim) return prelim.length;
    return element.length;
  }

  private cloneReminted(source: Y.XmlElement): Y.XmlElement {
    const nextId = `lid:xml-move:${this.mintSeq}`;
    this.mintSeq += 1;
    if (source.nodeName === TEXT_NAME) {
      const child = source.get(0);
      const value = child instanceof Y.XmlText ? child.toString() : '';
      return this.makeText(nextId, value);
    }
    const record = this.elementRecord(source);
    const clone = this.makeElement({
      logicalId: nextId,
      kind: String(source.getAttribute(KIND) ?? 'generic'),
      namespaceUri: String(source.getAttribute(NS) ?? ''),
      localName: record.localName,
      prefix: record.prefix,
      attributes: record.attributes,
      bindings: record.bindings,
    });
    const kids: Y.XmlElement[] = [];
    source.forEach((child) => {
      if (child instanceof Y.XmlElement) kids.push(this.cloneReminted(child));
    });
    if (kids.length > 0) clone.insert(0, kids);
    return clone;
  }
}
