import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * The converted PDF, rendered page by page onto canvases.
 *
 * The browser's own `<object>` viewer draws the file at whatever size it likes inside a box
 * it does not know the width of, with its own chrome, and no two browsers agree. Rendering
 * with pdf.js gives the same stacked pages the editor shows on the other side, fitted to the
 * pane and sharp on a high-density display: each page is drawn at the device pixel ratio
 * into a canvas sized to the pane's width, and drawn again when the pane changes width.
 */
export function PdfViewer({
  bytes,
  pageCount,
}: {
  readonly bytes: Uint8Array;
  readonly pageCount: number;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    setWidth(Math.floor(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    // pdf.js takes ownership of the buffer it is given, so it gets a copy and the demo keeps
    // its bytes for the download link.
    const task = pdfjs.getDocument({ data: bytes.slice() });
    void task.promise.then(
      (loaded) => {
        if (cancelled) void loaded.destroy();
        else setDocument(loaded);
      },
      () => {
        /* A file this demo just produced parses; if it does not, the pane stays empty. */
      }
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [bytes]);

  useEffect(() => () => void document?.destroy(), [document]);

  return (
    <div ref={host} className="pdf-viewer">
      {document && width > 0
        ? Array.from({ length: document.numPages }, (_, index) => (
            <PdfPage key={index} document={document} index={index} width={width} />
          ))
        : Array.from({ length: pageCount }, (_, index) => (
            <div key={index} className="pdf-viewer-page pdf-viewer-page--pending" />
          ))}
    </div>
  );
}

function PdfPage({
  document,
  index,
  width,
}: {
  readonly document: PDFDocumentProxy;
  readonly index: number;
  readonly width: number;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null =
      null;
    void document.getPage(index + 1).then((page) => {
      if (cancelled) return;
      const element = canvas.current;
      if (!element) return;
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      const viewport = page.getViewport({ scale: scale * ratio });
      element.width = Math.floor(viewport.width);
      element.height = Math.floor(viewport.height);
      element.style.width = `${width}px`;
      element.style.height = `${Math.floor(viewport.height / ratio)}px`;
      const context = element.getContext('2d');
      if (!context) return;
      render = page.render({ canvasContext: context, viewport, canvas: element });
      void render.promise.catch(() => {
        /* Cancelled by a newer width or an unmount; nothing to report. */
      });
    });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [document, index, width]);

  return (
    <div className="pdf-viewer-page">
      <canvas ref={canvas} aria-label={`Page ${index + 1}`} />
      <span className="pdf-viewer-page-number" aria-hidden="true">
        {index + 1}
      </span>
    </div>
  );
}
