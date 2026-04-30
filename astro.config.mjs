// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://websmiths.github.io',
  base: '/julian-smith-music',
  trailingSlash: 'ignore',
  vite: {
    plugins: [tailwindcss()],
  },
});
