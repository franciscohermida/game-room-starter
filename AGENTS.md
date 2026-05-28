# Agent guide

A starter for Cloudflare **Agents SDK** + Three.js multiplayer rooms. Small enough (~600 LOC) that the whole project fits in your context window.

This file exists for AI coding tools (Claude Code, Cursor, Codex). Humans should start at [README.md](README.md).

## File map

| File | What it owns | Approx LOC |
|---|---|---|
| [worker/Room.ts](worker/Room.ts) | The Cloudflare Agent: state (`{ players }`), `@callable` RPC methods, broadcasts, ghost-player reconciliation | 100 |
| [worker/index.ts](worker/index.ts) | Routes `/agents/room/<code>` → DO; everything else → static assets | 20 |
| [src/main.ts](src/main.ts) | Client entry: AgentClient, state mirror, input → RPC, render loop, camera follow | 230 |
| [src/scene.ts](src/scene.ts) | Three.js scene: iso ortho camera, tile floor, lights, `createPlayer` (body + indicator + held torch), screen↔world projection | 230 |
| [src/dungeon.ts](src/dungeon.ts) | Visual dungeon layout: walls, pillars, sconces. Registers a collider for every solid mesh | 150 |
| [src/collision.ts](src/collision.ts) | General-purpose static colliders: `addBox`, `addCircle`, `isBlocked(x, z, r)` | 80 |
| [src/input.ts](src/input.ts) | Keyboard + unified pointer input (mouse/touch/pen) | 90 |
| [src/overlay.ts](src/overlay.ts) | Per-player DOM overlay (name label + chat bubble), screen-projected each frame | 55 |

## Conventions

- **TC39 decorators only.** Never set `experimentalDecorators` in tsconfig — it silently breaks `@callable()`. Transpilation is handled by the `agents/vite` plugin in [vite.config.ts](vite.config.ts).
- **State vs broadcast.** Persistent world data → `setState({...})`. Ephemeral one-off events → `this.broadcast(json)`.
- **Player id = connection id.** Inside `@callable` methods, use `getCurrentAgent().connection.id`. Don't pass player ids across the wire — they're implicit.
- **Visual + collider together.** Wherever a solid object is added to the scene, register a matching collider in the same helper. The `wall()` / `pillar()` helpers in [dungeon.ts](src/dungeon.ts) do this; follow the pattern.
- **Comments explain WHY, not WHAT.** The codebase leans on this — preserve the style.
- **No comments on every line.** Most lines are obvious from the symbol names. Comments earn their place by explaining a subtle constraint, a workaround, or a non-obvious decision.

## Common gotchas

- The dev server runs the Worker locally via `@cloudflare/vite-plugin`. DO storage persists at `.wrangler/state/v3/do/<class>/`. Wipe that directory to fully reset state.
- `connection.id` is generated client-side (PartySocket's `_pk`) and passed to the server. Same value on both sides. A fresh tab → fresh id → fresh player row.
- Movement is client-authoritative. The server stores positions but trusts what each client sends. Don't build competitive systems on this without changing the model.
- Adding a `@callable()` method without rebuilding may not pick up until the dev server restarts; the SWC-driven decorator transform fires at build time, not at runtime.

## Running

```bash
pnpm install
pnpm dev       # http://127.0.0.1:5173 — open two tabs to test multiplayer
pnpm build
pnpm deploy    # builds + wrangler deploy
```
