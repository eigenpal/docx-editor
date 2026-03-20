import { C as CorePlugin } from './types-BhDofcWh.js';
export {
  b as CommandHandler,
  m as CommandResult,
  aJ as ExtractCommand,
  K as JsonSchema,
  N as LoadedDocument,
  O as McpSession,
  Q as McpToolAnnotations,
  S as McpToolContent,
  U as McpToolContext,
  M as McpToolDefinition,
  aK as McpToolExample,
  V as McpToolHandler,
  W as McpToolResult,
  a2 as PluginCommand,
  b as PluginCommandHandler,
  a3 as PluginEvent,
  c as PluginEventListener,
  P as PluginOptions,
  a as PluginRegistrationResult,
  M as ToolDefinition,
  V as ToolHandler,
  W as ToolResult,
  aL as TypedCommandHandler,
  am as ZodSchemaLike,
  au as isZodSchema,
} from './types-BhDofcWh.js';
export {
  P as PluginRegistry,
  c as createPluginRegistrar,
  p as pluginRegistry,
  r as registerPlugins,
} from './registry-ZDsXo2Ls.js';

/**
 * Docxtemplater Plugin
 *
 * Core plugin for template variable functionality using docxtemplater.
 *
 * **Command handlers** — `insertTemplateVariable` and `replaceWithTemplateVariable`
 * allow DocumentAgent to programmatically insert `{variable}` placeholders.
 *
 * @example
 * ```ts
 * import { pluginRegistry } from '@eigenpal/docx-editor/core-plugins';
 * import { docxtemplaterPlugin } from '@eigenpal/docx-editor/core-plugins/docxtemplater';
 *
 * pluginRegistry.register(docxtemplaterPlugin);
 * ```
 */

/**
 * Docxtemplater plugin for template variable functionality.
 *
 * Dependency validation is handled lazily by `processTemplate` at call time,
 * so no eager `initialize()` is needed.
 */
declare const docxtemplaterPlugin: CorePlugin;

export { CorePlugin, CorePlugin as Plugin, docxtemplaterPlugin };
