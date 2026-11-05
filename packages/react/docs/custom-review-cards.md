<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Custom cards in the review rail

Render `DocxEditorReview` with `preset` set to `false` and put your card component inside it. The component reads items from `useReview()`, stacks measured cards with `useStackedReviewPositions`, and converts positions to pixels with `useReviewRailMetrics()`.

## Render custom cards

The following example measures each card with a `ResizeObserver`, stacks the cards, and shows a refused decision:

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DocxEditorReview,
  useReview,
  useReviewRailMetrics,
  useStackedReviewPositions,
} from '@docx-editor.dev/pro/react';

type OnHeight = (key: string, height: number) => void;

function MeasuredCard(props: { id: string; top: number; onHeight: OnHeight; children: ReactNode }) {
  const { id, top, onHeight, children } = props;
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
  const { items, selectionAnchorY, accept, lastRefusal } = useReview();
  const metrics = useReviewRailMetrics();
  // A new map only when a height changes, so the stack recomputes only then.
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
          {lastRefusal?.key === item.key && <p>{lastRefusal.code}</p>}
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

`accept` returns `false` when the editor refuses, and `lastRefusal` names the item and the diagnostic code. `DocxEditorReview` already announces each refusal in a live region, so show it in the card as plain text. For a translated sentence, call `useReviewRefusalMessage()`.

## Position cards and drafts

Convert a layout position to CSS pixels with `metrics.top + position * metrics.scale`.

| Input to `useStackedReviewPositions` | Description |
| --- | --- |
| `heights` | Measured card heights in CSS pixels, by item key. A card without a height reserves `defaultHeight`, and a taller card overlaps the next one. |
| `scale` | `metrics.scale`, CSS pixels per layout point. |
| `defaultHeight` | The height to reserve before a card is measured. |

`DocxEditorReview.Draft` renders only while a comment draft is open. Without `top`, it takes the packaged stack's position, so pass `top` from your own stack. To keep the box clear of your cards, add an entry at `selectionAnchorY` to the list that you stack, in document order.

## Place review parts

`DocxEditorReview` finds its parts among its own children by element type. Fragments are transparent in React and Vue.

| Part | Placement |
| --- | --- |
| `List`, `Markers`, `AddComment`, `Balloon` | Direct children of `DocxEditorReview`. Inside your own wrapper, a part renders as plain content without its geometry. |
| `Draft` | A direct child, or inside your own card component. Inside a custom stack, pass `top` explicitly. |
| `Card`, `Empty`, and card parts such as `Author`, `Summary`, `Accept`, and `Reply` | Inside `DocxEditorReview.List`. |

With `preset` set to `false`, the rail adds no defaults, but recognized parts keep their wiring. Other children render inside the rail element.

## Limits

- Disconnect each observer when its card unmounts or its item changes.
- In React, keep the heights map reference-stable. In Vue, keep it reactive.
- In the compact rail, `metrics.compact` is `true`. Place cards at `metrics.compactCardLeft`; `Draft` does this itself.
- Keep the column hidden while `metrics.left` is `null`.

## See also

- [Review cards](https://www.docx-editor.dev/docs/2.x/customization/review-cards)
- [Tracked changes](https://www.docx-editor.dev/docs/2.x/pro/tracked-changes)
- [Accept or reject without scrolling](./accept-reject-without-scrolling.md)
