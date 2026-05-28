# game-room-starter

A Cloudflare Agents starter for tiny multiplayer rooms.

One Agent per room. Synced state. Hibernatable WebSockets. Three.js for an iso scene with players.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/franciscohermida/game-room-starter)
[![Source on GitHub](https://img.shields.io/badge/source-github-181717?style=for-the-badge&logo=github)](https://github.com/franciscohermida/game-room-starter)
[![MIT](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

One command runs it all locally. No Cloudflare account required.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://127.0.0.1:5173>. Type a name, hit enter. You're in the lobby room.

Open a second tab — second player. Click and drag (or use WASD / arrows) to walk. Press Enter to chat. Hit "New room" to get a private code, share the URL with a friend.

That's it. The whole thing is ~500 lines of code.

## What this shows off

The whole point of this repo is the **Cloudflare Agents SDK** + a 3D iso scene. The interesting bit is how short the multiplayer code is:

- Each room is a single class extending `Agent<Env, RoomState>`. State (`{ players: Record<id, Player> }`) is auto-synced to every connected client — when one player moves, you call `this.setState({...})` and every other client receives the update.
- WebSockets are hibernatable out of the box. The agent sleeps when idle and resumes on the next message; per-connection identity (`connection.id`) survives without you serializing anything yourself.
- `routeAgentRequest(req, env)` in the Worker handles all the URL parsing, DO routing, hibernation, and protocol framing. Our worker entry is ~10 lines.
- Ephemeral events (chat) go through `this.broadcast(json)` instead of state. Use state for "what exists right now", broadcasts for "something just happened".
- The client uses `AgentClient<Room, State>` from `agents/client`. Pass an `onStateUpdate` callback and you get the synced roster pushed to you. Type-only `import type` of the Room class gives the client a fully-typed view of state shape and methods, without dragging the worker code into the bundle.

The 3D bits:

- **Three.js** iso scene rendered with a plain `OrthographicCamera` that follows the local player. No TresJS, no scene graph framework — just `THREE.Mesh`, `RoundedBoxGeometry` tiles, manual `renderer.render()` per frame.
- **Pointer-anywhere walking**: hold mouse / finger / pen anywhere on the ground; the player walks toward the cursor's current world position. Because the camera follows the player, a held cursor produces a constant direction — release to stop. WASD / arrows still work as keyboard overrides.
- **Per-player overlay**: name label always visible above the player; chat bubble appears stacked above the name when speaking, auto-expires after 4s. Both are DOM, world-projected to screen each frame.
- **Direction indicator**: a small white player sits a step ahead of each player along their facing direction — no rotation gymnastics, just an offset.

Trade-offs:

- **Client-authoritative movement**: each peer owns its position + facing, pushes updates to the agent at ~20 Hz, the agent fan-outs to others via state sync. Fine for a demo, terrible for anything competitive — flip to server-tick if you ever need it.
- No D1, no R2, no KV, no auth. Room state lives in the agent. Your name is in `localStorage` (pre-filled on next visit, but the prompt still shows so you can edit).

## Layout

```
game-room-starter/
├── index.html
├── src/                  # client (vanilla TS + Three.js)
│   ├── main.ts           # AgentClient, state sync, render loop
│   ├── scene.ts          # iso ortho camera, rounded tile grid,
│   │                     #   sphere players + indicators,
│   │                     #   screen↔world projection helpers
│   ├── input.ts          # keyboard + unified pointer input
│   ├── overlay.ts        # per-player name label + chat bubble DOM
│   └── style.css
└── worker/
    ├── index.ts          # routeAgentRequest, else SPA
    └── Room.ts           # the Agent — state + @callable + broadcast
```

Everything's small enough to read top-to-bottom. Start at [worker/Room.ts](worker/Room.ts) to see how multiplayer works — the whole server is ~80 lines. Then [src/main.ts](src/main.ts) for how the client mirrors the state.

## Wire protocol

State (synced automatically):

```ts
type RoomState = {
  players: Record<
    string,
    {
      id: string;
      name: string;
      color: string;
      x: number;
      y: number;
      facingX: number;
      facingY: number;
    }
  >;
};
```

The client mirrors state into the scene whenever `onStateUpdate` fires. The SDK handles serialization, fan-out, ordering, and reconnection. We never write a `joined` or `left` message — they're just diffs of the players record.

Two `@callable()` methods on the agent — typed RPC, called as `agent.stub.method(...)` on the client:

```ts
// On the server (worker/Room.ts):
@callable() move(x, y, facingX, facingY) { /* updates state for getCurrentAgent().connection */ }
@callable() chat(text)                   { /* broadcasts as a one-shot, not state */ }

// On the client (src/main.ts):
agent.stub.move(x, y, facingX, facingY);
agent.stub.chat(text);

// Server → client ephemeral broadcast (received via `addEventListener("message")`):
{ type: "chat", id, text }   // shown as a bubble above the speaker
```

`@callable` relies on TC39 decorators, which Vite doesn't fully transpile yet, so the Agents SDK ships an official Vite plugin: [vite.config.ts](vite.config.ts) just imports `agents/vite` and lists it first in the plugins array. It only touches files containing `@`-decorators — everything else stays on Vite's normal pipeline.

## Hacking it

The whole project is ~600 lines across eight files. It fits in your AI editor's context — paste the files you care about and iterate fast.

A few "want X → touch Y" recipes:

### Add a new obstacle (wall, pillar, fence)

[src/dungeon.ts](src/dungeon.ts) — call `wall(cx, cz, sx, sz)` for a box or `pillar(x, z)` for a cylinder. Both helpers register the visual geometry **and** the collider in lockstep. For ad-hoc obstacles elsewhere, call `colliders.addBox(...)` / `colliders.addCircle(...)` directly.

### Add a new player action (attack, interact, emote)

[worker/Room.ts](worker/Room.ts) — add an `@callable()` method. Use `getCurrentAgent().connection` to identify the caller. On the client, call `agent.stub.yourMethod(...)`.

For state changes, `this.setState({...})` (auto-syncs to everyone). For one-off ephemeral events (chat, sound, FX), `this.broadcast(JSON.stringify({...}))` and listen in the client via `agent.addEventListener("message", ...)`.

### Add a new field to each player (HP, score, equipped item)

1. `Player` interface in [worker/Room.ts](worker/Room.ts) — source of truth
2. `NetPlayer` in [src/main.ts](src/main.ts) — client-side mirror
3. `Player` in [src/scene.ts](src/scene.ts) — only if you need a mesh / overlay tied to it

The new field auto-syncs through state; you just read it where it matters.

### Change the map / theme

[src/dungeon.ts](src/dungeon.ts) — `buildDungeon()` lays out walls, pillars, torches. Edit the calls in there. Bump `MAP_SIZE` in [scene.ts](src/scene.ts) for a bigger arena. Different room codes can build different dungeons if you pass the code into `buildDungeon`.

### Persist scores / saves / inventories

The Agent has a SQLite database built in. Inside the room: `this.sql\`CREATE TABLE...\``and`this.sql\`SELECT...\``. Survives hibernation and restarts. No D1 needed for per-room data. See [Agents SDK docs](https://developers.cloudflare.com/agents/api-reference/store-and-sync-state/#sql-based-storage).

## Mental model

- **One Durable Object per room code.** `lobby` is the default; `/r/<code>` opens a fresh DO instance. They're independent.
- **State is the world.** `state.players` is what every client mirrors. Mutate via `setState()`; the SDK broadcasts the diff.
- **Broadcasts are events.** Chat, sound, particles — anything ephemeral goes through `this.broadcast(json)` and isn't kept around.
- **Player id = connection id.** No login; the WebSocket's id IS the player. The room self-heals against orphaned player rows on every connect.
- **Movement is client-authoritative.** Each peer drives its own position and pushes updates. Fine for cozy multiplayer, bad for competitive — flip to server-tick if you need anti-cheat.

## Commands

```bash
pnpm dev       # vite + local Cloudflare runtime (DO + WS via @cloudflare/vite-plugin)
pnpm build     # build the client + worker into dist/
pnpm deploy    # build then wrangler deploy
```

## Deploy

```bash
pnpm deploy
```

Wrangler reads [`wrangler.jsonc`](wrangler.jsonc), creates the DO namespace on first deploy, ships the Worker and the static bundle. Custom domain via the Cloudflare dashboard once it's up.

## Why this exists

Cloudflare's Agents SDK collapses "I want one Durable Object per room, with a WebSocket protocol that hibernates, and state that syncs to every client" into a base class you extend and a `setState({...})` call. Without it you write ~150 lines of WS plumbing, `serializeAttachment` housekeeping, and broadcast loops. With it the room is ~80 lines and the whole protocol is "a record of players keyed by id".

This starter is the smallest excuse to ship that pattern. Three.js for the visuals because spheres on a grid are friendlier than text. The whole demo is small enough that you can copy the bits you like into your own project without inheriting any opinions.

If you're building something bigger and need [scoring](https://developers.cloudflare.com/d1/), [saves](https://developers.cloudflare.com/kv/), or [big asset delivery](https://developers.cloudflare.com/r2/), look at [vibe-cdn](https://github.com/acoyfellow/vibe-cdn) — same audience, more primitives.

## Status

Built to be forked. MIT.
