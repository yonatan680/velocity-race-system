import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    host: true,
    port: 5173,
    watch: {
      ignored: ['**/.tmp-verify/**', '**/public/models/*.original.glb'],
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
