# #167 — the AGENT panel's rule-2 cold break: five blind spots in `checkAgentPanel`

Card #167. Work by @test (test seat, 2026-10-31, `deepseek-flash[1m]`). The
panel and its check were built by a different session and model (`#ds-pro`),
which is what rule 2 asks for: this seat did not write either one.

The card's last gate was "Rule-2 cold read of `tests/check-studio.js`
checkAgentPanel owed by @test". This is that read. **Verdict: the check does
not catch five breaks of the feature it guards, so #167 is not closable.**
The check needs strengthening (#179, routed to @review, one kind up from the
test's builder). Nothing in the feature was changed by this seat.

Baseline at the commit tested (`04b6333`, the pushed `main`), in this seat's
own worktree:

```
node tests/check-studio.js
PASS  1685 checks, ... (19968 ms)
```

## Method

29 break-mutants were applied to `renderer/studio-panel-agent.js` **one at a
time**, each a single exact-string replacement (the harness asserts the string
occurs exactly once), with the pristine file restored before the next. Every
mutant was then run through the full `tests/check-studio.js` — the same
1685-check suite, the same fake WebSocket, the same page path — not through a
narrower fixture. The harness lived under `$TMPDIR/agent-mut/`, outside the
repository; the working tree was verified clean (`git status --short` empty)
after the series.

A mutant counts as DETECTED only when the suite exits non-zero **and names a
`#167` check** as failing; two mutants in the first batch also turned
unrelated checks red through load/timing, so a bare exit code was not enough.

## Results: 29 mutants — 22 DETECTED, 7 stayed green (5 distinct blind spots)

### Detected (the check earns its keep here)

| # | Break | What caught it |
|---|-------|----------------|
| 1 | `hello` carries protocol version 2 | `#167: the tab sends hello with the protocol version` |
| 2 | the `hello` frame is not sent at all | same |
| 3 | `https:` is not rewritten to `wss:` | the three `/ws/<token>` URL equalities |
| 4 | backoff's first step is 3000 ms | `… after the first backoff step` |
| 5 | a `taken` message does not set `state.taken` | `… and this tab stays taken over`, `… no reconnect scheduled` |
| 6 | the close after `taken` becomes a plain disconnect | `… and this tab stays taken over` |
| 7 | Connect sets status `live` instead of `connecting` | `Connect opens the socket (connecting)` |
| 8 | `onopen` does not set status `live` | `the socket opening makes the link live` |
| 9 | an unexpected close schedules no reconnect | `… with a reconnect scheduled` |
| 10 | the token is stored uppercase | `the token is kept in localStorage` |
| 11 | `readToken()` is ignored (always mint) | `the token survives a reload` |
| 12 | New link keeps the old token | `New link makes a different 32-hex token` |
| 13 | New link does not open a new socket | `… and reopens the socket with it` |
| 14 | CONSOLE frame count is `frames + 1` | `the CONSOLE gets the run's frame count` |
| 15 | CONSOLE gets an empty log | `… and its own log lines` |
| 16 | `frame_png` seeks to frame 0 | `the studio seeks to the frame Claude asked for` |
| 17 | a validate with findings is not mirrored | `… and its findings fill the CONSOLE CHECK block` |
| 18 | `source_add` adds no named source | `source_add records the source in sources.json`, ASSETS |
| 19 | the FEED marks every call ok | `the FEED marks it an error with its findings` |
| 20 | the FEED summary for `toy_write` is `"ok"` | `the FEED shows the call, its tool and its outcome` |
| 21 | the not-switched-on panel draws one button | `… it offers nothing else (no button in the drawer)` |
| 22 | the person's edit is not re-primed before `toy_run` | `the person's edit is the text Claude's run used` |

### Missed (the five blind spots)

#### M1 — Disconnect only changes the word; the socket keeps answering

Break: remove `closeSocket();` from `onDisconnect()`.

`state.status` becomes `"disconnected"` and the drawer says so, but the
WebSocket is still open, its `onmessage` is still wired, and a
`{"type":"call"}` arriving afterwards is still run and answered. That is the
opposite of the card's "This tab is Claude's hands until you disconnect" —
the person has pressed the button that is supposed to take the hands away.
The suite stays green because the check reads `api.state().status` and
`reconnectScheduled`; it never looks at `ws.readyState`, never calls after
Disconnect, and the fake socket's `drop()`/`close()` are the only socket
events it inspects.

What would catch it: after pressing Disconnect, assert the current fake
socket is closed (or `state.ws === null`), then send a `call` on that old
socket and assert `ws.sent` gains no `result` after `api.idle()`. Control:
the same call sent one step earlier **does** get a result — otherwise a probe
that can never see a reply would pass this assertion too.

#### M2 — the Copy button can copy anything, because nothing reads the clipboard

Break: `onCopy`'s `line` becomes `""`.

The check's section 6 sweep clicks every button and only proves the handler
does not throw; no check asserts what Copy put on the clipboard. A Copy
button whose whole purpose is the command can copy the empty string, the
wrong token, or the help text, and the suite is green.

What would catch it: give the stub page a `navigator.clipboard.writeText`
that records its argument; press Copy while live and require the recorded
text to be exactly `#agent-cmd`'s text (the command with **that** token).
Control: rotate the token with New link and require the next Copy's text to
differ, so an assertion that only checks "something was copied" fails.

#### M3 — `toy_run` can draw one frame while the CONSOLE says twelve

Break: `mirrorRun`'s `studio.render.runFrames(frames)` becomes
`runFrames(1)`.

The tool core is told (and reports) 12 frames; the person's OUTPUT canvas
shows one. The card's model is "the tool core's runtime stays the truth, the
studio only mirrors it" — this is the mirror lying about what the truth was.
The suite's only canvas assertion is `draws1 > draws0` (any call at all), so
it passes.

What would catch it: after a `toy_run` of N frames, assert the studio's own
frame position advanced to N−1 (or that the recorded draw count grew by a
run of N, if the stub can count per-frame); require N on a second call with
a different N. Control: a 1-frame run must leave the position at 0, so an
assertion of "it drew something" cannot pass both.

#### M4 — the FEED can be entirely absent from the drawer

Break: the loop that appends `feedRow(...)` becomes `i < 0` (no rows), or the
`agent-time` span is not appended.

The card says the FEED shows the calls — **time, tool name, a one-line
summary, ok/error** — "so the person sees what Claude did". The check reads
`api.feed()` (the state array) and never the drawer's `<ol id="agent-feed">`.
A panel that keeps the data and draws nothing (or draws it without times)
passes.

What would catch it: read `#agent-feed`'s rows from the stub DOM after a
call; require one row per call, its text to contain the tool name and the
summary, a non-empty time, and the `is-ok`/`is-error` class for the two
outcomes. Control: before any call the row is the `is-empty` one, so an
assertion that only counts nothing cannot pass both states.

#### M5 — the backoff never resets after a healthy connection

Break: remove `state.attempt = 0;` from `onopen`.

A tab that connects, drops, reconnects successfully, and later drops again
then waits 2000 ms instead of 1000, and keeps escalating across a session
that has been healthy each time. The check drives exactly one drop and reads
the first step, so it cannot see it.

What would catch it: drop → 1000 ms; Reconnect and open (a healthy session);
drop again → still 1000 ms, not 2000. Control: two drops with **no**
successful open between them must go 1000 then 2000, so a constant 1000 also
fails.

## What the strengthened check still cannot see

These are not mutants; they are places the current fixture has no instrument
at all, and #179 should not claim them:

- **`export_pce` and `toy_save` as downloads.** The card says the browser host
  turns them into downloads. No agent call in the suite uses `export_pce`, and
  `toy_save` is exercised only through the mirror's `capture` path, where the
  host deliberately holds the text instead of downloading it. `download()`,
  `writeRom()` and the Blob/anchor path are never driven. A browser host that
  returns success and downloads nothing passes.
- **The real relay.** The fake socket is not the network; the relay's own
  side (handshake, forwarding, takeover, the 25 s keepalive) is
  `tests/check-relay.js`'s, and there is no test of a real relay ↔ real tab
  pair end to end.
- **The keepalive and the actual timer.** `PING_MS` and the
  `setTimeout` in `scheduleReconnect` never fire in the check; every
  reconnect in the suite is a button press. A tab that never pings, or whose
  scheduled retry never runs, passes.
- **Takeover.** `{type:"taken"}` is injected by the test; two real tabs with
  the same token on one relay are not exercised.
- **Pixels.** The stub canvas records draw calls, not pixels — a run that
  draws the wrong picture, at the wrong frame, passes even after M3 is fixed.
- **The clipboard's real path and persistence.** The stub has no
  `navigator.clipboard` unless a test installs one; `localStorage` is the
  stub's. A real browser reload and a real clipboard are not exercised, and
  the `--browser` headless-Chrome driver does not touch the AGENT drawer.
- **`RELAY_URL` edge cases.** Only an `https://` relay with no trailing slash
  is used. `http://` (documented for local dev), a trailing slash, and a
  malformed URL are not.
- **Concurrency.** Calls are queued (`state.queue`) because the tool core's
  session is stateful, but every call in the suite is awaited before the next;
  two overlapping `call` messages are not exercised.

## Not proven by this card

The check passing would not prove the design was the right design: that a
one-line `claude mcp add` is the right shape, that the token is an acceptable
password, that a 50-row feed is readable, or that the deployed relay behaves
as documented. Those are @review's and Dennis's questions, not a test's.

## What was verified by reading (card claims outside the check)

At `04b6333` these are present — not proved by execution here, but checked
line by line:

- `renderer/relay-config.js` holds the one constant `RELAY_URL`, empty, with
  the not-switched-on behaviour in `renderer/studio-panel-agent.js`.
- `renderer/claude-code.html` has the new first section
  "Connect from the studio — nothing to install" (heading and TOC at lines
  59/73), with the command, the no-accounts line and the relay-off fallback.
- `renderer/testers.html` names the AGENT drawer / Connect route before the
  server route.
- `renderer/pce-guide.js` has the Claude Code paragraph and the generated
  `renderer/pcestudio-for-claude.md` carries it (line 25).
- No "Sign in" text remains in `renderer/studio.html` or the panel.
