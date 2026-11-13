#!/usr/bin/env python3
"""tools/study-scene.py — how does a real HuCard load a scene?

    python3 -I tools/study-scene.py run ROM.pce NAME TRACE.txt
    python3 -I tools/study-scene.py analyse TRACE.txt

run: starts ROM in Geargrafx (tools/ggmcp.py), presses RUN every 200 frames for
1,300 frames and logs the VDC register writes, VDC DMA and bank mapping events
(Geargrafx's trace filters vdc.registers, vdc.dma, system.mpr).  The trace is
large (50-250 MB): put it on External II, not the internal disk.
analyse: per video frame, the VRAM words written, the frames that write more than
600 words in a burst, the control register's writes (display on or blanked) and
the VRAM destinations of a burst.  docs/ENGINE-STUDY.md has the results.
"""
import sys
import re,collections
import json,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from ggmcp import GG
def run(rom,name,out):
    g=GG(rom)
    g.tool("debug_step_frame",{"frames":240,"mode":"sync"})
    g.tool("set_trace_log",{"enabled":True,"filters":["vdc.registers","vdc.dma","system.mpr"],"memory_size":"5M"})
    base=json.loads(g.tool("get_trace_log",{"count":1,"start":-1}))["total_logged"]
    presses=[60,260,460,660,860,1060]
    f=0
    for target in range(0,1300,10):
        if target in presses or any(abs(target-p)<10 and f<=p<=target for p in presses):
            g.tool("controller_button",{"action":"press_and_release","button":"run"})
        g.tool("debug_step_frame",{"frames":10,"mode":"sync"}); f+=10
    d=json.loads(g.tool("get_trace_log",{"count":1,"start":-1})); total=d["total_logged"]
    lines=[]; start=base
    while start<total:
        r=json.loads(g.tool("get_trace_log",{"count":1000,"start":start}))
        if not r["lines"]: break
        lines+=r["lines"]; start=r["next_sequence"]
    g.close()
    open(out,"w").write("\n".join(lines))
    print(name,"events",len(lines),"overrun",d.get("overrun"))

import re,collections
def analyse(path):
    lines=open(path).read().split("\n")
    FR=358986
    first=None
    per=collections.defaultdict(lambda: collections.Counter())
    mawr=collections.defaultdict(list)
    cr=[]
    mawr_cur=None
    for l in lines:
        m=re.match(r"@(\d+)",l)
        if not m: continue
        c=int(m.group(1)); 
        if first is None: first=c
        fr=(c-first)//FR
        if "REG       VWR" in l and "LSB" in l: per[fr]["vwr_words"]+=1
        elif "REG       MAWR" in l and "MSB" in l:
            v=int(re.search(r"Value:\$([0-9A-F]+)",l).group(1),16); per[fr]["mawr"]+=1; mawr[fr].append(v)
        elif "REG       CR(" in l and "LSB" in l:
            cr.append((fr,int(re.search(r"Value:\$([0-9A-F]+)",l).group(1),16)))
        elif "DMA" in l and "SATB" not in l: per[fr]["dma_other"]+=1; 
        elif "SATB DMA" in l: per[fr]["satb"]+=1
        elif "TAM" in l: per[fr]["tam"]+=1
    frames=sorted(per)
    print("frames traced",frames[-1]+1)
    big=[(f,per[f]["vwr_words"]) for f in frames if per[f]["vwr_words"]>600]
    print("frames with >600 VRAM words:",big[:60])
    print("typical frame words:",sorted(per[f]["vwr_words"] for f in frames)[len(frames)//2])
    # runs of heavy frames = scene loads
    runs=[]; cur=None
    for f,w in big:
        if cur and f<=cur[1]+2: cur[1]=f; cur[2]+=w
        else:
            cur=[f,f,w]; runs.append(cur)
    for a,b,w in runs: print("load burst frames %d-%d (%d frames): %d words"%(a,b,b-a+1,w))
    if cr: print("CR writes (frame,value):",cr[:24])

if __name__=="__main__":
    if len(sys.argv)>=5 and sys.argv[1]=="run": run(sys.argv[2],sys.argv[3],sys.argv[4])
    elif len(sys.argv)==3 and sys.argv[1]=="analyse": analyse(sys.argv[2])
    else: sys.exit(__doc__)
