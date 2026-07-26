import {
  createLayoutShaping,
  disposeLayoutShaping,
} from '../../packages/engine-editor/src/index.ts';
import { loadDemoFontConfiguration } from './demoFontShaping.ts';
import { mountDocxEditor, type EditorDriver, type MountedEditor } from './mountDocxEditor.ts';

export interface LifecycleDriver {
  readonly editable: boolean;
}

export interface LifecycleMount<Driver extends LifecycleDriver> {
  readonly driver: Driver;
  destroy(): void;
}

export interface DocxEditableLifecycleView<Driver extends LifecycleDriver> {
  getHost(): HTMLElement | null;
  publishDriver(driver: Driver): void;
  clearDriver(driver: Driver): void;
  setStatus(status: string): void;
  resetReopened(): void;
}

export interface DocxEditableLifecycleDependencies<
  Shaping,
  Mount extends LifecycleMount<LifecycleDriver>,
> {
  loadBytes(url: string): Promise<Uint8Array>;
  createShaping(): Promise<Shaping>;
  disposeShaping(shaping: Shaping): void;
  mount(root: HTMLElement, bytes: Uint8Array, shaping: Shaping): Promise<Mount>;
}

interface ActiveMount<Shaping, Mount extends LifecycleMount<LifecycleDriver>> {
  readonly host: HTMLElement;
  readonly ownedNodes: readonly Node[];
  readonly shaping: Shaping;
  readonly mount: Mount;
}

export class DocxEditableLifecycle<
  Driver extends LifecycleDriver,
  Shaping,
  Mount extends LifecycleMount<Driver>,
> {
  readonly #view: DocxEditableLifecycleView<Driver>;
  readonly #dependencies: DocxEditableLifecycleDependencies<Shaping, Mount>;
  #generation = 0;
  #active: ActiveMount<Shaping, Mount> | null = null;

  constructor(
    view: DocxEditableLifecycleView<Driver>,
    dependencies: DocxEditableLifecycleDependencies<Shaping, Mount>
  ) {
    this.#view = view;
    this.#dependencies = dependencies;
  }

  async load(url: string): Promise<void> {
    const generation = ++this.#generation;
    this.#releaseActive();
    this.#view.resetReopened();
    this.#view.setStatus('Loading…');
    let shaping: Shaping | null = null;
    try {
      const result = await Promise.all([
        this.#dependencies.loadBytes(url),
        this.#dependencies.createShaping(),
      ]);
      const [bytes, createdShaping] = result;
      shaping = createdShaping;
      const host = this.#view.getHost();
      if (!this.#isCurrent(generation) || !host) {
        this.#dependencies.disposeShaping(createdShaping);
        shaping = null;
        return;
      }

      const root = host.cloneNode(false) as HTMLElement;
      const stagingShell = attachStagingRoot(host, root);
      let candidate: Mount;
      try {
        candidate = await this.#dependencies.mount(root, bytes, createdShaping);
      } finally {
        stagingShell.remove();
      }
      if (!this.#isCurrent(generation) || this.#view.getHost() !== host) {
        candidate.destroy();
        this.#dependencies.disposeShaping(createdShaping);
        shaping = null;
        return;
      }

      const ownedNodes = [...root.childNodes];
      syncAttributes(host, root);
      host.replaceChildren(...ownedNodes);
      this.#active = { host, ownedNodes, shaping: createdShaping, mount: candidate };
      shaping = null;
      this.#view.publishDriver(candidate.driver);
      this.#view.setStatus(
        candidate.driver.editable ? 'Editable (paragraphs)' : 'Read-only (contains tables/SDTs)'
      );
    } catch (error) {
      if (shaping) this.#dependencies.disposeShaping(shaping);
      if (this.#isCurrent(generation)) {
        this.#view.setStatus(`Could not open this file (${String((error as Error).message)}).`);
      }
    }
  }

  dispose(): void {
    this.#generation += 1;
    this.#releaseActive();
  }

  #isCurrent(generation: number): boolean {
    return generation === this.#generation;
  }

  #releaseActive(): void {
    const active = this.#active;
    if (!active) return;
    this.#active = null;
    active.mount.destroy();
    this.#dependencies.disposeShaping(active.shaping);
    this.#view.clearDriver(active.mount.driver);
    for (const node of active.ownedNodes) {
      if (node.parentNode === active.host) node.remove();
    }
  }
}

function syncAttributes(target: HTMLElement, source: HTMLElement): void {
  for (const { name } of [...target.attributes]) {
    if (!source.hasAttribute(name)) target.removeAttribute(name);
  }
  for (const { name, value } of [...source.attributes]) target.setAttribute(name, value);
}

function attachStagingRoot(host: HTMLElement, root: HTMLElement): HTMLElement {
  const doc = host.ownerDocument;
  const shell = doc.createElement('div');
  const bounds = host.getBoundingClientRect();
  shell.dataset.docxEditableStaging = '';
  shell.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    `width:${Math.max(1, bounds.width)}px`,
    `height:${Math.max(1, bounds.height)}px`,
    'overflow:hidden',
    'opacity:0',
    'pointer-events:none',
  ].join(';');
  shell.append(root);
  (doc.body ?? doc.documentElement).append(shell);
  return shell;
}

type DemoShaping = Awaited<ReturnType<typeof createLayoutShaping>>;

export const defaultDocxEditableDependencies: DocxEditableLifecycleDependencies<
  DemoShaping,
  MountedEditor
> = {
  async loadBytes(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Document fetch failed (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  },
  async createShaping() {
    return createLayoutShaping(await loadDemoFontConfiguration());
  },
  disposeShaping: disposeLayoutShaping,
  mount: mountDocxEditor,
};

export type DemoDocxEditableLifecycle = DocxEditableLifecycle<
  EditorDriver,
  DemoShaping,
  MountedEditor
>;
