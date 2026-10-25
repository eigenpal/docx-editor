/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The look of a chartex chart: text, fills and lines per chart element, and the data colours.
//
// A chartex part saves little formatting of its own. Each element takes its look from its
// entry in the chart style part (`cs:chartStyle`: `title`, `legend`, `dataLabel`,
// `categoryAxis`, `gridlineMajor`, `dataPoint`, `seriesLine`, ...), and the data colours
// come from the colour style part (`cs:colorStyle`). A `cs:fillRef`/`cs:lnRef` with
// `cs:styleClr`, and a `phClr` colour, stand for the data colour of the point being painted.
// The element's own `cx:spPr`/`cx:txPr` win over its entry. Without the parts, or for an
// entry they lack, the default chartex look applies: the entries below and the colourful
// accent cycle.
//
// A chartex `cx:txPr` gives its text the run properties of its first paragraph's end
// (`a:endParaRPr`); the paragraph's default run (`a:pPr/a:defRPr`) does not reach the text.
// The chart space's own `cx:txPr` reaches every element but cannot change the text size.

import {
  CHART_STYLE_NAMESPACE_URI,
  DRAWINGML_MAIN_NAMESPACE_URI,
  findDirectChild,
  isElement,
  readOoxmlPart,
  resolveColorNode,
  schemaAttributeValue,
  type ChartThemeFaces,
  type OoxmlElement,
  type ShapeSchemeColorResolver,
} from '@docx-editor.dev/core/store';
import { DEFAULT_CHART_TEXT } from './chart-labels.ts';
import {
  mergeStroke,
  readChartShapeProperties,
  type ChartPaint,
  type ChartStroke,
} from './chart-style.ts';
import { applyRunLayer, type ChartTextStyle } from './chart-text.ts';

const CS = CHART_STYLE_NAMESPACE_URI;
const A = DRAWINGML_MAIN_NAMESPACE_URI;
const MAX_COLORS = 64;
const MAX_VARIATIONS = 64;
const MAX_TRANSFORMS = 16;

const GRAY_TEXT =
  '<a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr>';
const LIGHT_LINE =
  '<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="tx1">' +
  '<a:lumMod val="15000"/><a:lumOff val="85000"/></a:schemeClr></a:solidFill><a:round/></a:ln>';

function entryXml(name: string, font: string, rest = ''): string {
  return (
    `<cs:${name}><cs:lnRef idx="0"/><cs:fillRef idx="0"/><cs:effectRef idx="0"/>` +
    `<cs:fontRef idx="minor">${font}</cs:fontRef>${rest}</cs:${name}>`
  );
}

/** The default chartex look, as a chart style part. Trusted, generated markup. */
const DEFAULT_STYLE_XML =
  `<cs:chartStyle xmlns:cs="${CS}" xmlns:a="${A}">` +
  entryXml('axisTitle', GRAY_TEXT, '<cs:defRPr sz="900"/>') +
  entryXml('categoryAxis', GRAY_TEXT, `<cs:spPr>${LIGHT_LINE}</cs:spPr><cs:defRPr sz="900"/>`) +
  entryXml(
    'chartArea',
    '<a:schemeClr val="tx1"/>',
    `<cs:spPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill>${LIGHT_LINE}</cs:spPr><cs:defRPr sz="1000"/>`
  ) +
  entryXml('dataLabel', GRAY_TEXT, '<cs:defRPr sz="900"/>') +
  '<cs:dataPoint><cs:lnRef idx="0"/><cs:fillRef idx="0"><cs:styleClr val="auto"/></cs:fillRef>' +
  '<cs:effectRef idx="0"/><cs:fontRef idx="minor"><a:schemeClr val="tx1"/></cs:fontRef>' +
  '<cs:spPr><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></cs:spPr></cs:dataPoint>' +
  '<cs:dataPointLine><cs:lnRef idx="0"><cs:styleClr val="auto"/></cs:lnRef><cs:fillRef idx="0"/>' +
  '<cs:effectRef idx="0"/><cs:fontRef idx="minor"><a:schemeClr val="tx1"/></cs:fontRef>' +
  '<cs:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:round/></a:ln></cs:spPr></cs:dataPointLine>' +
  entryXml('gridlineMajor', '<a:schemeClr val="tx1"/>', `<cs:spPr>${LIGHT_LINE}</cs:spPr>`) +
  entryXml('gridlineMinor', '<a:schemeClr val="tx1"/>', `<cs:spPr>${LIGHT_LINE}</cs:spPr>`) +
  entryXml(
    'leaderLine',
    '<a:schemeClr val="tx1"/>',
    '<cs:spPr><a:ln w="9525"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="35000"/>' +
      '<a:lumOff val="65000"/></a:schemeClr></a:solidFill></a:ln></cs:spPr>'
  ) +
  entryXml('legend', GRAY_TEXT, '<cs:defRPr sz="900"/>') +
  entryXml('plotArea', '<a:schemeClr val="tx1"/>') +
  entryXml(
    'seriesLine',
    '<a:schemeClr val="tx1"/>',
    '<cs:spPr><a:ln w="9525" cap="flat"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill>' +
      '<a:round/></a:ln></cs:spPr>'
  ) +
  entryXml('title', GRAY_TEXT, '<cs:defRPr sz="1400"/>') +
  entryXml('valueAxis', GRAY_TEXT, '<cs:defRPr sz="900"/>') +
  '</cs:chartStyle>';

/** The colourful colour style: the six accents, then darker and lighter passes. */
const DEFAULT_COLORS_XML =
  `<cs:colorStyle xmlns:cs="${CS}" xmlns:a="${A}" meth="cycle">` +
  [1, 2, 3, 4, 5, 6].map((accent) => `<a:schemeClr val="accent${accent}"/>`).join('') +
  '<cs:variation/><cs:variation><a:lumMod val="60000"/></cs:variation>' +
  '<cs:variation><a:lumMod val="80000"/><a:lumOff val="20000"/></cs:variation>' +
  '<cs:variation><a:lumMod val="80000"/></cs:variation>' +
  '<cs:variation><a:lumMod val="60000"/><a:lumOff val="40000"/></cs:variation>' +
  '<cs:variation><a:lumMod val="50000"/></cs:variation>' +
  '<cs:variation><a:lumMod val="70000"/><a:lumOff val="30000"/></cs:variation>' +
  '<cs:variation><a:lumMod val="70000"/></cs:variation>' +
  '<cs:variation><a:lumMod val="50000"/><a:lumOff val="50000"/></cs:variation>' +
  '</cs:colorStyle>';

let defaults: { style: OoxmlElement | null; colors: OoxmlElement | null } | null = null;

function defaultParts(): { style: OoxmlElement | null; colors: OoxmlElement | null } {
  if (defaults) return defaults;
  const parse = (xml: string, name: string) => {
    const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
    return parsed.ok ? parsed.part.root : null;
  };
  defaults = {
    style: parse(DEFAULT_STYLE_XML, '/chartex-default-style'),
    colors: parse(DEFAULT_COLORS_XML, '/chartex-default-colors'),
  };
  return defaults;
}

function csChild(parent: OoxmlElement | null | undefined, localName: string): OoxmlElement | null {
  return parent ? findDirectChild(parent.children, { namespaceUri: CS, localName }) : null;
}

const parsedColors = new Map<string, OoxmlElement | null>();

/** A colour from trusted, generated markup; parsed once. */
function generatedColor(xml: string): OoxmlElement | null {
  if (parsedColors.has(xml)) return parsedColors.get(xml)!;
  const parsed = readOoxmlPart(xml, { name: '/chartex-color', contentType: 'application/xml' });
  const element = parsed.ok ? parsed.part.root : null;
  if (parsedColors.size < 4_096) parsedColors.set(xml, element);
  return element;
}

/**
 * `color` with colour transforms appended (a colour style variation, or a linear step).
 * Only transforms with a plain integer value reach the generated markup.
 */
function transformed(color: ChartPaint, transforms: readonly OoxmlElement[]): ChartPaint | null {
  let inner = '';
  for (const transform of transforms.slice(0, MAX_TRANSFORMS)) {
    const value = schemaAttributeValue(transform.attributes, 'val');
    if (transform.namespaceUri !== A || !/^[a-zA-Z]{1,16}$/.test(transform.localName)) continue;
    if (value === undefined || !/^-?\d{1,9}$/.test(value)) continue;
    inner += `<a:${transform.localName} val="${value}"/>`;
  }
  if (!inner) return color;
  const element = generatedColor(
    `<a:srgbClr xmlns:a="${A}" val="${color.hex}">${inner}</a:srgbClr>`
  );
  const resolved = element ? resolveColorNode(element) : null;
  return resolved ? { hex: resolved.hex, alpha: resolved.alpha * color.alpha } : null;
}

/** The run properties a chartex `cx:txPr` gives its text: its first paragraph's end run. */
export function chartexTextRun(txPr: OoxmlElement | null): OoxmlElement | null {
  const paragraph = txPr
    ? findDirectChild(txPr.children, { namespaceUri: A, localName: 'p' })
    : null;
  return paragraph
    ? findDirectChild(paragraph.children, { namespaceUri: A, localName: 'endParaRPr' })
    : null;
}

/** Whether a chartex `cx:txPr` names its own text colour. */
export function namesTextColor(txPr: OoxmlElement | null): boolean {
  const run = chartexTextRun(txPr);
  return run
    ? findDirectChild(run.children, { namespaceUri: A, localName: 'solidFill' }) !== null
    : false;
}

/** The look of one chartex chart. */
export class ChartexLook {
  private readonly style: OoxmlElement | null;
  private readonly fallbackStyle: OoxmlElement | null;
  private readonly palette: readonly OoxmlElement[];
  private readonly variations: readonly (readonly OoxmlElement[])[];
  private readonly method: string;
  private readonly base: ChartTextStyle;

  constructor(
    parts: { readonly style: OoxmlElement | null; readonly colors: OoxmlElement | null },
    private readonly chartTxPr: OoxmlElement | null,
    readonly resolveSchemeColor?: ShapeSchemeColorResolver,
    themeFaces?: ChartThemeFaces
  ) {
    const fallback = defaultParts();
    this.style = parts.style;
    this.fallbackStyle = fallback.style;
    const colors = parts.colors ?? fallback.colors;
    const palette: OoxmlElement[] = [];
    const variations: OoxmlElement[][] = [];
    for (const node of colors?.children ?? []) {
      if (!isElement(node)) continue;
      if (node.namespaceUri === A && palette.length < MAX_COLORS) palette.push(node);
      if (node.namespaceUri === CS && node.localName === 'variation') {
        if (variations.length < MAX_VARIATIONS) variations.push(node.children.filter(isElement));
      }
    }
    if (palette.length === 0) {
      for (const node of fallback.colors?.children ?? []) {
        if (isElement(node) && node.namespaceUri === A) palette.push(node);
      }
    }
    this.palette = palette;
    this.variations = variations.length > 0 ? variations : [[]];
    this.method = (colors ? schemaAttributeValue(colors.attributes, 'meth') : undefined) ?? 'cycle';
    this.base = themeFaces ? { ...DEFAULT_CHART_TEXT, themeFaces } : DEFAULT_CHART_TEXT;
  }

  /** The style entry `name`: the part's own, else the default one. */
  private entry(name: string): OoxmlElement | null {
    return csChild(this.style, name) ?? csChild(this.fallbackStyle, name);
  }

  /** A resolver that answers the placeholder colour for `phClr`. */
  private resolverWith(placeholder: ChartPaint | null): ShapeSchemeColorResolver | undefined {
    if (!placeholder) return this.resolveSchemeColor;
    const resolve = this.resolveSchemeColor;
    return (scheme) => (scheme === 'phClr' ? placeholder.hex : (resolve?.(scheme) ?? null));
  }

  /** Data colour `index` of `count` from the colour style. */
  dataColor(index: number, count = 1): ChartPaint {
    const fallback = { hex: '4472C4', alpha: 1 };
    const palette = this.palette;
    if (palette.length === 0) return fallback;
    if (this.method === 'withinLinear' || this.method === 'acrossLinear') {
      // One colour from dark to light across the data.
      const base = resolveColorNode(palette[0]!, this.resolveSchemeColor) ?? fallback;
      const step = count > 1 ? Math.min(1, Math.max(0, index / (count - 1))) : 0.5;
      const amount = Math.round((count > 1 ? 0.5 + step : 1) * 100_000);
      const name = amount <= 100_000 ? 'shade' : 'tint';
      const value = amount <= 100_000 ? amount : 200_000 - amount;
      const shift = generatedColor(`<a:${name} xmlns:a="${A}" val="${value}"/>`);
      return (shift ? transformed(base, [shift]) : base) ?? base;
    }
    const base =
      resolveColorNode(palette[index % palette.length]!, this.resolveSchemeColor) ?? fallback;
    const variation = this.variations[Math.floor(index / palette.length) % this.variations.length]!;
    return transformed(base, variation) ?? base;
  }

  /** Text of entry `name` under `txPr` layers (outermost first). */
  text(name: string, ...layers: (OoxmlElement | null)[]): ChartTextStyle {
    let style = this.base;
    for (const entryName of name === 'chartArea' ? ['chartArea'] : ['chartArea', name]) {
      const entry = this.entry(entryName);
      const fontRef = csChild(entry, 'fontRef');
      if (fontRef) {
        const idx = schemaAttributeValue(fontRef.attributes, 'idx');
        const color = fontRef.children.find(isElement);
        const resolved = color ? resolveColorNode(color, this.resolveSchemeColor) : null;
        style = {
          ...style,
          latin: idx === 'major' ? '+mj-lt' : '+mn-lt',
          eastAsian: idx === 'major' ? '+mj-ea' : '+mn-ea',
          complex: idx === 'major' ? '+mj-cs' : '+mn-cs',
          ...(resolved ? { colorHex: resolved.hex } : {}),
        };
      }
      style = applyRunLayer(style, csChild(entry, 'defRPr'), this.resolveSchemeColor);
    }
    const size = style.sizePt;
    style = {
      ...applyRunLayer(style, chartexTextRun(this.chartTxPr), this.resolveSchemeColor),
      sizePt: size,
    };
    for (const layer of layers) {
      style = applyRunLayer(style, chartexTextRun(layer), this.resolveSchemeColor);
    }
    return style;
  }

  /** The style entry's fill and line, with `color` for `phClr` and `cs:styleClr`. */
  private entryShape(name: string, color: ChartPaint | null) {
    const entry = this.entry(name);
    const resolve = this.resolverWith(color);
    const own = readChartShapeProperties(csChild(entry, 'spPr'), resolve);
    const fillRef = csChild(entry, 'fillRef');
    const lnRef = csChild(entry, 'lnRef');
    const styled = (ref: OoxmlElement | null) => ref !== null && csChild(ref, 'styleClr') !== null;
    return {
      fill: own.fill === undefined && styled(fillRef) ? color : (own.fill ?? null),
      line:
        own.line === undefined && styled(lnRef) && color
          ? { ...color, widthPt: 0.75, cap: 'butt' as const, dash: null }
          : (own.line ?? null),
    };
  }

  /** The fill of an element: its own `spPr`, else its style entry. */
  fill(
    name: string,
    spPr: OoxmlElement | null,
    color: ChartPaint | null = null
  ): ChartPaint | null {
    const own = readChartShapeProperties(spPr, this.resolverWith(color));
    return own.fill === undefined ? this.entryShape(name, color).fill : own.fill;
  }

  /**
   * The fill and outline of one data point: its `cx:dataPt` shape properties over the
   * series' own, over the style entry. A point that names only a fill keeps the series
   * outline.
   */
  point(
    name: string,
    seriesSpPr: OoxmlElement | null,
    pointSpPr: OoxmlElement | null,
    color: ChartPaint | null = null
  ): { fill: ChartPaint | null; line: ChartStroke | null } {
    const own = readChartShapeProperties(pointSpPr, this.resolverWith(color));
    return {
      fill: own.fill === undefined ? this.fill(name, seriesSpPr, color) : own.fill,
      line: mergeStroke(own.line, this.line(name, seriesSpPr, color)),
    };
  }

  /** The outline of an element: its own `spPr`, else its style entry. */
  line(
    name: string,
    spPr: OoxmlElement | null,
    color: ChartPaint | null = null
  ): ChartStroke | null {
    const own = readChartShapeProperties(spPr, this.resolverWith(color));
    return mergeStroke(own.line, this.entryShape(name, color).line);
  }
}
