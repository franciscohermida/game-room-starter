import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import agents from "agents/vite";

// `agents()` transpiles TC39 decorators (used by `@callable` in the
// Agents SDK) before Vite's normal pipeline. Must come first. Vite's
// default transformer doesn't yet support TC39 decorators, so without
// this plugin `@callable()` would fail at runtime.
export default defineConfig({
  plugins: [agents(), cloudflare()],
});
