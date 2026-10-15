import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs: the build works at https://<user>.github.io/<repo>/ under any
  // repo name, and from `npm run preview`.
  base: './',
  build: {
    // Phaser 4 alone is ~1.4 MB minified, so the default 500 kB warning would fire on every build.
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        // Minification strips Phaser's per-file licence comments; this banner is added after
        // minification, so it survives. Full third-party texts live in public/THIRD-PARTY-NOTICES.txt.
        postBanner:
          '/*! Jackson Heights RPG (c) 2026 jcnyc90: code MIT, content CC BY-NC-SA 4.0 ' +
          '(https://github.com/jcnyc90/jackson-heights-rpg). Bundles Phaser and third-party code ' +
          'under MIT, ISC and BSD licences; notices: ../THIRD-PARTY-NOTICES.txt */',
      },
    },
  },
});
