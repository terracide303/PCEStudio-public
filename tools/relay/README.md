# tools/relay — the PCEStudio relay (#165)

The hosted half of the agent link, ppu.toys-style: a person opens the
studio's AGENT panel (#167) and presses Connect; the tab mints a 32-hex
token and opens a WebSocket here. Claude Code then speaks MCP to
`https://<this-worker>/mcp/<token>` and every `tools/call` is forwarded
to that tab, which runs it through the studio's own modules. **The
relay stores nothing** — code and art only pass through, and the toy
state lives in the tab. The full design (wire protocol, security,
limits, what the relay sees) is in [`docs/AGENT-LINK.md`](../../docs/AGENT-LINK.md).

| file | what it is |
|---|---|
| `relay-core.js` | the platform-neutral Relay class — the whole protocol, no Cloudflare, no Node I/O |
| `worker.js` | the Cloudflare Worker: routes `/mcp/<token>` and `/ws/<token>` to a Durable Object `Room` per token (WebSocket Hibernation API) built around the core |
| `tools.json` | the static `tools/list` the relay serves — **generated**, see below |
| `build-tools.js` | regenerates `tools.json` from the one tool core |
| `wrangler.toml` | the Cloudflare config (worker name, the `ROOM` binding) |

`tests/check-relay.js` drives the core in Node with fake tab sockets and
a real `node:http` wrapper, and structurally checks the worker.

## Deploy

```sh
cd tools/relay
npx wrangler login        # once; browser sign-in to your Cloudflare account
npx wrangler deploy       # bundles worker.js + relay-core.js + tools.json
```

That is the whole install: there is no `package.json` in this
repository (by design — see `docs/DECISIONS.md`), so wrangler runs
through `npx` and installs nothing into the tree. The deploy prints the
worker's URL, `https://pcestudio-relay.<your-subdomain>.workers.dev`;
the relay is live at `<url>/mcp/<token>` and `<url>/ws/<token>`.
A custom domain is optional: add a `routes` entry to `wrangler.toml`
and re-deploy.

## Point the studio at it

The studio tab reads one constant, `RELAY_URL` in
`renderer/relay-config.js` (written by #167). Set it to the worker's
URL, e.g. `https://pcestudio-relay.example.workers.dev` — no trailing
slash. While it is empty the AGENT panel says the link is not switched
on yet. The panel builds the Claude Code line from it:

```
claude mcp add --transport http pcestudio <RELAY_URL>/mcp/<token>
```

## Trying it locally

`npx wrangler dev` (from this folder) runs the worker with the Durable
Object locally on `http://127.0.0.1:8787` — the Origin rule allows
`http://127.0.0.1:<port>` / `http://localhost:<port>` for exactly this.
Point `RELAY_URL` at it and connect the panel from a local copy of the
studio.

## Regenerating tools.json

`tools.json` is generated, never typed:

```sh
node tools/relay/build-tools.js
```

It reads the one tool core — `renderer/pce-agent-tools.js` (#166), the
UMD module the Node MCP server and the studio tab share — and writes
the definitions `tools/list` serves. Until #166 lands in the tree it
builds from `tools/mcp/server.js`'s `TOOLS` export instead, the exact
list #166 must keep byte-identical. **After any tool change: run the
build, then re-deploy** — the relay serves the committed file, and
`tests/check-relay.js` fails when `tools.json` and the core differ.

## What the free tier covers

As of writing (Cloudflare's numbers change — check the pricing page
before relying on them): Workers free includes 100,000 requests/day,
and Durable Objects free includes 150,000 DO requests/day and low
hibernating-DO usage, with billing only past that. This relay is
friendly to those numbers: the tab's socket hibernates (no billable
idle time), each MCP request is one DO request, and the 20 requests/s
per token + 8 MB per message limits bound what one token holder can
push through. For one studio tab in use now and then, the free tier is
ample; a relay shared with the public is the deployer's call, and
egress over the limits is billed to the deploying account.

## Known nuances (read before you wonder)

- **Hibernation loses the tab's handle.** When the Room hibernates it
  forgets the in-memory socket; the tab's next ping (every 25 s, per
  the protocol) re-attaches it. A `tools/call` that lands inside that
  window answers the standard "open the studio tab, then try again"
  error even though the tab is open — the retry succeeds. Bounded,
  self-healing, and honest: the relay never pretends to hold state it
  does not.
- **Hibernation also forgets rooms earlier than 24 h.** The 24 h
  forget rule (`docs/AGENT-LINK.md`) is the core's guarantee; in this
  deployment a hibernated Room with no tab simply starts fresh, which
  satisfies the rule early.
- **`node --check` is a design constraint.** `worker.js` and
  `relay-core.js` are CommonJS on purpose: `tests/check-relay.js` runs
  `node --check` on them, and wrangler bundles CommonJS module workers
  fine.
- **The relay sees everything** that passes through it — code, art,
  tool names, token — unencrypted at the application layer (TLS covers
  the wire). Deploy only where the operator is trusted; see
  `docs/AGENT-LINK.md` "What the relay sees".
