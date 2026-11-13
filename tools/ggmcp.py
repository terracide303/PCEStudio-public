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

    def close(self):
        self.p.kill()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    g = GG(sys.argv[1])
    try:
        if len(sys.argv) > 2 and sys.argv[2] == "status":
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
