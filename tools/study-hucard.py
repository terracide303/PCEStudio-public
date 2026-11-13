#!/usr/bin/env python3
"""tools/study-hucard.py — what does a real HuCard do in one video frame?

    python3 -I tools/study-hucard.py ROM.pce NAME OUT.json

Runs the ROM in Geargrafx (tools/ggmcp.py, docs/GEARGRAFX-MCP.md), presses RUN
a few times, and at four points records the CPU instruction trace of one whole
video frame (about 30,000 instructions) and summarizes it: CPU cycles (trace
units are master-clock cycles, three to a CPU cycle), time spent idle in the
wait loop, interrupts, calls, bank-mapping instructions and their masks, which
bank each page executes from, block transfers, which VDC registers are
selected and how many data words are written to each.  Prints one line per
point.  Reads the ROM only; nothing from it is stored.  Results:
docs/ENGINE-STUDY.md.
"""
import sys,json,re,collections,time
sys.path.insert(0,__import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from ggmcp import GG
LINE=re.compile(r"^@(\d+) \+(\d+)\s+([0-9A-F]{2}):([0-9A-F]{4})\s+A:(\w\w) X:(\w\w) Y:(\w\w) S:(\w\w)\s+(\S{8})\s+(.*?)\s{2,}([0-9A-F ]+)\s*$")
def capture(g,frames=1):
    g.tool("set_trace_log",{"enabled":True,"filters":["cpu.instructions","cpu.irqs"]})
    try: base=json.loads(g.tool("get_trace_log",{"count":1,"start":-1}))["total_logged"]
    except Exception: base=0
    g.tool("debug_step_frame",{"frames":frames,"mode":"sync"})
    d=json.loads(g.tool("get_trace_log",{"count":1,"start":-1}))
    total=d["total_logged"]; lines=[]; start=base
    while start<total:
        r=json.loads(g.tool("get_trace_log",{"count":1000,"start":start}))
        lines+=r["lines"]; start=r["next_sequence"]
        if not r["lines"]: break
    g.tool("set_trace_log",{"enabled":False})
    return lines,d.get("overrun")
def analyse(lines):
    ins=[]; other=collections.Counter()
    for l in lines:
        m=LINE.match(l)
        if not m: other[l[:40]]+=1; continue
        cyc=int(m.group(2)); bank=int(m.group(3),16); pc=int(m.group(4),16)
        txt=m.group(10).split(); mn=txt[0]; op=" ".join(txt[1:])
        ins.append((cyc,bank,pc,mn,op,int(m.group(5),16),int(m.group(6),16),int(m.group(7),16)))
    ins=ins[1:]   # the first entry's delta spans the time since the previous capture
    n=len(ins); cycles=sum(i[0] for i in ins)
    pcs=collections.Counter(i[2]|(i[1]<<16) for i in ins)
    # idle loop: the most frequent PCs that form a short spin
    top=pcs.most_common(6)
    spin=[k for k,v in pcs.items() if v>300]
    spin_cyc=sum(i[0] for i in ins if (i[2]|(i[1]<<16)) in set(spin))
    mn=collections.Counter(i[3] for i in ins)
    tam=collections.Counter(i[4] for i in ins if i[3]=="TAM")
    tma=sum(1 for i in ins if i[3]=="TMA")
    page=collections.defaultdict(collections.Counter)
    for c,b,p,_,_,_,_,_ in ins: page[p>>13][b]+=c
    blk={k:sum(1 for i in ins if i[3]==k) for k in ("TIA","TAI","TII","TIN","TDD")}
    # VDC access: ST0/ST1/ST2 are the VDC's own store instructions; plain stores to $0000-$0003
    # use the register value shown in the trace (A, X or Y at the store)
    vdc_sel=collections.Counter(); vdc_data=0; vcewr=0; sel=None; sel_hist=collections.Counter()
    for c,b,p,mn_,op,A,X,Y in ins:
        val=None; port=None
        if mn_=="ST0": port=0; val=int(re.search(r"#\$([0-9A-Fa-f]+)",op).group(1),16)
        elif mn_=="ST1": port=2; vdc_data+=1; continue
        elif mn_=="ST2": port=3; vdc_data+=1; continue
        elif mn_ in("STA","STX","STY","STZ") and op.split()[0] in("$0000","$0002","$0003"):
            port=int(op.split()[0][1:],16); val={"STA":A,"STX":X,"STY":Y,"STZ":0}[mn_]
        elif mn_ in("STA","STX","STY","STZ") and op.startswith(("$0402","$0403","$0404","$0405")): vcewr+=1; continue
        else: continue
        if port==0: sel=val&0x1F; sel_hist[sel]+=1
        else: vdc_data+=1; vdc_sel[("R%02X"%sel) if sel is not None else "R??"]+=1
    st12=vdc_data
    jsr=mn["JSR"]; rts=mn["RTS"]; rti=mn["RTI"]
    # interrupts: entries whose bank:pc jumps to vector targets are visible as RTI count
    return dict(instr=n,cycles=cycles,spin_pcs=[("%02X:%04X"%(k>>16,k&0xFFFF),v) for k,v in top],spin_share=spin_cyc/cycles if cycles else 0,
        jsr=jsr,rts=rts,rti=rti,tam=dict(tam),tma=tma,page_cycles={("MPR%d"%p):{("%02X"%b):round(c/cycles,3) for b,c in cnt.most_common(4)} for p,cnt in sorted(page.items())},
        block=blk,vdc_reg_selects={'R%02X'%k:v for k,v in sel_hist.most_common(10)},vdc_data_writes_by_reg=dict(vdc_sel.most_common(8)),vce_writes=vcewr,st1_st2=st12,other=dict(other.most_common(4)))

def brief(a):
    work=1-a["spin_share"]
    return dict(cpu_cycles_per_frame=round(a["cycles"]/3), idle_spin=round(a["spin_share"],2),
        interrupts_per_frame=a["rti"],   # one RTI per interrupt handled
        jsr=a["jsr"], tam_tma=sum(a["tam"].values())+a["tma"], tam_masks=a["tam"],
        block_xfers=a["block"], vdc_reg_selects=a["vdc_reg_selects"], vdc_data_by_reg=a["vdc_data_writes_by_reg"], vce_writes=a["vce_writes"], st1_st2=a["st1_st2"], banks_by_page=a["page_cycles"])
if __name__=="__main__":
    rom=sys.argv[1]; name=sys.argv[2]
    g=GG(rom)
    g.tool("debug_step_frame",{"frames":240,"mode":"sync"})
    rows=[]
    for k in range(1,9):
        g.tool("controller_button",{"action":"press_and_release","button":"run"}); g.tool("debug_step_frame",{"frames":150,"mode":"sync"})
        if k in (2,4,6,8):
            lines,over=capture(g,1)
            a=analyse(lines); b=brief(a); b["after_run_presses"]=k; b["overrun"]=over
            rows.append(b)
    g.close()
    json.dump(rows,open(sys.argv[3],"w"))
    for b in rows:
        print(name,"presses",b["after_run_presses"],"| cpu cycles/frame",b["cpu_cycles_per_frame"],"| idle",b["idle_spin"],"| interrupts",b["interrupts_per_frame"],"| jsr",b["jsr"],"| tam/tma",b["tam_tma"],"| block",{k:v for k,v in b["block_xfers"].items() if v})
        print("    VDC register selects/frame",b["vdc_reg_selects"],"| data writes by reg",b["vdc_data_by_reg"],"| VCE writes",b["vce_writes"])
