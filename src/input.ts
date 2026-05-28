// Movement input.
//
//   - Keyboard (WASD / arrows): emits a normalized direction vector
//     in `state`, rotated -45° so keys feel aligned with the iso view.
//   - Pointer (mouse / touch / pen): walk-toward-cursor while held.
//     We only track the cursor's *screen* position here — the render
//     loop re-projects it to world coords each frame. Because the
//     camera follows the player, a stationary cursor produces a
//     constant world-space direction, so the sphere keeps walking
//     until you release. Move the cursor to steer; release to stop.
//
// Keyboard takes priority over the pointer in the render loop.

export interface InputState {
  dx: number;
  dy: number;
}

const ISO_ROTATION = -Math.PI / 4;

function rotateForIso(x: number, y: number) {
  return {
    dx: x * Math.cos(ISO_ROTATION) - y * Math.sin(ISO_ROTATION),
    dy: x * Math.sin(ISO_ROTATION) + y * Math.cos(ISO_ROTATION),
  };
}

export function createInput(canvas: HTMLElement) {
  const ret = {
    state: { dx: 0, dy: 0 } as InputState,
    // Live cursor position in CSS pixels while a pointer is held.
    // The render loop re-casts this to world coords each frame so the
    // walk direction stays correct as the camera follows the player.
    pointerScreen: null as { x: number; y: number } | null,
    setEnabled(b: boolean) { enabled = b; if (!b) reset(); },
  };

  const keys = new Set<string>();
  let enabled = true;
  let pointerId: number | null = null;

  function reset() {
    keys.clear();
    ret.state.dx = 0;
    ret.state.dy = 0;
    ret.pointerScreen = null;
    pointerId = null;
  }

  function recomputeKeyboard() {
    let x = 0;
    let y = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
    if (x === 0 && y === 0) {
      ret.state.dx = 0;
      ret.state.dy = 0;
      return;
    }
    const { dx, dy } = rotateForIso(x, y);
    ret.state.dx = dx;
    ret.state.dy = dy;
  }

  window.addEventListener("keydown", (e) => {
    if (!enabled) return;
    if (e.target instanceof HTMLInputElement) return;
    keys.add(e.code);
    recomputeKeyboard();
  });
  window.addEventListener("keyup", (e) => {
    keys.delete(e.code);
    recomputeKeyboard();
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (!enabled) return;
    pointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    ret.pointerScreen = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!enabled || e.pointerId !== pointerId) return;
    ret.pointerScreen = { x: e.clientX, y: e.clientY };
  });
  function endPointer(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    ret.pointerScreen = null;
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  return ret;
}
