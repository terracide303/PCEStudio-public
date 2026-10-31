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

---

# #179 — the five blind spots, now checked (2026-10-31)

The check was strengthened; nothing in `renderer/studio-panel-agent.js` was
changed. Base commit `292dd60` (pushed `main`), same worktree, same fake
WebSocket and full suite:

```
HEAD (before these checks):  PASS 1725 checks
with these checks:           PASS 1754 checks
```

The #167 doc's 1685 was the count at `04b6333`; `main` had gained 40 checks
between that read and this one.

## What was added

| #167 break | check that now fails | control that fails if the assertion is weakened |
|---|---|---|
| **M1** `onDisconnect` stops calling `closeSocket()` | `#179: Disconnect closes the socket` (the current fake socket's `readyState` is 3) and `#179: ... and a call after Disconnect is not answered` (a `docs` `call` sent on the old socket after `api.idle()` produces no `result`) | the same `docs` call one step earlier, while live, **is** answered — `#179: control — the live socket answers a call before Disconnect` |
| **M2** `onCopy` copies `""` | `#179: Copy puts the command with this token on the clipboard` — a stub `navigator.clipboard.writeText` records its argument and the text must equal the drawer's command, byte for byte | after **New link** the next Copy must be the new token's command and must differ from the old — `#179: control — Copy after New link copies the new command` / `... and not the old one` |
| **M3** `mirrorRun` calls `runFrames(1)` | `#179: the canvas is on the 12-frame run's last frame` (`currentFrame()` is 11) and `#179: ... and at least 12 frames were drawn`; a second run of 24 must land on 23 and draw 24 | a one-frame run leaves the canvas on frame 0 and draws fewer than twelve — `#179: control — a one-frame run ...`; so "it drew something" cannot pass both |
| **M4** the FEED's rows / time spans are never drawn | reads the drawer's own `<ol id="agent-feed">`: one `<li>` per call, `agent-tool` and `agent-summary` text, an `agent-time` matching `HH:MM:SS`, and `is-ok` / `is-error`; the last drawn row must be the failed validate | before any call the one drawn row is the `is-empty` sentence — `#179: control — before any call the FEED's one row is the empty one`; so "a row exists" cannot pass both states |
| **M5** `onopen` drops `state.attempt = 0` | `#179: a drop after a healthy open waits the first step (1000 ms)` — drop, Reconnect, open (healthy), drop again: 1000 ms, not 2000 | two drops with **no** successful open between must go 1000 then 2000 (`#179: control — ...`), so a constant 1000 also fails; a third healthy cycle asserts 1000 again |

Every new check's name begins `#179:` so a mutation run can attribute the red.

## Evidence: each break on the pristine tree

Six exact-string replacements, one at a time, each asserted to occur exactly
once, source restored between runs; `node tests/check-studio.js` from the same
worktree:

| mutant | exit | checks it turned red |
|---|---|---|
| M1 remove `closeSocket();` from `onDisconnect` | 1 | `#179: Disconnect closes the socket (got 1, want 3)`; `#179: ... and a call after Disconnect is not answered` |
| M2 `onCopy`'s `line` becomes `""` | 1 | `#179: Copy puts the command with this token on the clipboard (got "", want …)`; the New-link control |
| M3 `runFrames(frames)` → `runFrames(1)` | 1 | `#179: the canvas is on the 12-frame run's last frame (got 0, want 11)`; `... at least 12 frames were drawn (2 -> 3)`; the 24-frame pair |
| M4a the FEED loop runs zero times (`i < 0`) | 1 | `#179: the FEED draws one row per call (got 0, want 1)`; tool/summary; time; the drawn error row |
| M4b the `agent-time` span is not appended | 1 | `#179: ... and a non-empty clock time ([])` |
| M5 remove `state.attempt = 0;` from `onopen` | 1 | `#179: a drop after a healthy open waits the first step (got 2000, want 1000)`; the two-drop control (4000); the third cycle (8000) |

The pristine tree afterwards: `PASS 1754 checks, 0 failed`.

## What these new checks still cannot see

- **The close is the stub's, not the network's.** M1's check proves the tab
  nulled its handler and called `close()` on the current fake socket. It says
  nothing about the real WebSocket close handshake or a relay that keeps
  answering on a half-closed connection, and nothing about the scheduled
  reconnect landing on a *new* socket after the person pressed Disconnect
  (the timers never fire in the stub; see below).
- **The clipboard is a recorder, not the clipboard.** The stub's
  `writeText` records the exact line, so a wrong or empty line is caught. A
  browser that denies the permission, the failure toast (`Copy it from the
  line above: …`), and the OS clipboard are not exercised; a real rejection
  would still leave the correct line recorded and pass.
- **The frame position is the studio's own claim; the stub draws calls, not
  pixels.** `currentFrame()` and the number of `putImageData` calls catch the
  named `runFrames(1)` break. They do not prove the twelve frames are the tool
  core's twelve pictures: a mirror that drew one frame and then `seek()`ed to
  N−1 would land on the right frame and draw the missing ones through `seek()`.
  Pixel equality is still not asserted.
- **The backoff check presses Reconnect; it never lets the timer run.**
  `setTimeout` in the stub returns 0 and never fires, so the reset is proved
  on `onopen`, not on the delayed retry: a `scheduleReconnect` that computed
  the right delay but scheduled the wrong one is not seen.
- **The FEED is read after `api.idle()`.** The drawer's render is synchronous
  inside the queue, which is what makes that a complete read; a render moved
  asynchronously after the queue would not be seen by this check.
- **Unchanged from the #167 list:** the real relay and a real tab↔relay pair,
  real two-tab takeover, the 25 s keepalive, `export_pce`/`toy_save` downloads,
  the real `navigator.clipboard`/`localStorage`, `RELAY_URL` edge cases
  (`http://`, trailing slash, malformed), and overlapping calls. Those remain
  fixture blind spots, not something #179 claims.


---

# #182 — the second cold read: twelve more breaks the strengthened check cannot see (2026-10-31)

Card #167's rule-2 gate asked for a cold read of the strengthened
`checkAgentPanel` (the #179 checks included). This is that read, by @test
(test seat, `deepseek-v4-pro`) — a different session and model from the
check's two builders (`#ds-pro`, `#opus`). **Verdict: the strengthened check
still misses twelve breaks of the feature it guards, so #167 is not
closable.** They are routed to #182 (@review, one kind up from the test's
builder). Nothing in the feature or the check was changed by this seat.

Baseline: pushed `main` 043d9a7, this seat's own worktree —
`node tests/check-studio.js` PASS 1754 checks. The five #179 checks are
alive on this tree (the `runFrames(1)` mutant reds four #179 checks).

## Method

Same discipline as the first read: 21 breaks, one at a time, each a single
exact-string replacement asserted to occur exactly once (harness under
`$TMPDIR/agent-mut/`, outside the repo), the full 1754-check suite per
mutant, the pristine source restored after each; `git status --short` empty
at the end of the series. A mutant counts as DETECTED only when the suite
exits non-zero **and names a `#167:`/`#179:` check** as failing.

## Results: 21 breaks — 4 DETECTED, 17 green

### Detected

| # | Break | What caught it |
|---|---|---|
| C1 | hello carries version 2 | `#167: the tab sends hello with the protocol version` |
| C2 | relay-config.js ships a non-empty RELAY_URL | `#167: with RELAY_URL empty the panel is not switched on` (+2 checks) |
| C3 | FEED rows drawn newest-first | `#167: the FEED marks it an error with its findings` / `#179: the FEED's last drawn row is the error` |
| C5 | the CHECK block stays hidden even with a report | `#167: ... and draws there` |

### The twelve new blind spots (green)

| # | Break (exact string, applied once) | Why green | What would catch it |
|---|---|---|---|
| C4 | `id="bottom-agent"` renamed in studio.html:1791 | the stub DOM's `get()` fabricates a `<div>` for any id the markup did not seed (check-studio.js `makeStubDom`), so the whole drawer renders into a phantom element and all 1754 checks pass | pin the drawer's markup from source (the #157 section's static-grep precedent): the id list seeded from studio.html must contain `bottom-agent` |
| M8 | `id="console-log"` renamed (studio.html:1702) | the RUN LOG block is never DOM-read; only `con.runLog()`'s api data is asserted | after a toy_run, read `#console-log`'s text: RUN LOG, the frame count, the "42" line |
| M9 | `host.appendChild(list);` removed from `drawCheck` | the findings report's DOM is never read — only the ok report is ("... and draws there") and `con.checkReport()` | after the findings validate, read `console-check`'s `con-check-row` for `validate-sprite-line` |
| M4 | the FEED's `agent-time` drawn as `"00:00:00"` | the time check is the regex `^\d{2}:\d{2}:\d{2}$`, which a constant satisfies; only the first row's time is read at all | eq each drawn time against `clockTime(entry.at)` recomputed in the check from `api.feed()`; a later row at a different time is the control |
| M14 | feed entries stamped `at: 0` | `clockTime(0)` is a valid `HH:MM:SS`, and the drawn time agrees with the (wrong) stamp | assert `entry.at` is within a few seconds of `Date.now()` (the sandbox's real clock) |
| M1 | `hello` drops its `title` | the check asserts `hello.version === 1` only, though the protocol table (docs/AGENT-LINK.md) pins `{"type":"hello","version":1,"title":"..."}` | assert `hello.title === "PCEStudio studio"` |
| M5 | `syncFromStudio` also skips `validate` | the re-prime is observable only through toy_run's reply (42→43); in the suite every other call follows a write whose `syncedKey` already matches | edit main.lua to the 17-sprite toy, then validate, and require the report to carry the edited toy's finding; control: the unedited toy validates clean |
| M15 | `song_write` dropped from `mirror()`'s file branch | no song_write call exists in the suite, though a step list needs no binary data (unlike a .mid) | song_write a step list, assert the studio gains song.json and `music(0)` plays |
| M16 | the taken state's Connect branch removed (`ready \|\| taken` → `ready`) | section 10 reads only the status word and `reconnectScheduled` | after taken, assert Connect and New link exist; press Connect, assert live, then a later drop is a plain disconnect |
| M6 | `studio.render.pause();` removed from `mirrorFrame` | the seek is pinned (`currentFrame() === 5`), the pause is not | assert the render is paused after frame_png |
| M7 | sourceEntry's `tiles` count becomes 0 | the ASSETS check reads only the name (`sources().some(name === "square")`); and the fixture's only source_add is kind sprites, so the bg/tilesheet/palette branches are dead code in the suite | drive a bg-kind source_add and eq the entry's ranges; eq the sprites entry's patterns count |
| M13 | relay-config.js defines `RELAY_URX` | an absent constant still yields the off state (section 1 passes), and the test assigns `S.RELAY_URL` itself for everything else | assert `S.RELAY_URL === ""` right after page load, before the test assigns it (or a source grep) |

### Verified, previously documented holes (green, expected)

M2 (http: no longer rewritten to ws:), M3 (trailing slashes no longer
stripped), M10 (the retry scheduled at 2× the computed delay), M11 (the call
queue bypassed) and M12 (the keepalive pings with type "pong") all stayed
green, exactly as the earlier reads' "cannot see" lists say they would. They
are re-confirmed by execution here, not new findings; #182 may close any of
them (the two RELAY_URL edge cases are one fixture line each) or leave them
"not proven".

## What even #182's checks will not be able to see

- **The stub-DOM fabrication is structural.** Any element's absence from
  studio.html is invisible to every DOM assertion in this suite until ids
  are pinned from source; pinning only `bottom-agent` leaves `console-log`,
  `console-check` and every other block the same hole in kind.
- Everything the earlier lists still carry: the real relay and two real
  tabs, the real clipboard and its denial path, the keepalive/retry timers
  (the stub's `setTimeout` never fires), pixels, `export_pce`/`toy_save`
  downloads, overlapping calls.
- `Date` is the sandbox's real clock, so a time can be checked only against
  "now" or against the entry's own `at` — a panel that stamps a wrong `at`
  and draws it faithfully is caught only by the freshness assertion above.
