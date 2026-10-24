import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Fills `%t:<id>%` placeholders in index.html from the English strings file, so the
 * static page (title, lang) has no hard-coded text. main.ts sets the same values again
 * at boot via t(); this just keeps them right before any JS runs.
 */
function htmlStrings(): Plugin {
  const escape = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return {
    name: 'html-strings',
    transformIndexHtml(html) {
      const strings: Record<string, string> = JSON.parse(readFileSync('src/data/strings/en.json', 'utf8'));
      return html.replace(/%t:([\w.-]+)%/g, (_, id: string) => {
        if (!(id in strings)) throw new Error(`index.html: missing string "${id}"`);
        return escape(strings[id]);
      });
    },
  };
}

export default defineConfig({
  // Relative asset URLs: the build works at https://<user>.github.io/<repo>/ under any
  // repo name, and from `npm run preview`.
  base: './',
  plugins: [htmlStrings()],
  build: {
    // Phaser 4 alone is ~1.4 MB minified, so the default 500 kB warning would fire on every build.
    // Since session 6e the world map is an external file (public/assets/maps), not bundled, so the
    // game chunk is back under this project's original limit (6d had raised it to 2000 kB).
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        // Minification strips Phaser's per-file licence comments; this banner is added after
        // minification, so it survives. Full third-party texts live in public/THIRD-PARTY-NOTICES.txt.
        postBanner:
          '/*! Jackson Heights RPG (c) 2026 jcnyc90: code MIT, content CC BY-NC-SA 4.0 ' +
          '(https://github.com/jcnyc90/jackson-heights-rpg). Bundles Phaser and third-party code ' +
          'under MIT, ISC and BSD licences, and the Spleen font (c) 2018-2026 Frederic Cambus, ' +
          'BSD-2-Clause; notices: ../THIRD-PARTY-NOTICES.txt */',
      },
    },
  },
});
