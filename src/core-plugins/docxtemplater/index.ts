/**
 * Docxtemplater Plugin
 *
 * Core plugin for template variable functionality using docxtemplater.
 *
 * **Command handlers** — `insertTemplateVariable` and `replaceWithTemplateVariable`
 * allow DocumentAgent to programmatically insert `{variable}` placeholders.
 *
 * **MCP tools** — `get_template_variables`, `insert_template_variable`,
 * `apply_template`, and `validate_template` are exposed to AI clients
 * (e.g., Claude Desktop) through the MCP server. This lets AI assistants
 * inspect and manipulate template variables without manual UI interaction.
 *
 * @example
 * ```ts
 * import { pluginRegistry } from '@eigenpal/docx-editor/core-plugins';
 * import { docxtemplaterPlugin } from '@eigenpal/docx-editor/core-plugins/docxtemplater';
 *
 * pluginRegistry.register(docxtemplaterPlugin);
 * ```
 */

import type { CorePlugin } from '../types';
import { handleInsertTemplateVariable, handleReplaceWithTemplateVariable } from './handlers';
import { docxtemplaterMcpTools } from './mcp-tools';

// ============================================================================
// PLUGIN DEFINITION
// ============================================================================

/**
 * Docxtemplater plugin for template variable functionality.
 *
 * Dependency validation is handled lazily by `processTemplate` at call time,
 * so no eager `initialize()` is needed.
 */
export const docxtemplaterPlugin: CorePlugin = {
  id: 'docxtemplater',
  name: 'Docxtemplater',
  version: '1.0.0',
  description: 'Template variable support using standard docxtemplater syntax ({variable})',

  /**
   * Command handlers for template operations.
   * DocumentAgent dispatches `insertTemplateVariable` and
   * `replaceWithTemplateVariable` commands to these handlers.
   */
  commandHandlers: {
    insertTemplateVariable: handleInsertTemplateVariable,
    replaceWithTemplateVariable: handleReplaceWithTemplateVariable,
  },

  /**
   * MCP tools exposed to AI clients (e.g., Claude Desktop).
   * The MCP server aggregates these from all registered plugins
   * and makes them callable over the Model Context Protocol.
   */
  mcpTools: docxtemplaterMcpTools,
};

// ============================================================================
// EXPORTS
// ============================================================================

// Export handlers for direct use
export {
  handleInsertTemplateVariable,
  handleReplaceWithTemplateVariable,
  type InsertTemplateVariableCommand,
  type ReplaceWithTemplateVariableCommand,
} from './handlers';

// Export MCP tools for customization
export {
  docxtemplaterMcpTools,
  getVariablesTool,
  insertVariableTool,
  applyTemplateTool,
  validateTemplateTool,
} from './mcp-tools';
