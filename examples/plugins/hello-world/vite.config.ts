import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindcssAnimate from 'tailwindcss-animate';
import path from 'path';
import fs from 'fs';

const monorepoRoot = path.resolve(__dirname, '../../..');
const isMonorepo = fs.existsSync(path.join(monorepoRoot, 'src/index.ts'));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  resolve: {
    alias: {
      ...(isMonorepo
        ? { '@eigenpal/docx-js-editor': path.join(monorepoRoot, 'src/index.ts') }
        : {}),
      '@': path.join(monorepoRoot, 'src'),
    },
    // Deduplicate React — ensure a single copy when aliasing into the monorepo
    dedupe: ['react', 'react-dom'],
  },
  css: {
    postcss: {
      plugins: [
        // Use absolute content paths so Tailwind scans the right files
        // regardless of which directory you run `npm run dev` from.
        tailwindcss({
          darkMode: ['class'],
          content: [
            path.join(monorepoRoot, 'src/**/*.{ts,tsx}'),
            path.join(__dirname, 'src/**/*.{ts,tsx}'),
          ],
          theme: {
            extend: {
              colors: {
                border: 'hsl(var(--border))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                primary: {
                  DEFAULT: 'hsl(var(--primary))',
                  foreground: 'hsl(var(--primary-foreground))',
                },
                secondary: {
                  DEFAULT: 'hsl(var(--secondary))',
                  foreground: 'hsl(var(--secondary-foreground))',
                },
                destructive: {
                  DEFAULT: 'hsl(var(--destructive))',
                  foreground: 'hsl(var(--destructive-foreground))',
                },
                muted: {
                  DEFAULT: 'hsl(var(--muted))',
                  foreground: 'hsl(var(--muted-foreground))',
                },
                accent: {
                  DEFAULT: 'hsl(var(--accent))',
                  foreground: 'hsl(var(--accent-foreground))',
                },
                popover: {
                  DEFAULT: 'hsl(var(--popover))',
                  foreground: 'hsl(var(--popover-foreground))',
                },
                card: {
                  DEFAULT: 'hsl(var(--card))',
                  foreground: 'hsl(var(--card-foreground))',
                },
              },
              borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)',
              },
            },
          },
          plugins: [tailwindcssAnimate],
        }),
        autoprefixer(),
      ],
    },
  },
  server: {
    port: 5175,
    open: false,
  },
  build: {
    outDir: 'dist',
  },
});
