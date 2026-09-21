import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'landing',
  base: './',
  plugins: [vue(), tailwindcss()],
  build: {
    outDir: '../.landing-build',
    emptyOutDir: true,
    assetsDir: 'landing-assets',
  },
});
