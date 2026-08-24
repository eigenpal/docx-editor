import type { Metadata } from 'next';
import '@docx-editor.dev/core/styles/editor.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'docx-editor — Writer agent example',
  description: 'A writer agent that creates and revises a live DOCX from a short request',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
