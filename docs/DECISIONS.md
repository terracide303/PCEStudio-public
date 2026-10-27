# Decisions

**Dated, with the reason. A decision without its reason gets re-litigated.**
Record reversals too — they are the most useful kind of entry.

## 2026-10-27 — project started
Kind: software. Nothing else decided yet.

## 2026-10-27 — what PCEStudio is (Dennis)

"Like ppu.toys, an AI dev studio that can port to a real PC Engine / TurboGrafx." So: pictures (and later effects)
made in the browser strictly by the HuC6270/HuC6260 rules; an AI that helps make them (#24); and an export that
runs on real hardware, Japanese and American (#25 for the TurboGrafx's reversed data lines).

## 2026-10-27 — our own hardware model; open-source emulators are references (Dennis)

The VDC, VCE and PSG model in the browser is **our own**, built from the Hudson manuals and what PCEHeroTN taught
us about the real chips: it can say exactly why something will or will not work on a real console, which is the
point of the studio. The open-source emulators (Mednafen, Geargrafx and others) are **references and checks**:
compare pixel for pixel and by ear, look up behaviour. Their code is not built into PCEStudio, so its licence stays
ours. Where the model and an emulator disagree, the manuals and a real console decide.

## 2026-10-27 — DeepSeek first; Claude sparingly until Saturday 2026-10-31 (Dennis)

Work autonomously. **Claude's credits are low until Saturday 2026-10-31**: build cards go to DeepSeek (`ds-pro` for
the hardware model and the 6280 viewer, `ds-flash` for the rest); Claude seats only for what DeepSeek cannot do,
for review (a different AI than the builder), and for an escalation after DeepSeek failed a card twice. Workshop
keeps its own sessions short. **DeepSeek is prepaid**: check `../workshop/agents.py balance` before a run; when it
is empty, stop and tell Dennis, who tops it up.

