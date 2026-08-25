import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlTextNode,
} from '@docx-editor.dev/core/store';

const W = WML_NAMESPACE_URI;
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const PART_NAME = '/word/document.xml';
const CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

function load(body: string): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">` +
    `<w:body>${body}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: PART_NAME, contentType: CONTENT_TYPE });
  if (!result.ok) throw new Error(`fixture read failed: ${result.reason}`);
  return result.part;
}

export function twoParagraphFixture(): OoxmlPart {
  return load(
    `<w:p w14:paraId="11111111" w14:textId="11111111"><w:r><w:t>Alpha</w:t></w:r></w:p>` +
      `<w:p w14:paraId="22222222" w14:textId="22222222"><w:r><w:t>Bravo</w:t></w:r></w:p>`
  );
}

export function formatFixture(): OoxmlPart {
  return load(
    `<w:p w14:paraId="33333333" w14:textId="33333333">` +
      `<w:r><w:rPr/><w:t>Format</w:t></w:r></w:p>`
  );
}

export function tableFixture(): OoxmlPart {
  return load(
    `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
      `<w:tr><w:tc><w:p w14:paraId="44444444" w14:textId="44444444">` +
      `<w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
      `<w:p w14:paraId="55555555" w14:textId="55555555"><w:r><w:t>After</w:t></w:r></w:p>`
  );
}

export function commentAnchorFixture(): OoxmlPart {
  return load(
    `<w:p w14:paraId="AAAAAAAA" w14:textId="AAAAAAAA">` +
      `<w:commentRangeStart w:id="1"/>` +
      `<w:r><w:t>Commented</w:t></w:r>` +
      `<w:commentRangeEnd w:id="1"/>` +
      `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>` +
      `<w:commentReference w:id="1"/></w:r></w:p>`
  );
}

export function revisionWrapperFixture(): OoxmlPart {
  return load(
    `<w:p w14:paraId="BBBBBBBB" w14:textId="BBBBBBBB">` +
      `<w:ins w:author="Ada" w:date="2020-01-01T00:00:00Z" w:id="1">` +
      `<w:r><w:t>Inserted</w:t></w:r></w:ins></w:p>`
  );
}

export function contentControlFixture(): OoxmlPart {
  return load(
    `<w:p w14:paraId="CCCCCCCC" w14:textId="CCCCCCCC">` +
      `<w:sdt><w:sdtPr><w:tag w:val="name"/><w:text/></w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>Bound</w:t></w:r></w:sdtContent></w:sdt></w:p>`
  );
}

export function unknownNodeFixture(): OoxmlPart {
  return load(
    `<w:p w14:paraId="DDDDDDDD" w14:textId="DDDDDDDD">` +
      `<w:r><w:t>Known</w:t></w:r>` +
      `<demo:marker xmlns:demo="urn:docx-editor:spike">keep</demo:marker></w:p>`
  );
}

export function invalidPlacementFixture(): OoxmlPart {
  return load(
    `<w:p w14:paraId="EEEEEEEE" w14:textId="EEEEEEEE"><w:r><w:t>Host</w:t></w:r>` +
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Nested</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:p>`
  );
}

export function moveFixture(): OoxmlPart {
  return load(
    `<w:p w14:paraId="66666666" w14:textId="66666666">` +
      `<w:r><w:t>Keep</w:t></w:r>` +
      `<w:r><w:t>MoveMe</w:t></w:r></w:p>` +
      `<w:p w14:paraId="77777777" w14:textId="77777777"><w:r><w:t>Dest</w:t></w:r></w:p>`
  );
}

export function walk(node: OoxmlNode, visit: (node: OoxmlNode) => void): void {
  visit(node);
  if (node.kind === 'textValue') return;
  for (const child of node.children) walk(child, visit);
}

export function collectKind(part: OoxmlPart, kind: OoxmlElement['kind']): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  walk(part.root, (node) => {
    if (node.kind === kind) found.push(node);
  });
  return found;
}

export function textNodes(part: OoxmlPart): OoxmlTextNode[] {
  const found: OoxmlTextNode[] = [];
  walk(part.root, (node) => {
    if (node.kind === 'textValue') found.push(node);
  });
  return found;
}

export function textWith(part: OoxmlPart, value: string): OoxmlTextNode {
  const node = textNodes(part).find((candidate) => candidate.value === value);
  if (!node) throw new Error(`text ${value} not found`);
  return node;
}

export function paragraphWithText(part: OoxmlPart, value: string): OoxmlElement {
  const paragraphs = collectKind(part, 'paragraph');
  for (const paragraph of paragraphs) {
    let text = '';
    walk(paragraph, (node) => {
      if (node.kind === 'textValue') text += node.value;
    });
    if (text.includes(value)) return paragraph;
  }
  throw new Error(`paragraph ${value} not found`);
}

export function runWithText(part: OoxmlPart, value: string): OoxmlElement {
  const runs = collectKind(part, 'run');
  for (const run of runs) {
    let text = '';
    walk(run, (node) => {
      if (node.kind === 'textValue') text += node.value;
    });
    if (text === value || text.includes(value)) return run;
  }
  throw new Error(`run ${value} not found`);
}

export function nodeText(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return node.children.map(nodeText).join('');
}

export function countNodes(node: OoxmlNode): number {
  let count = 0;
  walk(node, () => {
    count += 1;
  });
  return count;
}

export function countNewReferences(previous: OoxmlNode, next: OoxmlNode): number {
  const seen = new Set<object>();
  const visit = (node: OoxmlNode): void => {
    seen.add(node);
    if (node.kind === 'textValue') return;
    for (const child of node.children) visit(child);
  };
  visit(previous);
  let allocated = 0;
  walk(next, (node) => {
    if (!seen.has(node)) allocated += 1;
  });
  return allocated;
}

export function collectIds(node: OoxmlNode): Set<string> {
  const ids = new Set<string>();
  walk(node, (candidate) => ids.add(candidate.id));
  return ids;
}
