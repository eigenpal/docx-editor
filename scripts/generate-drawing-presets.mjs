#!/usr/bin/env node
// Generate packages/core/src/store/package/drawing-preset-table.ts from the ECMA-376 Part 1
// electronic annex file presetShapeDefinitions.xml.
//
//   node scripts/generate-drawing-presets.mjs path/to/presetShapeDefinitions.xml
//
// The annex file is regular: one element per preset under the root, each holding optional
// avLst/gdLst guide lists, an optional text rect and a pathLst. Adjust handles (ahLst) and
// connection sites (cxnLst) are not needed to draw a shape, so they are dropped.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const input = process.argv[2];
if (!input) {
  console.error('usage: node scripts/generate-drawing-presets.mjs presetShapeDefinitions.xml');
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'packages/core/src/store/package/drawing-preset-table.ts');

const TOKEN = /^[A-Za-z0-9-]+$/;
const FORMULA = /^[A-Za-z0-9?:*/+\- ]+$/;
const xml = readFileSync(input, 'utf8');

function attributes(source) {
  const result = new Map();
  for (const match of source.matchAll(/([A-Za-z]+)="([^"]*)"/g)) result.set(match[1], match[2]);
  return result;
}

function token(value, what) {
  if (!TOKEN.test(value)) throw new Error(`unexpected ${what}: ${JSON.stringify(value)}`);
  return value;
}

// A flat tag stream; the annex has no comments, CDATA or text content that matters.
const tags = [...xml.matchAll(/<(\/?)([A-Za-z0-9]+)([^>]*?)(\/?)>/g)].map((match) => ({
  close: match[1] === '/',
  name: match[2],
  attrs: attributes(match[3]),
  selfClosing: match[4] === '/',
}));

const presets = [];
let depth = 0;
let preset = null;
let list = null;
let path = null;
let command = null;
for (const tag of tags) {
  if (tag.close) {
    depth -= 1;
    if (depth === 1 && preset) {
      presets.push(preset);
      preset = null;
    }
    if (tag.name === 'avLst' || tag.name === 'gdLst') list = null;
    if (tag.name === 'path' && depth === 3) path = null;
    if (command && depth === 4) command = null;
    continue;
  }
  if (depth === 1) {
    preset = { name: token(tag.name, 'preset'), av: [], gd: [], rect: null, paths: [] };
  } else if (depth === 2 && preset) {
    if (tag.name === 'avLst') list = preset.av;
    else if (tag.name === 'gdLst') list = preset.gd;
    else if (tag.name === 'rect') {
      preset.rect = ['l', 't', 'r', 'b'].map((key) => token(tag.attrs.get(key), 'rect'));
    }
  } else if (depth === 3 && preset) {
    if (tag.name === 'gd' && list) {
      const formula = tag.attrs.get('fmla');
      if (!FORMULA.test(formula)) throw new Error(`unexpected formula ${formula}`);
      list.push(`${token(tag.attrs.get('name'), 'guide')}=${formula}`);
    } else if (tag.name === 'path') {
      const fill = tag.attrs.get('fill') ?? 'norm';
      const stroke = tag.attrs.get('stroke');
      path = {
        w: token(tag.attrs.get('w') ?? '0', 'path w'),
        h: token(tag.attrs.get('h') ?? '0', 'path h'),
        fill: token(fill, 'fill'),
        stroke: stroke === 'false' || stroke === '0' ? '0' : '1',
        commands: [],
      };
      preset.paths.push(path);
    }
  } else if (depth === 4 && path) {
    const a = tag.attrs;
    if (tag.name === 'moveTo') command = { op: 'M', args: [] };
    else if (tag.name === 'lnTo') command = { op: 'L', args: [] };
    else if (tag.name === 'quadBezTo') command = { op: 'Q', args: [] };
    else if (tag.name === 'cubicBezTo') command = { op: 'C', args: [] };
    else if (tag.name === 'close') command = { op: 'Z', args: [] };
    else if (tag.name === 'arcTo') {
      command = {
        op: 'A',
        args: ['wR', 'hR', 'stAng', 'swAng'].map((key) => token(a.get(key), 'arc')),
      };
    } else throw new Error(`unexpected path verb ${tag.name}`);
    path.commands.push(command);
  } else if (depth === 5 && command && tag.name === 'pt') {
    command.args.push(token(tag.attrs.get('x'), 'x'), token(tag.attrs.get('y'), 'y'));
  }
  if (!tag.selfClosing) depth += 1;
  else if (depth === 4) command = null;
}
if (depth !== 0) throw new Error('unbalanced annex file');

// One line per preset: name|avLst|gdLst|rect|paths. Guides are `name=formula` joined by `;`,
// paths `w h fill stroke:commands` joined by `!`, commands are single-letter verbs followed
// by their arguments. None of the separators occur inside guide names or formulas.
const lines = presets
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  .map((entry) => {
    const rect = entry.rect ? entry.rect.join(' ') : '';
    const paths = entry.paths
      .map(
        (p) =>
          `${p.w} ${p.h} ${p.fill} ${p.stroke}:` +
          p.commands.map((c) => [c.op, ...c.args].join(' ')).join(' ')
      )
      .join('!');
    return `${entry.name}|${entry.av.join(';')}|${entry.gd.join(';')}|${rect}|${paths}`;
  });

const header = `// GENERATED FILE. Do not edit. Regenerate with:
//   node scripts/generate-drawing-presets.mjs presetShapeDefinitions.xml
//
// Preset shape geometry from presetShapeDefinitions.xml in the electronic annex of
// ECMA-376 Part 1 (Office Open XML File Formats, Fundamentals and Markup Language Reference).
// Copyright Ecma International. The Ecma notice in packages/core/licenses/ECMA-376.md applies
// to this table. Adjust handles and connection sites are omitted.
//
// One line per preset: name|avLst|gdLst|text rect|paths. Guides are \`name=formula\` joined
// by ';'. Paths are \`w h fill stroke:commands\` joined by '!', where a command is one of
// M x y, L x y, A wR hR stAng swAng, Q x1 y1 x2 y2, C x1 y1 x2 y2 x3 y3, Z.
`;
const body = `export const PRESET_SHAPE_SOURCE = \`\n${lines.join('\n')}\n\`;\n`;
writeFileSync(output, header + '\n' + body);
console.log(`wrote ${presets.length} presets to ${output}`);
