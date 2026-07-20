import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chat with your Doc',
  description: 'Upload a DOCX and chat with AI — it can add comments and suggest changes live',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
