import type { Metadata } from 'next';
// The shipped stylesheet is self-contained: its utilities are compiled and
// scoped to `.docx-editor` at build time, so there is no Tailwind step here.
import '@docx-editor.dev/core/styles/editor.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'docx-editor — Agent Example',
  description: 'An LLM agent reading and commenting on a DOCX in the browser',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
