# OOXML Reference Documentation

Reference materials for implementing the DOCX editor.

## Full text of the standard

The PDFs of Parts 1 to 4 are large, so git ignores them. Fetch them, with a text copy and a subclause index for each part:

```bash
bun run reference:fetch
```

The command needs Poppler (`pdftotext`). It writes, for each part N:

| File | Holds |
| --- | --- |
| `ecma-376/partN/ECMA-376-N.pdf` | The standard, as Ecma publishes it |
| `ecma-376/partN/*.zip` | The supplementary archives: Strict and Transitional schemas, RELAX NG, the DrawingML preset geometries, the SpreadsheetML styles, and the WordprocessingML art borders |
| `ecma-376/partN/text/full.txt` | The text of the PDF, with its layout |
| `ecma-376/partN/text/index.tsv` | One row for each subclause: number, title, PDF page, and line in `full.txt` |

To read a subclause, find its row in the index, and then read `full.txt` from that line:

```bash
grep -P '^17\.3\.1\.22\t' reference/ecma-376/part1/text/index.tsv
sed -n '11778,11850p' reference/ecma-376/part1/text/full.txt
```

The parts are Part 1 (fundamentals and the markup languages, 5th edition, 2016), Part 2 (Open Packaging Conventions, 5th edition, 2021), Part 3 (Markup Compatibility and Extensibility, 5th edition, 2015), and Part 4 (transitional migration features, 5th edition, 2016). Cite these editions.

`bun run reference:check-citations` checks each citation of the form "ECMA-376 Part 1, 17.3.1.22" in the tracked files against the index, and fails on a number that is not a subclause. Add `--list` to print each citation with the title of its subclause. The check needs the local index, so CI does not run it.

The quick references and the XSDs under `ecma-376/part1/schemas/` stay committed, for offline schema lookups.

## Terms

Ecma International holds the copyright of the files under `ecma-376/`. They are unmodified copies of the ECMA-376 Part 1 Strict schemas, and the Apache License of this repository does not apply to them. Ecma's copyright notice permits copies if they carry the notice, and the notice is in [`ecma-376/NOTICE`](ecma-376/NOTICE). Never edit a file in `ecma-376/`. A rename across the repository must skip this directory.

## Folder structure

```
reference/
├── quick-ref/                    # Committed. Human quick references.
│   ├── wordprocessingml.md       # Paragraphs, runs, formatting
│   └── themes-colors.md          # Theme colors, fonts
└── ecma-376/
    ├── overview.pdf              # Optional; fetch manually
    ├── part1/
    │   ├── *.pdf                 # Gitignored. `bun run reference:fetch`
    │   ├── *.zip                 # Gitignored. Same.
    │   ├── text/                 # Gitignored. full.txt and index.tsv
    │   └── schemas/              # Committed. XSDs for lookup.
    │       ├── wml.xsd           # WordprocessingML schema
    │       └── dml-main.xsd      # DrawingML (colors, themes)
    ├── part2/, part3/            # Gitignored. PDF and text/
    └── part4/
        ├── *.pdf                 # Gitignored.
        ├── *.zip                 # Gitignored.
        └── text/                 # Gitignored.
```

## Key Files for DOCX Editing

| File           | Use For                                                             |
| -------------- | ------------------------------------------------------------------- |
| `wml.xsd`      | Document structure: `<w:p>`, `<w:r>`, `<w:t>`, `<w:rPr>`, `<w:pPr>` |
| `dml-main.xsd` | Colors, themes, fonts: `<a:clrScheme>`, `<a:fontScheme>`            |
| `overview.pdf` | Quick intro to OOXML concepts                                       |
| Part 1 PDF     | Definitive reference for all elements                               |

## Online Resources

- **ECMA-376 Official**: https://ecma-international.org/publications-and-standards/standards/ecma-376/
- **Microsoft Open Specs**: https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/
- **OfficeOpenXML.com**: http://officeopenxml.com/ (human-readable element docs)
- **Open XML SDK**: https://learn.microsoft.com/en-us/office/open-xml/open-xml-sdk

## Common Element Reference

### WordprocessingML (wml)

```xml
<w:document>           <!-- Root document -->
  <w:body>             <!-- Document body -->
    <w:p>              <!-- Paragraph -->
      <w:pPr>          <!-- Paragraph properties -->
        <w:jc w:val="center"/>     <!-- Alignment -->
        <w:spacing w:line="360"/>  <!-- Line spacing -->
      </w:pPr>
      <w:r>            <!-- Run (text with formatting) -->
        <w:rPr>        <!-- Run properties -->
          <w:b/>       <!-- Bold -->
          <w:i/>       <!-- Italic -->
          <w:sz w:val="24"/>       <!-- Font size (half-points) -->
          <w:color w:val="FF0000"/> <!-- Text color -->
        </w:rPr>
        <w:t>Text</w:t> <!-- Actual text content -->
      </w:r>
    </w:p>
  </w:body>
</w:document>
```

### Theme Colors (DrawingML)

```xml
<a:clrScheme name="Office">
  <a:dk1>...</a:dk1>      <!-- Dark 1 (usually black) -->
  <a:lt1>...</a:lt1>      <!-- Light 1 (usually white) -->
  <a:dk2>...</a:dk2>      <!-- Dark 2 -->
  <a:lt2>...</a:lt2>      <!-- Light 2 -->
  <a:accent1>...</a:accent1>  <!-- Accent colors 1-6 -->
  ...
</a:clrScheme>
```

### Styles (styles.xml)

```xml
<w:style w:type="paragraph" w:styleId="Heading1">
  <w:name w:val="heading 1"/>
  <w:basedOn w:val="Normal"/>
  <w:pPr>...</w:pPr>      <!-- Paragraph formatting -->
  <w:rPr>...</w:rPr>      <!-- Character formatting -->
</w:style>
```

## How to Use

1. **Quick lookup**: Check this README or `quick-ref/` markdown files
2. **Schema validation**: Use `.xsd` files to understand valid attributes
3. **Deep dive**: Search the Part 1 PDF for specific element documentation
4. **Real-world behavior**: Check Microsoft Open Specs for implementation details
