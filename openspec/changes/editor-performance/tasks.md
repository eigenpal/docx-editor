# Tasks: Editor Performance

## Investigation

- [ ] Profile loading a 200+ page document — identify bottleneck phase
- [ ] Profile editing a document with 100+ tracked changes — identify slow operations
- [ ] Measure time spent in: parsing, toProseDoc, layout measurement, painting
- [ ] Check if synchronous rendering blocks main thread

## Large document loading

- [ ] Implement incremental page rendering (first N pages, then batches)
- [ ] Use `requestIdleCallback` or `setTimeout(0)` chunking for batch rendering
- [ ] Add placeholder/loading indicator for un-rendered pages
- [ ] Test that tab switching doesn't cause white screen
- [ ] Benchmark: target < 5s for first meaningful paint, < 15s for full document

## Tracked changes performance

- [ ] Profile DOM node count with 100+ tracked changes
- [ ] Merge adjacent same-author changes into single DOM spans
- [ ] Consider virtualizing comment sidebar (only render visible comments)
- [ ] Test scrolling performance with 100+ changes

## General optimizations

- [ ] Check if layout-painter recalculates unchanged pages unnecessarily
- [ ] Consider caching page measurements for unchanged content
- [ ] Profile memory usage with large documents

## Testing

- [ ] Load test: 200-page document loads within 15 seconds
- [ ] Load test: 50-page document with 100+ tracked changes is scrollable
- [ ] Tab switch during loading doesn't cause white screen
- [ ] Run `bun run typecheck`
