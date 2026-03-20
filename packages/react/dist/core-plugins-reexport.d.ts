import { C as CorePlugin } from './types-igZ1x_e4.js';
export {
  b as CommandHandler,
  d as CommandResult,
  E as ExtractCommand,
  J as JsonSchema,
  L as LoadedDocument,
  e as McpSession,
  f as McpToolAnnotations,
  g as McpToolContent,
  h as McpToolContext,
  M as McpToolDefinition,
  n as McpToolExample,
  i as McpToolHandler,
  j as McpToolResult,
  k as PluginCommand,
  b as PluginCommandHandler,
  l as PluginEvent,
  c as PluginEventListener,
  P as PluginOptions,
  a as PluginRegistrationResult,
  M as ToolDefinition,
  i as ToolHandler,
  j as ToolResult,
  T as TypedCommandHandler,
  Z as ZodSchemaLike,
  m as isZodSchema,
} from './types-igZ1x_e4.js';
export {
  P as PluginRegistry,
  c as createPluginRegistrar,
  p as pluginRegistry,
  r as registerPlugins,
} from './registry-CgWNVTk9.js';
import './agentApi-BVHzyk2l.js';

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
