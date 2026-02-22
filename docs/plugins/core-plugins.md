# CorePlugin & MCP Integration

CorePlugins are **headless** plugins that work in Node.js without React or a DOM. They extend the `DocumentAgent` with custom command handlers and can expose tools to AI assistants through the [Model Context Protocol](https://modelcontextprotocol.io) (MCP).

## When to Use CorePlugin

Use a CorePlugin when you need:

- **Programmatic document manipulation** — command handlers that transform a `Document` object
- **AI integration** — tools callable by Claude Desktop, Cursor, or any MCP client
- **Headless automation** — scripts that process DOCX files without a browser

If you need UI panels, overlays, or ProseMirror decorations, use an [EditorPlugin](./editor-plugins.md) instead.

## CorePlugin Interface

```ts
interface CorePlugin {
  id: string;
  name: string;
  version?: string;
  description?: string;
  commandHandlers?: Record<string, CommandHandler>;
  mcpTools?: McpToolDefinition[];
  initialize?: () => void | Promise<void>;
  destroy?: () => void | Promise<void>;
  dependencies?: string[];
}
```

### Fields

| Field             | Required | Description                                  |
| ----------------- | -------- | -------------------------------------------- |
| `id`              | Yes      | Unique identifier                            |
| `name`            | Yes      | Human-readable name                          |
| `version`         | No       | Semver version string                        |
| `description`     | No       | Short description                            |
| `commandHandlers` | No       | Map of command type → handler function       |
| `mcpTools`        | No       | MCP tool definitions exposed to AI clients   |
| `initialize`      | No       | Called once during registration              |
| `destroy`         | No       | Cleanup on unregistration                    |
| `dependencies`    | No       | IDs of plugins that must be registered first |

## Command Handlers

A command handler is a pure function that receives a `Document` and a command, then returns a new `Document`:

```ts
type CommandHandler = (doc: Document, command: PluginCommand) => Document;

interface PluginCommand {
  type: string;
  id?: string;
  position?: Position;
  range?: Range;
  [key: string]: unknown;
}
```

Example:

```ts
import type { CorePlugin, PluginCommand } from '@eigenpal/docx-js-editor';
import type { Document } from '@eigenpal/docx-js-editor';

const myPlugin: CorePlugin = {
  id: 'watermark',
  name: 'Watermark',
  commandHandlers: {
    addWatermark(doc: Document, cmd: PluginCommand) {
      const text = (cmd as { text: string }).text;
      // ... transform doc to add watermark header
      return doc;
    },
  },
};
```

`DocumentAgent` dispatches commands to the matching handler:

```ts
import { pluginRegistry } from '@eigenpal/docx-js-editor';

pluginRegistry.register(myPlugin);

const handler = pluginRegistry.getCommandHandler('addWatermark');
if (handler) {
  const newDoc = handler(doc, { type: 'addWatermark', text: 'DRAFT' });
}
```

## PluginRegistry

The global `pluginRegistry` manages all CorePlugins:

```ts
import { pluginRegistry } from '@eigenpal/docx-js-editor';

// Register
pluginRegistry.register(myPlugin);

// Query
pluginRegistry.has('watermark'); // true
pluginRegistry.getAll(); // CorePlugin[]
pluginRegistry.getCommandTypes(); // ['addWatermark']

// MCP tools
pluginRegistry.getMcpTools(); // McpToolDefinition[]
pluginRegistry.getMcpTool('add_watermark');

// Unregister
pluginRegistry.unregister('watermark');

// Batch registration
import { registerPlugins } from '@eigenpal/docx-js-editor';
registerPlugins([pluginA, pluginB]);
```

## MCP Tools

### What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io) is an open standard that lets AI assistants (Claude Desktop, Cursor, etc.) call tools provided by local servers. The docx-editor ships an MCP server that collects tools from all registered CorePlugins, so AI can **programmatically read, modify, and validate DOCX files** without manual UI interaction.

### Defining MCP Tools

Each tool has a name, description (shown to the AI), an input schema, and a handler:

```ts
import type { McpToolDefinition, McpToolContext } from '@eigenpal/docx-js-editor';

const addWatermarkTool: McpToolDefinition = {
  name: 'add_watermark',
  description: 'Add a text watermark to the document header',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Watermark text' },
      opacity: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['text'],
  },
  handler: async (input, context: McpToolContext) => {
    const { text } = input as { text: string };
    // context.document — current Document (if loaded)
    // context.session  — persistent session state
    // context.log()    — debug logger
    return {
      content: [{ type: 'text', text: `Watermark "${text}" added` }],
    };
  },
};
```

Then attach the tool to your plugin:

```ts
const watermarkPlugin: CorePlugin = {
  id: 'watermark',
  name: 'Watermark',
  mcpTools: [addWatermarkTool],
};
```

### McpToolContext

```ts
interface McpToolContext {
  document?: Document; // Current document (if loaded)
  documentBuffer?: ArrayBuffer; // Raw DOCX bytes (if loaded)
  session: McpSession; // Persistent session state
  log: (msg: string, data?: unknown) => void;
}
```

### McpToolResult

Handlers return content blocks:

```ts
interface McpToolResult {
  content: McpToolContent[];
  isError?: boolean;
}

type McpToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; uri: string; mimeType?: string; text?: string };
```

## Starting the MCP Server

The package includes a stdio-based MCP server:

```ts
import { pluginRegistry, docxtemplaterPlugin } from '@eigenpal/docx-js-editor';
import { startStdioServer } from '@eigenpal/docx-js-editor/mcp';

pluginRegistry.register(docxtemplaterPlugin);
startStdioServer({ debug: true });
```

Or use the CLI entry point:

```bash
npx docx-editor-mcp
```

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "docx-editor": {
      "command": "npx",
      "args": ["docx-editor-mcp"]
    }
  }
}
```

After restarting Claude Desktop, the tools from all registered plugins appear in the tool picker.

## Reference Implementation: Docxtemplater Plugin

The built-in `docxtemplaterPlugin` in `src/core-plugins/docxtemplater/` is a full reference:

- **Command handlers**: `insertTemplateVariable`, `replaceWithTemplateVariable`
- **MCP tools**: `get_template_variables`, `insert_template_variable`, `apply_template`, `validate_template`
- Lazy dependency validation — `processTemplate` checks for `docxtemplater`/`pizzip` at call time

```ts
import { pluginRegistry, docxtemplaterPlugin } from '@eigenpal/docx-js-editor';

pluginRegistry.register(docxtemplaterPlugin);
// AI can now call get_template_variables, apply_template, etc.
```

## Next Steps

- [EditorPlugin API](./editor-plugins.md) — browser-side UI plugins
- [Examples & Cookbook](./examples.md) — advanced patterns
- [Getting Started](./getting-started.md) — overview and hello world
