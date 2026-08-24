import type { Metadata } from 'next';
import '@docx-editor.dev/core/styles/editor.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'docx-editor — Writer agent example',
  description: 'An interviewed writer agent that creates and revises a live DOCX',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
