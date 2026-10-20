# Unsupported content consumer trial

This demo uses the built public React and Vue package exports.
It adds a graphic review card with details and a local annotation field.
Annotations stay in component state. They do not change the saved DOCX.

From the repository root, build the packages if needed:

```sh
bun run build:packages
cd examples/unsupported-content-trial
bun run dev
```

Open http://127.0.0.1:5199 for React. Select **Open Vue trial** for Vue.
Select **Custom placeholders** to restore built-in fallbacks.
Select **Change zoom** to test component state through a repaint.

The card keeps the original document layout box. Small inline boxes limit card space.
Use app-level state keyed by `nodeId` when annotations must survive unmounting.
The example reads the canonical fixture through Vite's asset URL import.
The Vite aliases choose built workspace packages without installing a second engine.

Run the interaction checks from another terminal at the repository root:

```sh
node examples/unsupported-content-trial/browser-trial.mjs
```

The checks use the installed macOS Google Chrome application.
See [FEEDBACK.md](./FEEDBACK.md) for verified results and trial limits.
