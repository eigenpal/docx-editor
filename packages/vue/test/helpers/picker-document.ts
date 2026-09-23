import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { SOURCE } from './fixtures';

const parts = unzipSync(SOURCE);
parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']!).replace('</Types>',
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'));
parts['word/_rels/document.xml.rels'] = strToU8(
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
parts['word/styles.xml'] = strToU8(
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style></w:styles>');
export const PICKER_SOURCE = zipSync(parts);
