# The agent link — a hosted relay plus the open studio tab (#165)

**The answer to "making a game with Claude must not mean cloning the repo."**
Dennis, 2026-10-31, after reading ppu.toys' studio: *'deepseek is funded go ahead
and build it'*. The installer idea is dropped; the architecture is ppu.toys'
own: a **hosted MCP endpoint** plus **the open studio tab as the agent's
hands**. Nothing to install, nothing to clone — the person opens the studio,
presses Connect, runs one `claude mcp add` line, and Claude writes and runs
the toy in the tab the person is watching.

```
 Claude Code                                    the relay (tools/relay/)
 ┌──────────────────┐  POST /mcp/<token>   ┌───────────────────────────┐
 │ `claude mcp add  │─────────────────────▶│ worker.js → Durable       │
 │  --transport http│  MCP JSON-RPC 2.0    │ Object `Room` per token   │
 │  pcestudio       │◀─────────────────────│ (WebSocket Hibernation    │
 │  https://<relay>/ │  JSON replies        │  API), around relay-core │
 │  mcp/<token>`    │                      └────────────┬──────────────┘
 └──────────────────┘                                   │ wss://<relay>/ws/<token>
                                                        │ {"type":"call", ...}
                                                        ▼
                                  the studio tab (renderer/studio.html, #167)
                                  ─ runs the tool through pce-agent-tools.js (#166),
                                    the SAME modules the page and the tests run;
                                    the person watches every call in the AGENT feed
```

Three cards build it, one wire protocol (this file) binds them:

- **#165 (this card)** — the relay: `tools/relay/` and this design.
- **#166** — one tool core: `renderer/pce-agent-tools.js`, the UMD module the
  Node MCP server and the studio tab share. The relay embeds its tool list as
  `tools/relay/tools.json` (`build-tools.js`); a test fails when the two
  differ.
- **#167** — the AGENT panel: makes the token, connects the tab, runs the
  calls, shows the feed.

## The token is the whole account system

There are **no accounts and no sign-in**. The studio tab mints a secret with
`crypto.getRandomValues`: **32 hex characters, lowercase** — the TOKEN. It is
the key to one tab and one tab only:

- whoever holds `https://<relay>/mcp/<token>` can drive that tab through MCP,
- whoever holds `wss://<relay>/ws/<token>` can answer the calls.

So the panel (#167) has **"New link"** (rotates the token — the old URL stops
working at once) and **"Disconnect"** (closes the socket). The token lives in
the tab's localStorage so the command stays the same across reloads, and in
the person's `claude mcp add` config. It is a bearer secret: treat the URL
like a password, and rotate it when it has been shared.

## The wire protocol

### Claude side — POST /mcp/<token>

```
claude mcp add --transport http pcestudio https://<relay>/mcp/<token>
```

MCP JSON-RPC 2.0 over streamable HTTP, one request per POST, JSON replies
(no SSE — the relay answers with plain JSON, which the spec allows and the
stdio server already does). The relay answers every method it knows from
memory; it never holds a session:

| request | reply |
|---|---|
| `initialize` | echoes `protocolVersion` when it is one the relay knows (`2025-06-18`, `2025-03-26`, `2024-11-05`; otherwise the default `2025-06-18`), `capabilities: {tools:{}}`, `serverInfo: {name:"pcestudio", version:"0.1.0"}`, and an `instructions` text |
| `notifications/initialized` (any notification) | **202, empty body** — notifications are never answered |
| `ping` | `{jsonrpc:"2.0", id, result:{}}` |
| `tools/list` | `{tools: [...]}` — the static list embedded from `tools/relay/tools.json`, built by `build-tools.js` from #166's tool core |
| `tools/call` | see below |
| unknown method | JSON-RPC error `-32601` |
| unknown tool / `tools/call` without a name | JSON-RPC error `-32602` — exactly as `tools/mcp/server.js` answers |
| unparseable body | **400** with JSON-RPC error `-32700` |
| a JSON batch | answered as one array (the stdio server's rule) |

`tools/call` is the interesting one. The relay looks for the tab:

- **A tab is connected:** the relay makes a call id (a UUID), sends
  `{"type":"call", ...}` to the tab, and answers with the tab's reply
  **verbatim** — `result` becomes the MCP `result`. The call waits **at most
  120 s**; if the tab never answers, the MCP result is `isError: true` with
  the text `the studio tab did not answer`.
- **No tab is connected:** a normal MCP result, `isError: true`, with the
  text
  `Open https://pcestudio.terracides.com/renderer/studio.html, open the AGENT
  panel and press Connect, then try again.`
- **The tab closes or is taken over mid-call:** the pending calls fail with
  `the studio tab disconnected` (this text is the relay's addition to the
  protocol, below).

Tool *results* follow the MCP convention: `{content: [...], isError: bool}`.
A tool that fails inside the studio still answers `isError: true` with the
failure in `content` — it is a result, not a transport error.

### Tab side — WebSocket wss://<relay>/ws/<token>

The tab connects with the **Origin rule**: the `Origin` header must be
`https://pcestudio.terracides.com`, or `http://127.0.0.1:<port>` /
`http://localhost:<port>` for development (the card's list, enforced by the
worker at the edge — a browser always sends `Origin` on an upgrade, and
anything else, including a missing header, is a 403).

Messages are JSON text, one per frame, both ways:

| tab → relay | meaning |
|---|---|
| `{"type":"hello","version":1,"title":"..."}` | first message after Connect; recorded in memory only, not answered |
| `{"type":"ping"}` | every **25 s** — keepalive; answered with `{"type":"pong"}` |
| `{"type":"result","id":"...","result":{"content":[...],"isError":false}}` | answers a call; the `result` is the MCP tool result, sent back verbatim |
| `{"type":"error","id":"...","message":"..."}` | answers a call with an MCP result `isError: true` carrying `message` |

| relay → tab | meaning |
|---|---|
| `{"type":"call","id":"<uuid>","name":"toy_write","arguments":{...}}` | run this tool; answer with `result` (or `error`) carrying the same `id` |
| `{"type":"taken"}` | another tab connected with the same token — **the older one is closed** (its pending calls fail with `the studio tab disconnected`) |
| `{"type":"pong"}` | the relay's answer to `ping` |

The relay does not enforce the `hello` version (it records it; a tab that
speaks a future version still works), unknown message types are ignored, and
a message over the size limit or one that is not JSON closes the socket —
those are the tab's own bugs, not something the relay negotiates.

## Limits

| limit | what enforces it |
|---|---|
| **8 MB per message** | the relay core, on both the HTTP body (answer: **413**) and the WebSocket message (answer: the socket is closed); the worker also refuses a `Content-Length` over the limit before reading the body |
| **20 requests/s per token** | a token bucket per room (capacity 20, refilled at 20/s); the 21st request inside a second is a **429** with `Retry-After: 1` |
| **a token with no tab for 24 h is forgotten** | the relay core drops the room — rate bucket and all — lazily, on the next request (see the hibernation note in `tools/relay/README.md`: in the Cloudflare deployment a hibernated room is forgotten even sooner) |
| **a call waits at most 120 s for the tab** | per-call timer in the relay core |
| **the relay stores NOTHING** | no DO storage is ever written; code and art only pass through; the toy state lives in the tab (and in its `project.json`/`.pcestudio` once #162 lands). The tab's connection survives hibernation through the WebSocket attachment, not through storage |

A bad token — anything but 32 lowercase hex characters — is a **404** and
never creates a Durable Object. `GET` on `/mcp/<token>` is a 405 (`POST`
only); `GET /ws/<token>` without a WebSocket upgrade is a 426.

## Security — what the token buys, and what it does not

- **The token is the whole secret.** Anyone with the URL can call the tools
  and see the results: read the toy, write it, run it, export it. The scope
  is one tab — the person's own studio tab — and the person is watching the
  feed (#167), so a stolen token cannot silently do anything the person
  would not see. Rotate it with "New link" when it leaks.
- **The relay sees everything, in the clear, at the application layer.**
  TLS protects the wire, but the relay operator (whoever deployed it) could
  read every file, every frame, every tool name, and the token itself, and
  could tamper with calls and replies. Deploy the relay only where the
  operator is trusted — which is exactly what "run the hosted relay" means.
  There is no end-to-end encryption between Claude and the tab; the protocol
  does not pretend otherwise.
- **The tab executes whatever the token holder calls** — the same trust the
  local MCP server already assumes. The person watches; the panel's
  Disconnect ends it.
- **The Origin rule keeps foreign web pages out of the tab socket.** A page
  on another origin cannot open `wss://<relay>/ws/<token>` from a browser;
  combined with the unguessable 32-hex token, only the studio tab (or
  something the person runs locally for development) can attach.
- **The relay is not an account system.** No identity, no rate limiting per
  person — only per token. Someone who mints many tokens from many tabs
  gets many 20 req/s buckets; the free tier note in
  `tools/relay/README.md` says what that costs the deployer.

## What the relay sees (the honest inventory)

For each connection it routes: the token, message sizes and timing, request
counts, tool names, and the full contents — code, art, frames, results. It
**keeps** none of it: no logs, no storage, no history; rooms are memory-only
and are forgotten (24 h rule, or hibernation, whichever comes first). The
panel's feed in the tab shows the person everything Claude calls; the relay
itself shows the operator nothing it does not pass through.

## Design decisions, labelled

- **Immediate no-tab error, then retry.** The card pins the no-tab text and
  says a call *waits at most 120 s* — reading both together: a call waits
  for a **connected** tab; with no tab it answers at once. Consequence (see
  `tools/relay/README.md`): right after the Durable Object hibernates, the
  relay has lost the tab's in-memory handle, so a call landing before the
  tab's next 25 s ping answers the no-tab error although the tab is open;
  the retry succeeds. This is bounded, self-healing, and visible — accepted
  over keeping the DO awake (billable) or writing storage (the relay stores
  nothing). *This trade-off is reasoning, not something I read.*
- **Unknown tool = JSON-RPC error, not a tool result.** `tools/mcp/server.js`
  answers `-32602`, and the relay keeps the same surface so a client cannot
  tell the two servers apart.
- **`the studio tab disconnected`** is the relay's own third failure text,
  for calls whose tab vanishes mid-flight (taken over, closed, socket gone).
  The card names the other two; this one is needed for the state the card
  itself defines ("the older one is closed").
- **The relay does not enforce the tab's `hello` version.** The protocol
  pins `version: 1`; the relay records it and keeps working — a future tab
  must not need a relay flag-day. *Reasoning.*
- **`tools.json` is generated, never typed** — `build-tools.js` reads the
  tool core (#166); until it lands, it builds from `tools/mcp/server.js`'s
  `TOOLS` export, the list #166's card keeps byte-identical. `tests/
  check-relay.js` fails when the file and the core differ, and SKIPs the
  core comparison while the core is absent.

## Tests

`node tests/check-relay.js` — drives the core with fake tab sockets behind a
real `node:http` wrapper and pins everything above: the handshake and
`tools/list` over HTTP, a call round-tripping to the tab, the no-tab text,
the 120 s timeout (with a short injected timeout), `taken`, bad token →
404, oversize → 413, rate limit → 429, a second token seeing nothing,
`node --check` on the worker plus structural checks of its routes and Origin
rule, and `tools.json` against the tool core.

## Deploy

See [`tools/relay/README.md`](../tools/relay/README.md): `npx wrangler
login`, `npx wrangler deploy`, point `RELAY_URL` (`renderer/relay-config.js`,
#167) at the worker. No `package.json` exists in this repository by design —
wrangler runs through npx and installs nothing into the tree.

## Credit

The architecture — a hosted MCP endpoint with the open studio tab as the
agent's hands, no accounts, a per-tab secret link — is **ppu.toys**' own
shape (MIT, Liora Labs), read before this card was revised
([`docs/PPU-TOYS.md`](PPU-TOYS.md), the #53 survey). The wire protocol here
is PCEStudio's; ppu.toys' Studio link itself is not open source, so nothing
of it was copied — this protocol was written from the card and the MCP
spec, and its only peer is `tools/mcp/server.js`, which it mirrors where the
spec does not decide.
