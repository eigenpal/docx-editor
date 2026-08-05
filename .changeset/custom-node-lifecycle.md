---
'@docx-editor.dev/react': minor
---

Custom nodes now have a full lifecycle. Backspace or Delete at a chip's edge removes the whole node as one unit, with one undo. Inserted nodes default to `contentLocked` — the label cannot be typed into, but the node deletes normally in the editor and in Word. `updateCustomNode` rewrites an existing node's attrs and text in place (one undo step) and `removeCustomNode` deletes it by id; the context menu's custom-node section gains a "Remove {label}" row by default alongside "Edit {label}". Authored controls now carry the numeric `w:id` Word itself writes — Word Online silently deletes id-less controls on resave, which lost the chip on a cloud round-trip.
