import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs: the build works at https://<user>.github.io/<repo>/ under any
  // repo name, and from `npm run preview`.
  base: './',
  build: {
    // Phaser 4 alone is ~1.4 MB minified, so the default 500 kB warning would fire on every build.
    chunkSizeWarningLimit: 1500,
  },
});
