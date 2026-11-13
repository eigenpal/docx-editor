import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Apache-licensed packages only, resolved through their built dist/.
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  server: { port: 5181 },
});
