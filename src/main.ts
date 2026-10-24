import './style.css';
import { loadExternalMaps } from './systems/mapLoader';
import { applyDocumentStrings, t } from './systems/strings';
import { initTouchControls } from './systems/touchControls';

applyDocumentStrings();

// Before the game boots, so the canvas is measured with the touch-control strip in place.
initTouchControls();

// The world map is an external file (session 6e): fetch and decode it first, then load the game,
// whose map registry, orders and start point read it synchronously.
loadExternalMaps()
  .then(() => import('./game'))
  .then(({ startGame }) => startGame())
  .catch((e: unknown) => {
    console.error(e);
    const el = document.getElementById('game');
    if (el) el.textContent = t('app.load-failed');
  });
