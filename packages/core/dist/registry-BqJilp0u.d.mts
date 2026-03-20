import { C as CorePlugin, P as PluginOptions, a as PluginRegistrationResult, b as CommandHandler, M as McpToolDefinition, c as PluginEventListener } from './types-BhDofcWh.mjs';

/**
 * Plugin Registry
 *
 * Central registry for core plugins. Manages plugin lifecycle,
 * collects command handlers from all plugins, and aggregates
 * MCP tool definitions for the MCP server.
 */

/**
 * Plugin Registry - manages core plugins
 *
 * @example
 * ```ts
 * import { pluginRegistry, docxtemplaterPlugin } from '@eigenpal/docx-editor/core-plugins';
 *
 * // Register plugins
 * pluginRegistry.register(docxtemplaterPlugin);
 *
 * // Get all MCP tools for MCP server
 * const tools = pluginRegistry.getMcpTools();
 *
 * // Get command handler for executor
 * const handler = pluginRegistry.getCommandHandler('insertTemplateVariable');
 * ```
 */
declare class PluginRegistry {
    private plugins;
    private commandHandlers;
    private eventListeners;
    private initialized;
    /**
     * Register a plugin
     *
     * @param plugin - The plugin to register
     * @param options - Optional configuration
     * @returns Registration result
     */
    register(plugin: CorePlugin, options?: PluginOptions): PluginRegistrationResult;
    /**
     * Unregister a plugin
     *
     * @param pluginId - ID of the plugin to unregister
     * @returns Whether unregistration succeeded
     */
    unregister(pluginId: string): boolean;
    /**
     * Get a registered plugin by ID
     *
     * @param id - Plugin ID
     * @returns The plugin or undefined
     */
    get(id: string): CorePlugin | undefined;
    /**
     * Get all registered plugins
     *
     * @returns Array of all plugins
     */
    getAll(): CorePlugin[];
    /**
     * Check if a plugin is registered
     *
     * @param id - Plugin ID
     * @returns Whether the plugin is registered
     */
    has(id: string): boolean;
    /**
     * Get number of registered plugins
     */
    get size(): number;
    /**
     * Get a command handler for a command type
     *
     * @param commandType - The command type
     * @returns The handler or undefined
     */
    getCommandHandler(commandType: string): CommandHandler | undefined;
    /**
     * Get all registered command types
     *
     * @returns Array of command type strings
     */
    getCommandTypes(): string[];
    /**
     * Check if a command type has a handler
     *
     * @param commandType - The command type
     * @returns Whether a handler exists
     */
    hasCommandHandler(commandType: string): boolean;
    /**
     * Get all MCP tools from all registered plugins
     *
     * @returns Array of MCP tool definitions
     */
    getMcpTools(): McpToolDefinition[];
    /**
     * Get MCP tools from a specific plugin
     *
     * @param pluginId - Plugin ID
     * @returns Array of MCP tool definitions
     */
    getMcpToolsForPlugin(pluginId: string): McpToolDefinition[];
    /**
     * Get an MCP tool by name
     *
     * @param toolName - Tool name
     * @returns The tool definition or undefined
     */
    getMcpTool(toolName: string): McpToolDefinition | undefined;
    /**
     * Add an event listener
     *
     * @param listener - Event listener function
     */
    addEventListener(listener: PluginEventListener): void;
    /**
     * Remove an event listener
     *
     * @param listener - Event listener function
     */
    removeEventListener(listener: PluginEventListener): void;
    /**
     * Emit an event to all listeners
     */
    private emit;
    /**
     * Clear all registered plugins
     *
     * Useful for testing or resetting state.
     */
    clear(): void;
    /**
     * Get registry state for debugging
     */
    getDebugInfo(): {
        plugins: string[];
        commandTypes: string[];
        mcpTools: string[];
        initialized: string[];
    };
}
/**
 * Global plugin registry instance
 *
 * Use this for registering plugins and accessing their capabilities.
 */
declare const pluginRegistry: PluginRegistry;
/**
 * Register multiple plugins at once
 *
 * @param plugins - Array of plugins to register
 * @returns Array of registration results
 */
declare function registerPlugins(plugins: CorePlugin[], options?: PluginOptions): PluginRegistrationResult[];
/**
 * Create a plugin registration helper with options pre-configured
 *
 * @param options - Default options for plugin registration
 * @returns Registration function
 */
declare function createPluginRegistrar(options: PluginOptions): (plugin: CorePlugin) => PluginRegistrationResult;

export { PluginRegistry as P, createPluginRegistrar as c, pluginRegistry as p, registerPlugins as r };
