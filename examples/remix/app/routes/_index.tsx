import type { MetaFunction } from '@remix-run/node';
import { lazy, Suspense, useEffect, useState } from 'react';

export const meta: MetaFunction = () => {
  return [
    { title: 'docx-js-editor — Remix Example' },
    { name: 'description', content: 'DOCX editor powered by Remix' },
  ];
};

const Editor = lazy(() => import('../components/Editor').then((m) => ({ default: m.Editor })));

export default function Index() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: '#666',
        }}
      >
        Loading DOCX Editor...
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            color: '#666',
          }}
        >
          Loading DOCX Editor...
        </div>
      }
    >
      <Editor />
    </Suspense>
  );
}
