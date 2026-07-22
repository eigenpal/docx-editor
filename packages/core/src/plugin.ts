/**
 * `@docx-editor.dev/core/plugin` — extension and command authoring.
 *
 * Separate from `core/editor` because plugin authors and adapter authors are
 * different audiences: the plugin contract should move slower than the engine.
 *
 * CONTRACT ONLY.
 */

import type { Extension, JSONSchema, Unsubscribe } from './types';
import type { Editor, EditorCommand, EditorSnapshot } from './editor';

// `Extension` lives in `core/types` (the leaf) to avoid the editor↔plugin
// cycle; re-exported here so plugin authors and adapters share one identity.
export type { Editor, EditorCommand, EditorSnapshot, Extension };

const NOT_IMPLEMENTED = 'contract-only stub: no implementation';
export interface ExtensionSpec {
  name: string;
  commands?: Record<string, (...args: never[]) => unknown>;
}
export interface NodeExtensionSpec extends ExtensionSpec {
  nodeSpec: unknown;
}
export interface MarkExtensionSpec extends ExtensionSpec {
  markSpec: unknown;
}
export interface StarterKitOptions {
  readonly [key: string]: unknown;
}

export function createExtension(_spec: ExtensionSpec): Extension {
  throw new Error(NOT_IMPLEMENTED);
}
export function createNodeExtension(_spec: NodeExtensionSpec): Extension {
  throw new Error(NOT_IMPLEMENTED);
}
export function createMarkExtension(_spec: MarkExtensionSpec): Extension {
  throw new Error(NOT_IMPLEMENTED);
}
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

export interface EditorPlugin {
  readonly name: string;
  setup(context: PluginContext): Unsubscribe | void;
}

export interface PluginContext {
  readonly editor: Editor;
  subscribe(handler: (snapshot: EditorSnapshot) => void): Unsubscribe;
  getRenderedPage(pageNumber: number): RenderedPage | null;
}

export interface RenderedPage {
  readonly pageNumber: number;
  readonly element: HTMLElement;
}
