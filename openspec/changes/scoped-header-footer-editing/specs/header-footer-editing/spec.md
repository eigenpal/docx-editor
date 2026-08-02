## REMOVED Requirements

Every requirement below describes the previous dual-renderer architecture: a hidden ProseMirror `EditorView` mounted per header/footer `rId`, with the painter rendering that view's document. That architecture no longer exists. Painted pages **are** the editable surface, and none of the named symbols (`InlineHeaderFooterEditor`, `HiddenHeaderFooterPMs`, `renderHeaderFooterContent`, `OffscreenEditorHost`, `.hf-editor-pm`) has any occurrence under `packages/`.

These are removed rather than modified because the mechanism they constrain is gone. The *behaviour* they protected — one visible renderer, clicks reaching the right editing surface, carets and selections drawn for header and footer regions, toolbar commands applying to the focused region, and React/Vue parity — is restated over the painted surface in `header-footer-authoring-surface`.

### Requirement: Single visible renderer for header and footer content

Superseded. There is no second visible ProseMirror view to forbid; the painter is the only renderer by construction. `header-footer-authoring-surface` carries the replacement rule that header/footer chrome is UI only and contributes no layout records.

### Requirement: Persistent hidden HF ProseMirror EditorView per distinct part

Superseded. Editing is a scope on the painted surface, not a mounted view per `rId`. `header-footer-authoring-surface` defines entering and leaving that scope.

### Requirement: PM projection synced to Document model

Superseded. `TreeDocumentStore` is canonical and the only write path; there is no HF-specific projection to keep in sync.

### Requirement: Painter consumes HF PM document directly

Superseded. The painter consumes semantic layout records produced from the canonical tree.

### Requirement: Click in painted HF routes to HF PM

Superseded by semantic interaction: a pointer event resolves through the semantic hit test, and `section-page-furniture` decides which part the hit page resolves to.

### Requirement: Selection overlay draws HF carets and selections

Superseded. Caret and selection geometry come from semantic layout records for every scope, with no HF-specific overlay path.

### Requirement: Toolbar commands route to focused EditorView

Superseded. Commands apply to the active `EditorScope`; there is no `EditorView` to route to.

### Requirement: Removal of `.hf-editor-pm` CSS patches

Already satisfied and no longer meaningful: the CSS, the components it patched, and the layout mismatch it worked around are all gone.

### Requirement: React and Vue adapter parity

Retained as an obligation, relocated. Parity is gated by `paragraph-adapter-acceptance`, and this change ships React only by request — recorded in its `tasks.md` §9.1 as an open follow-up rather than a satisfied requirement.

### Requirement: Behavioral parity with current HF capabilities

Superseded. The capabilities this protected were parity against the previous implementation; the replacement baseline is the per-section resolution, variant selection, and field behaviour specified in `section-page-furniture` and `header-footer-fields`.
