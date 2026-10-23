import { DIRECTIONS_8, type Direction8 } from '../config';

/** Touch input state, written by DOM pointer events and read by Controls each frame. */
export const touchState = {
  direction: null as Direction8 | null,
  /** Counts thumbstick presses (new pointer down), so a lock can tell a held press from a new one. */
  stickPresses: 0,
  actionQueued: false,
  /** Returns true once per action-button press. */
  takeAction(): boolean {
    const queued = this.actionQueued;
    this.actionQueued = false;
    return queued;
  },
};

// The thumbstick (session 6d, replacing the D-pad): a round base and a knob that follows the
// thumb, up to KNOB_TRAVEL of the base's radius from the centre. The direction snaps to one of
// eight 45-degree sectors; within DEADZONE of the radius it's neutral.
const DEADZONE = 0.25;
const KNOB_TRAVEL = 0.55;

/**
 * The thumbstick direction for an offset from the base's centre, in units of its radius:
 * null inside the deadzone, else the 45-degree sector the offset points into.
 */
export function stickDirection(dx: number, dy: number): Direction8 | null {
  if (Math.hypot(dx, dy) < DEADZONE) return null;
  // Angle clockwise from up, in eighths of a turn.
  const eighths = Math.round((Math.atan2(dx, -dy) / (2 * Math.PI)) * 8);
  return DIRECTIONS_8[((eighths % 8) + 8) % 8];
}

function isTouchDevice(): boolean {
  return navigator.maxTouchPoints > 0 || window.matchMedia('(any-pointer: coarse)').matches;
}

/**
 * Wires the on-screen thumbstick and action button declared in index.html. They are only
 * shown (via the `touch` class on <html>) on touch devices, or after the first touch.
 */
export function initTouchControls(): void {
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  const action = document.getElementById('action-btn');
  if (!stick || !knob || !action) throw new Error('Touch control elements missing from index.html');

  const show = () => document.documentElement.classList.add('touch');
  if (isTouchDevice()) show();
  else window.addEventListener('touchstart', show, { once: true, passive: true });

  // One pointer drives the stick; it keeps tracking while the thumb slides off the base.
  let stickPointer: number | null = null;

  const setDirection = (dir: Direction8 | null) => {
    touchState.direction = dir;
    if (dir) stick.dataset.dir = dir;
    else delete stick.dataset.dir;
  };

  const update = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    const radius = r.width / 2;
    if (!radius) return; // hidden (no touch): nothing to measure against
    const dx = (e.clientX - (r.left + radius)) / radius;
    const dy = (e.clientY - (r.top + r.height / 2)) / radius;
    setDirection(stickDirection(dx, dy));
    // The knob follows the thumb, clamped to its travel (whole pixels, like everything else).
    const len = Math.hypot(dx, dy);
    const k = len > KNOB_TRAVEL ? KNOB_TRAVEL / len : 1;
    knob.style.transform = `translate(${Math.round(dx * k * radius)}px, ${Math.round(dy * k * radius)}px)`;
  };

  const release = () => {
    stickPointer = null;
    setDirection(null);
    knob.style.transform = '';
  };

  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (stickPointer !== null) return;
    stickPointer = e.pointerId;
    touchState.stickPresses++;
    update(e);
  });
  // Listen on window so a thumb sliding off the base still updates/releases it.
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickPointer) update(e);
  });
  for (const type of ['pointerup', 'pointercancel'] as const) {
    window.addEventListener(type, (e) => {
      if (e.pointerId === stickPointer) release();
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
  window.addEventListener('blur', release);
  document.getElementById('touch-controls')?.addEventListener('contextmenu', (e) => e.preventDefault());
}
