import { PDFViewer } from '@/components/extend/pdf-viewer';
import { loadSharedPdfEngine } from '@/lib/pdf-thumbnail-utils';
import './pdf-viewer.css';

/** Start the shared renderer while the server converts, instead of after the PDF arrives. */
export function preparePdfPreview(): void {
  // The mounted viewer reports engine errors. Prewarming must not fail the conversion or
  // prevent downloading a PDF when only its preview is unavailable.
  void loadSharedPdfEngine().catch(() => undefined);
}

/**
 * The converted PDF in the Extend UI viewer (PDFium in a Web Worker, via EmbedPDF).
 *
 * The viewer gets the demo's blob URL and owns its own scroll viewport: pages are fitted to the
 * pane width, tiled at the device pixel ratio, and refitted when the split handle changes the
 * pane. The toolbar keeps zoom, rotate, search, thumbnails and download; upload is off because
 * the document comes from the editor on the other side.
 */
export function PdfViewer({ src }: { readonly src: string }) {
  return (
    <div className="pdf-extend-viewer">
      <PDFViewer
        src={src}
        defaultZoom="fit-width"
        fileName="document.pdf"
        showUpload={false}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
