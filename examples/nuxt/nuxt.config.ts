// Nuxt example for @eigenpal/nuxt-docx-editor. Registering the module is the
// whole integration — it auto-imports an SSR-safe <DocxEditor> component and
// injects the editor stylesheet.
export default defineNuxtConfig({
  modules: ['@eigenpal/nuxt-docx-editor'],
  compatibilityDate: '2025-07-01',
  devtools: { enabled: false },
  app: {
    head: {
      title: 'docx-editor — Nuxt Example',
      link: [
        { rel: 'icon', href: '/favicon.ico' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block',
        },
      ],
    },
  },
});
