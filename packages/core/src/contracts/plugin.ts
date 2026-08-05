/**
 * `@docx-editor.dev/core/contracts/plugin` — extension and command authoring.
 *
 * Separate from `core/editor` because plugin authors and adapter authors are different
 * audiences: this contract is meant to move slower than the engine.
 *
 * CONTRACT ONLY — declarations, not an implementation.
 *
 * @packageDocumentation
 * @public
 */

import type { Extension, JSONSchema, Unsubscribe } from './types';
import type { Editor, EditorCommand, EditorSnapshot } from './editor';

// `Extension` lives in `core/types` (the leaf) to avoid the editor↔plugin
// cycle; re-exported here so plugin authors and adapters share one identity.
export type { Editor, EditorCommand, EditorSnapshot, Extension };

const NOT_IMPLEMENTED = 'contract-only stub: no implementation';

/** The base every extension declares: a name, and the commands it contributes. */
export interface ExtensionSpec {
  name: string;
  commands?: Record<string, (...args: never[]) => unknown>;
}

/** An extension that also contributes a node type to the schema. */
export interface NodeExtensionSpec extends ExtensionSpec {
  nodeSpec: unknown;
}

/** An extension that also contributes a mark type to the schema. */
export interface MarkExtensionSpec extends ExtensionSpec {
  markSpec: unknown;
}

/** Per-extension options for {@link createStarterKit}, keyed by extension name. */
export interface StarterKitOptions {
  readonly [key: string]: unknown;
}

/**
 * Build a plain extension: commands and behaviour, no schema contribution.
 *
 * CONTRACT ONLY — this stub always throws.
 *
 * @throws Always, in this contract-only module.
 */
export function createExtension(_spec: ExtensionSpec): Extension {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Build an extension that adds a node type to the schema.
 *
 * CONTRACT ONLY — this stub always throws.
 *
 * @throws Always, in this contract-only module.
 */
export function createNodeExtension(_spec: NodeExtensionSpec): Extension {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Build an extension that adds a mark type to the schema.
 *
 * CONTRACT ONLY — this stub always throws.
 *
 * @throws Always, in this contract-only module.
 */
export function createMarkExtension(_spec: MarkExtensionSpec): Extension {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * The default extension bundle, configurable per extension.
 *
 * CONTRACT ONLY — this stub always throws.
 *
 * @throws Always, in this contract-only module.
 */
export function createStarterKit(_options?: StarterKitOptions): Extension[] {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Extension authors widen the command union AND register a runtime schema:
 *
 *   declare module '@docx-editor.dev/core/editor' {
 *     interface EditorCommands { myThing: { foo: string } }
 *   }
 *   registerCommandSchema('myThing', { type: 'object', ... });
 */
export function registerCommandSchema(_type: string, _schema: JSONSchema): void {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * A plugin: a named unit of behaviour set up against a live editor.
 *
 * Distinct from an {@link Extension}, which contributes to the SCHEMA. A plugin contributes
 * behaviour, and returns its own teardown from `setup`.
 */
export interface EditorPlugin {
  readonly name: string;
  /** Returns an unsubscribe to run at teardown, or nothing when there is none. */
  setup(context: PluginContext): Unsubscribe | void;
}

/**
 * What a plugin's `setup` is handed: the editor, a state subscription, and painted-page access.
 *
 * {@link PluginContext.getRenderedPage} is the one DOM-facing member, for plugins that must
 * overlay the painted surface. It answers null for a page that is not currently laid out.
 */
export interface PluginContext {
  readonly editor: Editor;
  subscribe(handler: (snapshot: EditorSnapshot) => void): Unsubscribe;
  getRenderedPage(pageNumber: number): RenderedPage | null;
}

/** One painted page, for plugins that position their own overlays against it. */
export interface RenderedPage {
  /** One-based, matching what a reader sees. */
  readonly pageNumber: number;
  readonly element: HTMLElement;
}
