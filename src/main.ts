import Phaser from 'phaser';
import './style.css';
import { BG_COLOR, GAME_HEIGHT, GAME_WIDTH } from './config';
import { BootScene } from './scenes/BootScene';
import { DialogueScene } from './scenes/DialogueScene';
import { MapScene } from './scenes/MapScene';
import { applyDocumentStrings } from './systems/strings';
import { initTouchControls } from './systems/touchControls';

applyDocumentStrings();

// Before the game boots, so the canvas is measured with the touch-control strip in place.
initTouchControls();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: BG_COLOR,
  pixelArt: true, // nearest-neighbour scaling + whole-pixel rendering
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    expandParent: false,
  },
  physics: {
    default: 'arcade',
    // Dev only: add ?debug to the URL to draw collision boxes.
    arcade: { debug: import.meta.env.DEV && new URLSearchParams(location.search).has('debug') },
  },
  audio: { noAudio: true }, // no audio yet; avoids creating an AudioContext
  // Later scenes render on top: the text window draws over the map.
  scene: [BootScene, MapScene, DialogueScene],
});

// Dev only: expose the game for poking at it from the browser console.
if (import.meta.env.DEV) Object.assign(window, { game });
