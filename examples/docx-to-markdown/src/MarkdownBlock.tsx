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
          img: ({ src, alt }) => {
            const url = src ? images.get(src) : undefined;
            return url ? (
              <img
                src={url}
                alt={alt ?? ''}
                loading="lazy"
                style={{ maxWidth: '100%', height: 'auto' }}
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
