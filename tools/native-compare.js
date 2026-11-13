#!/usr/bin/env node
/*
 * tools/native-compare.js — does a natively compiled (IL -> C -> llvm-mos)
 * toy ROM draw the browser's picture?  Compiler step 1.
 *
 *   node tools/native-compare.js ROM.pce toys/NAME/main.lua OUTDIR [FRAMES]
 *
 * Runs the ROM in Mednafen (windowless), records the movie, and checks that
 * one of its last 12 frames is pixel-identical (diff 0) to one of the
 * browser's first FRAMES (default 60) frames of the same toy.  Prints
 * how many captured frames were lit and the match.  Machinery copied from
 * tests/check-export-games.js (the same capture and compare).
 */
"use strict";
const fs=require("fs"),path=require("path"),zlib=require("zlib"),{spawn,spawnSync}=require("child_process");
const ROOT=path.join(__dirname,"..");
const MEDNAFEN="/opt/homebrew/bin/mednafen";
const MOVFRAMES=path.join(ROOT,"tools","movframes.py");
const toys=require(ROOT+"/renderer/pce-toys.js");
const BROWSER_FRAMES=60,CAPTURE_TAIL=12;
function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function captureFrames(romPath, outDir, sleepMs, tailOnly) {
  const movie = path.join(outDir, "capture.mov");
  const home = path.join(outDir, "home");
  fs.mkdirSync(path.join(home, "mcs"), { recursive: true });
  const env = Object.assign({}, process.env, {
    MEDNAFEN_HOME: home,
    SDL_VIDEODRIVER: "dummy",
    SDL_AUDIODRIVER: "dummy"
  });
  const args = [
    "-force_module", "pce", "-sound", "0", "-autosave", "1",
    "-pce.slstart", "3", "-pce.slend", "234",
    "-pce.xscale", "1", "-pce.yscale", "1",
    "-qtrecord", movie, "-qtrecord.vcodec", "png",
    "-qtrecord.w_double_threshold", "0",
    "-qtrecord.h_double_threshold", "0",
    romPath
  ];
  const child = spawn(MEDNAFEN, args, { env: env,
                                        stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  child.stderr.on("data", function (d) { log += d; });
  /* boot, OSD fade, a run of frames; a toy whose one-time build outlasts
   * the default is captured at its pin's length instead (GAME_PINS). */
  await sleep(sleepMs || 5500);
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill("SIGINT"); } catch (e) { /* already gone */ }
  }
  const deadline = Date.now() + 30000;
  while (child.exitCode === null && child.signalCode === null &&
         Date.now() < deadline) {
    await sleep(100);
  }
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill("SIGKILL"); } catch (e) { /* already gone */ }
    return { error: "Mednafen did not stop; log tail: " +
                    log.trim().split("\n").slice(-2).join(" | ") };
  }
  if (!fs.existsSync(movie) || !fs.statSync(movie).size) {
    return { error: "Mednafen recorded no movie; log tail: " +
                    log.trim().split("\n").slice(-2).join(" | ") };
  }
  const frames = path.join(outDir, "frames");
  const m = spawnSync("python3",
    ["-I", MOVFRAMES, movie, tailOnly ? "--tail" : "--all",
     ...(tailOnly ? [String(CAPTURE_TAIL)] : []), frames, "256", "224", "4"],
    { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  if (m.status !== 0) {
    return { error: "movframes.py failed: " +
                    (m.stderr || m.stdout || "").trim() };
  }
  const files = fs.readdirSync(frames)
    .filter(function (f) { return /^frame\d+\.png$/.test(f); }).sort();
  if (!files.length) return { error: "the movie held no complete PNG frame" };
  return { frames: frames, files: files };
}

/* ---- a minimal PNG reader (8-bit RGB, non-interlaced) ------------------ */

function decodePng(buf) {
  if (buf.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n") {
    throw new Error("not a PNG");
  }
  let pos = 8, width = 0, height = 0, bitDepth = 0, colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString("latin1");
    const body = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      bitDepth = body[8]; colourType = body[9];
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  if (bitDepth !== 8 || colourType !== 2) {
    throw new Error("PNG must be 8-bit RGB");
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const out = Buffer.alloc(width * height * 3);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.slice(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? line[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      line[i] = v;
    }
    out.set(line, y * stride);
    prev = line;
  }
  return { width: width, height: height, pixels: out };
}

function diff(a, b) {
  const n = Math.min(a.length, b.length);
  let count = 0;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) count++;
  return count;
}

/* The first row where two pictures differ (1-based), or 0. */
function firstDifferingLine(a, b, width) {
  const row = width * 3;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += row) {
    const end = Math.min(i + row, n);
    for (let k = i; k < end; k++) if (a[k] !== b[k]) return i / row + 1;
  }
  return 0;
}

function sampleHash(pixels) {
  let h = 2166136261;
  for (let i = 0; i < pixels.length; i += 97) {
    h = ((h ^ pixels[i]) * 16777619) >>> 0;
  }
  return h;
}

/* The browser's run of the same toy: the first `count` frames (60 by
 * default).  A game with a long one-time build may be captured hundreds of
 * toy frames in, so its pin asks for a wider window (TOWER: 600). */
function browserFrames(toyPath, count) {
  const source = fs.readFileSync(path.resolve(ROOT, toyPath), "utf8");
  /* the toy folder's art files, as the studio hands them to the runtime */
  const dir = path.dirname(path.resolve(ROOT, toyPath));
  const files = ["tiles.json", "palettes.json", "sprites.json"]
    .filter((n) => fs.existsSync(path.join(dir, n)))
    .map((n) => ({ name: n, source: fs.readFileSync(path.join(dir, n), "utf8") }));
  const songFiles = ["song.json", "songs.json"].filter((n) => fs.existsSync(path.join(dir, n)))
    .map((n) => ({ name: n, source: fs.readFileSync(path.join(dir, n), "utf8") }));
  const options = { budgetMs: 2000 };
  if (files.length) options.files = files;
  if (songFiles.length) options.songs = require("./../renderer/pce-seq.js").songsFromFiles(songFiles);
  const browser = toys.create(source, options);
  browser.load();
  const frames = [];
  const n = count || BROWSER_FRAMES;
  for (let f = 0; f < n; f++) {
    const g = browser.frame(f);
    frames.push({ pixels: g.pixels, hash: sampleHash(g.pixels) });
  }
  browser.dispose();
  return frames;
}

/* Compare the capture's tail against the browser's frames.  Returns
 * { match: k, line: 0 } on diff 0, else { match: -1, line, best, diff }. */
function compareCapture(framesDir, files, want) {
  const tail = files.slice(-CAPTURE_TAIL);
  let best = { match: -1, line: 0, best: null, diff: Infinity, file: null };
  for (const file of tail) {
    const img = decodePng(fs.readFileSync(path.join(framesDir, file)));
    for (let k = 0; k < want.length; k++) {
      const d = diff(img.pixels, want[k].pixels);
      if (d === 0) return { match: k, line: 0, file: file };
      if (d < best.diff) {
        best = { match: -1, file: file, best: k, diff: d,
                 line: firstDifferingLine(img.pixels, want[k].pixels,
                                          img.width) };
      }
    }
  }
  return best;
}

/* The captured frames that have any non-black pixel.  A game that builds
 * but does not play is pinned as an all-black screen: this is the
 * frame-by-frame assertion of that verdict, not a stand-in for a picture it
 * never drew.  An empty list is the verdict (DUSK RUN, #221). */
function notBlack(framesDir, files) {
  const lit = [];
  for (const file of files) {
    const img = decodePng(fs.readFileSync(path.join(framesDir, file)));
    let any = false;
    for (let i = 0; i < img.pixels.length; i++) {
      if (img.pixels[i] !== 0) { any = true; break; }
    }
    if (any) lit.push(file);
  }
  return lit;
}

(async()=>{
 const rom=process.argv[2],toy=process.argv[3],out=process.argv[4];
 fs.mkdirSync(out,{recursive:true});
 const cap=await captureFrames(rom,out,+process.env.CAPTURE_MS||9000,true);  /* CAPTURE_MS: a game with a long start-up needs longer */
 if(cap.error){console.log("ERR",cap.error);return;}
 const lit=notBlack(cap.frames,cap.files);
 const want=browserFrames(toy,+process.argv[5]||60);
 const r=compareCapture(cap.frames,cap.files,want);
 console.log("captured",cap.files.length,"lit",lit.length,"compare",JSON.stringify(r));
 if(r.match<0 && r.file){
  /* which picture rows differ from the closest browser frame: a few clustered rows
   * point at a timing difference (raster), a scattered picture at wrong data */
  const img=decodePng(fs.readFileSync(path.join(cap.frames,r.file)));
  const w=want[r.best].pixels, row=img.width*3, rows=[];
  for(let y=0;y<img.pixels.length/row;y++){let d=0;for(let k=y*row;k<(y+1)*row;k++)if(img.pixels[k]!==w[k])d++;if(d)rows.push(y);}
  const ranges=[];for(const y of rows){const l=ranges[ranges.length-1];if(l&&y===l[1]+1)l[1]=y;else ranges.push([y,y]);}
  /* a raster phase difference moves everything below the split by whole rows: try shifting the lower picture */
  {
    const out=[];
    for(const split of [24,32]) for(let sh=-3;sh<=3;sh++){
      let d=0;const H=img.pixels.length/row;
      for(let y=split;y<H;y++){const yy=y+sh; if(yy<0||yy>=H){continue;} for(let k=0;k<row;k++) if(img.pixels[y*row+k]!==w[yy*row+k]) d++;}
      for(let y=0;y<split;y++) for(let k=0;k<row;k++) if(img.pixels[y*row+k]!==w[y*row+k]) d++;
      out.push("split "+split+" shift "+sh+": "+d);
    }
    console.log("shift test (differing bytes, rows below the split compared one browser row apart):\n  "+out.join("\n  "));
  }
 console.log("differing rows:",rows.length,"in",ranges.length,"range(s):",ranges.slice(0,12).map(a=>a[0]===a[1]?a[0]:a[0]+"-"+a[1]).join(","));
 }
})();
