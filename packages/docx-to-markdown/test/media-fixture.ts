import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { docx } from './fixture.ts';

export const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ef8AAAAASUVORK5CYII=',
    'base64'
  )
);
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

export function picture(id = 1, anchor = false, description = 'Picture', hidden = false): string {
  const graphic = `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="127000" cy="127000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
  const properties = `<wp:extent cx="127000" cy="127000"/>${anchor ? '<wp:wrapNone/>' : ''}<wp:docPr id="${id}" name="Picture ${id}" descr="${description}"${hidden ? ' hidden="1"' : ''}/><wp:cNvGraphicFramePr/>${graphic}`;
  return `<w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="${R}">${anchor ? `<wp:anchor simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>${properties}</wp:anchor>` : `<wp:inline>${properties}</wp:inline>`}</w:drawing>`;
}

export function imageDocx(
  body = `<w:p><w:r><w:t>Before</w:t>${picture()}<w:t>After</w:t></w:r></w:p><w:p><w:r><w:t>End</w:t></w:r></w:p>`,
  bytes = PNG,
  extension = 'png',
  mime = 'image/png'
): Uint8Array {
  const entries = unzipSync(docx(body));
  entries['[Content_Types].xml'] = strToU8(
    strFromU8(entries['[Content_Types].xml']!).replace(
      '</Types>',
      `<Default Extension="${extension}" ContentType="${mime}"/></Types>`
    )
  );
  entries['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rImage" Type="${R}/image" Target="media/image.${extension}"/></Relationships>`
  );
  entries[`word/media/image.${extension}`] = bytes;
  return zipSync(entries);
}
