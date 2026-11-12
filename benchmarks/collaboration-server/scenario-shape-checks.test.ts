import { expect, test } from 'bun:test';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { zipDocument } from '../../packages/pro/src/collaboration/__tests__/document-peer-support.ts';
import {
  shapePackageProblems,
  shapeRoundTripProblems,
  shapeSavedProblems,
} from './scenario-shape-checks.ts';
import { SHAPE_FORMAT_BODY } from './scenario-shape-document.ts';

function open(body: string) {
  const loaded = readOoxmlPackage(zipDocument(body));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

test('the shape document passes the shape oracles', () => {
  const pkg = open(SHAPE_FORMAT_BODY);
  expect(shapePackageProblems(pkg, 'seed')).toEqual([]);
  expect(shapeRoundTripProblems(pkg)).toEqual([]);
});

test('a repeated fill or line child is reported', () => {
  const twice = SHAPE_FORMAT_BODY.replace(
    '<a:solidFill><a:srgbClr val="D9E2F3"/></a:solidFill>',
    '<a:solidFill><a:srgbClr val="D9E2F3"/></a:solidFill><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>'
  )
    .replace('<a:round/>', '<a:round/><a:bevel/>')
    .replace(
      '<a:srgbClr val="00B050"/>',
      '<a:srgbClr val="00B050"><a:alpha val="50000"/><a:alpha val="20000"/></a:srgbClr>'
    );
  const problems = shapePackageProblems(open(twice), 'seed');
  expect(problems.some((problem) => /spPr .* 2 fill children/.test(problem))).toBe(true);
  expect(problems.some((problem) => /ln .* 2 join children/.test(problem))).toBe(true);
});

test('an empty hidden fill, two hidden fills, and a VML copy that disagrees are reported', () => {
  const empty = SHAPE_FORMAT_BODY.replace(
    /<a14:hiddenFill [^>]*>.*?<\/a14:hiddenFill>/,
    '<a14:hiddenFill xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"/>'
  );
  expect(shapeSavedProblems(open(empty), 'saved').join('\n')).toMatch(/hiddenFill .* 0 fills/);
  const two = SHAPE_FORMAT_BODY.replace(
    '<a:srgbClr val="FFE699"/></a:solidFill>',
    '<a:srgbClr val="FFE699"/></a:solidFill><a:noFill/>'
  );
  expect(shapeSavedProblems(open(two), 'saved').join('\n')).toMatch(/hiddenFill .* 2 fills/);
  const vml = SHAPE_FORMAT_BODY.replace(
    'fillcolor="#d9e2f3"',
    'fillcolor="#d9e2f3" filled="f"'
  ).replace('fillcolor="#ffc000"', 'fillcolor="#00ff00"');
  const problems = shapeSavedProblems(open(vml), 'saved').join('\n');
  expect(problems).toMatch(/filled="f" over a fill that shows/);
  expect(problems).toMatch(/fillcolor #00ff00 against fill #ffc000/);
  expect(shapeSavedProblems(open(SHAPE_FORMAT_BODY), 'saved')).toEqual([]);
});
