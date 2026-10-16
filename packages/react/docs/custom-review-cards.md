<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Custom cards in the review rail

To draw your own cards, render `DocxEditorReview` with `preset` set to `false` and put your card component inside it. Your component reads the items from `useReview()`, measures each card, stacks the cards with `useStackedReviewPositions`, and converts positions to pixels with `useReviewRailMetrics()`.

Measure every card with a `ResizeObserver` and pass the heights in CSS pixels. Without measured heights, each card reserves only `defaultHeight`, and a taller card overlaps the next one.

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DocxEditorReview,
  useReview,
  useReviewRailMetrics,
  useStackedReviewPositions,
} from '@docx-editor.dev/pro/react';

type OnHeight = (key: string, height: number) => void;

function MeasuredCard({
  id,
  top,
  onHeight,
  children,
}: {
  id: string;
  top: number;
  onHeight: OnHeight;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current!;
    const observer = new ResizeObserver(() => onHeight(id, node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [id, onHeight]);
  return (
    <div ref={ref} style={{ position: 'absolute', top }}>
      {children}
    </div>
  );
}

function MyCards() {
  const { items, selectionAnchorY, accept } = useReview();
  const metrics = useReviewRailMetrics();
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const onHeight = useCallback<OnHeight>(
    (key, height) =>
      setHeights((prev) => (prev.get(key) === height ? prev : new Map(prev).set(key, height))),
    []
  );
  const positions = useStackedReviewPositions(items, heights, {
    scale: metrics.scale,
    defaultHeight: 96,
  });
  const top = (y: number) => metrics.top + y * metrics.scale;
  return (
    <>
      {items.map((item) => (
        <MeasuredCard
          key={item.key}
          id={item.key}
          top={top(positions.get(item.key) ?? 0)}
          onHeight={onHeight}
        >
          {item.text}
          {item.kind === 'revision' && <button onClick={() => accept(item)}>Accept</button>}
        </MeasuredCard>
      ))}
      <DocxEditorReview.Draft top={top(selectionAnchorY ?? 0)} />
    </>
  );
}

export function MyRail() {
  return (
    <DocxEditorReview preset={false}>
      <MyCards />
      <DocxEditorReview.AddComment />
    </DocxEditorReview>
  );
}
```

The heights map gets a new reference only when a height changes, so the stack recomputes only then. Keep that rule if you store heights another way.

## Root parts and card parts

`DocxEditorReview` finds its parts among its own children by element type.

- **Root parts** are `List`, `Markers`, `AddComment`, `Draft`, and `Balloon`. Put them as direct children of `DocxEditorReview`. Fragments are transparent in React and in Vue. The rail gives these parts geometry that only it can compute, such as the comment button's `top`. A root part inside your own wrapper component is not a part. It renders as ordinary content, without that wiring.
- **Card parts** are `Card`, `Empty`, and the parts inside a card, such as `Author`, `Summary`, `Accept`, and `Reply`. Put them inside `DocxEditorReview.List`.

With `preset` set to `false`, the rail adds no defaults. Root parts that you pass keep their wiring. Every other child renders as is inside the rail element, where `useReviewRailMetrics()` reads the rail's own measurement.

## Position the compose box

`DocxEditorReview.Draft` renders only while a comment draft is open. A draft opens from `DocxEditorReview.AddComment` or from the `review.addComment` toolbar control. You can place `Draft` in either of these places:

- As a direct child of `DocxEditorReview`.
- Inside your own card component, as in the example. It still renders only while the draft is open.

Without `top`, the box sits where the packaged card stack puts it. That position comes from the packaged cards, not yours, so when you render your own cards, pass `top` from your own stack. In the narrow compact rail, the box takes the compact card's `left` in both cases, so it does not overflow the marker strip. The example places the box at the selection's anchor. To keep it clear of your cards, add an entry with the key of your choice and the anchor `selectionAnchorY` to the list that you pass to `useStackedReviewPositions`, in document order.
