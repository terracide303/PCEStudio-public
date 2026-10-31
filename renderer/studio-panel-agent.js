/*
 * studio-panel-agent.js — the AGENT drawer: Claude drives this studio tab
 * (#167), a module of the studio since #102.
 *
 * The agent link is ppu.toys' shape (docs/AGENT-LINK.md, #165): a hosted MCP
 * endpoint plus the open tab as the agent's hands.  Nothing is installed and
 * nothing is cloned.  The person presses Connect in the AGENT drawer, the
 * tab mints a 32-hex token (crypto.getRandomValues, kept in localStorage so
 * the command stays the same after a reload; "New link" rotates it), opens
 * the relay's WebSocket, and shows the one line to run:
 *
 *   claude mcp add --transport http pcestudio <RELAY_URL>/mcp/<token>
 *
 * The relay forwards every tools/call to this tab as {"type":"call"}; the
 * panel runs it through the ONE tool core (renderer/pce-agent-tools.js, #166)
 * — the same code tools/mcp/server.js runs — and answers {"type":"result"}.
 * The tool core's sessions, runs and replies are the truth; this panel only
 * mirrors them into the studio so the person sees what Claude did:
 *
 *   toy_write / source_add / song_write  the toy's files into the studio
 *                                        through the page's own Open… →
 *                                        From file path (studio.openToy over
 *                                        renderer/pce-source.js's envelope),
 *                                        so editor tabs and the ASSETS list
 *                                        are the same ones a person opening
 *                                        the file gets
 *   toy_run                              the run plays in the OUTPUT canvas
 *                                        and the toy's log lands in the
 *                                        CONSOLE panel
 *   frame_png                            the studio seeks to that frame
 *   validate                             the validator's report in the
 *                                        CONSOLE panel's CHECK block
 *
 * THE PERSON'S EDITS WIN.  Before every call the panel compares the studio's
 * current files with what it last gave the tool core; when they differ (the
 * person edited main.lua between calls) it re-primes the session with the
 * studio's files first, so Claude's next toy_run runs the text in the editor.
 * The panel's help text says so.
 *
 * RELAY_URL is renderer/relay-config.js's one constant.  While it is empty the
 * drawer says the agent link is not switched on yet and offers nothing else.
 *
 * The wire protocol is docs/AGENT-LINK.md's, exactly: hello/ping/result/error
 * out, call/taken/pong in, 25 s keepalive, reconnect with backoff.  The
 * browser host (createSession's one door out) turns export_pce and toy_save
 * into downloads, as the Node host turns them into files.
 */
(function (root) {
  "use strict";
  var P = root.PCEStudio = root.PCEStudio || {};
  P.studioPanelModules = P.studioPanelModules || [];

  /* ---- the protocol's own numbers (docs/AGENT-LINK.md) ------------------ */
  var TOKEN_KEY = "pcestudio.agent.token.v1";
  var PING_MS = 25000;                    /* the tab's keepalive */
  var BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];
  var FEED_MAX = 50;

  var HELP = "Run this once in your terminal, then ask Claude to build a game " +
             "in the studio. This tab is Claude's hands until you disconnect.";
  var EDITS = "Your edits are part of the run: whatever is in the editor when " +
              "Claude calls toy_run is the text it runs, so fixing main.lua " +
              "between calls changes what Claude sees.";

  P.studioPanelModules.push({
    id: "agent",
    register: function (studio) {
      var doc = studio.document;

      /* one panel, one state: the socket, the token, the calls shown */
      var state = {
        status: "off",        /* off | ready | connecting | live | taken |
                               * disconnected */
        token: null,
        ws: null,
        note: "",
        feed: [],
        taken: false,
        manualStop: false,
        attempt: 0,
        reconnectIn: 0,
        retryScheduled: false,
        timer: 0,
        pingTimer: 0,
        session: null,
        syncedKey: null,      /* what the tool core last got from the studio */
        capture: false,       /* the mirror's toy_save: hold the envelope */
        captureText: null,
        captureTitle: "",
        queue: Promise.resolve()
      };

      /* ---- small DOM helpers (the stub DOM the checks use has only these) */
      function el(tag, cls, text) {
        var e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined && text !== null) e.textContent = String(text);
        return e;
      }
      function button(id, cls, text, fn) {
        var b = doc.createElement("button");
        b.type = "button";
        b.id = id;
        b.className = cls;
        b.textContent = text;
        if (fn) b.addEventListener("click", fn);
        return b;
      }
      function clear(host) {
        while (host.firstChild) host.removeChild(host.firstChild);
      }

      /* ---- the relay's URL, read at Connect time ----------------------- */
      function relayUrl() {
        return String(P.RELAY_URL || "").replace(/\/+$/, "");
      }
      function wsUrl(token) {
        return relayUrl().replace(/^https:/i, "wss:")
                         .replace(/^http:/i, "ws:") + "/ws/" + token;
      }
      function command(token) {
        return "claude mcp add --transport http pcestudio " +
               relayUrl() + "/mcp/" + token;
      }

      /* ---- the token: 32 lowercase hex, in localStorage ----------------- */
      function mintToken() {
        var c = root.crypto;
        if (!c || typeof c.getRandomValues !== "function") {
          throw new Error("this browser has no secure random generator " +
                          "(crypto.getRandomValues), so the link token " +
                          "cannot be made");
        }
        var bytes = new Uint8Array(16);
        c.getRandomValues(bytes);
        var out = "";
        for (var i = 0; i < bytes.length; i++) {
          out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
        }
        return out;
      }
      function readToken() {
        try {
          var t = root.localStorage ? root.localStorage.getItem(TOKEN_KEY) : null;
          return typeof t === "string" && /^[0-9a-f]{32}$/.test(t) ? t : null;
        } catch (e) { return null; }
      }
      function writeToken(t) {
        try {
          if (root.localStorage) root.localStorage.setItem(TOKEN_KEY, t);
        } catch (e) { /* private mode: the token lives for this page only */ }
      }
      function token() {
        if (state.token && /^[0-9a-f]{32}$/.test(state.token)) return state.token;
        state.token = readToken() || mintToken();
        writeToken(state.token);
        return state.token;
      }

      /* ---- the socket -------------------------------------------------- */
      function clearTimer() {
        if (state.retryScheduled && typeof root.clearTimeout === "function") {
          root.clearTimeout(state.timer);
        }
        state.retryScheduled = false;
        state.timer = 0;
        state.reconnectIn = 0;
      }
      function stopPing() {
        if (state.pingTimer && typeof root.clearTimeout === "function") {
          root.clearTimeout(state.pingTimer);
        }
        state.pingTimer = 0;
      }
      function startPing() {
        stopPing();
        if (typeof root.setTimeout !== "function") return;
        function beat() {
          send({ type: "ping" });
          state.pingTimer = root.setTimeout(beat, PING_MS);
        }
        state.pingTimer = root.setTimeout(beat, PING_MS);
      }
      function send(msg) {
        var ws = state.ws;
        if (!ws || ws.readyState !== 1) return false;
        try { ws.send(JSON.stringify(msg)); return true; }
        catch (e) { return false; }
      }
      function closeSocket() {
        var ws = state.ws;
        state.ws = null;
        if (!ws) return;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        try { ws.close(); } catch (e) { /* already gone */ }
      }
      function scheduleReconnect() {
        if (state.manualStop || state.taken || state.retryScheduled) return;
        if (typeof root.setTimeout !== "function") return;
        var delay = BACKOFF_MS[Math.min(state.attempt, BACKOFF_MS.length - 1)];
        state.attempt += 1;
        state.reconnectIn = delay;
        state.retryScheduled = true;
        state.timer = root.setTimeout(function () {
          state.timer = 0;
          state.retryScheduled = false;
          state.reconnectIn = 0;
          connect();
        }, delay);
      }

      function connect() {
        var url = relayUrl();
        if (!url) { state.status = "off"; render(); return false; }
        var tok;
        try { tok = token(); }
        catch (e) { state.note = String(e.message || e); render(); return false; }
        closeSocket();
        clearTimer();
        stopPing();
        state.taken = false;
        state.manualStop = false;
        state.status = "connecting";
        state.note = "";
        render();

        var WS = root.WebSocket;
        if (typeof WS !== "function") {
          state.status = "disconnected";
          state.note = "this browser has no WebSocket, so the tab cannot " +
                       "answer the relay";
          render();
          return false;
        }
        var ws;
        try { ws = new WS(wsUrl(tok)); }
        catch (e) {
          state.status = "disconnected";
          state.note = "the socket could not be opened: " +
                       String(e && e.message || e);
          render();
          return false;
        }
        state.ws = ws;
        ws.onopen = function () {
          if (state.ws !== ws) return;
          state.status = "live";
          state.attempt = 0;
          state.reconnectIn = 0;
          send({ type: "hello", version: 1, title: "PCEStudio studio" });
          startPing();
          render();
        };
        ws.onmessage = function (ev) {
          if (state.ws !== ws) return;
          onMessage(ev);
        };
        ws.onclose = function () {
          if (state.ws !== ws) return;
          state.ws = null;
          stopPing();
          if (state.taken) {
            state.status = "taken";
          } else {
            state.status = "disconnected";
            if (!state.manualStop) scheduleReconnect();
          }
          render();
        };
        ws.onerror = function () { /* onclose follows and owns the state */ };
        return true;
      }

      /* ---- messages in (docs/AGENT-LINK.md, "relay → tab") ------------- */
      function onMessage(ev) {
        var msg;
        try { msg = JSON.parse(ev && ev.data); }
        catch (e) { return; }
        if (!msg || typeof msg.type !== "string") return;
        if (msg.type === "taken") {
          /* another tab connected with this token; the relay closes us
           * next (docs/AGENT-LINK.md).  Say so at once — the close that
           * follows must not turn it into a plain disconnect, and nothing
           * here may reconnect: the other tab owns the link now. */
          state.taken = true;
          state.status = "taken";
          clearTimer();
          render();
          return;
        }
        if (msg.type === "pong") return;
        if (msg.type === "call") {
          /* one call at a time: the tool core's session is stateful */
          state.queue = state.queue.then(function () { return runCall(msg); },
                                         function () { return runCall(msg); });
        }
      }

      function runCall(msg) {
        var id = msg.id;
        var name = String(msg.name || "");
        var args = msg.arguments && typeof msg.arguments === "object"
          ? msg.arguments : {};
        var entry = { at: Date.now(), name: name, summary: "running…",
                      ok: null, id: id };
        state.feed.push(entry);
        while (state.feed.length > FEED_MAX) state.feed.shift();
        render();

        return Promise.resolve().then(function () {
          return syncFromStudio(name);
        }).then(function () {
          return session().call(name, args);
        }).then(function (result) {
          /* the reply is the tool core's, verbatim (the relay forwards it) */
          send({ type: "result", id: id, result: result });
          entry.ok = !result.isError;
          entry.summary = summarise(name, args, result);
          render();
          return waitThenMirror(name, args, result);
        }).catch(function (e) {
          send({ type: "error", id: id, message: String(e && e.message || e) });
          entry.ok = false;
          entry.summary = truncate(String(e && e.message || e));
          render();
        }).then(function () { render(); });
      }

      /* ---- the mirror's timing: the reply goes first, the studio follows */
      function waitThenMirror(name, args, result) {
        var info = resultJson(result);
        return Promise.resolve().then(function () {
          return mirror(name, args, result, info);
        }).catch(function (e) {
          state.note = "the studio copy of " + name + " failed: " +
                       String(e && e.message || e);
          render();
        });
      }

      /* ---- the session and the browser host (#166's one door out) ------ */
      function session() {
        if (state.session) return state.session;
        var tools = P.agentTools;
        if (!tools || typeof tools.createSession !== "function") {
          throw new Error("the tool core (renderer/pce-agent-tools.js) did " +
                          "not load, so this tab cannot run Claude's calls");
        }
        state.session = tools.createSession(browserHost());
        return state.session;
      }

      /* The PNG's zlib step, the page's way: CompressionStream /
       * DecompressionStream with "deflate" (the zlib wrapper a PNG holds),
       * the same pair renderer/studio-panel-assets.js uses. */
      function pipeBytes(bytes, ctorName) {
        var Ctor = root[ctorName];
        if (typeof Ctor !== "function") {
          return Promise.reject(new Error("this browser has no " + ctorName +
                                          ", so a PNG cannot be read here"));
        }
        var cs = new Ctor("deflate");
        var writer = cs.writable.getWriter();
        writer.write(bytes).catch(function () {});
        writer.close().catch(function () {});
        var reader = cs.readable.getReader();
        var chunks = [], total = 0;
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) {
              var out = new Uint8Array(total), at = 0;
              for (var i = 0; i < chunks.length; i++) {
                out.set(chunks[i], at);
                at += chunks[i].length;
              }
              return out;
            }
            chunks.push(res.value);
            total += res.value.length;
            return pump();
          });
        }
        return pump();
      }

      /* The page's download, the way the studio's own Save hands a file to
       * the browser (an anchor with a download name). */
      function download(data, name, mime) {
        var a = doc.createElement("a");
        a.download = name;
        var url = "";
        if (typeof root.Blob === "function" && root.URL &&
            typeof root.URL.createObjectURL === "function") {
          url = root.URL.createObjectURL(new root.Blob([data], { type: mime }));
        } else if (typeof data === "string") {
          url = "data:" + mime + ";charset=utf-8," + encodeURIComponent(data);
        } else {
          throw new Error("this browser cannot download a file from the page");
        }
        a.href = url;
        a.click();
        return name;
      }

      function browserHost() {
        return {
          deflate: function (bytes) {
            return pipeBytes(bytes, "CompressionStream");
          },
          inflate: function (bytes) {
            return pipeBytes(bytes, "DecompressionStream");
          },
          /* export_pce's committed interpreter image, beside the page */
          readBank0: function () {
            if (typeof root.fetch !== "function") {
              return Promise.reject(new Error("this browser has no fetch, so " +
                                              "the ROM's interpreter cannot be " +
                                              "read (renderer/ilvm.bin)"));
            }
            return root.fetch("ilvm.bin").then(function (r) {
              return r.arrayBuffer();
            }).then(function (b) { return new Uint8Array(b); });
          },
          /* toy_save's path rules: a browser has no folder to stay inside,
           * so the download's file name is the whole path. */
          savePath: function (p) {
            var name = String(p || "").replace(/\\/g, "/").split("/").pop().trim()
              || "toy";
            if (!/\.(pce\.json|pce\.studio)$/i.test(name)) name += ".pce.json";
            return { path: name, name: name };
          },
          saveEnvelope: function (req) {
            /* the mirror's own toy_save holds the envelope instead of
             * downloading it: the studio installs those very bytes */
            if (state.capture) {
              state.captureText = req.text;
              state.captureTitle = req.title || "";
              return { path: req.path, name: req.name };
            }
            download(req.text, req.name || "toy.pce.json",
                     "application/json");
            return { path: req.path, name: req.name };
          },
          writeRom: function (req) {
            var name = (req.name || "toy") + ".pce";
            download(new Uint8Array(req.bytes), name, "application/octet-stream");
            return { path: name };
          }
        };
      }

      /* ---- the person's edits, read before every call ------------------ */
      function studioFiles() {
        var list = studio.toy.files() || [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
          out.push({ name: list[i].name, source: list[i].source });
        }
        return out;
      }
      function filesKey(list) {
        var parts = [];
        for (var i = 0; i < list.length; i++) {
          parts.push(list[i].name + "\u0000" + list[i].source);
        }
        return parts.join("\u0001");
      }

      /* The tool core's session starts from the studio's toy, and follows
       * the person's edits: a call that reads or runs the toy re-primes the
       * session when the studio's files are not the ones it last saw.
       * toy_write replaces the toy itself and docs needs no toy, so neither
       * pays for the re-prime. */
      function syncFromStudio(name) {
        if (name === "toy_write" || name === "docs") return Promise.resolve();
        var now = studioFiles();
        if (!now.length) return Promise.resolve();
        var key = filesKey(now);
        if (state.syncedKey === key) return Promise.resolve();
        return Promise.resolve().then(function () {
          return session().call("toy_write", { files: now });
        }).then(function (r) {
          if (!r.isError) state.syncedKey = key;
        }).catch(function () { /* the call below reports its own refusal */ });
      }

      /* ---- the mirror: the studio follows the tool core ---------------- */
      function resultJson(result) {
        var c = result && result.content && result.content[0];
        if (c && c.type === "text" && typeof c.text === "string") {
          try { return JSON.parse(c.text); } catch (e) { return null; }
        }
        return null;
      }

      function jsonOf(list, name) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].name !== name) continue;
          try { return JSON.parse(list[i].source); } catch (e) { return null; }
        }
        return null;
      }

      /* The session's whole file set, as the studio's own Save writes it:
       * the tool core's toy_save through the host, held instead of
       * downloaded, built by renderer/pce-source.js's envelopeText — the
       * same bytes the page's Save and Open… → From file use. */
      function captureEnvelope() {
        state.capture = true;
        state.captureText = null;
        state.captureTitle = "";
        return session().call("toy_save", { path: "claude.pce.json" })
          .then(function (r) {
            var text = state.capture ? state.captureText : null;
            state.capture = false;
            state.captureText = null;
            return r.isError || !text ? null
              : { text: text, title: state.captureTitle };
          }, function (e) {
            state.capture = false;
            state.captureText = null;
            throw e;
          });
      }

      /* The named source an Add Source records (#156), from what the call
       * said it wrote and the merged files themselves. */
      function sourceEntry(info, before, after) {
        if (!info || !info.name || info.kind === "song") return null;
        if (!/^[A-Za-z0-9 _.-]+$/.test(info.name)) return null;
        var stats = info.stats || {};
        if (info.kind === "bg" || info.kind === "tilesheet") {
          return { name: info.name, kind: info.kind,
                   tiles: { first: 0, count: stats.tiles },
                   map: info.kind === "bg" ? true : undefined,
                   palettes: { side: "bg", first: 0,
                               count: stats.palettes } };
        }
        if (info.kind === "palette") {
          return { name: info.name, kind: "palette",
                   palettes: { side: "bg", first: 0,
                               count: stats.palettes } };
        }
        if (info.kind === "sprites") {
          var oldDoc = jsonOf(before, "sprites.json") || {};
          var newDoc = jsonOf(after, "sprites.json") || {};
          var patterns = (newDoc.patterns || []).length -
                         (oldDoc.patterns || []).length;
          var placed = (newDoc.sprites || []).length -
                       (oldDoc.sprites || []).length;
          if (patterns <= 0 && placed <= 0) return null;
          return { name: info.name, kind: "sprites",
                   patterns: { first: 0, count: Math.max(0, patterns) },
                   sprites: { first: 0, count: Math.max(0, placed) },
                   palettes: { side: "spr", first: 0,
                               count: stats.palettes } };
        }
        return null;
      }

      /* sources.json is the ASSETS panel's named-source list (#156); the
       * merge is pce-assets.js's own (#123's Add Source), not a second one. */
      function addNamedSource(info, before, after) {
        var A = P.assets;
        if (!A || typeof A.mergeSource !== "function") return false;
        var entry = sourceEntry(info, before, after);
        if (!entry) return false;
        var f = studio.toy.file("sources.json");
        var text = A.mergeSource(f ? f.source : "", entry).text;
        if (f) {
          f.source = text;
          studio.toy.persist();
          studio.toy.refreshAssets();
        } else {
          studio.toy.addFile("sources.json", "json", text);
        }
        /* the ASSETS panel lists sources.json from its own state (#156), so
         * it re-reads the file set the same way it does after Add Source */
        var assets = studio.panels.get("assets");
        if (assets && assets.api && assets.api.refresh) assets.api.refresh();
        return true;
      }

      /* A toy_write / source_add / song_write changed the session's files:
       * install them in the studio through the page's own open path. */
      function mirrorFiles(name, info) {
        var before = studioFiles();
        return captureEnvelope().then(function (env) {
          if (!env) return;
          studio.openToy(env.text, "claude.pce.json", {
            title: "Claude's toy", stash: true
          });
          if (name === "source_add") {
            try { addNamedSource(info, before, studioFiles()); }
            catch (e) { /* a named-source row is bookkeeping, not the toy */ }
          }
          /* the studio now holds exactly the session's files (plus the
           * sources.json row the ASSETS list reads) */
          state.syncedKey = filesKey(studioFiles());
        });
      }

      /* toy_run: run the same frames in the OUTPUT canvas; the tool core's
       * log (what Claude was told) lands in the CONSOLE panel. */
      function mirrorRun(info, args) {
        var frames = info && typeof info.frames === "number" ? info.frames
          : (args && typeof args.frames === "number" ? args.frames : 60);
        frames = Math.max(1, Math.min(600, frames));
        try {
          studio.render.runFrames(frames);
          var f = studio.render.currentFrame();
          if (f >= 0 && f < studio.render.length()) studio.render.seek(f);
          else if (studio.panels && studio.panels.refresh)
            studio.panels.refresh(true);
        } catch (e) {
          state.note = "the studio could not play the run: " +
                       String(e && e.message || e);
        }
        var con = studio.panels.get("console");
        if (con && con.api && con.api.setRunLog) {
          con.api.setRunLog((info && info.log) || [], frames);
        }
        if (studio.panels && studio.panels.refresh) studio.panels.refresh(true);
      }

      /* frame_png: the studio seeks to the frame the tool rendered. */
      function mirrorFrame(result) {
        var info = resultJson(result);
        if (!info || typeof info.frame !== "number") return;
        var frame = Math.max(0, info.frame);
        studio.render.pause();
        if (frame < studio.render.length()) {
          studio.render.seek(frame);
        } else {
          studio.render.seek(studio.render.length() - 1);
        }
      }

      /* validate: the validator's own report, in the CONSOLE panel. */
      function mirrorValidate(info) {
        if (!info || typeof info !== "object") return;
        var con = studio.panels.get("console");
        if (con && con.api) {
          if (con.api.setCheck) con.api.setCheck(info || { ok: false });
          if (con.api.refresh) con.api.refresh();
        }
        if (studio.panels && studio.panels.refresh) studio.panels.refresh(true);
      }

      function mirror(name, args, result, info) {
        if (!result) return undefined;
        /* validate is answered with isError:true exactly when the toy has
         * findings — that is the report the person most needs to see, so it
         * is mirrored before the refusal check.  Everything else that fails
         * changed nothing in the session, so there is nothing to mirror. */
        if (name === "validate") return mirrorValidate(info);
        if (result.isError) return undefined;
        if (name === "toy_write" || name === "source_add" ||
            name === "song_write") {
          return mirrorFiles(name, info);
        }
        if (name === "toy_run") return mirrorRun(info, args);
        if (name === "frame_png") return mirrorFrame(result);
        return undefined;
      }

      /* ---- one line per call, for the FEED ----------------------------- */
      function truncate(text) {
        var s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
        return s.length > 96 ? s.slice(0, 93) + "…" : s;
      }
      function failed(reason) {
        if (reason && reason.code) {
          return reason.code + (reason.message ? " · " +
                                truncate(reason.message) : "");
        }
        return truncate(reason && (reason.message || reason));
      }
      function summarise(name, args, result) {
        var info = resultJson(result);
        /* a validator report is an answer, not a refusal, even when it
         * carries findings (the tool core marks ok:false as isError) */
        if (name === "validate" && info) {
          var n = (info.problems || []).length;
          return info.ok ? "ok · no findings"
                         : n + " finding" + (n === 1 ? "" : "s") +
                           (info.code ? " · " + info.code : "");
        }
        if (!result || result.isError) {
          return "refused · " + failed(info || { message: "no reply" });
        }
        if (!info) return truncate(result && result.content &&
          result.content[0] && result.content[0].text);
        switch (name) {
        case "toy_write":
          return (info.files || []).length + " file" +
                 ((info.files || []).length === 1 ? "" : "s") + " · " +
                 (info.files || []).slice(0, 4).join(", ") +
                 ((info.files || []).length > 4 ? "…" : "");
        case "toy_run":
          return info.frames + " frame" + (info.frames === 1 ? "" : "s") +
                 " · " + ((info.log || []).length) + " log line" +
                 ((info.log || []).length === 1 ? "" : "s");
        case "source_add":
          return info.kind + " " + JSON.stringify(info.name) + " · " +
                 (info.stats && info.stats.tiles) + " tiles" +
                 (info.budget ? ", " + info.budget.sprites + " sprites" : "");
        case "song_write":
          return "song.json · " + info.notes_placed + " notes · " +
                 info.patterns + " pattern" + (info.patterns === 1 ? "" : "s");
        case "frame_png":
          return "frame " + info.frame + " · " + info.width + "×" +
                 info.height + " PNG";
        case "toy_save":
          return "saved " + info.path;
        case "export_pce":
          return info.bytes + " bytes · " + info.path;
        case "docs":
          return info.topic ? "chapter " + info.topic
                            : (info.topics || []).length + " chapters";
        case "registers_get":
          return args && args.chip ? args.chip : "all chips";
        case "register_set":
          return (args && args.name) + " = " +
                 (args && args.value == null ? "the toy's value" : args.value);
        default:
          return "ok";
        }
      }

      /* ---- the drawing ------------------------------------------------- */
      function statusText() {
        switch (state.status) {
        case "live": return "live";
        case "connecting": return "connecting";
        case "taken": return "taken over";
        case "disconnected": return "disconnected";
        case "off": return "not switched on";
        default: return "not connected";
        }
      }

      function feedRow(entry) {
        var li = el("li", "agent-entry " + (entry.ok === true ? "is-ok"
          : entry.ok === false ? "is-error" : "is-pending"));
        li.appendChild(el("span", "agent-mark",
          entry.ok === true ? "ok" : entry.ok === false ? "error" : "…"));
        li.appendChild(el("span", "agent-time", clockTime(entry.at)));
        li.appendChild(el("span", "agent-tool", entry.name || "?"));
        li.appendChild(el("span", "agent-summary", entry.summary || ""));
        return li;
      }
      function clockTime(ms) {
        var d = new Date(ms);
        function two(n) { return (n < 10 ? "0" : "") + n; }
        return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" +
               two(d.getSeconds());
      }

      function drawHead(host, url) {
        var head = el("p", "agent-head");
        var dot = el("span", "agent-dot is-" + state.status);
        dot.setAttribute("aria-hidden", "true");
        head.appendChild(dot);
        var text = el("span", "agent-state", statusText());
        text.id = "agent-status";
        head.appendChild(text);
        head.appendChild(el("span", "agent-head-spacer"));
        if (url) {
          if (state.status === "ready" || state.status === "taken") {
            head.appendChild(button("btn-agent-connect", "agent-connect",
                                    "Connect", onConnect));
            if (state.status === "taken") {
              head.appendChild(button("btn-agent-newlink", "btn-mini",
                                      "New link", onNewLink));
            }
          } else if (state.status === "connecting" || state.status === "live") {
            head.appendChild(button("btn-agent-disconnect", "btn-mini",
                                    "Disconnect", onDisconnect));
            head.appendChild(button("btn-agent-newlink", "btn-mini",
                                    "New link", onNewLink));
          } else if (state.status === "disconnected") {
            head.appendChild(button("btn-agent-reconnect", "btn-mini",
                                    "Reconnect", onReconnect));
            head.appendChild(button("btn-agent-newlink", "btn-mini",
                                    "New link", onNewLink));
          }
        }
        host.appendChild(head);
      }

      function drawBody(host, url) {
        var body = el("div", "agent-body");
        if (!url) {
          /* nothing is switched on: say so and offer nothing else */
          var off = el("p", "agent-intro", "the agent link is not switched on " +
            "yet — set RELAY_URL in renderer/relay-config.js to the relay's " +
            "URL, then reload this page.");
          off.id = "agent-off";
          body.appendChild(off);
          host.appendChild(body);
          return;
        }
        if (state.status === "ready") {
          body.appendChild(el("p", "agent-intro",
            "Let Claude drive this tab. Press Connect, then run the one " +
            "command it shows in your terminal — nothing to install."));
          if (state.note) body.appendChild(el("p", "agent-note", state.note));
          host.appendChild(body);
          return;
        }

        var cmd = command(state.token || "");
        var row = el("div", "agent-cmd-row");
        var code = el("code", "agent-cmd", cmd);
        code.id = "agent-cmd";
        row.appendChild(code);
        row.appendChild(button("btn-agent-copy", "btn-mini", "Copy", onCopy));
        body.appendChild(row);

        var help = el("p", "agent-help", HELP);
        help.id = "agent-help";
        body.appendChild(help);
        var edits = el("p", "agent-edits", EDITS);
        edits.id = "agent-edits";
        body.appendChild(edits);

        if (state.status === "taken") {
          body.appendChild(el("p", "agent-note",
            "another tab connected with this token and took the link over. " +
            "Connect here to take it back, or New link to change the token."));
        } else if (state.status === "disconnected") {
          var note = state.manualStop
            ? "the link is closed; press Reconnect to open it again."
            : "the link is down; reconnecting" +
              (state.reconnectIn ? " in " + Math.round(state.reconnectIn / 1000) +
               "s" : "") + " — Reconnect tries now.";
          body.appendChild(el("p", "agent-note", note));
        }
        if (state.note) body.appendChild(el("p", "agent-note", state.note));

        var feed = el("ol", "agent-feed");
        feed.id = "agent-feed";
        if (!state.feed.length) {
          feed.appendChild(el("li", "agent-entry is-empty",
            "no calls yet — Claude's tool calls appear here"));
        }
        for (var i = 0; i < state.feed.length; i++) {
          feed.appendChild(feedRow(state.feed[i]));
        }
        body.appendChild(feed);
        host.appendChild(body);
      }

      function render() {
        var host = studio.$("bottom-agent");
        if (!host) return;
        if (!relayUrl() && state.status !== "off") state.status = "off";
        if (relayUrl() && state.status === "off") state.status = "ready";
        clear(host);
        drawHead(host, relayUrl());
        drawBody(host, relayUrl());
        return host;
      }

      /* ---- the buttons ------------------------------------------------- */
      function onConnect() {
        state.manualStop = false;
        state.taken = false;
        try { connect(); }
        catch (e) { state.note = String(e && e.message || e); render(); }
        return state.status;
      }
      function onDisconnect() {
        state.manualStop = true;
        state.taken = false;
        clearTimer();
        closeSocket();
        stopPing();
        state.status = "disconnected";
        render();
        return state.status;
      }
      function onReconnect() {
        state.manualStop = false;
        state.taken = false;
        clearTimer();
        connect();
        return state.status;
      }
      function onNewLink() {
        try { state.token = mintToken(); }
        catch (e) { state.note = String(e && e.message || e); render(); return null; }
        writeToken(state.token);
        state.taken = false;
        state.manualStop = false;
        closeSocket();
        clearTimer();
        stopPing();
        /* the old token stops being answered at once: this tab attaches
         * with the new one, so the old /mcp/<token> has nothing behind it */
        if (relayUrl()) connect();
        else render();
        return state.token;
      }
      function onCopy() {
        var line = command(state.token || "");
        var clip = root.navigator && root.navigator.clipboard;
        if (clip && typeof clip.writeText === "function") {
          clip.writeText(line).then(function () {
            studio.toast("The command is on your clipboard.");
          }, function () {
            studio.toast("Copy it from the line above: " + line);
          });
        } else {
          studio.toast("Copy it from the line above: " + line);
        }
        return line;
      }

      /* ---- register ---------------------------------------------------- */
      if (studio.$("bottom-agent")) render();

      studio.panels.register({
        id: "agent",
        label: "Agent",
        group: "workspace",
        open: function () {
          studio.layout.drawer("agent");
          render();
        },
        draw: render,
        /* the evidence surface: the same functions the drawer's buttons
         * call, so tests/check-studio.js drives the real code path */
        api: {
          render: render,
          connect: onConnect,
          disconnect: onDisconnect,
          reconnect: onReconnect,
          newLink: onNewLink,
          copy: onCopy,
          status: function () { return state.status; },
          state: function () {
            return { status: state.status, token: state.token,
                     command: state.token ? command(state.token) : "",
                     note: state.note, attempt: state.attempt,
                     reconnectIn: state.reconnectIn,
                     reconnectScheduled: state.retryScheduled,
                     feed: state.feed.slice() };
          },
          feed: function () { return state.feed.slice(); },
          idle: function () { return state.queue; },
          html: function () { return studio.$("bottom-agent"); }
        }
      });
    }
  });
})(typeof self !== "undefined" ? self : this);
