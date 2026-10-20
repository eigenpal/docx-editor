import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { useMediaPreviewUrls } from './MediaPreview';

export function MarkdownBlock({ children }: { readonly children: string }) {
  const images = useMediaPreviewUrls();
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          img: ({ src, alt, width, height }) => {
            const w = Number(width);
            const h = Number(height);
            const sized =
              width !== undefined &&
              height !== undefined &&
              Number.isFinite(w) &&
              Number.isFinite(h) &&
              w >= 0 &&
              h >= 0;
            const url = src ? images.get(src) : undefined;
            return url ? (
              <img
                src={url}
                alt={alt ?? ''}
                loading="lazy"
                width={sized ? w : undefined}
                height={sized ? h : undefined}
                style={{
                  display: 'inline',
                  maxWidth: '100%',
                  height: sized && (w === 0 || h === 0) ? h : 'auto',
                  ...(sized ? { width: w } : {}),
                  ...(sized && w > 0 && h > 0 ? { aspectRatio: `${w} / ${h}` } : {}),
                }}
              />
            ) : (
              <span>{alt}</span>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
