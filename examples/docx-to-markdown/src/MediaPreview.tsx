import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MarkdownExportResult, MarkdownImageAsset } from '@docx-editor.dev/docx-to-markdown';

const EMPTY_URLS: ReadonlyMap<string, string> = new Map();
const ImageUrls = createContext(EMPTY_URLS);

export function createMediaPreviewUrls(media: readonly MarkdownImageAsset[]) {
  const urls = new Map<string, string>();
  const dispose = () => {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  };
  try {
    for (const image of media)
      urls.set(
        image.path,
        URL.createObjectURL(new Blob([image.bytes.slice().buffer], { type: image.mimeType }))
      );
    return { urls, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function MediaPreview({
  result,
  children,
}: {
  readonly result: MarkdownExportResult | null;
  readonly children: ReactNode;
}) {
  const [preview, setPreview] = useState<{
    result: MarkdownExportResult | null;
    urls: ReadonlyMap<string, string>;
  }>({ result: null, urls: EMPTY_URLS });
  useEffect(() => {
    const next = createMediaPreviewUrls(result?.media ?? []);
    setPreview({ result, urls: next.urls });
    return next.dispose;
  }, [result]);
  return (
    <ImageUrls.Provider value={preview.result === result ? preview.urls : EMPTY_URLS}>
      {children}
    </ImageUrls.Provider>
  );
}

export function useMediaPreviewUrls(): ReadonlyMap<string, string> {
  return useContext(ImageUrls);
}
