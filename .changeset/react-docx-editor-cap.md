---
'@eigenpal/docx-editor-react': patch
---

Internal refactor: split DocxEditor.tsx (5158 → 3712 LOC, -28%) into focused hooks under `components/DocxEditor/hooks/` — useOutlineSidebar, useKeyboardShortcuts, useFileIO, usePageSetupControls, useHyperlinkActions, useFindReplaceBridge, useFormattingActions, useImageActions — plus 6 micro-components (CommentsSidebarToggle, LocalizedAgentPanel, PageIndicator, AgentPanelToggle, OutlineToggleButton, EditingModeDropdown) and a `commentFactories` module that hides the shared comment/revision ID counter behind getNextCommentId/bumpNextCommentIdAbove helpers. No public API change.
