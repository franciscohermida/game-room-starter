// Per-player screen overlay. One DOM container per player, anchored
// at the projected position of the head, containing:
//   - A chat bubble (only visible while a recent message hasn't yet
//     expired). Stacked ON TOP of the name.
//   - A name label, always visible.
// The container is `transform: translate(-50%, -100%)`, so its bottom
// edge sits at the projected point. Vertical stacking is plain flex.

interface Overlay {
  root: HTMLElement;
  label: HTMLElement;
  bubble: HTMLElement;
  bubbleExpiresAt: number;
}

const overlays = new Map<string, Overlay>();

export function createOverlay(
  container: HTMLElement,
  playerId: string,
  name: string,
  color: string,
) {
  const root = document.createElement("div");
  root.className = "player-overlay";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.hidden = true;
  root.appendChild(bubble);

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = name;
  label.style.setProperty("--accent", color);
  root.appendChild(label);

  container.appendChild(root);
  overlays.set(playerId, { root, label, bubble, bubbleExpiresAt: 0 });
}

export function updateOverlay(playerId: string, screenX: number, screenY: number) {
  const o = overlays.get(playerId);
  if (!o) return;
  o.root.style.left = `${screenX}px`;
  o.root.style.top = `${screenY}px`;
  if (!o.bubble.hidden && Date.now() > o.bubbleExpiresAt) {
    o.bubble.hidden = true;
  }
}

export function showBubble(playerId: string, text: string, durationMs = 4000) {
  const o = overlays.get(playerId);
  if (!o) return;
  o.bubble.textContent = text;
  o.bubble.hidden = false;
  o.bubbleExpiresAt = Date.now() + durationMs;
}

export function removeOverlay(playerId: string) {
  const o = overlays.get(playerId);
  if (!o) return;
  o.root.remove();
  overlays.delete(playerId);
}
