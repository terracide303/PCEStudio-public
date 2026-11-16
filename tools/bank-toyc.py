#!/usr/bin/env python3
"""tools/bank-toyc.py — put a natively compiled toy's functions into switched
ROM banks (compiler step 1; docs/BANKING-STUDY.md for why).

    bank-toyc.py GEN.c OBJ.o OUT.c LLVM_ROOT

GEN.c is tools/toyc/emit.js's C; OBJ.o is the same C compiled with
-fno-lto -c, which gives each il_fn_N's size.  The functions are packed
first-fit-decreasing into 8 KiB banks (.rom_bank1, ...), which the SDK links at
$C000 (page 6); every call goes through il_call, the one dispatcher, which maps
the callee's bank around the call and restores the caller's.  il_call, the
runtime and the constants stay in the fixed top page.  Prints "BANKS n" on
stdout; or "SPLIT ids" and exit 4 when functions larger than a bank need
splitting (pce-cgen.js splitOnly).  Called by tools/build-toyc-banked.sh.
"""
import os,re,subprocess,sys
src,elf,out,llvm=sys.argv[1:5]
text=open(src).read()
sizes={}
for l in subprocess.run([llvm+"/bin/llvm-nm","-S",elf],capture_output=True,text=True).stdout.splitlines():
    p=l.split()
    m=re.match(r"il_fn_(\d+(?:_c\d+)?)$",p[-1]) if len(p)>=4 else None
    if m: sizes[m.group(1)]=int(p[1],16)
# a function split into chunks (pce-cgen.js) keeps a small dispatcher of its own
# name in the fixed page; only its chunks are packed into banks
split={k.split("_")[0] for k in sizes if "_c" in k}
for f in split: sizes.pop(f,None)
# the raster hook (pce-cgen.js marks it `/* HOT il_fn_N */`) runs 224 times a frame; a small one stays in the
# fixed page so that il_call reaches it with no bank switch.  BANK_PIN_HOT=0 turns this off (the build script
# does that when the fixed page is full).
if os.environ.get("BANK_PIN_HOT","1")!="0":
    for m in re.finditer(r"/\* HOT il_fn_(\d+) \*/",text):
        k=m.group(1)
        if k in sizes and sizes[k]<=int(os.environ.get("BANK_HOT_MAX","600")):
            sizes.pop(k); print("pinned in the fixed page: il_fn_"+k,file=sys.stderr)
# first-fit decreasing into 8 KiB banks; the sizes come from a non-LTO object, so
# leave 1 KiB for the difference to the LTO link
# (build-toyc-banked.sh retries with more slack if the link overflows)
edges={}
use_affinity=os.environ.get("BANK_AFFINITY","1")!="0"
# Call affinity.  A direct call (IL_DIRECT) is a plain call only when caller and callee share a bank
# (or the callee is in the fixed page); across banks it falls back to il_call, ~500 cycles dearer.
# pce-cgen.js marks every direct call site `/* AFF caller callee weight */` (weight: how often the
# site runs per frame, relative).  Cluster greedily along the heaviest edges while a cluster still
# fits one bank (union-find, deterministic tie-breaks), then first-fit-decreasing the clusters.
# BANK_AFFINITY=0 packs by size alone, the way it was before (for the measurements).
for m in re.finditer(r"/\* AFF il_fn_(\d+(?:_c\d+)?) il_fn_(\d+(?:_c\d+)?) (\d+) \*/",text):
    a_,b_,w=m.group(1),m.group(2),int(m.group(3))
    if a_ in sizes and b_ in sizes and a_!=b_:
        k=(a_,b_) if a_<b_ else (b_,a_)
        edges[k]=edges.get(k,0)+w
    # the callee in the fixed page (a split function's dispatcher) is already free
def pack(slack):
    CAP=8192-slack
    banks=[]; assign={}
    parent={k:k for k in sizes}; csize=dict(sizes)
    def find(x):
        while parent[x]!=x:
            parent[x]=parent[parent[x]]; x=parent[x]
        return x
    for (a_,b_),w in sorted(edges.items() if use_affinity else [],key=lambda e:(-e[1],e[0])):
        ra,rb=find(a_),find(b_)
        if ra==rb: continue
        if csize[ra]+csize[rb]<=CAP:
            parent[rb]=ra; csize[ra]+=csize[rb]
    clusters={}
    for k in sorted(sizes): clusters.setdefault(find(k),[]).append(k)
    for root,members in sorted(clusters.items(),key=lambda c:(-sum(sizes[m] for m in c[1]),c[0])):
        total=sum(sizes[m] for m in members)
        if total>CAP and len(members)==1:   # a single oversized function: the SPLIT path below handles it
            banks.append(total); assign[members[0]]=len(banks); continue
        for b,used in enumerate(banks):
            if used+total<=CAP:
                banks[b]+=total
                for m in members: assign[m]=b+1
                break
        else:
            banks.append(total)
            for m in members: assign[m]=len(banks)
    tw=sum(edges.values()); sw=sum(w for (a_,b_),w in edges.items() if assign[a_]==assign[b_])
    return banks,assign,sw,tw
SLACK=int(os.environ.get("BANK_SLACK","1024"))
banks,assign,sw,tw=pack(SLACK)
# A game whose hot calls cross banks (NOVA TIDE: 55% of the call weight stayed in a bank, its draw()
# fills a bank and leaves no room for spr() and hide()) pays ~500 cycles a cross-bank call.  Below 90%
# try a smaller slack for the packing and keep the best share; a link that overflows is retried by
# build-toyc-banked.sh with BANK_SLACK set, which takes this path once only.  A game at 90% or more
# keeps its packing byte for byte.  BANK_SLACK_SEARCH=0 turns the search off.
if edges and use_affinity and sw*100<tw*90 and "BANK_SLACK" not in os.environ and os.environ.get("BANK_SLACK_SEARCH","1")!="0":
    best=(sw,SLACK,banks,assign,tw)
    for sl in (768,512,384,256):
        b2,a2,s2,t2=pack(sl)
        if s2>best[0]: best=(s2,sl,b2,a2,t2)
    sw,SLACK,banks,assign,tw=best
if edges:
    print("call affinity (%s): %d of %d edge weight is same-bank (%d%%), %d edges, slack %d"%("on" if use_affinity else "off",sw,tw,100*sw//max(tw,1),len(edges),SLACK),file=sys.stderr)
CAP=8192-SLACK
if os.environ.get("BANK_DEBUG"):
    for (a_,b_),w in sorted(edges.items(),key=lambda e:-e[1])[:12]:
        print("  edge %s %s weight %d, banks %s %s, sizes %d %d"%(a_,b_,w,assign[a_],assign[b_],sizes[a_],sizes[b_]),file=sys.stderr)
# physical bank numbers for the packed banks: 1, 2, 3, ... or, when the ROM
# keeps banks for the sound engine, BANK_IDS="1,5,6,..." (tools/build-toyc-banked.sh)
ids=[int(x) for x in os.environ.get("BANK_IDS","").split(",") if x] or list(range(1,200))
for k in assign: assign[k]=ids[assign[k]-1]
print("banks used",len(banks),"fill",banks,file=sys.stderr)
big=sorted(int(k) for k,v in sizes.items() if v>CAP and "_" not in k)
if big:
    print("SPLIT "+",".join(map(str,big)))
    sys.exit(4)   # the caller re-emits with those functions split (PCE_SPLIT_ONLY)
if max(sizes.values())>CAP: sys.exit("a chunk is larger than one bank: %d B"%max(sizes.values()))
# 1. section attribute on each forward declaration
def decl(m):
    k=m.group(1)
    if k not in assign: return m.group(0)
    return m.group(0).replace("__attribute__((noinline))","__attribute__((noinline, section(\".rom_bank%d\")))"%assign[k])
text=re.sub(r"^static int(?:32|16)_t il_fn_(\d+(?:_c\d+)?)\((?:struct il_closure \*cl)[^;]*\) __attribute__\(\(noinline\)\);",decl,text,flags=re.M)
# 2. il_call: every case maps its bank around the call
nfn_all=max([int(x) for x in re.findall(r"^  case (\d+): return il_fn_\1\(",text,flags=re.M)]+[0])+1
bank_table="\n".join("#define IL_BANK_il_fn_%s %d"%(k,b) for k,b in sorted(assign.items()))+"\n"
bank_table+="".join("#define IL_BANK_il_fn_%d 0\n"%i for i in range(nfn_all) if str(i) not in assign)
bank_table+="#define IL_BANK_none 255\n"
helper='''
/* bank prototype: switched code lives in .rom_bankN, mapped at page 6 ($C000). */
static uint8_t il_bank = 0;
static inline __attribute__((always_inline)) void il_map(uint8_t b) {
  __asm__ volatile("tam #$40" :: "a"(b) : "memory");
}
#undef IL_DIRECT
/* A direct call (pce-cgen.js resolves the callee at compile time).  A callee in the fixed page
 * (IL_BANK 0) or in the caller's own bank is called as it is.  Any other callee goes through il_call,
 * which lives in the fixed page: a bank switch must not run from inside the banked code it swaps out
 * (measured: direct cross-bank switches crashed TOWER), and a stub per callee costs the fixed page
 * about 70 bytes each, which NOVA TIDE has not got.  A chunk caller (IL_BANK_none, 255) always
 * takes il_call. */
#define IL_DIRECT(caller, callee, cid, ...) ((IL_BANK_il_fn_##callee == 0 || IL_BANK_il_fn_##callee == IL_BANK_##caller) ? il_fn_##callee(&il_closures[cid], __VA_ARGS__) : il_call(cid, __VA_ARGS__))
#undef IL_CHUNK_CALL
#define IL_CHUNK_CALL(sym, e) ({ uint8_t o__ = il_bank; int16_t v__; il_bank = IL_BANK_##sym; il_map(IL_BANK_##sym); v__ = (e); il_bank = o__; il_map(o__); v__; })
'''
# the argument list of il_call depends on the toy (callArgs in pce-cgen.js): match it, do not assume four
m_call=re.search(r"^static int32_t il_call\([^)]*\) __attribute__\(\(noinline\)\);",text,flags=re.M)
if not m_call: sys.exit("il_call's declaration not found in "+src)
text=text.replace(m_call.group(0),bank_table+helper+m_call.group(0),1)
# one table gives each function's bank (0: it is in the fixed page, nothing to map), and the
# switch holds only the calls, so the map/unmap code is in il_call once, not in every case
nfn=max([int(x) for x in re.findall(r"^  case (\d+): return il_fn_\1\(",text,flags=re.M)]+[0])+1
bank_of=[assign.get(str(i),0) for i in range(nfn)]
def case(m):
    return "  case %s: rv = il_fn_%s(&il_closures[cv]%s); break;"%(m.group(1),m.group(1),m.group(2))
text,ncase=re.subn(r"^  case (\d+): return il_fn_\1\(&il_closures\[cv\]((?:, a\d)*)\);",case,text,flags=re.M)
if ncase==0: sys.exit("no il_call cases found in "+src)
old_head="  fid = il_closures[cv].fid;\n  switch (fid) {\n"
if old_head not in text: sys.exit("il_call's switch head not found in "+src)
text=text.replace(old_head,"  uint8_t o = il_bank, b = 0;\n  int32_t rv = 0;\n  fid = il_closures[cv].fid;\n  if (fid >= 0 && fid < %d) b = il_bank_of[fid];\n  if (b) { il_bank = b; il_map(b); }\n  switch (fid) {\n"%nfn,1)
old_tail="  default: return 0;\n  }\n}"
if old_tail not in text: sys.exit("il_call's switch tail not found in "+src)
text=text.replace(old_tail,"  default: break;\n  }\n  if (b) { il_bank = o; il_map(o); }\n  return rv;\n}",1)
text=text.replace(m_call.group(0),"static const uint8_t il_bank_of[%d] = {%s};\n"%(nfn,",".join(map(str,bank_of)))+m_call.group(0),1)
# 3. the direct boot call
if "0" in assign:
    boot=re.compile(r"\(void\)il_fn_0\(&il_closures\[0\][^;]*\);")
    text,nb=boot.subn(lambda m:"il_bank = %d; il_map(%d); %s il_bank = 0; il_map(0);"%(assign["0"],assign["0"],m.group(0)),text,count=1)
    if nb!=1: sys.exit("the boot call of il_fn_0 not found in "+src)
open(out,"w").write(text)
print("BANKS "+" ".join(str(ids[i]) for i in range(len(banks))))
