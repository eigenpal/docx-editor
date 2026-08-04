# Table editing interaction polish

## Scope

This follow-up fixes three problems found during review of the Word-like table editing
work:

1. Table border color and cell fill use a small custom palette instead of the editor's
   full color picker.
2. Row and column insertion controls appear after a noticeable delay.
3. Choosing **No borders** for a whole table can leave the table's outer frame visible.

Merging and splitting cells remain out of scope.

## Color controls

`DocxEditor.Toolbar.TableBorderColor` and `TableCellFill` will use the same picker body
as the existing text-color control. The picker includes theme colors, standard colors,
and custom hexadecimal input.

The table controls will keep their current table-specific shell and dispatch path.
Picking a border color must preserve the active border target, line style, and width in
`TableChromeDraft`. Picking a fill must continue to issue `setCellFill`. Clearing a fill
must remove direct cell shading.

The shared picker body remains a presentational component. It receives callbacks for
hexadecimal colors and optional clear/automatic actions; it does not construct editor
commands.

## Insertion controls

Pointer hits for row and column insertion will paint the corresponding `+` control in
the same event turn. Divider and right-edge resize handles may retain the existing
150 ms dwell delay.

The controller will keep:

- identity-based reuse of the current insertion control;
- deepest-first nested-table hit testing;
- the existing hide grace and `pointerenter` protection that let the pointer cross from
  the table edge to the control;
- viewing-mode suppression and cleanup.

This removes the perceived lag without making the button flicker or changing resize
targeting.

## Border removal

The layout cascade remains unchanged: a cell-level `none` border can yield to a
table-level outer frame. This matches Word and prevents partial cell formatting from
silently deleting table formatting.

For `setTableBorders` with `scope: 'none'`:

- A full-table `target: 'all'` operation clears all selected cell edges and writes direct
  `w:tblPr/w:tblBorders` `val="none"` overrides for `top`, `left`, `bottom`, `right`,
  `insideH`, and `insideV`.
- An `outside` operation clears table-level perimeter sides only when the selection hull
  reaches those table edges.
- Partial selections keep cell-scoped behavior and do not erase table borders outside
  their hull.

Property patching must preserve unrelated `tblPr` children, unknown attributes,
namespace bindings, and untouched border-side payload.

## Verification

Tests will prove:

- both table color controls expose the shared theme, standard, and custom-color UI;
- border picks retain the current target, style, and width;
- fill clearing removes direct shading;
- insertion controls appear without waiting for a timer, retarget in place, and retain
  hide grace and nested-table targeting;
- full-table **No borders** removes interior and perimeter strokes;
- partial clearing does not remove unrelated table-level borders;
- undo restores the previous cell and table border properties atomically;
- save and reopen preserve the borderless result and unrelated OOXML.

The existing outer-border cascade test stays unchanged.
