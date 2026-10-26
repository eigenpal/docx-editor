# Default sample document

Run `bun run demo-doc:build` to rebuild the default document for all example apps. The Vite and Vue demos use the same bytes.

The builder preserves the original element coverage fixture and its inherited formatting. It adds two pages of DrawingML examples, short RTL and CJK sections, and a page break before the coverage summary.

`diagrams/` contains anonymous SmartArt data, layout, style, color, and saved drawing parts. Keep the data labels and saved drawing labels consistent. `charts/` contains chart parts with anonymous example values.

The generated package uses fixed ZIP timestamps. Rebuilding unchanged sources must produce identical bytes. Check package relationships and sample copies with `bun test ./scripts/__tests__/demo-doc.test.ts`.

Open the result in Word and both demos after changing drawing parts. Check the two-page drawing limit, text labels, multilingual glyphs, and summary page break.

To change chart data or styling, edit `generate-charts.py`. Install the optional authoring dependencies with `python3 -m pip install XlsxWriter lxml`, then run `python3 scripts/demo-doc/generate-charts.py`. The script writes classic chart XML and anonymous embedded workbooks. These dependencies are not needed to build the sample from the checked-in assets.
