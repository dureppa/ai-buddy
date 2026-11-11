import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const extensionFile = (relativePath: string) => new URL(relativePath, import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      input: {
        popup: extensionFile('./index.html'),
        content: extensionFile('./src/content.ts'),
        background: extensionFile('./src/background.ts'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
