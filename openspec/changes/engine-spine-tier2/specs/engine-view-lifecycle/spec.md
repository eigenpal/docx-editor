## ADDED Requirements

### Requirement: PM view lifecycle (body + per-rId HF)

The engine SHALL own the body EditorView and a `Map<rId, EditorView>` of header/footer views, creating each through the host's `mountView(hostEl, state, dispatch)` and tearing down through `destroyView`. `engine.syncHfViews(document)` SHALL enumerate the document's header/footer rIds (deduped per ECMA-376 — an rId appearing as both header and footer registers once), mount missing views, tear down removed ones (view + mount node + per-rId ExtensionManager), and write each HF view's doc back to `Document` content on `docChanged`. The reactive-vs-imperative trigger for `syncHfViews` stays adapter-side.

#### Scenario: HF views mount/teardown on document change

- **WHEN** `syncHfViews(document)` runs after a document with two headers and one footer loads
- **THEN** three EditorViews exist (deduped by rId), each in a mount node under the HF host, with its ExtensionManager

#### Scenario: Removed rId tears down cleanly

- **WHEN** a document no longer contains a previously-present rId
- **THEN** `syncHfViews` destroys that view, removes its mount node, destroys its ExtensionManager, and drops it from the map

#### Scenario: HF writeback on edit

- **WHEN** a header/footer EditorView dispatches a doc-changing transaction
- **THEN** the engine writes the new content back to the matching `HeaderFooter` in the Document

#### Scenario: Both triggers supported

- **WHEN** React drives `syncHfViews` from a reactive effect and Vue drives it from an imperative call on load
- **THEN** both produce the same view map and writeback behavior
