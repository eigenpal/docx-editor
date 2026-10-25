/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFDocument, PDFName, PDFStream, PDFString, type PDFImage, type PDFPage } from 'pdf-lib';
import type { FontBackedExportCapabilities } from '@docx-editor.dev/core/export';
import {
  groupPictureLayerDrawing,
  type LayoutBox,
  type ListMarkerPictureRecord,
  type SemanticDrawingVisit,
} from '@docx-editor.dev/core/layout';
import { color, number as n, pageHeight, pdfLiteralUri, rect, Commands, Work } from './context.ts';
import { paintVectorShape } from './vector-shapes.ts';
import { paintTextArt } from './text-art.ts';
import { outlinePath, turnAbout } from './textbox-shape.ts';
import { lumTransfer, type LumTransfer } from '@docx-editor.dev/core/output';
import { MetafileForms } from './metafile-pdf.ts';
import { gifToPng } from './gif-png.ts';
import { embedPlainPng } from './png-passthrough.ts';
import { reflectionMask, softEdgeMask } from './picture-effects.ts';

const EMU_PER_POINT = 12_700;

/**
 * The raster formats this writer embeds directly.
 *
 * PDF has no GIF, BMP or WebP image filter, and its `LZWDecode` is the TIFF flavour
 * (MSB-first, with EarlyChange) rather than GIF's LSB-first stream, so a GIF cannot be
 * re-wrapped without decoding it. Core hands exporters validated ENCODED bytes and header
 * metadata — `ImageDecodePort.decode` answers dimensions and density, never pixels — so
 * widening this set means writing new decoders over attacker-controlled bytes, not reading
 * a buffer core already has.
 */
// A GIF embeds as the PNG of its first frame.
const EMBEDDABLE_MIMES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif']);

/** Embed a picture of one of the embeddable formats. */
async function embedRaster(doc: PDFDocument, mime: string, bytes: Uint8Array): Promise<PDFImage> {
  if (mime === 'image/jpeg') return doc.embedJpg(bytes);
  const png = mime === 'image/gif' ? gifToPng(bytes) : bytes;
  if (!png) throw new Error('GIF picture could not be decoded');
  return (await embedPlainPng(doc, png)) ?? doc.embedPng(png);
}

/**
 * Why a picture bullet cannot be drawn into the PDF, or null when it can.
 *
 * Every value folded into the reason is a CLOSED union minted by core — `ImageResourceState`
 * kinds, its `reason`, and a `mime` that came from signature sniffing or the content-type
 * map — so no attacker-controlled string reaches a diagnostic message.
 */
function unpaintableBulletReason(picture: ListMarkerPictureRecord, box: LayoutBox): string | null {
  const resource = picture.resource;
  if (resource.kind === 'unrenderable') return `image refused: ${resource.reason}`;
  if (resource.kind !== 'ready') return `image ${resource.kind}`;
  if (!EMBEDDABLE_MIMES.has(resource.mime)) return `format not embeddable: ${resource.mime}`;
  if (!(box.width > 0 && box.height > 0)) return 'no visible area';
  return null;
}

export class ImageWriter {
  private readonly images = new Map<string, PDFImage>();
  private readonly metafiles: MetafileForms;
  constructor(
    readonly doc: PDFDocument,
    readonly session: FontBackedExportCapabilities,
    readonly work: Work
  ) {
    this.metafiles = new MetafileForms(doc, session, work);
  }
  /**
   * Draw a list marker's picture bullet in the box layout published for it.
   *
   * Returns '' for anything not drawable — missing, external, still decoding, refused, or a
   * format this writer cannot embed — and the caller then paints the level's `w:lvlText`.
   *
   * That fall back is FOLLOWING the document, not approximating it: the same `w:lvl` authors
   * `w:lvlText` as this level's marker and `w:lvlPicBulletId` as a picture to use in its
   * place (ECMA-376 §17.9.12), so the text is the document's own alternative rather than
   * something this writer invented. It is reported all the same, at `information`: nothing
   * the document authors is lost from the page, so a strict export is still faithful, while
   * the reader is still told which of the two markers was drawn. An inline `w:drawing` whose
   * format cannot be embedded keeps reporting `unsupported`, because there the document
   * offers no alternative and the page really does lose content.
   *
   * No scaling decision is taken here: the box is the extent layout already placed on the
   * baseline, after the marker font scale.
   */
  async paintListMarkerPicture(
    picture: ListMarkerPictureRecord,
    box: LayoutBox,
    page: PDFPage,
    pageIndex: number
  ): Promise<string> {
    await this.work.yield();
    const unpaintable = unpaintableBulletReason(picture, box);
    if (unpaintable !== null) {
      this.work.report(
        'list-picture-bullet',
        `Picture bullet drawn as its level text (${unpaintable})`,
        pageIndex,
        'information'
      );
      return '';
    }
    if (picture.resource.kind !== 'ready') return '';
    const mime = picture.resource.mime;
    const bytes = this.session.validatedImageBytes(picture);
    if (!bytes || (mime === 'image/gif' && !gifToPng(bytes))) return '';
    let image = this.images.get(picture.resource.resourceKey);
    if (!image) {
      image = await embedRaster(this.doc, mime, bytes);
      this.images.set(picture.resource.resourceKey, image);
    }
    const key = `Im${image.ref.objectNumber}`;
    page.node.setXObject(PDFName.of(key), image.ref);
    const x = box.x;
    const y = pageHeight(page) - box.y - box.height;
    return `q ${n(box.width)} 0 0 ${n(box.height)} ${n(x)} ${n(y)} cm /${key} Do Q`;
  }

  /** Shadow opacity resources: one object per opacity in the document, named once per page. */
  private readonly alphaStates = new Map<
    number,
    { readonly name: string; readonly ref: ReturnType<PDFDocument['context']['register']> }
  >();
  private readonly pageAlphaStates = new WeakMap<PDFPage, Set<string>>();

  /** An `ExtGState` resource on `page` with fill and stroke opacity `alpha`. */
  private alphaState(page: PDFPage, alpha: number): string {
    let state = this.alphaStates.get(alpha);
    if (!state) {
      const ref = this.doc.context.register(
        this.doc.context.obj({ Type: 'ExtGState', ca: alpha, CA: alpha })
      );
      state = { name: `TextboxShadow${ref.objectNumber}`, ref };
      this.alphaStates.set(alpha, state);
    }
    const named = this.pageAlphaStates.get(page) ?? new Set<string>();
    if (!named.has(state.name)) {
      page.node.setExtGState(PDFName.of(state.name), state.ref);
      named.add(state.name);
      this.pageAlphaStates.set(page, named);
    }
    return state.name;
  }

  /**
   * A textbox: its shadow, its fill and outline at the extent, then `body` (the story's
   * decorations and the text its owner collected) clipped to the content box, all clipped to
   * the published paint bounds — the same boxes the screen painter draws, in the same order.
   *
   * The outline is stroked inside the extent, as a CSS border inside a `border-box` is, unless
   * the story centres it on the edge (`strokeCentered`), as a legacy shape does. Overflowing
   * content clips to the box, so a height clip is information.
   */
  paintTextbox(visit: SemanticDrawingVisit, page: PDFPage, body: readonly string[]): string {
    const d = visit.drawing;
    if (!d.textboxStory) return '';
    const story = d.textboxStory;
    const bounds = visit.absolutePaintBounds;
    if (bounds.width <= 0 || bounds.height <= 0 || d.accessibility.hidden) return '';
    if (story.fallbackReason === 'textbox-height-clip')
      this.work.report(
        'textbox-clip',
        'Textbox content taller than its box is clipped',
        visit.page.index,
        'information'
      );
    else if (story.fallbackReason) {
      this.work.report(
        'textbox',
        `Textbox story not laid out: ${story.fallbackReason}`,
        visit.page.index
      );
      return '';
    }
    const height = pageHeight(page);
    const x = visit.drawingOrigin.x - visit.page.box.x;
    const y = visit.drawingOrigin.y - visit.page.box.y;
    const extent = { x, y, width: d.width, height: d.height };
    const out = new Commands(this.work);
    out.push(`q ${rect(bounds, -visit.page.box.x, -visit.page.box.y, height)} W n`);
    const content = {
      x: x + story.contentOffset.x,
      y: y + story.contentOffset.y,
      width: story.contentWidth,
      height: Math.max(0, story.contentHeight),
    };
    // Turned text lays out upright and turns about its frame's pivot when painted.
    const turn = story.contentRotation;
    const contentTurn = turn
      ? [turnAbout(x + turn.pivot.x, y + turn.pivot.y, turn.degrees, height)]
      : [];
    const chrome = (fill: string | null, stroke: string | null): string[] => {
      const commands: string[] = [];
      // A turned shape turns its fill and outline about the box centre.
      const chromeTurn = story.chromeRotationDegrees;
      if (chromeTurn)
        commands.push('q', turnAbout(x + d.width / 2, y + d.height / 2, chromeTurn, height));
      const outline = story.outline;
      if (fill !== null)
        commands.push(
          `${color(fill)} rg ${outline ? outlinePath(outline, extent, 0, height) : rect(extent, 0, 0, height)} f`
        );
      if (stroke !== null) {
        const width = Math.max(0.5, story.strokeWidthPt);
        // A centred outline runs on the edge itself; otherwise it stays inside the box.
        const inset = story.strokeCentered ? 0 : width / 2;
        const inner = {
          x: x + inset,
          y: y + inset,
          width: Math.max(0, d.width - 2 * inset),
          height: Math.max(0, d.height - 2 * inset),
        };
        // A dashed rectangle runs from its top-left corner, where its pattern starts.
        const square = { kind: 'roundRect' as const, arc: 0 };
        const path = outline
          ? outlinePath(outline, extent, inset, height)
          : story.strokeDashPt
            ? outlinePath(square, extent, inset, height)
            : rect(inner, 0, 0, height);
        const dash = story.strokeDashPt ? `[${story.strokeDashPt.map(n).join(' ')}] 0 d ` : '';
        const cap =
          story.strokeCap === 'round' ? '1 J ' : story.strokeCap === 'square' ? '2 J ' : '';
        commands.push(`q ${dash}${cap}${color(stroke)} RG ${n(width)} w ${path} S Q`);
      }
      if (chromeTurn) commands.push('Q');
      return commands;
    };
    // A box whose shape paints as vector components: that shape first, under its own ink
    // clip, then only the text in the box.
    const vector =
      story.chromeByVector && d.vectorShape
        ? paintVectorShape(this.doc, page, visit, this.work)
        : null;
    if (vector !== null) out.unshift(vector);
    const shadow = vector === null ? story.shadow : undefined;
    if (shadow) {
      // The shape again, under itself in the shadow colour, at its page offset. A plain shadow
      // copies the outline, and the text of an unfilled shape; an obscured one is the solid
      // silhouette, cut out where the shape itself stands.
      out.push('q');
      if (shadow.alpha < 1) out.push(`/${this.alphaState(page, shadow.alpha)} gs`);
      const offset = `1 0 0 1 ${n(shadow.dx)} ${n(-shadow.dy)} cm`;
      if (shadow.obscured) {
        const edge = outlinePath(
          story.outline ?? { kind: 'roundRect', arc: 0 },
          extent,
          0,
          height,
          story.chromeRotationDegrees ?? 0
        );
        out.push(
          'q',
          `${rect(bounds, -visit.page.box.x, -visit.page.box.y, height)} ${edge} W* n`,
          offset,
          ...chrome(shadow.hex, story.strokeHex !== null ? shadow.hex : null),
          'Q'
        );
      } else {
        out.push(
          'q',
          offset,
          ...chrome(
            story.fillHex !== null ? shadow.hex : null,
            story.strokeHex !== null ? shadow.hex : null
          ),
          'Q'
        );
      }
      out.push(offset);
      if (!shadow.obscured && story.fillHex === null) {
        // The shadow is ink, not text: the copy sits in an empty actual-text span, so the story
        // extracts once, right-to-left lines included. Pictures cast no tinted copy.
        const tinted = body.map((line) =>
          line
            .replace(
              /-?[\d.]+ -?[\d.]+ -?[\d.]+ (rg|RG)\b/g,
              (_, op: string) => `${color(shadow.hex)} ${op}`
            )
            .replace(/\/ActualText <FEFF[0-9A-Fa-f]*>/g, '/ActualText <FEFF>')
            .replace(/\/[\w.-]+ Do\b/g, '')
        );
        out.push(
          'q',
          ...contentTurn,
          `${rect(content, 0, 0, height)} W n`,
          '/Span << /ActualText <FEFF> >> BDC',
          ...tinted,
          'EMC',
          'Q'
        );
      }
      out.push('Q');
    }
    if (vector === null) out.push(...chrome(story.fillHex, story.strokeHex));
    out.push('q', ...contentTurn, `${rect(content, 0, 0, height)} W n`, ...body, 'Q', 'Q');
    return out.join('\n');
  }

  async paint(visit: SemanticDrawingVisit, page: PDFPage): Promise<string> {
    await this.work.yield();
    const d = visit.drawing;
    // A hidden record (an MC wrap footprint) reserves layout space and draws nothing.
    if (d.accessibility.hidden) return '';
    const report = (message: string): string => {
      this.work.report('drawing', message, visit.page.index);
      return '';
    };
    if (d.groupPicture) return this.paintGroupPicture(visit, page, report);
    // A picture's own frame: shadow and fill under the picture, the outline over it.
    if (d.vectorShape && d.placeholderGraphicKind === null) {
      const under = paintVectorShape(this.doc, page, visit, this.work, (c) => !!c.belowPicture);
      const picture = await this.paintPicture(visit, page, report);
      const over = paintVectorShape(this.doc, page, visit, this.work, (c) => !c.belowPicture);
      return [under, picture, over].filter((commands) => commands !== '').join('\n');
    }
    if (d.vectorShape) return paintVectorShape(this.doc, page, visit, this.work);
    if (d.textboxStory) return report('Textbox story not routed through paintTextbox');
    if (d.textArt) return paintTextArt(this.doc, page, visit, this.work);
    if (d.placeholderGraphicKind) return report(`Unsupported drawing: ${d.placeholderGraphicKind}`);
    return this.paintPicture(visit, page, report);
  }

  /**
   * A shape group with picture members: the members drawn before the picture, the pictures in
   * document order, then the other vector members over them.
   *
   * The group paints whole or not at all, as it does on screen. Layout already drops an
   * `mc:AlternateContent` group whose picture resource fails, following the rule for MC
   * payloads the engine cannot draw. A ready picture in a format this writer cannot embed
   * gets the same rule here: the MC group is left out and reported at `information`, because
   * the editor draws it and only this output cannot. A bare group reports every refusal as
   * `unsupported`, as it reports an unsupported group.
   */
  private async paintGroupPicture(
    visit: SemanticDrawingVisit,
    page: PDFPage,
    report: (message: string) => string
  ): Promise<string> {
    const d = visit.drawing;
    // The first picture is the record's own image; each later one paints above it, in order.
    const pictures = [
      visit,
      ...(d.groupPictureLayers ?? []).map((layer) => ({
        ...visit,
        drawing: groupPictureLayerDrawing(d, layer),
      })),
    ];
    for (const { drawing } of pictures) {
      const { resource } = drawing;
      if (
        d.groupPicture?.alternateContent &&
        resource.kind === 'ready' &&
        !EMBEDDABLE_MIMES.has(resource.mime)
      ) {
        this.work.report(
          'drawing',
          `Shape group left out: picture format not embeddable: ${resource.mime}`,
          visit.page.index,
          'information'
        );
        return '';
      }
    }
    const painted: string[] = [];
    for (const picture of pictures) {
      let refused = false;
      const commands = await this.paintPicture(picture, page, (message) => {
        refused = true;
        return report(message);
      });
      if (refused) return '';
      painted.push(commands);
    }
    // Members drawn before the picture paint under it; the rest paint over it.
    const under = d.vectorShape
      ? paintVectorShape(this.doc, page, visit, this.work, (c) => !!c.belowPicture)
      : '';
    const over = d.vectorShape
      ? paintVectorShape(this.doc, page, visit, this.work, (c) => !c.belowPicture)
      : '';
    return [under, ...painted, over].filter((commands) => commands !== '').join('\n');
  }

  /**
   * One image object per resource and brightness/contrast transfer.
   *
   * The transfer is linear per channel, so it is the image's `Decode` array: sample 0 maps to
   * the intercept and sample 1 to slope + intercept, and the colour space clamps the result to
   * [0, 1] — the same clamped line the screen applies as a CSS filter. Only `DeviceRGB` and
   * `DeviceGray` samples are sRGB-like channels; a CMYK image keeps its samples and reports.
   */
  private async embedPicture(
    resourceKey: string,
    mime: string,
    bytes: Uint8Array,
    transfer: LumTransfer | null
  ): Promise<{ image: PDFImage; lum: boolean }> {
    const plain = async () => {
      let image = this.images.get(resourceKey);
      if (!image) {
        image = await embedRaster(this.doc, mime, bytes);
        this.images.set(resourceKey, image);
      }
      return image;
    };
    if (!transfer) return { image: await plain(), lum: false };
    const key = `${resourceKey}\0lum:${transfer.slope}:${transfer.intercept}`;
    const cached = this.images.get(key);
    if (cached) return { image: cached, lum: true };
    const image = await embedRaster(this.doc, mime, bytes);
    await image.embed();
    const stream = this.doc.context.lookup(image.ref);
    const dict = stream instanceof PDFStream ? stream.dict : null;
    const space = dict?.get(PDFName.of('ColorSpace'));
    const components =
      space === PDFName.of('DeviceRGB') ? 3 : space === PDFName.of('DeviceGray') ? 1 : 0;
    if (!dict || !components || dict.get(PDFName.of('Decode'))) {
      this.doc.context.delete(image.ref);
      return { image: await plain(), lum: false };
    }
    const low = transfer.intercept,
      high = transfer.slope + transfer.intercept;
    dict.set(
      PDFName.of('Decode'),
      this.doc.context.obj(Array.from({ length: components }, () => [low, high]).flat())
    );
    this.images.set(key, image);
    return { image, lum: true };
  }

  private async paintPicture(
    visit: SemanticDrawingVisit,
    page: PDFPage,
    report: (message: string) => string
  ): Promise<string> {
    const d = visit.drawing;
    // An EMF or WMF picture with no raster draws from its own vector commands.
    if (d.resource.kind === 'unrenderable' && d.resource.partName !== null) {
      const metafile = this.session.metafileBytes?.(d);
      if (metafile) {
        const form = await this.metafiles.form(d.resource.partName, metafile, visit.page.index);
        if (!form) return report('Metafile picture could not be drawn');
        const opacity = this.opacityCommand(visit, page);
        if (opacity === null) return report('Invalid image opacity');
        const key = `Fm${form.objectNumber}`;
        page.node.setXObject(PDFName.of(key), form);
        return this.placePicture(visit, page, key, opacity, report);
      }
    }
    const bytes = this.session.validatedImageBytes(d);
    if (!bytes || d.resource.kind !== 'ready') return report('Image has no validated raster bytes');
    const mime = d.resource.mime;
    // An inline drawing has no authored alternative, so an unembeddable format is a real
    // refusal here — unlike a picture bullet, whose level authors `w:lvlText` beside it.
    if (!EMBEDDABLE_MIMES.has(mime)) return report(`Unsupported PDF image format: ${mime}`);
    if (mime === 'image/gif' && !gifToPng(bytes)) return report('GIF picture could not be decoded');
    const transfer = lumTransfer(d.effects.brightness, d.effects.contrast);
    const embedded = await this.embedPicture(d.resource.resourceKey, mime, bytes, transfer);
    if (d.effects.grayscale || d.effects.bilevel !== undefined || (transfer && !embedded.lum))
      this.work.report(
        'image-effects',
        'Image color adjustments are not encoded',
        visit.page.index
      );
    const image = embedded.image;
    const opacityCommand = this.opacityCommand(visit, page);
    if (opacityCommand === null) return report('Invalid image opacity');
    const key = `Im${image.ref.objectNumber}`;
    page.node.setXObject(PDFName.of(key), image.ref);
    return this.placePicture(visit, page, key, opacityCommand, report);
  }

  /** The graphics state command for the picture's opacity; null for an invalid opacity. */
  private opacityCommand(visit: SemanticDrawingVisit, page: PDFPage): string | null {
    const opacity = visit.drawing.effects.opacity;
    if (opacity === undefined || opacity === 1) return '';
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return null;
    const name = `Alpha${Math.round(opacity * 100000)}`;
    const ref = this.doc.context.register(
      this.doc.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity })
    );
    page.node.setExtGState(PDFName.of(name), ref);
    return `/${name} gs `;
  }

  /**
   * Draw the XObject `key`, which fills the unit square, as the picture: placed by its
   * transform and crop, clipped by its geometry, with its link.
   */
  private placePicture(
    visit: SemanticDrawingVisit,
    page: PDFPage,
    key: string,
    opacityCommand: string,
    report: (message: string) => string
  ): string {
    const d = visit.drawing;
    const points = d.geometry.imageTransformCorners ?? d.geometry.transformedCorners;
    if (points.length !== 4) return report('Image has no affine rectangle geometry');
    if (d.geometry.clipFallback !== 'none')
      this.work.report('image-clip', 'Image clipping uses a Core fallback', visit.page.index);
    const offsetX = visit.drawingOrigin.x - d.x - visit.page.box.x;
    const offsetY = visit.drawingOrigin.y - d.y - visit.page.box.y;
    const p = points.map((v) => ({ x: v.x + offsetX, y: pageHeight(page) - v.y - offsetY }));
    const topLeft = p[0]!,
      topRight = p[1]!,
      bottomLeft = p[3]!;
    const ax = topRight.x - topLeft.x,
      ay = topRight.y - topLeft.y;
    const bx = topLeft.x - bottomLeft.x,
      by = topLeft.y - bottomLeft.y;
    const crop = d.crop;
    const width = 1 - crop.left - crop.right,
      height = 1 - crop.top - crop.bottom;
    if (!(width > 0 && height > 0)) return report('Image crop has no visible area');
    if (d.geometry.clipPolygon && d.geometry.clipPolygon.length === 0) return '';
    const clip = d.geometry.clipPolygon?.length
      ? d.geometry.clipPolygon.map((v) => ({
          x: v.x + offsetX,
          y: pageHeight(page) - v.y - offsetY,
        }))
      : p;
    // A byte string, escaped: `PDFString.of` writes its value verbatim, and a `)` in the href
    // would end the string and leave raw PDF inside the action dictionary.
    const uri =
      d.hyperlinkHref && /^(https?:|mailto:|tel:|ftp:)/i.test(d.hyperlinkHref)
        ? pdfLiteralUri(d.hyperlinkHref)
        : null;
    if (uri !== null) {
      // A loop, not `Math.min(...xs)`: the clip polygon is file-derived, and spreading a long
      // one into a call is the one place a large but otherwise valid shape could blow the stack.
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      for (const point of clip) {
        bounds[0] = Math.min(bounds[0]!, point.x);
        bounds[1] = Math.min(bounds[1]!, point.y);
        bounds[2] = Math.max(bounds[2]!, point.x);
        bounds[3] = Math.max(bounds[3]!, point.y);
      }
      page.node.addAnnot(
        this.doc.context.register(
          this.doc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: bounds,
            Border: [0, 0, 0],
            A: { S: 'URI', URI: PDFString.of(uri) },
          })
        )
      );
    }
    const path = clip.map((v, i) => `${n(v.x)} ${n(v.y)} ${i === 0 ? 'm' : 'l'}`).join(' ');
    const matrix = [
      ax / width,
      ay / width,
      bx / height,
      by / height,
      bottomLeft.x - (ax * crop.left) / width - (bx * crop.bottom) / height,
      bottomLeft.y - (ay * crop.left) / width - (by * crop.bottom) / height,
    ];
    const effects = d.frameEffects;
    const soft = effects?.softEdgeEmu
      ? softEdgeMask(this.doc, page, clip, effects.softEdgeEmu / EMU_PER_POINT)
      : '';
    const picture = `q ${opacityCommand}${soft}${path} h W n ${matrix.map(n).join(' ')} cm /${key} Do Q`;
    const reflection = effects?.reflection;
    if (!reflection) return picture;
    // The mirror image of an upright picture, below its bottom edge and fading downward.
    const bottom = Math.min(...p.map((v) => v.y));
    const top = Math.max(...p.map((v) => v.y));
    const gap = reflection.distanceEmu / EMU_PER_POINT;
    const mirror = (y: number) => 2 * bottom - y - gap;
    const [a, b, c, dd, e, f] = matrix as [number, number, number, number, number, number];
    const fade = reflectionMask(
      this.doc,
      page,
      bottom - gap,
      bottom - gap - (top - bottom) * reflection.endPosition,
      reflection.startAlpha,
      reflection.endAlpha
    );
    const mirrored = clip
      .map((v, i) => `${n(v.x)} ${n(mirror(v.y))} ${i === 0 ? 'm' : 'l'}`)
      .join(' ');
    return [
      picture,
      `q ${opacityCommand}${fade}${mirrored} h W n ${[a, -b, c, -dd, e, mirror(f)].map(n).join(' ')} cm /${key} Do Q`,
    ].join('\n');
  }
}
