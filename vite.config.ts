import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Phaser alone is ~1.2 MB minified, so the default 500 kB warning would fire on every build.
    chunkSizeWarningLimit: 1500,
  },
});
