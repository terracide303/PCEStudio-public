// entry.mjs: the module-worker entry wrangler needs. worker.js stays CommonJS (so node --check and the
// tests can load it); this file only re-exports its pieces in the ES-module shape Cloudflare expects.
import worker from "./worker.js";

export const Room = worker.Room;
export default { fetch: worker.fetch };
