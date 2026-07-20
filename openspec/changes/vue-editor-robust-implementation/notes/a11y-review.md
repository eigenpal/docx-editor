# Vue Agent UI — Accessibility Review (1.0.0-release, tip a6179f6)

Static axe-core-style review of the seven Vue components under `packages/agent-use/src/vue/components/`. No tools were run; all findings come from reading the templates and inline styles.

## What's already well-covered

The library has its a11y fundamentals right in many places. `AgentPanel.vue:16` declares `role="complementary"` with an `aria-label`. `AgentPanel.vue:21–27` correctly uses `role="separator"` with `aria-orientation="vertical"` and a translatable `aria-label` for the resize handle. Every decorative SVG carries `aria-hidden="true"` (`AgentPanel.vue:37,55`, `AgentComposer.vue:26`, `AgentTimeline.vue:16,27,40,51,68`). Icon-only buttons that need labels have them: the close button (`AgentPanel.vue:47`), the send button (`AgentComposer.vue:22`), and the preview close (`AIResponsePreview.vue:13`). The chat error path uses `role="alert"` (`AgentChatLog.vue:31`), and the timeline toggle is a real `<button>` with `aria-expanded` (`AgentTimeline.vue:8–11`). Touch targets are comfortably above the WCAG 2.5.8 24×24 floor — close button is ~30×30, send button is 36×36, suggestion chip is full-width.

## Findings

### Roles + labels — no findings beyond items called out below.

### Keyboard reachability — high severity

- `AgentPanel.vue:21–27` — the `role="separator"` resize handle has only a `pointerdown` listener. No `tabindex="0"`, no `keydown` arrow handler, no `aria-valuenow`/`aria-valuemin`/`aria-valuemax`. Per W3C ARIA APG, a window-splitter separator MUST be keyboard-operable (Left/Right or Up/Down to resize, Home/End to snap). Today a keyboard-only or screen-reader user cannot resize the panel. **High** — fix before 1.0 or downgrade the role to a non-focusable visual handle and document the gap.
- `AIContextMenu.vue:17–25` — items are `<button>` elements (good), but there's no roving tabindex, no `role="menu"`/`role="menuitem"` wrapper, and no arrow-key navigation between items. Acceptable as a button list, but the `.ai-ctx-menu__header` (`:16`) is a `<div>` rather than acting as the menu's accessible name (e.g., labelling via `aria-labelledby`). **Medium**.

### Focus management — high severity

- `AgentPanel.vue` — when `closed` flips false→true the panel becomes `aria-hidden` and `pointer-events: none`, but focus inside the panel is not moved. If the close button itself had focus when clicked, focus is left orphaned on a hidden element. No `focus()` call on the trigger or document body. **Medium**.
- `AgentPanel.vue` open transition — focus is not auto-routed to the close button or composer input on open. **Low** (debatable; some users prefer focus to stay put).
- `AIContextMenu.vue:9–35` — Teleported menu opens with no focus trap, no autofocus on the first item or on `customPrompt` input, and no `keydown.esc` listener. Closing requires a click on the backdrop. Keyboard users cannot dismiss it; screen-reader users get no announcement. **High**.
- `AIResponsePreview.vue:7` — modal-style preview card has no Escape handler, no focus trap, no autofocus on Accept. **Medium**.

### Live regions — medium severity

- `AgentChatLog.vue:7` — the chat log root has no `role="log"` or `aria-live="polite"`, so newly appended assistant messages aren't announced. The "thinking" dots bubble at `:26` has an `aria-label` but no `aria-live`, so the label is only read if a user navigates to it. **Medium** — add `role="log"` `aria-live="polite"` to the root, and `aria-live="polite"` `aria-atomic="true"` on the thinking bubble.

### Color contrast — medium/low severity

Hand-checked WCAG AA pairs from the inline styles:

- `#0b57d0` on `#ffffff` (panel icon, user bubble bg, send button) — 5.17:1, **passes** AA for normal text and UI.
- `#1f1f1f` on `#ffffff` and on `#f0f4f9` (assistant bubble) — both >12:1, pass.
- `#5f6368` on `#ffffff` (footnote, dot color, chevron) — 5.9:1, passes AA normal text.
- `#444746` on `#ffffff` (close button, timeline item) — 9.3:1, pass.
- `#b3261e` on `#fce8e6` (error bubble, `AgentChatLog.vue:182–192`) — ~4.8:1, **passes** AA normal but tight; OK.
- `#6b7280` on `#ffffff` (`AIContextMenu.vue:137`, `AIResponsePreview.vue:171`) — 4.69:1, passes AA normal text but is just below 4.5 if rendered at 11px in some browsers' anti-aliasing; uppercase 11px headers (`AIResponsePreview.vue:206`) are visually small. **Low** — bump to `#5f6368` for safety on the small-caps labels.
- `#1a73e8` on `#f0f4ff` (`AIResponsePreview.vue:170`) — 4.4:1, **fails** AA 4.5:1 for normal text (13px, weight 600 is borderline large). **Medium** — darken to `#1557b0` (already used for hover) or strengthen the background.

### Form semantics — medium severity

- `AgentComposer.vue:13–19` — `<input>` has only `:placeholder`, no `<label>`, no `aria-label`, no `aria-labelledby`. Placeholders are not accessible names per WCAG 3.3.2 / WAI-ARIA. **Medium** — add `:aria-label="placeholder"` (and a separate `inputLabel` i18n key would be cleaner).
- `AIContextMenu.vue:28–33` — custom-prompt `<input>` has only `:placeholder`. Same issue. **Medium**.
- `AIResponsePreview.vue:44–49` — `<textarea>` has no label. **Medium**.

### Escape / dismiss — medium severity

None of `AgentPanel.vue`, `AIContextMenu.vue`, or `AIResponsePreview.vue` listens for `keydown.esc`. AIContextMenu in particular is the worst offender (see Focus management). **Medium across all three.**

### Tooltips and ARIA descriptions — no findings

`AgentPanel.vue:48` correctly pairs `:aria-label` with `:title` so the accessible name is the aria-label, not the tooltip. Good.

### Touch target size — no findings

All interactive controls meet WCAG 2.5.8 (24×24): close button ~30×30 (`AgentPanel.vue:261` padding 6 around an 18px svg), send button 36×36 (`AgentComposer.vue:75–76`), suggestion chip full-width with 10px+14px padding (`AgentSuggestionChip.vue:24`), context-menu items 7px+14px padding × full width.

### Miscellaneous

- `AIContextMenu.vue:78–87` — emoji icons are rendered via `v-html` with HTML entities (`&#x270D;` etc.). Emoji is read by screen readers as its Unicode name (e.g., "writing hand"), which competes with the label that follows. Wrap the icon span with `aria-hidden="true"` (the `class="ai-ctx-menu__icon"` span at `:23`). **Low**.
- `AgentTimeline.vue:40` — `▾` chevron is a Unicode character inside a span marked `aria-hidden="true"`. Good.
- `AgentChatLog.vue:21` — `whiteSpace: 'pre-wrap'` preserves user newlines but `{{ m.text }}` (no markdown) is fine; no `dangerouslySetInnerHTML` equivalent in scope.
- `AgentSuggestionChip.vue` — relies on visible text label, which is correct. No findings.

## Verdict

**Take separate PRs for required follow-ups; ship 1.0.0 as-is is acceptable but not ideal.** The two high-severity items (separator keyboard support, AIContextMenu focus/Escape) are real WCAG 2.1 AA failures, but each is contained, well-understood, and fixable in a small PR. The 1.0.0 train is about the rename and Vue parity, not greenfield a11y work — file these as fast-follow issues and land them in 1.0.1/1.0.2. The medium items (live region, form labels, color tweaks) bundle naturally into one a11y polish PR.

## What axe-core would flag if run

1. `aria-input-field-name` / `label` — input in `AgentComposer.vue`, custom-prompt input in `AIContextMenu.vue`, textarea in `AIResponsePreview.vue` (no accessible name).
2. `aria-required-children` / role-specific keyboard — `role="separator"` without `aria-valuenow` and tabindex (`AgentPanel.vue:21`).
3. `color-contrast` — `#1a73e8` on `#f0f4ff` title text (`AIResponsePreview.vue:170`) and possibly `#6b7280` 11px caps in the same file.
4. `aria-dialog-name` / focus management — `AIContextMenu.vue` Teleport renders an interactive overlay with no role, no Escape, and no trap (axe's `dialog` rules + Deque's "modal without focus management" pattern).
5. No `aria-live`/`role="log"` — axe's experimental rules and ARC Toolkit will flag the chat log root for missing live region semantics on a stream of new content.
