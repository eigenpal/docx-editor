# CorePlugin & Headless API

## What is the Headless API?

The package has two entry points:

```
src/index.ts      → Browser editor (React, needs DOM)
src/headless.ts   → Headless API (Node.js, no DOM needed)
```

The headless API gives you `DocumentAgent`, parsers, serializers, and template processing — everything you need to manipulate DOCX files programmatically in Node.js. No browser, no React, no ProseMirror.

```ts
import { DocumentAgent, parseDocx, processTemplate } from '@eigenpal/docx-js-editor/headless';
```

**CorePlugins** extend the headless API with custom command handlers. They're the server-side equivalent of EditorPlugins.

## When to Use the Headless API

- **API routes** — fill templates, generate documents server-side
- **CI/CD pipelines** — validate templates, extract variables
- **Node.js scripts** — batch-process DOCX files
- **Server-side agents** — programmatic document manipulation

If you need UI panels, overlays, or ProseMirror decorations, use an [EditorPlugin](./editor-plugins.md) instead.

## DocumentAgent

`DocumentAgent` is the main entry point for headless document manipulation:

```ts
import { DocumentAgent } from '@eigenpal/docx-js-editor/headless';
import fs from 'fs';

// Load a DOCX file
const buffer = fs.readFileSync('template.docx');
const agent = await DocumentAgent.fromBuffer(buffer);

// Read content
console.log('Word count:', agent.getWordCount());
console.log('Variables:', agent.getVariables());

// Edit
const edited = agent
  .insertText({ paragraphIndex: 0, offset: 0 }, 'Hello ')
  .applyStyle(0, 'Heading1');

// Fill template variables
const filled = await edited.applyVariables({
  customer_name: 'Jane Doe',
  date: '2024-02-15',
});

// Export
const output = await filled.toBuffer();
fs.writeFileSync('output.docx', Buffer.from(output));
```

### In a Next.js API Route

```ts
// app/api/fill-template/route.ts
import { processTemplate } from '@eigenpal/docx-js-editor/headless';

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get('file') as File;
  const variables = JSON.parse(formData.get('variables') as string);

  const buffer = await file.arrayBuffer();
  const filled = await processTemplate(buffer, variables);

  return new Response(filled, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  });
}
```

### Template Processing Utilities

```ts
import {
  processTemplate,
  getTemplateTags,
  validateTemplate,
} from '@eigenpal/docx-js-editor/headless';

// Get all template variables from a DOCX
const tags = await getTemplateTags(buffer);
// → ['name', 'date', 'items', 'total']

// Validate template syntax
const result = await validateTemplate(buffer);
// → { valid: true } or { valid: false, errors: [...] }

// Fill template with data
const filled = await processTemplate(buffer, {
  name: 'Jane Doe',
  date: '2024-02-15',
  items: [{ name: 'Widget', price: 9.99 }],
  total: '$9.99',
});
```

## CorePlugin Interface

CorePlugins extend `DocumentAgent` with custom command handlers:

```ts
interface CorePlugin {
  id: string;
  name: string;
  version?: string;
  description?: string;
  commandHandlers?: Record<string, CommandHandler>;
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

Example — a plugin that adds watermark text:

```ts
import type { CorePlugin, PluginCommand } from '@eigenpal/docx-js-editor';
import type { Document } from '@eigenpal/docx-js-editor';

const watermarkPlugin: CorePlugin = {
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

Use it:

```ts
import { pluginRegistry } from '@eigenpal/docx-js-editor';

pluginRegistry.register(watermarkPlugin);

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

// Unregister
pluginRegistry.unregister('watermark');

// Batch registration
import { registerPlugins } from '@eigenpal/docx-js-editor';
registerPlugins([pluginA, pluginB]);
```

## Reference Implementation: Docxtemplater Plugin

The built-in `docxtemplaterPlugin` in `src/core-plugins/docxtemplater/` is a full reference:

- **Command handlers**: `insertTemplateVariable`, `replaceWithTemplateVariable`
- Lazy dependency validation — `processTemplate` checks for `docxtemplater`/`pizzip` at call time

```ts
import { pluginRegistry, docxtemplaterPlugin } from '@eigenpal/docx-js-editor';

pluginRegistry.register(docxtemplaterPlugin);

// Now DocumentAgent can dispatch insertTemplateVariable commands
```

Note: there is also a separate **EditorPlugin** for template UI (`src/plugins/template/`) that handles syntax highlighting and the annotation panel in the browser. The two systems are independent but complement each other — a single feature can span both.

## Next Steps

- [EditorPlugin API](./editor-plugins.md) — browser-side UI plugins
- [Examples & Cookbook](./examples.md) — advanced patterns
- [Getting Started](./getting-started.md) — overview and hello world
