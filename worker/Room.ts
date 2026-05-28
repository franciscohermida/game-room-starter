// Room — a Cloudflare Agent. One instance per room code, addressed by
// the URL `/agents/room/<code>`. Holds the live roster in synced
// state, fan-outs ephemeral events (chat) via `broadcast`, hibernates
// when empty and re-hydrates on the next connect.
//
// Why an Agent instead of a raw Durable Object:
//   - `setState({...})` is automatically broadcast to every connected
//     client. No manual "moved" / "joined" / "left" protocol — the
//     state diff IS the protocol.
//   - WebSockets are hibernatable by default; per-connection metadata
//     (we use `connection.id`) survives without us serializing it.
//   - `@callable()` methods are typed RPC. Clients invoke them as
//     `agent.stub.move(...)`; `getCurrentAgent()` inside the method
//     hands us the calling connection so we know whose player to move.
//
// The only piece that isn't state is the chat bubble: it's ephemeral
// (auto-expires in the UI), so we send it as a one-shot broadcast
// instead of putting it in state. State is for "what exists right now"
// (positions, names), broadcasts are for "something just happened".

import {
  Agent,
  callable,
  getCurrentAgent,
  type Connection,
  type ConnectionContext,
} from "agents";

interface Env {
  Room: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

interface Player {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  facingX: number;
  facingY: number;
}

interface RoomState {
  players: Record<string, Player>;
}

const COLORS = [
  "#ff6b6b",
  "#4ecdc4",
  "#ffe66d",
  "#a78bfa",
  "#fb7185",
  "#34d399",
  "#60a5fa",
  "#f59e0b",
];

export class Room extends Agent<Env, RoomState> {
  initialState: RoomState = { players: {} };

  // A new client opened a WebSocket. Grab their name from the query
  // string and add them to state. The setState broadcast tells every
  // other client to spawn a sphere for them.
  override async onConnect(connection: Connection, ctx: ConnectionContext) {
    const url = new URL(ctx.request.url);
    const name = (url.searchParams.get("name") ?? "Anon").slice(0, 20);
    const player: Player = {
      id: connection.id,
      name,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      // Spawn in the small room (X=3..10) centred around (6.5, 0).
      // A small jitter keeps players from stacking when several
      // connect at once. Facing -X so they walk toward the doorway.
      x: 6.5 + (Math.random() - 0.5) * 1.5,
      y: (Math.random() - 0.5) * 1.5,
      facingX: -1,
      facingY: 0,
    };
    // Reconcile state with live connections before adding the new
    // player. If a tab was force-killed or the dev server restarted
    // mid-session, onClose may never have fired and ghost player
    // rows would linger in state forever. Anyone whose id is in
    // state but no longer has a live WebSocket gets dropped here.
    const liveIds = new Set<string>([connection.id]);
    for (const c of this.getConnections()) liveIds.add(c.id);
    const cleaned: Record<string, Player> = {};
    for (const [id, p] of Object.entries(this.state.players)) {
      if (liveIds.has(id)) cleaned[id] = p;
    }
    this.setState({ players: { ...cleaned, [player.id]: player } });
  }

  override async onClose(connection: Connection) {
    if (!(connection.id in this.state.players)) return;
    const next = { ...this.state.players };
    delete next[connection.id];
    this.setState({ players: next });
  }

  // RPC: client calls `agent.stub.move(x, y, fx, fy)`. We use
  // `getCurrentAgent()` to find which connection called us — the
  // player id is implicit, never passed across the wire.
  @callable()
  move(x: number, y: number, facingX: number, facingY: number) {
    const { connection } = getCurrentAgent();
    if (!connection) return;
    const p = this.state.players[connection.id];
    if (!p) return;
    this.setState({
      players: {
        ...this.state.players,
        [connection.id]: {
          ...p,
          x: clamp(x, -10, 10),
          y: clamp(y, -10, 10),
          facingX,
          facingY,
        },
      },
    });
  }

  @callable()
  chat(text: string) {
    const { connection } = getCurrentAgent();
    if (!connection) return;
    const t = String(text).slice(0, 200).trim();
    if (!t || !this.state.players[connection.id]) return;
    // Chat is ephemeral; broadcast outside the state-sync channel.
    this.broadcast(
      JSON.stringify({ type: "chat", id: connection.id, text: t }),
    );
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
