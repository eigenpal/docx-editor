export function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

export function tagOf(element: Element): string {
  return element.tagName.toLowerCase();
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
  if (headingTag) return `Heading${headingTag[1]}`;
  return undefined;
}
