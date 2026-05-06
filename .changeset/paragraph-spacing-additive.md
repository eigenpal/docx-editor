---
'@eigenpal/docx-js-editor': patch
---

Fix paragraph wrappers double-counting `spaceBefore`/`spaceAfter` in the renderer. The pageComposer already positions `fragment.y` with the gap baked in, but the renderer was also applying it as wrapper padding. Wrapper height is set to line-height only, so the padding pushed text below the wrapper bottom and the next paragraph's background covered the bottom half of the heading text. Symptom on real-world docs: top half of `Dev setup` heading missing — covered by the lavender background of the code block immediately following.
