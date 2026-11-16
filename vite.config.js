import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: process.env.GITHUB_PAGES === 'true' ? '/velocity-race-system/' : '/',
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
