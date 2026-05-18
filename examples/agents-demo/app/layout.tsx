import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Roast My Doc',
  description: 'Upload a DOCX and let AI roast it with comments and suggestions',
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
