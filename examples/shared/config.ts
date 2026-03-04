export interface FrameworkExample {
  name: string;
  url: string;
  localUrl: string;
  sourceUrl: string;
  description: string;
  icon: string; // SVG string
}

// Compact inline SVG icons for each framework
const icons = {
  vite: '<svg viewBox="0 0 410 404" width="14" height="14" fill="none"><path d="M399.6 67.6 213.1 387.3c-3.4 5.9-12 6-15.5.2L8.6 67.7c-3.9-6.5 1.7-14.4 9.1-12.8l186.5 38.2c1.2.2 2.4.2 3.6 0L393 54.7c7.3-1.5 13 6.2 9.2 12.8l-2.6.1Z" fill="url(#a)"/><path d="m292.6.1-129 26c-1.4.3-2.4 1.5-2.5 2.9l-7.9 135c-.1 1.9 1.7 3.4 3.6 2.9l35-8.6c2.1-.5 4 1.3 3.5 3.4l-10.5 47.7c-.6 2.2 1.5 4.1 3.6 3.4l22.2-7.3c2.2-.7 4.2 1.2 3.6 3.4l-16.7 64.6c-.8 3.2 3.5 5 5.4 2.2L206 266l89.2-38.9c2-.9 2.2-3.7.3-4.9l-36.7-22.9c-1.7-1-1.7-3.5.1-4.5l88-53c1.8-1 1.6-3.6-.3-4.4L209.3 83.2c-1.5-.6-1.7-2.7-.3-3.6l79.5-53.7c2-1.3 1.2-4.4-1.2-4.4L292.6.1Z" fill="url(#b)"/><defs><linearGradient id="a" x1="6" y1="33" x2="235" y2="345" gradientUnits="userSpaceOnUse"><stop stop-color="#41D1FF"/><stop offset="1" stop-color="#BD34FE"/></linearGradient><linearGradient id="b" x1="194.7" y1="8.8" x2="236.3" y2="293" gradientUnits="userSpaceOnUse"><stop stop-color="#FFBD4F"/><stop offset="1" stop-color="#FF9640"/></linearGradient></defs></svg>',
  nextjs:
    '<svg viewBox="0 0 180 180" width="14" height="14"><mask id="m" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="180" height="180"><circle cx="90" cy="90" r="90" fill="black"/></mask><g mask="url(#m)"><circle cx="90" cy="90" r="90" fill="black"/><path d="M149.5 157.5L71.8 52.5H60v75h9.5V65.5l71.3 96.6c3.1-1.4 6-3 8.7-4.6Z" fill="url(#c)"/><rect x="111" y="52.5" width="9.5" height="75" fill="url(#d)"/></g><defs><linearGradient id="c" x1="109" y1="116.5" x2="144.5" y2="160.5" gradientUnits="userSpaceOnUse"><stop stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient><linearGradient id="d" x1="115.8" y1="52.5" x2="115.5" y2="116.3" gradientUnits="userSpaceOnUse"><stop stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient></defs></svg>',
  remix:
    '<svg viewBox="0 0 800 800" width="14" height="14"><path d="M587.9 527.7c4.5 61.2 4.5 89.9 4.5 119.8H440.7c0-10-.4-19.2-.8-28.9-1.6-40.7-3.7-91.2 30-125 25.8-25.8 62-36.2 113.2-36.2h171.5v-113H599.2c-145.8 0-236.8 72.5-236.8 200.2 0 21.1 2.2 41.3 6 60.7l.3 1.2c.2 1 .5 2 .7 2.9.8 3.3 1.6 6.5 2.6 9.7l.8 2.8c.3 1 .6 2 .9 2.9.6 1.9 1.3 3.7 2 5.6.5 1.4 1.1 2.7 1.6 4.1.4.9.7 1.8 1.1 2.7.7 1.8 1.5 3.5 2.3 5.3l1 2.3c1 2.3 2.1 4.6 3.2 6.9l.6 1.2h-201v.5c0-17.6 0-17.6-1.6-43.3-.6-9.9-1.5-23-3-42.5-10.4-139.2-59.6-184-155.5-184H0V270.2h30.3c94.5 0 152.8-47.7 152.8-125.8 0-68.5-47.7-117.2-136-117.2H0V.1h197c162.3 0 258.3 83.4 258.3 206.2 0 90.6-54.6 153.5-135.1 176.5 77.4 19.5 116.6 71.5 121 145h146.7Z" fill="currentColor"/></svg>',
  astro:
    '<svg viewBox="0 0 256 366" width="12" height="14"><path d="M182.0 300.3c-16.5 12.7-49.5 21.3-87.4 21.3-37.9 0-70.9-8.6-87.4-21.3C-5.7 271.4 2.0 227.5 2.0 227.5l37.0-155.6L76.9 0h102.2l37.9 71.9 37.0 155.6s7.7 43.9-72.0 72.8Z" fill="#FF5D01"/><path d="M149.1 251.8c0 20.4-32.4 50.9-32.4 50.9s-32.4-30.5-32.4-50.9c0-20.4 14.5-37.0 32.4-37.0s32.4 16.6 32.4 37.0Z" fill="#1B1042"/></svg>',
};

const localPorts = {
  Vite: 5173,
  'Next.js': 3000,
  Remix: 3001,
  Astro: 4321,
};

export const examples: FrameworkExample[] = [
  {
    name: 'Vite',
    url: 'https://docx-editor-vite.vercel.app',
    localUrl: `http://localhost:${localPorts.Vite}`,
    sourceUrl: 'https://github.com/eigenpal/docx-js-editor/tree/main/examples/vite',
    description: 'Vite + React',
    icon: icons.vite,
  },
  {
    name: 'Next.js',
    url: 'https://docx-editor-nextjs.vercel.app',
    localUrl: `http://localhost:${localPorts['Next.js']}`,
    sourceUrl: 'https://github.com/eigenpal/docx-js-editor/tree/main/examples/nextjs',
    description: 'Next.js App Router',
    icon: icons.nextjs,
  },
  {
    name: 'Remix',
    url: 'https://docx-editor-remix.vercel.app',
    localUrl: `http://localhost:${localPorts.Remix}`,
    sourceUrl: 'https://github.com/eigenpal/docx-js-editor/tree/main/examples/remix',
    description: 'Remix + Vite',
    icon: icons.remix,
  },
  {
    name: 'Astro',
    url: 'https://docx-editor-astro.vercel.app',
    localUrl: `http://localhost:${localPorts.Astro}`,
    sourceUrl: 'https://github.com/eigenpal/docx-js-editor/tree/main/examples/astro',
    description: 'Astro + React Island',
    icon: icons.astro,
  },
];
