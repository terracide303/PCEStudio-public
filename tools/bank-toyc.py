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
# first-fit decreasing into 8 KiB banks; the sizes come from a non-LTO object, so
# leave 1 KiB for the difference to the LTO link
CAP=8192-int(os.environ.get("BANK_SLACK","1024"))   # build-toyc-banked.sh retries with more slack if the link overflows
banks=[]; assign={}
for fid,sz in sorted(sizes.items(),key=lambda x:-x[1]):  # fid is the symbol suffix, e.g. 7 or 39_c1
    for b,used in enumerate(banks):
        if used+sz<=CAP: banks[b]+=sz; assign[fid]=b+1; break
    else: banks.append(sz); assign[fid]=len(banks)
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
bank_table="\n".join("#define IL_BANK_il_fn_%s %d"%(k,b) for k,b in sorted(assign.items()))+"\n"
helper='''
/* bank prototype: switched code lives in .rom_bankN, mapped at page 6 ($C000). */
static uint8_t il_bank = 0;
static inline __attribute__((always_inline)) void il_map(uint8_t b) {
  __asm__ volatile("tam #$40" :: "a"(b) : "memory");
}
#undef IL_CHUNK_CALL
#define IL_CHUNK_CALL(sym, e) ({ uint8_t o__ = il_bank; int16_t v__; il_bank = IL_BANK_##sym; il_map(IL_BANK_##sym); v__ = (e); il_bank = o__; il_map(o__); v__; })
'''
# the argument list of il_call depends on the toy (callArgs in pce-cgen.js): match it, do not assume four
m_call=re.search(r"^static int32_t il_call\([^)]*\) __attribute__\(\(noinline\)\);",text,flags=re.M)
if not m_call: sys.exit("il_call's declaration not found in "+src)
text=text.replace(m_call.group(0),bank_table+helper+m_call.group(0),1)
def case(m):
    fid=int(m.group(1))
    if str(fid) not in assign:   # a split function's dispatcher is in the fixed page
        return m.group(0)
    b=assign[str(fid)]
    return "  case %d: { uint8_t o = il_bank; int32_t rv; il_bank = %d; il_map(%d); rv = il_fn_%d(&il_closures[cv]%s); il_bank = o; il_map(o); return rv; }"%(fid,b,b,fid,m.group(2))
text,ncase=re.subn(r"^  case (\d+): return il_fn_\1\(&il_closures\[cv\]((?:, a\d)*)\);",case,text,flags=re.M)
if ncase==0: sys.exit("no il_call cases found in "+src)
# 3. the direct boot call
if "0" in assign:
    boot=re.compile(r"\(void\)il_fn_0\(&il_closures\[0\][^;]*\);")
    text,nb=boot.subn(lambda m:"il_bank = %d; il_map(%d); %s il_bank = 0; il_map(0);"%(assign["0"],assign["0"],m.group(0)),text,count=1)
    if nb!=1: sys.exit("the boot call of il_fn_0 not found in "+src)
open(out,"w").write(text)
print("BANKS "+" ".join(str(ids[i]) for i in range(len(banks))))
