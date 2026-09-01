import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

// Nested tables arrive as stock HTML. Blob URLs are minted only from Core-validated DOCX media;
// allowing that local protocol makes the live preview self-contained without uploading images.
const MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'blob'],
  },
};

export function MarkdownBlock({ children }: { readonly children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]}
        urlTransform={(url, key) =>
          key === 'src' && url.startsWith('blob:') ? url : defaultUrlTransform(url)
        }
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
