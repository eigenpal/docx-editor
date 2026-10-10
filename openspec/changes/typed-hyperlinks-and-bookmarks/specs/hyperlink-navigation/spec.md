## ADDED Requirements

### Requirement: Clicks classify; the host page never navigates

The editing surface SHALL prevent native navigation for every anchor inside painted pages. A click with a collapsed selection on an external link SHALL open the hyperlink popover; on an internal link it SHALL navigate to the bookmark; a click ending a range selection SHALL do neither. External activation SHALL happen only through the popover's open action (or Ctrl/Cmd+Click), through a single call site invoking `window.open(sanitizedHref, '_blank', 'noopener,noreferrer')`.

#### Scenario: External click opens the popover, not the target

- **WHEN** the user clicks `Example.com` in paragraph 9.1 with a collapsed selection
- **THEN** the popover shows `https://example.com`, the host page URL is unchanged, and no new tab exists

#### Scenario: Range selection over a link does not pop

- **WHEN** a drag selection ends on the `Example.com` link
- **THEN** no popover opens and the selection stands

#### Scenario: Ctrl/Cmd+Click activates directly

- **WHEN** the user Ctrl/Cmd+Clicks `Example.com`
- **THEN** the sanitized target opens in a new tab with `noopener,noreferrer` and no popover appears

### Requirement: Internal links jump to their bookmark and place the caret

Clicking an internal link SHALL resolve its anchor through the bookmark index, scroll the target's page into view via layout geometry — including targets whose pages are virtualized and unpainted — and place the engine caret at the bookmark's paragraph position. No popover SHALL appear. An anchor with no matching bookmark SHALL be an inert click. Duplicate bookmark names resolve to the first in document order.

#### Scenario: Backward jump

- **WHEN** the user clicks `Section 1` in paragraph 9.2
- **THEN** the view scrolls backward until the `1. Text Formatting & Typography` heading is in the viewport and the caret sits at that paragraph

#### Scenario: Forward jump to an unpainted page

- **WHEN** the user clicks `Section 12 – Form Elements`, whose target lies several virtualized pages ahead
- **THEN** the view scrolls forward to the `12. Form Elements & Checkboxes` heading even though its page had no DOM at click time

#### Scenario: Dangling anchor is inert

- **WHEN** a hyperlink's `w:anchor` names a bookmark that does not exist
- **THEN** the click changes nothing: no scroll, no popover, no error
