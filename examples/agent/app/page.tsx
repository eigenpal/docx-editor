'use client';

import dynamic from 'next/dynamic';

// The editor reads the DOM and measures layout, so it cannot run during server
// rendering. One `dynamic()` with `ssr: false` is the whole fix.
const RoastMyDoc = dynamic(() => import('./components/RoastMyDoc').then((m) => m.RoastMyDoc), {
  ssr: false,
  loading: () => <div className="boot">Loading editor…</div>,
});

export default function Page() {
  return <RoastMyDoc />;
}
