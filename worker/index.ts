// Worker entry. `routeAgentRequest` handles everything addressed at
// `/agents/<kebab-class-name>/<instance-name>` — opens the WS, lands
// it on the right Durable Object, manages hibernation, the works.
// Everything else falls through to the static SPA.

import { routeAgentRequest } from "agents";
import { Room } from "./Room";

export { Room };

interface Env {
  Room: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const handled = await routeAgentRequest(request, env);
    if (handled) return handled;
    return env.ASSETS.fetch(request);
  },
};
