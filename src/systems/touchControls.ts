import type { Direction } from '../config';

/** Touch input state, written by DOM pointer events and read by Controls each frame. */
export const touchState = {
  direction: null as Direction | null,
  /** Counts D-pad presses (new pointer down), so a lock can tell a held press from a new one. */
  dpadPresses: 0,
  actionQueued: false,
  /** Returns true once per action-button press. */
  takeAction(): boolean {
    const queued = this.actionQueued;
    this.actionQueued = false;
    return queued;
  },
};

// Pointer this close to the D-pad centre (fraction of its width) counts as neutral.
const DEADZONE = 0.12;

function isTouchDevice(): boolean {
  return navigator.maxTouchPoints > 0 || window.matchMedia('(any-pointer: coarse)').matches;
}

/**
 * Wires the on-screen D-pad and action button declared in index.html. They are only
 * shown (via the `touch` class on <html>) on touch devices, or after the first touch.
 */
export function initTouchControls(): void {
  const dpad = document.getElementById('dpad');
  const action = document.getElementById('action-btn');
  if (!dpad || !action) throw new Error('Touch control elements missing from index.html');

  const show = () => document.documentElement.classList.add('touch');
  if (isTouchDevice()) show();
  else window.addEventListener('touchstart', show, { once: true, passive: true });

  // D-pad: one pointer drives it; its position relative to the centre picks the
  // direction, so a thumb can roll between arms without lifting.
  let dpadPointer: number | null = null;

  const setDirection = (dir: Direction | null) => {
    touchState.direction = dir;
    if (dir) dpad.dataset.dir = dir;
    else delete dpad.dataset.dir;
  };

  const updateDirection = (e: PointerEvent) => {
    const r = dpad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * DEADZONE) setDirection(null);
    else if (Math.abs(dx) > Math.abs(dy)) setDirection(dx > 0 ? 'right' : 'left');
    else setDirection(dy > 0 ? 'down' : 'up');
  };

  const releaseDpad = () => {
    dpadPointer = null;
    setDirection(null);
  };

  dpad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (dpadPointer !== null) return;
    dpadPointer = e.pointerId;
    touchState.dpadPresses++;
    updateDirection(e);
  });
  // Listen on window so a thumb sliding off the pad still updates/releases it.
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId === dpadPointer) updateDirection(e);
  });
  for (const type of ['pointerup', 'pointercancel'] as const) {
    window.addEventListener(type, (e) => {
      if (e.pointerId === dpadPointer) releaseDpad();
    });
  }

  action.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    touchState.actionQueued = true;
    action.classList.add('pressed');
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    action.addEventListener(type, () => action.classList.remove('pressed'));
  }

  // Never leave a direction held if the page loses focus mid-press.
  window.addEventListener('blur', releaseDpad);
  document.getElementById('touch-controls')?.addEventListener('contextmenu', (e) => e.preventDefault());
}
