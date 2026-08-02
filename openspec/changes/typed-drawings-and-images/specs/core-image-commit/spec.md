## REMOVED Requirements

### Requirement: Image resize/drag commit functions in core

Superseded. `commitImageResize` and `commitImageDragMove` were ProseMirror commit builders from the architecture where PM transactions were the write path. Neither has any occurrence under `packages/`.

The behaviour they specified is restated over the canonical tree in `drawing-model` and `image-authoring-surface`: resize and drag commit through `TreeDocOp`s, a drag is one transaction and one history entry rather than one per pointer move, handle geometry comes from semantic layout records rather than from measuring painted DOM, and resize and crop write `wp:extent` and `a:srcRect` without re-encoding the media.
