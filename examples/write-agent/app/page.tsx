'use client';

import dynamic from 'next/dynamic';

const WriterWorkspace = dynamic(
  () => import('./components/WriterWorkspace').then((module) => module.WriterWorkspace),
  {
    ssr: false,
    loading: () => <div className="boot">Loading writer workspace…</div>,
  }
);

export default function Page() {
  return <WriterWorkspace />;
}
