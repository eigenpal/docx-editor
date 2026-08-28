/** A CSS length in points, from `px` or `pt` values only. */
export function parseCssLengthPt(value: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?)(px|pt)$/.exec(value.trim().toLowerCase());
  if (!match) return null;
  const magnitude = Number.parseFloat(match[1]!);
  if (!Number.isFinite(magnitude)) return null;
  return match[2] === 'px' ? magnitude * 0.75 : magnitude;
}

/** Whether bare image extents use Word's point-based clipboard convention. */
export function isWordClipboardHtml(html: string): boolean {
  return (
    html.includes('urn:schemas-microsoft-com:office') ||
    html.includes('class=Mso') ||
    html.includes('class="Mso') ||
    html.includes("class='Mso")
  );
}

/** A built-in Word style named by Word desktop's clipboard HTML class. */
export function wordParagraphStyleId(element: Element, wordHtml: boolean): string | undefined {
  for (const className of element.classList) {
    const heading = /^MsoHeading([1-9])$/.exec(className);
    if (heading) return `Heading${heading[1]}`;
    const onlineHeading = /^Heading([1-9])$/.exec(className);
    if (onlineHeading) return `Heading${onlineHeading[1]}`;
    if (className === 'MsoCaption') return 'Caption';
    if (className === 'MsoTitle') return 'Title';
    if (className === 'MsoSubtitle') return 'Subtitle';
    if (className === 'MsoQuote') return 'Quote';
  }
  const headingTag = wordHtml ? /^h([1-6])$/.exec(tagOf(element)) : null;
  return headingTag ? `Heading${headingTag[1]}` : undefined;
}

/** An image extent in CSS pixels, including Word's bare-point convention. */
export function imageDimensionPx(
  element: Element,
  style: ReadonlyMap<string, string>,
  axis: 'width' | 'height',
  wordHtml: boolean
): number | null {
  const pt = parseCssLengthPt(style.get(axis) ?? '');
  if (pt !== null && pt > 0) return pt / 0.75;
  const attr = element.getAttribute(axis)?.trim() ?? '';
  if (!/^[1-9]\d{0,4}$/.test(attr)) return null;
  const value = Number.parseInt(attr, 10);
  return wordHtml ? value / 0.75 : value;
}

export function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

export function tagOf(element: Element): string {
  return element.tagName.toLowerCase();
}
