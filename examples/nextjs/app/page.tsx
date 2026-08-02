'use client';

import dynamic from 'next/dynamic';

const Editor = dynamic(() => import('./components/Editor').then((m) => m.Editor), {
  ssr: false,
  loading: () => (
    <div className="demo-loading">
      <div className="demo-loading-spinner" />
      <span>Loading editor...</span>
    </div>
  ),
});

export default function Page() {
  return <Editor />;
}
