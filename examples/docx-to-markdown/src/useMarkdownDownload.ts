import { useEffect, useRef, useState } from 'react';
import { createMarkdownZip, type MarkdownExportResult } from '@docx-editor.dev/docx-to-markdown';

export function useMarkdownDownload(result: MarkdownExportResult | null, filename: string) {
  const generation = useRef(0);
  const urls = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    generation.current += 1;
    setBusy(false);
    setError(null);
  }, [result]);
  useEffect(
    () => () => {
      generation.current += 1;
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    },
    []
  );
  const download = async () => {
    if (!result || busy) return;
    const current = generation.current;
    setBusy(true);
    setError(null);
    try {
      const hasMedia = result.media.length > 0;
      const blob = hasMedia
        ? new Blob([(await createMarkdownZip(result)).slice().buffer], { type: 'application/zip' })
        : new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
      if (current !== generation.current) return;
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename.replace(/\.docx$/i, '') + (hasMedia ? '.zip' : '.md');
      link.click();
      window.setTimeout(() => {
        if (urls.current.delete(url)) URL.revokeObjectURL(url);
      }, 1000);
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  return { download, busy, error };
}
