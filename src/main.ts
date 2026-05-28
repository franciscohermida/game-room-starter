// Client entry. Wires the Three.js scene to a Cloudflare Agent.
//
// The Agent owns the truth: `state.players` is the live roster, kept
// in sync to every connected client automatically by the SDK. Our job
// is just to mirror that into the scene each time it changes.
//
// Movement is client-authoritative for the LOCAL player: we step the
// position from input each frame, then push it to the server at ~20Hz.
// The server stores it and the SDK fans it out to everyone else via
// the same state-sync channel. Other clients see the new position on
// their next `onStateUpdate`.
//
// Chat is the only thing that isn't in state — it's ephemeral, so the
// server broadcasts a one-shot message and we render it as a bubble.

import { AgentClient } from "agents/client";
import {
  createScene,
  createPlayer,
  projectToScreen,
  screenToWorld,
  torchPositionFor,
  MAP_SIZE,
  INDICATOR_OFFSET,
  PLAYER_RADIUS,
  PLAYER_TORCH_BASE_INTENSITY,
  type Player,
} from "./scene";
import { createInput } from "./input";
import { createOverlay, updateOverlay, showBubble, removeOverlay } from "./overlay";

interface NetPlayer {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  facingX: number;
  facingY: number;
}
interface RoomState {
  players: Record<string, NetPlayer>;
}

const SPEED = 4; // tiles per second
const SEND_INTERVAL_MS = 50; // ~20 Hz position sync
const HALF_MAP = MAP_SIZE / 2 - 0.5;
const ARRIVAL_RADIUS = 0.15;
const CAM_OFFSET = { x: 15, y: 15, z: 15 };

const canvasContainer = $("canvas-container");
const overlaysContainer = $("overlays");
const namePrompt = $("name-prompt");
const nameInput = $<HTMLInputElement>("name-input");
const enterBtn = $<HTMLButtonElement>("enter-btn");
const chat = $("chat");
const chatInput = $<HTMLInputElement>("chat-input");
const roomInfo = $("room-info");
const roomCodeEl = $("room-code");
const copyLinkBtn = $("copy-link-btn");
const newRoomBtn = $("new-room-btn");
const hint = $("hint");

const { scene, camera, renderer, dungeon, colliders } = createScene(canvasContainer);
const input = createInput(canvasContainer);
const localPlayers = new Map<string, Player>();

let agent: AgentClient<Room> | null = null;
let myId: string | null = null;
let lastSentAt = 0;
let lastSentX = 0;
let lastSentY = 0;
let lastSentFacingX = 0;
let lastSentFacingY = 1;

// Type-only import for the typed RPC stub. `import type` ensures the
// server module never lands in the client bundle.
type Room = import("../worker/Room").Room;

const savedName = localStorage.getItem("game-room-name") ?? "";
nameInput.value = savedName;

function getRoomCode(): string {
  const m = location.pathname.match(/^\/r\/([\w-]+)/);
  return m?.[1] ?? "lobby";
}

function spawn(p: NetPlayer) {
  const player = createPlayer(scene, p);
  localPlayers.set(player.id, player);
  createOverlay(overlaysContainer, player.id, player.name, player.color);
}

function despawn(id: string) {
  const p = localPlayers.get(id);
  if (!p) return;
  scene.remove(p.body);
  scene.remove(p.indicator);
  scene.remove(p.torchFlame);
  scene.remove(p.torchLight);
  removeOverlay(p.id);
  localPlayers.delete(p.id);
}

// Reconcile local view with server state. The local player is special:
// we OWN its position client-side and ignore the echo from the server
// (which would just snap us back to ~50ms ago). For everyone else, the
// server's position is the truth.
function syncFromState(state: RoomState) {
  for (const [id, p] of Object.entries(state.players)) {
    if (!localPlayers.has(id)) spawn(p);
    if (id !== myId) {
      const lp = localPlayers.get(id);
      if (!lp) continue;
      lp.x = p.x;
      lp.y = p.y;
      lp.facingX = p.facingX;
      lp.facingY = p.facingY;
    }
  }
  for (const id of [...localPlayers.keys()]) {
    if (!(id in state.players)) despawn(id);
  }
}

function connect(name: string) {
  if (agent) return; // guard against double-clicks on Enter
  localStorage.setItem("game-room-name", name);
  namePrompt.hidden = true;
  chat.hidden = false;
  roomInfo.hidden = false;
  hint.hidden = false;
  roomCodeEl.textContent = `room: ${getRoomCode()}`;

  agent = new AgentClient<Room, RoomState>({
    host: location.host,
    agent: "room",
    name: getRoomCode(),
    query: { name },
    onStateUpdate: (state) => syncFromState(state),
  });
  // The Agent's WebSocket id (also = server-side connection.id) is
  // our player id. Available synchronously after construct.
  myId = agent.id;

  // Ephemeral chat broadcasts come in as raw "message" events.
  agent.addEventListener("message", (e) => {
    if (typeof e.data !== "string") return;
    let msg: { type?: string; id?: string; text?: string };
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "chat" && msg.id && msg.text) {
      showBubble(msg.id, msg.text);
    }
  });

  // SDK reconnects under the hood. On a hard drop, the AgentClient
  // surface stays the same instance — no work to do here.
}

// -- Name prompt --

function enter() {
  const name = nameInput.value.trim() || "Anon";
  connect(name);
}
enterBtn.addEventListener("click", enter);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") enter();
});

// -- Chat. Enter focuses; Enter sends-and-blurs; ESC blurs. --

window.addEventListener("keydown", (e) => {
  if (!namePrompt.hidden) return;
  if (e.key === "Enter" && document.activeElement !== chatInput) {
    e.preventDefault();
    chatInput.focus();
  } else if (e.key === "Escape" && document.activeElement === chatInput) {
    chatInput.blur();
  }
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  // Stop the Enter from bubbling — otherwise the window listener
  // above sees it and re-focuses the input we just blurred.
  e.stopPropagation();
  const text = chatInput.value.trim();
  if (text && agent) {
    agent.stub.chat(text);
  }
  chatInput.value = "";
  chatInput.blur();
});

// -- Room actions --

copyLinkBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(location.href);
});
newRoomBtn.addEventListener("click", () => {
  const code = Math.random().toString(36).slice(2, 8);
  location.href = `/r/${code}`;
});

// -- Render loop --

let last = performance.now();
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  dungeon.update(now / 1000);

  if (myId) {
    const me = localPlayers.get(myId);
    if (me) {
      // Decide direction: keyboard wins over pointer.
      let dx = 0;
      let dy = 0;
      const keyMag = Math.hypot(input.state.dx, input.state.dy);
      if (keyMag > 0) {
        dx = input.state.dx / keyMag;
        dy = input.state.dy / keyMag;
      } else if (input.pointerScreen) {
        const t = screenToWorld(
          input.pointerScreen.x,
          input.pointerScreen.y,
          camera,
          canvasContainer,
        );
        if (t) {
          const tx = t.x - me.x;
          const ty = t.y - me.y;
          const dist = Math.hypot(tx, ty);
          if (dist >= ARRIVAL_RADIUS) {
            dx = tx / dist;
            dy = ty / dist;
          }
        }
      }

      if (dx !== 0 || dy !== 0) {
        // Two-axis sliding: try each axis independently and only
        // commit the move if it doesn't land us inside a collider.
        // If both succeed → diagonal walk. If one is blocked → the
        // player slides along the wall instead of stopping dead.
        // Preventive (not reactive) — we never let the player enter
        // the collider in the first place.
        const stepX = clamp(me.x + dx * SPEED * dt, -HALF_MAP, HALF_MAP);
        if (!colliders.isBlocked(stepX, me.y, PLAYER_RADIUS)) me.x = stepX;
        const stepY = clamp(me.y + dy * SPEED * dt, -HALF_MAP, HALF_MAP);
        if (!colliders.isBlocked(me.x, stepY, PLAYER_RADIUS)) me.y = stepY;
        me.facingX = dx;
        me.facingY = dy;
      }

      // Throttle outbound updates — skip if nothing changed since last send.
      const moved =
        Math.abs(me.x - lastSentX) > 0.001 ||
        Math.abs(me.y - lastSentY) > 0.001 ||
        Math.abs(me.facingX - lastSentFacingX) > 0.01 ||
        Math.abs(me.facingY - lastSentFacingY) > 0.01;
      if (
        moved &&
        now - lastSentAt > SEND_INTERVAL_MS &&
        agent?.readyState === WebSocket.OPEN
      ) {
        agent.stub.move(me.x, me.y, me.facingX, me.facingY);
        lastSentAt = now;
        lastSentX = me.x;
        lastSentY = me.y;
        lastSentFacingX = me.facingX;
        lastSentFacingY = me.facingY;
      }
    }
  }

  // Camera follows the local player.
  if (myId) {
    const me = localPlayers.get(myId);
    if (me) {
      camera.position.set(me.x + CAM_OFFSET.x, CAM_OFFSET.y, me.y + CAM_OFFSET.z);
      camera.lookAt(me.x, 0, me.y);
    }
  }

  const t = now / 1000;
  for (const p of localPlayers.values()) {
    p.body.position.x = p.x;
    p.body.position.z = p.y;
    p.indicator.position.x = p.x + p.facingX * INDICATOR_OFFSET;
    p.indicator.position.z = p.y + p.facingY * INDICATOR_OFFSET;

    // Player-carried torch follows the body (held to the right side
    // at body height), and flickers with its own phase.
    const torchPos = torchPositionFor(p.x, p.y, p.facingX, p.facingY);
    p.torchFlame.position.set(torchPos.x, torchPos.y, torchPos.z);
    p.torchLight.position.set(torchPos.x, torchPos.y, torchPos.z);
    const flicker =
      1 +
      0.18 * Math.sin(t * 9 + p.torchPhase) +
      0.1 * Math.sin(t * 14 + p.torchPhase * 2);
    p.torchLight.intensity = PLAYER_TORCH_BASE_INTENSITY * flicker;

    const head = projectToScreen(p.x, 1.2, p.y, camera, canvasContainer);
    updateOverlay(p.id, head.x, head.y);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// -- helpers --

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from index.html`);
  return el as T;
}
function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
