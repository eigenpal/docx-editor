import type { Metadata } from 'next';
import './globals.css';

// Icons and share image match the other demos so the favicon, PWA install
// prompt, and link previews all use the same artwork.
export const metadata: Metadata = {
  // Resolves the relative og/twitter image URLs below; without it Next warns
  // at build time and emits an unusable relative URL in the share tags.
  metadataBase: new URL('https://docx-editor.dev/'),
  title: 'docx-editor — Next.js Example',
  description: 'DOCX editor powered by Next.js App Router',
  alternates: {
    canonical: '/',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/web-app-manifest-192x192.png', type: 'image/png', sizes: '192x192' },
      { url: '/web-app-manifest-512x512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: '/icon.png',
  },
  openGraph: {
    title: 'DOCX Editor — Open-source DOCX editor for the browser',
    description:
      'WYSIWYG DOCX editor in the browser. Tables, images, tracked changes, comments. No server required. MIT.',
    url: '/',
    images: ['/og/docx-icon.png'],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og/docx-icon.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
