/**
 * Cloudflare Worker - Interactive Fiction Story Server
 * 
 * Runs Z-code version 3 games server-side using JSZM.
 * Provides a stateless HTTP interface for Kindle devices.
 */

// ============================================================================
// JSZM - JavaScript Z-Machine (Modified for Server-Side Execution)
// Based on https://github.com/DLehenbauer/jszm (Public Domain)
// ============================================================================

const JSZM_Version = { major: 2, minor: 0, subminor: 3, timestamp: Date.now() };

function JSZM(arr) {
  this.memInit = new Uint8Array(arr);
  if (this.memInit[0] != 3) throw new Error("Unsupported Z-code version. Only Version 3 is supported.");
  this.byteSwapped = !!(this.memInit[1] & 1);
  this.statusType = !!(this.memInit[1] & 2);
  this.serial = String.fromCharCode(...this.memInit.slice(18, 24));
  this.zorkid = (this.memInit[2] << (this.byteSwapped ? 0 : 8)) | (this.memInit[3] << (this.byteSwapped ? 8 : 0));
  this.seed = (Math.random() * 0xFFFFFFFF) >>> 0;
}

JSZM.prototype = {
  byteSwapped: false,
  constructor: JSZM,
  // Helper to get int16 from view
  get: function (x) { return this.view.getInt16(x, this.byteSwapped); },
  getu: function (x) { return this.view.getUint16(x, this.byteSwapped); },
  put: function (x, y) { return this.view.setInt16(x, y, this.byteSwapped); },
  putu: function (x, y) { return this.view.setUint16(x, y & 65535, this.byteSwapped); },

  // Decodes Z-text
  getText: function (addr) {
    var d, o = "", ps = 0, ts = 0, w, y;
    d = v => {
      if (ts == 3) { y = v << 5; ts = 4; }
      else if (ts == 4) { y += v; if (y == 13) o += "\n"; else if (y) o += String.fromCharCode(y); ts = ps; }
      else if (ts == 5) { o += this.getText(this.getu(this.fwords + (y + v) * 2) * 2); ts = ps; }
      else if (v == 0) { o += " "; }
      else if (v < 4) { ts = 5; y = (v - 1) * 32; }
      else if (v < 6) { if (!ts) ts = v - 3; else if (ts == v - 3) ps = ts; else ps = ts = 0; }
      else if (v == 6 && ts == 2) { ts = 3; }
      else { o += "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ*\n0123456789.,!?_#'\"/\\-:()"[ts * 26 + v - 6]; ts = ps; }
    };
    for (; ;) {
      w = this.getu(addr);
      addr += 2;
      d((w >> 10) & 31); d((w >> 5) & 31); d(w & 31);
      if (w & 32768) break;
    }
    this.endText = addr;
    return o;
  },

  // State Serialization
  // Modified to include RNG seed
  serialize: function (ds, cs, pc) {
    var i, j, e, ar, vi;
    e = this.getu(14); // PURBOT (start of dynamic memory)
    // Calculate size: Dynamic Mem + Header (8) + DS + CS structs + Seed (4)
    i = e + cs.reduce((p, c) => p + 2 * (c.ds.length + c.local.length) + 6, 0) + 2 * ds.length + 8 + 4;
    ar = new Uint8Array(i);
    ar.set(new Uint8Array(this.mem.buffer, 0, e));
    vi = new DataView(ar.buffer);
    vi.setUint32(e, pc);
    vi.setUint16(e + 4, cs.length);
    vi.setUint16(e + 6, ds.length);
    for (i = 0; i < ds.length; i++) vi.setInt16(e + i * 2 + 8, ds[i]);
    e += ds.length * 2 + 8;
    for (i = 0; i < cs.length; i++) {
      vi.setUint32(e, cs[i].pc);
      vi.setUint8(e, cs[i].local.length);
      vi.setUint16(e + 4, cs[i].ds.length);
      for (j = 0; j < cs[i].ds.length; j++) vi.setInt16(e + j * 2 + 6, cs[i].ds[j]);
      for (j = 0; j < cs[i].local.length; j++) vi.setInt16(e + cs[i].ds.length * 2 + j * 2 + 6, cs[i].local[j]);
      e += (cs[i].ds.length + cs[i].local.length) * 2 + 6;
    }
    // Append seed at end
    vi.setUint32(e, this.seed);
    return ar;
  },

  deserialize: function (ar) {
    var e, i, j, ds, cs, pc, vi, purbot;
    var g8, g16s, g16, g24, g32;
    // Helper readers
    g8 = () => ar[e++];
    g16s = () => (e += 2, vi.getInt16(e - 2));
    g16 = () => (e += 2, vi.getUint16(e - 2));
    g24 = () => (e += 3, vi.getUint32(e - 4) & 0xFFFFFF);
    g32 = () => (e += 4, vi.getUint32(e - 4));

    try {
      e = purbot = this.getu(14);
      vi = new DataView(ar.buffer);
      if (ar[2] != this.memInit[2] || ar[3] != this.memInit[3]) return null; // ZORKID check

      pc = g32();
      cs = new Array(g16());
      ds = Array.from({ length: g16() }, g16s);

      for (i = 0; i < cs.length; i++) {
        cs[i] = {};
        cs[i].local = new Int16Array(g8());
        cs[i].pc = g24();
        cs[i].ds = Array.from({ length: g16() }, g16s);
        for (j = 0; j < cs[i].local.length; j++) cs[i].local[j] = g16s();
      }

      this.mem.set(new Uint8Array(ar.buffer, 0, purbot));

      // Try reading seed (might fail if old save format, but we are new)
      if (e + 4 <= ar.length) {
        this.seed = vi.getUint32(e);
      }

      return [ds, cs, pc];
    } catch (e) {
      console.error("Deserialize failed", e);
      return null;
    }
  },

  // Output handling
  print: function* (text) {
    yield text;
  },

  genPrint: function* (text) {
    var x = this.get(16);
    if (x != this.savedFlags) {
      this.savedFlags = x;
      // Highlighting ignored for simpler text output
    }
    yield* this.print(text);
  },

  // Input handling logic (placeholder, overridden in run)
  read: function* (maxlen) { return ""; },

  // Vocabulary parsing
  parseVocab: function (s) {
    this.vocabulary = new Map();
    if (s === 0) {
      this.regBreak = new RegExp("[^ \\n\\t]+", "g");
      return;
    }
    var e, n;
    n = this.mem[s++];
    e = this.selfInsertingBreaks = String.fromCharCode(...this.mem.slice(s, s + n));
    e = e.split("").map(x => (x.toUpperCase() == x.toLowerCase() ? "" : "\\") + x).join("") + "]";
    this.regBreak = new RegExp("[" + e + "|[^ \\n\\t" + e + "+", "g");
    s += n;
    e = this.mem[s++];
    n = this.get(s);
    s += 2;
    while (n--) {
      this.vocabulary.set(this.getText(s), s);
      s += e;
    }
  },

  handleInput: function (str, t1, t2) {
    var i, br, w;
    str = str.toLowerCase().slice(0, this.mem[t1] - 1);
    for (i = 0; i < str.length; i++) this.mem[t1 + i + 1] = str.charCodeAt(i);
    this.mem[t1 + str.length + 1] = 0;

    // Lex
    w = x => (i = 0, x.split("").filter(y => (i += /[a-z]/.test(y) ? 1 : /[0-9.,!?_#'"\/\\:\-()]/.test(y) ? 2 : 4) < 7).join(""));
    br = JSON.parse("[" + str.replace(this.regBreak, (m, o) => ",[" + (m.length) + "," + (this.vocabulary.get(w(m)) || 0) + "," + (o + 1) + "]").slice(1) + "]");

    i = this.mem[t2 + 1] = br.length;
    while (i--) {
      this.putu(t2 + i * 4 + 2, br[i][1]);
      this.mem[t2 + i * 4 + 4] = br[i][0];
      this.mem[t2 + i * 4 + 5] = br[i][2];
    }
  },

  // Main Execution Loop
  // Accepts optional 'restoredState' to resume execution
  // Accepts optional 'input' to process for a READ instruction
  run: function* (restoredState, input) {
    var mem, pc, cs, ds, op0, op1, op2, op3, opc, inst, x, y, z;
    var globals, objects, fwords, defprop;
    var addr, fetch, flagset, init, move, opfetch, pcfetch, pcget, pcgetb, pcgetu, predicate, propfind, ret, store, xfetch, xstore;

    // Helpers
    addr = (x) => (x & 65535) << 1;
    fetch = (x) => {
      if (x == 0) return ds.pop();
      if (x < 16) return cs[0].local[x - 1];
      return this.get(globals + 2 * x);
    };
    flagset = () => {
      op3 = 1 << (15 & ~op1);
      op2 = objects + op0 * 9 + (op1 & 16 ? 2 : 0);
      opc = this.get(op2);
    };
    init = () => {
      mem = this.mem = new Uint8Array(this.memInit);
      this.view = new DataView(mem.buffer);
      mem[1] &= 3;
      if (this.isTandy) mem[1] |= 8;
      if (!this.updateStatusLine) mem[1] |= 16;
      if (this.screen && this.split) mem[1] |= 32;
      this.put(16, this.savedFlags || 0);
      if (!this.vocabulary) this.parseVocab(this.getu(8));
      defprop = this.getu(10) - 2;
      globals = this.getu(12) - 32;
      this.fwords = fwords = this.getu(24);
      cs = [];
      ds = [];
      pc = this.getu(6);
      objects = defprop + 55;
    };
    move = (x, y) => {
      var w, z;
      if (z = mem[objects + x * 9 + 4]) {
        if (mem[objects + z * 9 + 6] == x) mem[objects + z * 9 + 6] = mem[objects + x * 9 + 5];
        else {
          z = mem[objects + z * 9 + 6];
          while (z != x) { w = z; z = mem[objects + z * 9 + 5]; }
          mem[objects + w * 9 + 5] = mem[objects + x * 9 + 5];
        }
      }
      if (mem[objects + x * 9 + 4] = y) {
        mem[objects + x * 9 + 5] = mem[objects + y * 9 + 6];
        mem[objects + y * 9 + 6] = x;
      } else mem[objects + x * 9 + 5] = 0;
    };
    opfetch = (x, y) => {
      if ((x &= 3) == 3) return;
      opc = y;
      return [pcget, pcgetb, pcfetch][x]();
    };
    pcfetch = (x) => fetch(mem[pc++]);
    pcget = () => { pc += 2; return this.get(pc - 2); };
    pcgetb = () => mem[pc++];
    pcgetu = () => { pc += 2; return this.getu(pc - 2); };
    predicate = (p) => {
      var x = pcgetb();
      if (x & 128) p = !p;
      if (x & 64) x &= 63; else x = ((x & 63) << 8) | pcgetb();
      if (p) return;
      if (x == 0 || x == 1) return ret(x);
      if (x & 0x2000) x -= 0x4000;
      pc += x - 2;
    };
    propfind = () => {
      var z = this.getu(objects + op0 * 9 + 7);
      z += mem[z] * 2 + 1;
      while (mem[z]) {
        if ((mem[z] & 31) == op1) { op3 = z + 1; return true; }
        else z += (mem[z] >> 5) + 2;
      }
      op3 = 0;
      return false;
    };
    ret = (x) => {
      ds = cs[0].ds;
      pc = cs[0].pc;
      cs.shift();
      store(x);
    };
    store = (y) => {
      var x = pcgetb();
      if (x == 0) ds.push(y);
      else if (x < 16) cs[0].local[x - 1] = y;
      else this.put(globals + 2 * x, y);
    };
    xfetch = (x) => {
      if (x == 0) return ds[ds.length - 1];
      if (x < 16) return cs[0].local[x - 1];
      return this.get(globals + 2 * x);
    };
    xstore = (x, y) => {
      if (x == 0) ds[ds.length - 1] = y;
      else if (x < 16) cs[0].local[x - 1] = y;
      else this.put(globals + 2 * x, y);
    };

    // --- Initialization Strategy ---
    if (restoredState) {
      // Init memory/view first
      mem = this.mem;
      this.view = new DataView(mem.buffer);
      // Load state
      ds = restoredState[0];
      cs = restoredState[1];
      pc = restoredState[2];

      // Re-calculate derived values
      defprop = this.getu(10) - 2;
      globals = this.getu(12) - 32;
      this.fwords = fwords = this.getu(24);
      objects = defprop + 55;

      // If we lacked vocabulary (lazy init), ensure it's loaded
      if (!this.vocabulary) this.parseVocab(this.getu(8));

    } else {
      init();
      // Optional: yield* this.restarted(); if implemented
    }

    // --- Input Handling State ---
    let inputProcessed = false;

    // --- Main Loop ---
    main: for (; ;) {
      let instStart = pc; // Mark start of instruction for re-execution if input needed
      inst = pcgetb();

      // Decode Opcode
      if (inst < 128) { // 2OP
        if (inst & 64) op0 = pcfetch(); else op0 = pcgetb();
        if (inst & 32) op1 = pcfetch(); else op1 = pcgetb();
        inst &= 31;
        opc = 2;
      } else if (inst < 176) { // 1OP
        x = (inst >> 4) & 3;
        inst &= 143;
        if (x == 0) op0 = pcget();
        else if (x == 1) op0 = pcgetb();
        else if (x == 2) op0 = pcfetch();
      } else if (inst >= 192) { // EXT
        x = pcgetb();
        op0 = opfetch(x >> 6, 1);
        op1 = opfetch(x >> 4, 2);
        op2 = opfetch(x >> 2, 3);
        op3 = opfetch(x >> 0, 4);
        if (inst < 224) inst &= 31;
      }

      // Execute Opcode
      switch (inst) {
        case 1: predicate(op0 == op1 || (opc > 2 && op0 == op2) || (opc == 4 && op0 == op3)); break;
        case 2: predicate(op0 < op1); break;
        case 3: predicate(op0 > op1); break;
        case 4: xstore(op0, x = xfetch(op0) - 1); predicate(x < op1); break;
        case 5: xstore(op0, x = xfetch(op0) + 1); predicate(x > op1); break;
        case 6: predicate(mem[objects + op0 * 9 + 4] == op1); break;
        case 7: predicate((op0 & op1) == op1); break;
        case 8: store(op0 | op1); break;
        case 9: store(op0 & op1); break;
        case 10: flagset(); predicate(opc & op3); break;
        case 11: flagset(); this.put(op2, opc | op3); break;
        case 12: flagset(); this.put(op2, opc & ~op3); break;
        case 13: xstore(op0, op1); break;
        case 14: move(op0, op1); break;
        case 15: store(this.get((op0 + op1 * 2) & 65535)); break;
        case 16: store(mem[(op0 + op1) & 65535]); break;
        case 17: if (propfind()) store(mem[op3 - 1] & 32 ? this.get(op3) : mem[op3]); else store(this.get(defprop + 2 * op1)); break;
        case 18: propfind(); store(op3); break;
        case 19: if (op1) { propfind(); store(mem[op3 + (mem[op3 - 1] >> 5) + 1] & 31); } else { x = this.getu(objects + op0 * 9 + 7); store(mem[x + mem[x] * 2 + 1] & 31); } break;
        case 20: store(op0 + op1); break;
        case 21: store(op0 - op1); break;
        case 22: store(Math.imul(op0, op1)); break;
        case 23: store(Math.trunc(op0 / op1)); break;
        case 24: store(op0 % op1); break;
        case 128: predicate(!op0); break;
        case 129: store(x = mem[objects + op0 * 9 + 5]); predicate(x); break;
        case 130: store(x = mem[objects + op0 * 9 + 6]); predicate(x); break;
        case 131: store(mem[objects + op0 * 9 + 4]); break;
        case 132: store((mem[(op0 - 1) & 65535] >> 5) + 1); break;
        case 133: x = xfetch(op0); xstore(op0, x + 1); break;
        case 134: x = xfetch(op0); xstore(op0, x - 1); break;
        case 135: yield* this.genPrint(this.getText(op0 & 65535)); break;
        case 137: move(op0, 0); break;
        case 138: yield* this.genPrint(this.getText(this.getu(objects + op0 * 9 + 7) + 1)); break;
        case 139: ret(op0); break;
        case 140: pc += op0 - 2; break;
        case 141: yield* this.genPrint(this.getText(addr(op0))); break;
        case 142: store(xfetch(op0)); break;
        case 143: store(~op0); break;
        case 176: ret(1); break;
        case 177: ret(0); break;
        case 178: yield* this.genPrint(this.getText(pc)); pc = this.endText; break;
        case 179: yield* this.genPrint(this.getText(pc) + "\n"); ret(1); break;
        case 180: break; // NOOP

        // SAVE/RESTORE (Opcode 181/182) - Simple implementation or no-op/fail for now
        // A true implementation would need to hook into the outer KV store, primarily handled by the browser context usually.
        case 181: store(0); break; // SAVE failed
        case 182: store(0); break; // RESTORE failed

        case 183: init(); break; // RESTART
        case 184: ret(ds[ds.length - 1]); break;
        case 185: ds.pop(); break;
        case 186: return; // QUIT

        case 187: yield* this.genPrint("\n"); break;
        // USL (Update Status Line) - ignored for now
        case 188: break;
        case 189: predicate(this.verify()); break;

        case 224: // CALL
          if (op0) {
            x = mem[op0 = addr(op0)];
            cs.unshift({ ds: ds, pc: pc, local: new Int16Array(x) });
            ds = [];
            pc = op0 + 1;
            for (x = 0; x < mem[op0]; x++) cs[0].local[x] = pcget();
            if (opc > 1 && mem[op0] > 0) cs[0].local[0] = op1;
            if (opc > 2 && mem[op0] > 1) cs[0].local[1] = op2;
            if (opc > 3 && mem[op0] > 2) cs[0].local[2] = op3;
          } else {
            store(0);
          }
          break;
        case 225: this.put((op0 + op1 * 2) & 65535, op2); break;
        case 226: mem[(op0 + op1) & 65535] = op2; break;
        case 227: propfind(); if (mem[op3 - 1] & 32) this.put(op3, op2); else mem[op3] = op2; break;

        // READ (228) - CRITICAL FOR STATELESS SERVER
        case 228:
          // Flush any status line updates if we had them
          // this.handleInput(yield * this.read(mem[op0 & 65535]), op0 & 65535, op1 & 65535); 

          if (input !== null && input !== undefined && !inputProcessed) {
            // We have input from the request, consume it
            inputProcessed = true;
            this.handleInput(input, op0 & 65535, op1 & 65535);
          } else {
            // No input available OR we already processed input and hit ANOTHER read.
            // We must yield execution to wait for user content.
            // We yield a special object to the runner.
            yield { type: 'WAIT_FOR_INPUT', pc: instStart, ds: ds, cs: cs };
            return; // Suspend execution
          }
          break;

        case 229: yield* this.genPrint(op0 == 13 ? "\n" : op0 ? String.fromCharCode(op0) : ""); break;
        case 230: yield* this.genPrint(String(op0)); break;
        case 231: // RANDOM
          if (op0 <= 0) {
            if (op0 === 0) this.seed = (Math.random() * 0xFFFFFFFF) >>> 0;
            else this.seed = (op0 >>> 0);
            store(0);
            break;
          }
          this.seed = (1664525 * this.seed + 1013904223) >>> 0;
          store(Math.floor((this.seed / 0xFFFFFFFF) * op0) + 1);
          break;
        case 232: ds.push(op0); break;
        case 233: xstore(op0, ds.pop()); break;
        case 234: if (this.split) yield* this.split(op0); break;
        case 235: if (this.screen) yield* this.screen(op0); break;
        default: break; // Unknown opcode, ignore
      }
    }
  }
};


// ============================================================================
// Worker Implementation
// ============================================================================

const ALLOWED_ORIGINS = [
  'https://beta.rekindle.pages.dev',
  'https://rekindle.ink'
];

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function generateId() {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 12);
}

// Generate the game HTML page
function renderGamePage(gameId, output, location, score, moves, error = null) {
  const escapedOutput = (output || ''); // Output is already HTML-safe or contains HTML tags we want to preserve?
  // Wait, if output comes from Z-machine text decoder, it has \n. We replace \n with <br>.
  // But if we store the *accumulated* HTML in KV, we shouldn't double-escape.
  // Strategy: The 'output' arg is now the FULL LOG (HTML). 

  // Note: We need to handle the new output vs old history.
  // For simplicity, let's assume 'output' passed here is the COMPLETE HTML transcript.

  // We rely on the caller to format the output as HTML before passing it in, or we handle simple text transforms.
  // The output passed here will be the full history log designated as innerHTML.
  const content = output || '';

  const escapedLocation = (location || 'Unknown')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Interactive Fiction</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: Georgia, serif;
      max-width: 100%;
      margin: 0;
      padding: 10px;
      background: #fff;
      color: #000;
      font-size: 16px;
      line-height: 1.5;
    }
    #status {
      background: #000;
      color: #fff;
      padding: 8px 12px;
      display: flex;
      justify-content: space-between;
      font-family: sans-serif;
      font-size: 0.85rem;
      margin-bottom: 15px;
    }
    #output {
      margin-bottom: 15px;
      min-height: 100px;
    }
    #input-form {
      display: flex;
      gap: 8px;
    }
    #cmd {
      flex-grow: 1;
      padding: 12px;
      font-size: 16px;
      font-family: inherit;
      border: 2px solid #000;
    }
    button {
      padding: 12px 20px;
      font-size: 16px;
      background: #000;
      color: #fff;
      border: none;
      cursor: pointer;
      font-weight: bold;
    }
    .error {
      color: red;
      font-weight: bold;
    }
    
    /* Quick Actions Bar */
    #quick-actions {
      display: flex;
      flex-wrap: wrap; /* Allow 2 lines */
      /* Kindle Legacy WebKit support: gap often fails, use margins */
      padding-bottom: 10px;
      margin-bottom: 5px;
      width: 100%; 
    }
    .action-btn {
      flex: 1 0 auto; /* Grow to fill space equally */
      margin-right: 8px; /* Fallback for gap */
      margin-bottom: 8px; /* Spacing for second line */
      padding: 8px 10px; /* Reduced side padding slightly as width handles layout */
      background: #ffffff; /* Explicit White Background */
      color: #000000;      /* Explicit Black Text */
      border: 2px solid #000000;
      font-size: 1rem;     /* Slightly larger for touch */
      font-family: sans-serif;
      font-weight: bold;
      cursor: pointer;
      border-radius: 4px;  /* Soften edges slightly */
      text-align: center;
    }
    .action-btn.clear-btn {
        background: #000000;
        color: #ffffff;
        margin-left: auto; /* Push to right if space permits, or just standard flow */
    }
    .action-btn:active {
      transform: translateY(2px);
    }
    
    /* Sticky Controls Area */
    #controls-area {
        position: sticky;
        bottom: 0;
        left: 0;
        width: 100%;
        background: #ffffff;
        border-top: 2px solid #000;
        padding: 10px 0;
        z-index: 100;
        box-shadow: 0 -4px 10px rgba(0,0,0,0.1); /* Subtle shadow implies overlay */
    }
    
    /* Ensure content isn't hidden behind sticky footer */
    body {
        padding-bottom: 0; /* Handled by spacer or intrinsic flow if sticky */
    }
  </style>
</head>
<body>
  <div id="status">
    <span>${escapedLocation}</span>
    <!-- Simple Score/Moves disabled for generic Z3 without checking globals -->
    <!-- <span>Score: ${score || 0} Moves: ${moves || 0}</span> -->
  </div>
  
  <div id="output">
    ${error ? `<p class="error">${error}</p>` : ''}
    ${content}
  </div>
  
  <!-- Container for sticky elements -->
  <div id="controls-area">
      <div id="quick-actions">
        <!-- onmousedown="event.preventDefault()" prevents the button from stealing focus, keeping the keyboard open -->
        <button class="action-btn" onmousedown="event.preventDefault()" onclick="appendCmd('Look')">Look</button>
        <button class="action-btn" onmousedown="event.preventDefault()" onclick="appendCmd('Inventory')">Inventory</button>
        <button class="action-btn" onmousedown="event.preventDefault()" onclick="appendCmd('North')">North</button>
        <button class="action-btn" onmousedown="event.preventDefault()" onclick="appendCmd('South')">South</button>
        <button class="action-btn" onmousedown="event.preventDefault()" onclick="appendCmd('East')">East</button>
        <button class="action-btn" onmousedown="event.preventDefault()" onclick="appendCmd('West')">West</button>
        <button class="action-btn" onmousedown="event.preventDefault()" onclick="appendCmd('Up')">Up</button>
        <button class="action-btn" onmousedown="event.preventDefault()" onclick="appendCmd('Down')">Down</button>
        <button class="action-btn" onmousedown="event.preventDefault()" onclick="appendCmd('Wait')">Wait</button>
        <button class="action-btn" onmousedown="event.preventDefault()" onclick="appendCmd('Undo')">Undo</button>
        <button class="action-btn" onmousedown="event.preventDefault()" onclick="appendCmd('Help')">Help</button>
        <button class="action-btn clear-btn" onmousedown="event.preventDefault()" onclick="clearCmd()">Clear</button>
      </div>

      <form id="input-form" method="POST" action="/play/${gameId}">
        <input type="text" id="cmd" name="cmd" placeholder="What do you want to do?" autocomplete="off">
        <button type="submit">Go</button>
      </form>
  </div>
  
  <script>
    const cmdInput = document.getElementById('cmd');
    
    function scrollToBottom() {
       window.scrollTo(0, document.body.scrollHeight);
    }
    
    // Additive logic: append word
    function appendCmd(word) {
        const current = cmdInput.value;
        if (current.length > 0 && !current.endsWith(' ')) {
            cmdInput.value = current + ' ' + word;
        } else {
            cmdInput.value = current + word;
        }
        // cmdInput.focus(); // Disable auto-focus
    }
    
    function clearCmd() {
        cmdInput.value = '';
        // cmdInput.focus(); // Disable auto-focus
    }

    // AJAX Submission to prevent keyboard flicker
    document.getElementById('input-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const val = cmdInput.value;
        
        // Immediate UI feedback? Keep it simple for now to avoid desync.
        // But we DO want to clear the input so user feels it "sent".
        cmdInput.value = ''; 
        
        try {
            const formData = new FormData();
            formData.append('cmd', val);
            
            const response = await fetch(e.target.action, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) throw new Error("Network error");
            
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Diff/Update DOM
            const newOutput = doc.getElementById('output').innerHTML;
            const newStatus = doc.getElementById('status').innerHTML;
            
            document.getElementById('output').innerHTML = newOutput;
            document.getElementById('status').innerHTML = newStatus;
            
            scrollToBottom();
            
        } catch (err) {
            console.error("AJAX failed, falling back", err);
            // Restore value and do normal submit
            cmdInput.value = val;
            e.target.submit();
        }
    });

    // Keep focus on input
    // cmdInput.focus(); // Disable auto-focus on load
    
    // Smart Scroll:
    // Scroll to bottom explicitly
    scrollToBottom();
    
    // Fix for Kindle Keyboard:
    // When keyboard opens, viewport shrinks. We need to scroll down again.
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scrollToBottom);
    } else {
        window.addEventListener('resize', scrollToBottom);
    }
    
    // Also scroll when input is focused/clicked (sometimes needed if keyboard was closed)
    cmdInput.addEventListener('focus', scrollToBottom);
    cmdInput.addEventListener('click', scrollToBottom);
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: getCorsHeaders(request) });
    }

    // ========================================================================
    // POST /upload
    // ========================================================================
    if (request.method === 'POST' && url.pathname === '/upload') {
      // (Unchanged from original code)
      // Retrieves base64 data, decodes, checks version, stores to KV
      try {
        const { data, filename } = await request.json();
        if (!data) return new Response('Missing data', { status: 400 });

        const id = generateId();
        let base64Data = data;
        if (data.includes(',')) base64Data = data.split(',')[1];

        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

        if (bytes[0] < 1 || bytes[0] > 3) {
          return new Response(JSON.stringify({ error: `Unsupported Z-code version ${bytes[0]}. Only versions 1-3 implemented.` }), {
            status: 400, headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' }
          });
        }

        await env.STORIES.put(`game:${id}`, bytes.buffer);

        return new Response(JSON.stringify({
          url: `${url.origin}/play/${id}`,
          id: id
        }), { headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' } });

      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: getCorsHeaders(request) });
      }
    }

    // ========================================================================
    // GET/POST /play/:id
    // ========================================================================
    if (url.pathname.startsWith('/play/')) {
      const id = url.pathname.replace('/play/', '');
      if (!id) return new Response('Game ID required', { status: 400 });

      // Load Game Code
      const gameData = await env.STORIES.get(`game:${id}`, { type: 'arrayBuffer' });
      if (!gameData) {
        return new Response(renderGamePage(id, '', '', 0, 0, 'Game not found / expired.'), {
          status: 404, headers: { 'Content-Type': 'text/html' }
        });
      }

      // Load User Input
      let cmd = null;
      if (request.method === 'POST') {
        const formData = await request.formData();
        cmd = formData.get('cmd');
      }

      const urlParams = new URL(request.url).searchParams;
      const isRestart = urlParams.get('restart') === 'true';

      // Load History Log
      const logKey = `log:${id}`;
      // Load Saved State
      const stateKey = `state:${id}`;

      if (isRestart) {
        // Clear previous state and log
        await env.STORIES.delete(logKey);
        await env.STORIES.delete(stateKey);
      }

      let historyLog = ""; // Initialize empty, will load if not restart
      if (!isRestart) {
        historyLog = await env.STORIES.get(logKey) || "";
      }

      // Load Saved State
      // We use a separate KV key for state: `state:{id}`
      // Note: In a real multi-user app, this would be `state:{id}:{userId}` or cookie-based.
      // For this simplified version (Kindle Owner specific), global ID state is acceptable if unique game IDs are used per session,
      // but to stop users overwriting each other if they share a link, we ideally want session cookies.
      // However, Kindle cookies are flaky. We'll stick to `state:{id}` and assume the ID is unique per upload (which it is).

      let savedStateBuffer = null; // Initialize null, will load if not restart
      if (!isRestart) {
        savedStateBuffer = await env.STORIES.get(stateKey, { type: 'arrayBuffer' });
      }
      let restoredState = null;

      const interpreter = new JSZM(gameData);

      if (savedStateBuffer) {
        restoredState = interpreter.deserialize(new Uint8Array(savedStateBuffer));
      }


      // --- FILTER LOGIC ---
      function filterRepeats(history, newText) {
        if (!history || !newText) return newText;

        // Strategy: 
        // 1. Look at the new text line by line.
        // 2. If the *start* of the new text matches the *most recent* block of history (conceptually), 
        //    or more simply, if the new text *begins* with lines that are already present in the history.
        // 3. However, history is HTML (with <br> and tags), newText is raw string from Z-machine.
        //    We need to be careful. 

        // Actually, the new output buffer is just text here. the history is HTML.
        // Let's strip tags from history for comparison? Expensive.
        // OR: We check if the *previous* turn output same content?
        // Game loops often print: "LOCATION\nDescription...\n> COMMAND\nLOCATION\nDescription..."
        // If we just moved, we want the description.
        // But some games print "STATUS LINE" every turn.

        // SIMPLE FILTER:
        // Split newText into paragraphs/lines.
        // If a paragraph/line ALREADY EXISTS in the history (loose check), suppress it?
        // No, that would hide "You are in a forest" if you revisit.

        // User request: "same block of text is sent at the top of each response... filtered after it is sent the first time"
        // This implies likely a status line.
        // Heuristic: If the First Line of output is identical to the First Line of the *Previous Turn's Output*, hide it.
        // But we don't store "Previous Turn Output" cleanly, just a blob of HTML.

        // Let's try:
        // Use a regex to find the last text block in history.

        // BETTER HEURISTIC (Safe):
        // If the new text STARTS with a block that is ALREADY at the very end of the history (before the prompt),
        // it duplication.
        // BUT, checking the *User Request* again: "repeated paragraphs are hidden in subsequent messages"
        // This sounds like a static header.

        // Implementation:
        // Store a set of "seen header lines" in state? No, stateless.
        // Scan history for the *exact same line*.

        const lines = newText.split('\n');
        let startIndex = 0;

        // We only filter the leading block. Once we print something, we stop filtering.
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.length < 3) continue; // Don't filter empty/short lines

          // Check if this line appears in history (robust check)
          // We replace HTML entities in check because history has them
          const escapedLine = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

          // If history contains this line, we *might* want to skip it.
          // BUT only if it's "at the top".
          if (history.includes(escapedLine)) {
            // Verify it's not a common word like "You can see:"
            // Allow skipping.
            startIndex = i + 1;
          } else {
            // Found a new line! Stop filtering.
            break;
          }
        }

        // Reconstruct
        if (startIndex > 0) {
          return lines.slice(startIndex).join('\n').trimStart();
        }
        return newText;
      }

      // --- EXECUTION ---
      let outputBuffer = "";

      try {
        // Run the interpreter
        // It yields strings (output) or objects (wait requests)
        for (const result of interpreter.run(restoredState, cmd)) {
          if (typeof result === 'string') {
            outputBuffer += result;
          } else if (result && result.type === 'WAIT_FOR_INPUT') {
            // Game pausing for input. Save State.
            // pc has been rewound to start of instruction by logic in run()
            const newState = interpreter.serialize(result.ds, result.cs, result.pc);
            await env.STORIES.put(stateKey, newState.buffer);
            break; // Stop execution, return response
          }
        }
      } catch (e) {
        console.error("Interpreter Error:", e);
        outputBuffer += `\n[System Error: ${e.message}]`;
      }


      // Filter Repetitive Headers
      // We do this BEFORE formatting to HTML, so we compare Clean Text vs (Implicitly checked) History
      outputBuffer = filterRepeats(historyLog, outputBuffer);

      // Format new output
      const formattedOutput = outputBuffer
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

      // Append to history
      if (formattedOutput) {
        if (cmd) {
          historyLog += `\n<div class="turn"><p><strong>&gt; ${cmd}</strong></p>${formattedOutput}</div>`;
        } else {
          // No command (e.g. start/load/resume), just append output without prompt
          historyLog += `\n<div class="turn">${formattedOutput}</div>`;
        }

        // Truncate to avoid exploding size (keep last 50k chars approx)
        if (historyLog.length > 50000) {
          historyLog = historyLog.substring(historyLog.length - 50000);
          // Try to find a clean tag break
          const tagIndex = historyLog.indexOf('<div class="turn">');
          if (tagIndex !== -1) historyLog = historyLog.substring(tagIndex);
        }
        await env.STORIES.put(logKey, historyLog);
      }

      return new Response(renderGamePage(id, historyLog, 'Interactive Reader', 0, 0), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Default
    return new Response('Not found', { status: 404 });
  }
};
