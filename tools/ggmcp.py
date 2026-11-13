#!/usr/bin/env python3
"""tools/ggmcp.py — a tiny client for Geargrafx's built-in MCP server (stdio).

Geargrafx (drhelius/Geargrafx, v1.8.5 here) runs headless and exposes 90
debugger tools: pause/step/continue, breakpoints, memory read/write, the
HuC6280's registers including the eight MPR bank registers, disassembly, the
call stack, VDC/VCE/PSG status, screenshots, controller input, a trace log and
a profiler.  docs/GEARGRAFX-MCP.md has the recipe and the gotchas.

    python3 -I tools/ggmcp.py ROM.pce                  list the tools
    python3 -I tools/ggmcp.py ROM.pce status [SECONDS] run SECONDS (default 3),
                                                        pause, print CPU + call stack
    python3 -I tools/ggmcp.py ROM.pce psgtrace IMAGE.json [FRAMES]
                                                        run FRAMES video frames (default 120) of a
                                                        PSG_TRACE build and print its write log as
                                                        JSON (image.json = the engine's hutrack-image.json)
    python3 -I tools/ggmcp.py ROM.pce satdump [FRAMES]
                                                        step FRAMES video frames (default 400) and print, as JSON, the
                                                        runtime's toy-frame counter ($2104) and the sprite list in VRAM
                                                        $7F00 (256 words) -- for tools/native-sat-compare.js
    python3 -I tools/ggmcp.py ROM.pce vramdump OUT.bin [FRAMES]
                                                        step FRAMES (default 60) and write the console's VRAM (64 KiB) then its
                                                        colour table (1 KiB) to OUT.bin -- for tests/check-native-art.js
    python3 -I tools/ggmcp.py ROM.pce psgframes IMAGE.json [FRAMES]
                                                        step FRAMES video frames one at a time and print,
                                                        per toy frame (the trace build's counter), each PSG
                                                        channel's [frequency, enabled, noise] as JSON

As a library:
    sys.path.insert(0, "tools"); from ggmcp import GG
    g = GG("rom.pce"); g.tool("debug_continue"); time.sleep(2); g.tool("debug_pause")
    print(g.tool("get_huc6280_status")); g.close()

GEARGRAFX=/path/to/geargrafx overrides the binary (default: the unzipped app
beside the tools on External II).
"""
import json
import os
import subprocess
import sys
import time

CANDIDATES = [
    os.environ.get("GEARGRAFX", ""),
    "/Volumes/External II/pce-tools/geargrafx/app/Geargrafx.app/Contents/MacOS/geargrafx",
]


def binary():
    for c in CANDIDATES:
        if c and os.access(c, os.X_OK):
            return c
    sys.exit("Geargrafx not found: unzip Geargrafx.app.zip and set GEARGRAFX=.../Contents/MacOS/geargrafx")


class GG:
    def __init__(self, rom, extra=()):
        self.p = subprocess.Popen([binary(), "--headless", "--mcp-stdio", *extra, rom],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.id = 0
        self.rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                                "clientInfo": {"name": "pcestudio", "version": "0"}})
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        self.p.stdin.flush()

    def rpc(self, method, params=None):
        self.id += 1
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.id, "method": method,
                                       "params": params or {}}) + "\n")
        self.p.stdin.flush()
        while True:
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError("Geargrafx closed")
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if d.get("id") == self.id:
                return d

    def tool(self, name, args=None):
        d = self.rpc("tools/call", {"name": name, "arguments": args or {}})
        r = d.get("result") or d
        c = r.get("content")
        return "".join(x.get("text", "") for x in c) if c else json.dumps(r)

    def ram(self, addr, n):
        """n bytes of console RAM at CPU address addr ($2000-$3FFF)."""
        t = self.tool("read_memory", {"area": 0, "offset": "%04X" % (addr - 0x2000), "size": n})
        d = json.loads(t)
        v = d.get("data") or d.get("bytes") or d.get("hex")
        if isinstance(v, str):
            return bytes.fromhex(v.replace(" ", ""))
        return bytes(int(x, 16) if isinstance(x, str) else x for x in v)

    def close(self):
        self.p.kill()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    g = GG(sys.argv[1])
    try:
        if len(sys.argv) > 3 and sys.argv[2] == "psgtrace":
            tr = json.load(open(sys.argv[3]))["psg_trace"]
            g.tool("debug_step_frame", {"frames": int(sys.argv[4]) if len(sys.argv) > 4 else 120, "mode": "sync"})
            cap = tr["capacity"]
            count = g.ram(tr["psg_trace_count"], 1)[0]
            f, r, v = (g.ram(tr[k], cap) for k in ("psg_trace_f", "psg_trace_r", "psg_trace_v"))
            print(json.dumps({"ok": g.ram(tr["psg_trace_ok"], 1)[0], "count": count,
                              "events": [[f[i], r[i], v[i]] for i in range(count)],
                              "tail": all(f[i] == 0xEE and r[i] == 0xEE and v[i] == 0xEE for i in range(count, cap))}))
        elif len(sys.argv) > 3 and sys.argv[2] == "vramdump":
            g.tool("debug_step_frame", {"frames": int(sys.argv[4]) if len(sys.argv) > 4 else 60, "mode": "sync"})
            areas = {a["name"]: a for a in json.loads(g.tool("list_memory_areas"))["areas"]}
            def rd(name, size):
                a = areas[name]; out = b""
                while len(out) < size:
                    n = min(4096, size - len(out))
                    t = json.loads(g.tool("read_memory", {"area": a["id"], "offset": "%04X" % (len(out) // a["unit_size"]), "size": n}))
                    out += bytes.fromhex(t["data"].replace(" ", ""))
                return out
            open(sys.argv[3], "wb").write(rd("VRAM", 65536) + rd("PALETTES", 1024))
            print("wrote", sys.argv[3])
        elif len(sys.argv) > 2 and sys.argv[2] == "satdump":
            g.tool("debug_step_frame", {"frames": int(sys.argv[3]) if len(sys.argv) > 3 else 400, "mode": "sync"})
            m = g.ram(0x2100, 16)
            areas = {a["name"]: a for a in json.loads(g.tool("list_memory_areas"))["areas"]}
            t = json.loads(g.tool("read_memory", {"area": areas["VRAM"]["id"], "offset": "7F00", "size": 512}))
            b = bytes.fromhex(t["data"].replace(" ", ""))
            print(json.dumps({"count": m[4] | (m[5] << 8), "flags": m[15],
                              "sat": [b[i] | (b[i + 1] << 8) for i in range(0, 512, 2)]}))
        elif len(sys.argv) > 3 and sys.argv[2] == "psgframes":
            tr = json.load(open(sys.argv[3]))["psg_trace"]
            out = {}
            for _ in range(int(sys.argv[4]) if len(sys.argv) > 4 else 90):
                g.tool("debug_step_frame", {"frames": 1, "mode": "sync"})
                tf = int.from_bytes(g.ram(tr["psg_trace_frame"], 2), "little")
                ch = json.loads(g.tool("get_psg_status"))["channels"]
                out[tf] = [[c["frequency"], c["enabled"], c["noise"]] for c in ch]
            print(json.dumps(out))
        elif len(sys.argv) > 2 and sys.argv[2] == "status":
            g.tool("debug_continue")
            time.sleep(float(sys.argv[3]) if len(sys.argv) > 3 else 3)
            g.tool("debug_pause")
            print(g.tool("get_huc6280_status"))
            print(g.tool("get_call_stack"))
        else:
            ts = g.rpc("tools/list")["result"]["tools"]
            print(len(ts), "tools")
            for t in ts:
                print(" ", t["name"])
    finally:
        g.close()
