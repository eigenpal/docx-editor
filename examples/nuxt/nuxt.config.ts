// Nuxt example for @docx-editor.dev/nuxt. Registering the module is the
// whole integration — it auto-imports an SSR-safe <DocxEditor> component and
// injects the editor stylesheet.
export default defineNuxtConfig({
  modules: ['@docx-editor.dev/nuxt'],
  compatibilityDate: '2025-07-01',
  devtools: { enabled: false },
  app: {
    head: {
      title: 'docx-editor — Nuxt Example',
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
        { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/icon.png' },
        { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/web-app-manifest-192x192.png' },
        { rel: 'icon', type: 'image/png', sizes: '512x512', href: '/web-app-manifest-512x512.png' },
      ],
    },
  },
});
