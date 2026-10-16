<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Custom cards in the review rail

To draw your own cards, render `DocxEditorReview` with `preset` set to `false` and put your card component inside it. Your component reads the items from `useReview()`, stacks them with `useStackedReviewPositions`, and converts positions to pixels with `useReviewRailMetrics()`.

```vue
<!-- MyCards.vue -->
<script setup lang="ts">
import {
  DocxEditorReview,
  useReview,
  useReviewRailMetrics,
  useStackedReviewPositions,
} from '@docx-editor.dev/pro/vue';

const HEIGHTS = new Map<string, number>();
const { items, selectionAnchorY, accept } = useReview();
const { metrics } = useReviewRailMetrics();
const positions = useStackedReviewPositions(items, HEIGHTS, () => ({
  scale: metrics.value.scale,
  defaultHeight: 96,
}));
const top = (y: number) => `${metrics.value.top + y * metrics.value.scale}px`;
</script>

<template>
  <div
    v-for="item in items"
    :key="item.key"
    :style="{ position: 'absolute', top: top(positions.get(item.key) ?? 0) }"
  >
    {{ item.text }}
    <button v-if="item.kind === 'revision'" @click="accept(item)">Accept</button>
  </div>
  <DocxEditorReview.Draft :top="metrics.top + (selectionAnchorY ?? 0) * metrics.scale" />
</template>
```

```vue
<!-- MyRail.vue -->
<script setup lang="ts">
import { DocxEditorReview } from '@docx-editor.dev/pro/vue';
import MyCards from './MyCards.vue';
</script>

<template>
  <DocxEditorReview :preset="false">
    <MyCards />
    <DocxEditorReview.AddComment />
  </DocxEditorReview>
</template>
```

Pass measured card heights instead of the empty map when your cards vary in height. Keep the map reference stable between renders.

## Root parts and card parts

`DocxEditorReview` finds its parts among its own children by element type.

- **Root parts** are `List`, `Markers`, `AddComment`, `Draft`, and `Balloon`. Put them as direct children of `DocxEditorReview`. Fragments are transparent. The rail gives these parts geometry that only it can compute, such as the comment button's `top`. A root part inside your own wrapper component is not a part. It renders as ordinary content, without that wiring.
- **Card parts** are `Card`, `Empty`, and the parts inside a card, such as `Author`, `Summary`, `Accept`, and `Reply`. Put them inside `DocxEditorReview.List`.

With `preset` set to `false`, the rail adds no defaults. Root parts that you pass keep their wiring. Every other child renders as is inside the rail element, where `useReviewRailMetrics()` reads the rail's own measurement.

## Position the compose box

`DocxEditorReview.Draft` renders only while a comment draft is open. A draft opens from `DocxEditorReview.AddComment` or from the `review.addComment` toolbar control. You can place `Draft` in either of these places:

- As a direct child of `DocxEditorReview`.
- Inside your own card component, as in the example. It still renders only while the draft is open.

Without `top`, the box sits where the packaged card stack puts it. In the narrow compact rail it takes the compact card's `left` either way, so it does not overflow the marker strip. That position comes from the packaged cards, not yours. When you render your own cards, pass `top` from your own stack. The example places the box at the selection's anchor. To keep it clear of your cards, add an entry with the key of your choice and the anchor `selectionAnchorY` to the list that you pass to `useStackedReviewPositions`, in document order.
