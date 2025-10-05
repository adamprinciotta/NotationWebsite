/* Combo Overlay – EDDIE Export Module (v1.0)
   Standalone module for converting recordings to EDDIE input format
   Depends on window.ComboOverlay API facade
*/
;(function() {
  'use strict';
  
  // ===== Robust Config Sanitization System =====
  const SYMBOL_ALIASES = {
    // case-insensitive logical names -> canonical HW names
    'dash': 'TriggerR', 'dash_btn': 'TriggerR', 'dashbutton': 'TriggerR',
    'dash_analog': 'TriggerR', 'dash_trigger': 'TriggerR',
    'd1': 'DpadDown', 'd2': 'DpadDown',
    's1': 'BtnB', 'l': 'BtnA', 'm': 'BtnY', 'h': 'BtnX',
    'parry': 'TriggerL', 'tag': 'BtnShoulderL',
    // controller variants
    'btntriggerr': 'TriggerR',
    'btntriggerl': 'TriggerL',
    'btnshoulderl': 'BtnShoulderL',
    'btnshoulderr': 'BtnShoulderR'
  };

  const HW_NAME_CANONICAL = {
    'BtnA': true, 'BtnB': true, 'BtnX': true, 'BtnY': true,
    'BtnBack': true, 'BtnStart': true,
    'BtnThumbL': true, 'BtnThumbR': true,
    'BtnShoulderL': true, 'BtnShoulderR': true,
    'TriggerL': true, 'TriggerR': true,
    'DpadUp': true, 'DpadDown': true, 'DpadLeft': true, 'DpadRight': true
  };

  const MACRO_SAFE = /^[\] \[\+\d]+$/; // digits, spaces, +, [ ]

  const DEFAULT_DIRS = {
    '1':'down_left','2':'down','3':'down_right',
    '4':'left','6':'right','7':'up_left','8':'up','9':'up_right'
  };

  function canonicalizeKey(k) {
    return (k || '').toString().trim();
  }

  function normalizeHwName(v, logger) {
    const raw = canonicalizeKey(v);
    if (HW_NAME_CANONICAL[raw]) return raw;

    const alias = SYMBOL_ALIASES[raw.toLowerCase()];
    if (alias && HW_NAME_CANONICAL[alias]) return alias;

    logger?.warn?.('[CONFIG] Unknown hardware name, falling back to BtnA:', raw);
    return 'BtnA';
  }

  function sanitizeSymbols(src, logger) {
    const out = {};
    if (src && typeof src === 'object') {
      for (const [k,v] of Object.entries(src)) {
        if (typeof v !== 'string') { logger?.warn?.('[CONFIG] Symbol value not string:', k); continue; }
        const key = canonicalizeKey(k);
        out[key] = normalizeHwName(v, logger);
        // Add tolerant duplicates for common case variants
        if (key.toLowerCase() === 'dash' && !out['DASH']) out['DASH'] = out[key];
        if (key.toLowerCase() === 'parry' && !out['PARRY']) out['PARRY'] = out[key];
        if (key.toLowerCase() === 'tag' && !out['TAG']) out['TAG'] = out[key];
      }
    }
    return out;
  }

  function sanitizeMacros(src, logger) {
    const out = {};
    if (src && typeof src === 'object') {
      for (const [k,v] of Object.entries(src)) {
        if (typeof v !== 'string' || !MACRO_SAFE.test(v)) {
          logger?.warn?.('[CONFIG] Dropping unsafe macro:', k);
          continue;
        }
        out[canonicalizeKey(k)] = v.trim().replace(/\s+/g,' ');
      }
    }
    // ensure defaults
    out['5'] ??= ']1[';
    out['QCF'] ??= '2 3 6';
    out['QCB'] ??= '2 1 4';
    out['DP']  ??= '6 2 3';
    out['HCF'] ??= '4 1 2 3 6';
    out['HCB'] ??= '6 3 2 1 4';
    return out;
  }

  function sanitizeDirections(src, logger) {
    const out = {};
    for (const d of ['1','2','3','4','6','7','8','9']) {
      const v = src?.[d];
      const dp = v?.Dpad;
      if (dp && DEFAULT_DIRS[d] === dp) {
        out[d] = { Dpad: dp };
      } else if (dp && dp.match(/^(up|down|left|right|up_left|up_right|down_left|down_right)$/)) {
        out[d] = { Dpad: dp };
      } else {
        out[d] = { Dpad: DEFAULT_DIRS[d] };
        if (v) logger?.warn?.('[CONFIG] Fixing invalid direction mapping for', d, '->', dp);
      }
    }
    return out;
  }

  function loadAndSanitizeConfig(raw, opts = {}) {
    const logger = opts?.logger ?? console;
    try {
      const FPS = typeof raw?.FPS === 'number' && raw.FPS > 0 ? raw.FPS : 60;
      const Symbols = sanitizeSymbols(raw?.Symbols, logger);
      const Macros  = sanitizeMacros(raw?.Macros, logger);
      const P1_directions = sanitizeDirections(raw?.P1_directions, logger);
      const P2_directions = sanitizeDirections(raw?.P2_directions, logger);
      return { FPS, Symbols, Macros, P1_directions, P2_directions };
    } catch (e) {
      logger?.error?.('[CONFIG] Fatal error loading config, using safe defaults:', e);
      // return safe minimal defaults
      return {
        FPS: 60,
        Symbols: { L:'BtnA', M:'BtnY', H:'BtnX', S1:'BtnB', Dash:'TriggerR', DASH:'TriggerR', Parry:'TriggerL', PARRY:'TriggerL', Tag:'BtnShoulderL', TAG:'BtnShoulderL', Select:'BtnBack', Start:'BtnStart' },
        Macros: { '5':']1[', QCF:'2 3 6', QCB:'2 1 4', DP:'6 2 3', HCF:'4 1 2 3 6', HCB:'6 3 2 1 4' },
        P1_directions: sanitizeDirections(undefined, logger),
        P2_directions: sanitizeDirections(undefined, logger)
      };
    }
  }

  // Safe initialization - create minimal stub if ComboOverlay doesn't exist
  if (typeof window.ComboOverlay === 'undefined') {
    window.ComboOverlay = {
      version: '13.8-stub',
      on: function() {},
      emit: function() {},
      setStatus: function(msg) { console.log('[EDDIE]', msg); },
      suppressHistory: false,
      rec: { mode: 'idle' }
    };
  }
  
  const CO = window.ComboOverlay;
  
  // EDDIE export namespace
  const eddie = {
    // 1) Build Eddie config from active profile
    makeConfigFromProfile: function(options = {}) {
      return this._makeConfigFromProfile(options);
    },
    
    // 2) Transform recorded script to EddieInput lines
    exportScript: function(options = {}) {
      return this._exportScript(options);
    },
    
    // 3) Utility: quantize ms -> frames
    msToFrames: function(ms, options = {}) {
      return this._msToFrames(ms, options);
    },
    
    // 4) Utility: normalize step data
    normalizeStep: function(step, context) {
      return this._normalizeStep(step, context);
    }
  };
  
  // Internal implementation
  eddie._msToFrames = function(ms, { fps = 60, round = 'nearest' } = {}) {
    const frames = ms * fps / 1000;
    switch (round) {
      case 'floor': return Math.floor(frames);
      case 'ceil': return Math.ceil(frames);
      case 'nearest': default: return Math.round(frames);
    }
  };
  
  eddie._normalizeStep = function(step, context = {}) {
    const result = {
      dirs: [],
      buttons: [],
      hold: {},
      tMs: step?.t ?? 0,
      dtMs: 0
    };
    if (!step) return result;

    const curr = Array.isArray(step.chipsHTML) ? step.chipsHTML : [];
    const prev = Array.isArray(context.prevStep?.chipsHTML) ? context.prevStep.chipsHTML : [];

    // Determine the "new chips" at this step:
    // - cumulative snapshot: new chips = curr.slice(prev.length)
    // - single-chip style: new chips = curr (length 0 or 1)
    let newChips;
    if (curr.length >= prev.length) {
      newChips = curr.slice(prev.length);
    } else {
      // (rare: if it shrank without a clear, treat as all chips "new" to avoid dropping)
      newChips = curr.slice();
    }

    for (const chipHTML of newChips) {
      this._parseChipHTML(chipHTML, result);
    }
    
    if (context.prevStep && context.prevStep.t !== undefined) {
      result.dtMs = result.tMs - context.prevStep.t;
    }
    
    return result;
  };
  
  // Parse a chip into semantic tokens {dirs:[], buttons:[], holdCandidate?:{button} }
  eddie._parseChipHTML = eddie._parseChipHTML; // keep your current parser

  // Utility: set equality
  eddie._setEq = function(a, b){ if(a.size !== b.size) return false; for(const x of a){ if(!b.has(x)) return false; } return true; };

  // From a cumulative snapshot pair (prev,curr), compute transitions
  eddie._diffSnapshot = function(prevArr, currArr){
    // Reuse your existing HTML parser to collect tokens for each array
    const prevTok = { dirs: new Set(), btns: new Set() };
    const currTok = { dirs: new Set(), btns: new Set() };

    const wrapParse = (arr, acc) => {
      for (const html of (arr||[])) {
        const tmp = { dirs:[], buttons:[], hold:{} };
        this._parseChipHTML(html, tmp);
        for (const d of tmp.dirs)    acc.dirs.add(d);
        for (const b of tmp.buttons) acc.btns.add(b);
      }
    };

    wrapParse(prevArr, prevTok);
    wrapParse(currArr, currTok);

    const startedDirs = [...currTok.dirs].filter(d => !prevTok.dirs.has(d));
    const endedDirs   = [...prevTok.dirs].filter(d => !currTok.dirs.has(d));
    const startedBtns = [...currTok.btns].filter(b => !prevTok.btns.has(b));
    const endedBtns   = [...prevTok.btns].filter(b => !currTok.btns.has(b));

    return { startedDirs, endedDirs, startedBtns, endedBtns, currTok, prevTok };
  };

  // Build a per-step timeline with absolute tMs and transitions
  eddie._buildTimeline = function(script){
    if (!Array.isArray(script) || !script.length) return [];
    let end = script.length - 1;
    while (end >= 0 && ((script[end]?.chipsHTML?.length || 0) === 0)) end--;
    const trimmed = end >= 0 ? script.slice(0, end + 1) : [];
    const rows = [];
    for (let i = 0; i < trimmed.length; i++) {
      const step = trimmed[i];
      const prev = i > 0 ? trimmed[i - 1] : null;
      const prevArr = prev?.chipsHTML || [];
      const currArr = step?.chipsHTML || [];
      const diff = this._diffSnapshot(prevArr, currArr);
      rows.push({
        i,
        tMs: step?.t ?? 0,
        dtMs: i > 0 ? (step.t - trimmed[i - 1].t) : 0,
        ...diff
      });
    }
    return rows;
  };

  // Look ahead to find when a token ends; returns {endIndex, durationMs}
  eddie._findHoldDuration = function(rows, startIndex, kind, token){
    const startT = rows[startIndex].tMs;
    for (let j=startIndex+1; j<rows.length; j++){
      const r = rows[j];
      if (kind==='dir'){
        // a direction "ends" if it's in endedDirs OR replaced by its opposite / different diagonal
        if (r.endedDirs.includes(token)) return { endIndex:j, durationMs: r.tMs - startT };
      } else {
        if (r.endedBtns.includes(token)) return { endIndex:j, durationMs: r.tMs - startT };
      }
    }
    // If never ends, treat as lasting until final timestamp
    const lastT = rows[rows.length-1]?.tMs ?? startT;
    return { endIndex: rows.length-1, durationMs: Math.max(0,lastT - startT) };
  };

  // From cumulative snapshots, return the *newly added chips* at this step.
  // If the overlay was cleared (curr shorter), we return [] (no chips added).
  eddie._newChipsAtStep = function(prevArr, currArr) {
    const prevLen = Array.isArray(prevArr) ? prevArr.length : 0;
    const currLen = Array.isArray(currArr) ? currArr.length : 0;
    if (currLen <= prevLen) return [];          // cleared or same length: nothing added
    return currArr.slice(prevLen);              // appended chips
  };
  
  // Helper to parse individual chip HTML
  eddie._parseChipHTML = function(html, result, buttonSet = null) {
    // result: { dirs:[], buttons:[], holdTokens:[] }
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const text = (temp.textContent || '').trim();

    // Initialize holdTokens array
    if (!result.holdTokens) result.holdTokens = [];

    // Extract ALL bracket tokens from text (including mixed like "236[L]")
    const bracketTokens = [];
    text.replace(/\[([A-Za-z0-9]+)\]|\]([A-Za-z0-9]+)\[/g, (m, openTok, closeTok) => {
      if (openTok) bracketTokens.push({ kind: 'open', token: openTok.toUpperCase() });
      else bracketTokens.push({ kind: 'close', token: closeTok.toUpperCase() });
      return m;
    });
    
    // Store bracket tokens for later processing
    result.holdTokens = bracketTokens;

    // Images → directions
    const dirMap = {
      // 8-way + diagonals (add your filenames here if different)
      'u':'8','up':'8','d':'2','down':'2','l':'4','left':'4','r':'6','right':'6',
      'ub':'7','ul':'7','uf':'9','ur':'9','db':'1','dl':'1','df':'3','dr':'3',
      'b':'4','back':'4','f':'6',
      // motions (stay as digit strings inside one *chip*)
      'qcf':'236','qcb':'214','dp':'623','hcf':'41236','hcb':'63214'
    };
    const images = temp.querySelectorAll('img.img');
    for (const img of images) {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';
      const filename = (src.split('/').pop() || alt).replace(/\.(png|svg|webp)$/i,'').toLowerCase();
      if (dirMap[filename]) {
        const digits = dirMap[filename].split('');
        for (const d of digits) result.dirs.push(d);
      }
    }
    
    // Buttons (text spans inside the chip) - use profile-aware button set
    const spans = temp.querySelectorAll('span');
    for (const span of spans) {
      let t = (span.textContent || '').trim().toUpperCase();
      if (!t) continue;

      // Remove bracket tokens from text for button detection
      t = t.replace(/\[[A-Za-z0-9]+\]|\][A-Za-z0-9]+\[/g, '').trim();
      if (!t) continue;

      // Chord like "L+M"
      if (t.includes('+')) {
        const parts = t.split('+').map(s => s.trim().toUpperCase());
        for (const p of parts) {
          if (buttonSet && buttonSet.has(p)) {
            result.buttons.push(p);
          }
        }
        continue;
      }
      
      // Single button - check against profile button set
      if (buttonSet && buttonSet.has(t)) {
        result.buttons.push(t);
        continue;
      }
      
      // Direction digit printed as text (e.g., "2", "6")
      if (/^[12346789]$/.test(t)) {
        result.dirs.push(t);
        continue;
      }
    }

    // Fallback: scan raw text for button tokens using profile button set
    if (buttonSet) {
      for (const btn of buttonSet) {
        const pattern = new RegExp(`\\b${btn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        if (pattern.test(text) && !result.buttons.includes(btn)) {
          result.buttons.push(btn);
        }
      }
    }
  };
  
  eddie._makeConfigFromProfile = function({ game = 'dbfz', side = 'P1', macrosPreset = 'default' } = {}) {
    // Get the current active profile from ComboOverlay
    const CO = window.ComboOverlay;
    let currentProfile = null;
    
    if (CO && CO.profiles && CO.activeProfile !== undefined) {
      currentProfile = CO.profiles[CO.activeProfile];
    }
    
    // Build a proper raw config from profile data
    const rawConfig = {
      FPS: currentProfile?.fps || 60,
      Symbols: {},
      Macros: currentProfile?.macros || {},
      P1_directions: currentProfile?.p1Directions || {},
      P2_directions: currentProfile?.p2Directions || {}
    };
    
    // Populate Symbols from profile button labels
    if (currentProfile && currentProfile.buttonLabels) {
      const controllerButtons = [
        'BtnA', 'BtnB', 'BtnX', 'BtnY',
        'BtnShoulderL', 'BtnShoulderR', 
        'BtnTriggerL', 'BtnTriggerR',
        'BtnBack', 'BtnStart',
        'BtnThumbL', 'BtnThumbR',
        'DpadUp', 'DpadDown', 'DpadLeft', 'DpadRight'
      ];
      
      for (let i = 0; i < Math.min(currentProfile.buttonLabels.length, 16); i++) {
        const label = currentProfile.buttonLabels[i];
        if (label && label.trim()) {
          rawConfig.Symbols[label.trim()] = controllerButtons[i] || `Btn${i}`;
        }
      }
    }
    
    // Add common system buttons
    rawConfig.Symbols['select'] = 'BtnBack';
    rawConfig.Symbols['start'] = 'BtnStart';
    
    // Use robust config sanitization
    const sanitizedConfig = loadAndSanitizeConfig(rawConfig, { logger: console });
    
    return sanitizedConfig;
  };
  
  // Helper to find which chip was added between steps
  eddie._findAddedIndex = function(prevStep, curStep) {
    const prev = prevStep?.chipsHTML || [];
    const cur = curStep?.chipsHTML || [];
    if (cur.length > prev.length) return cur.length - 1;
    // Fallback: find first position where HTML differs
    const n = Math.min(prev.length, cur.length);
    for (let i = 0; i < n; i++) {
      if (prev[i] !== cur[i]) return i;
    }
    return cur.length - 1; // best guess
  };

  // Prompt 3: Dynamic button set from profile
  eddie._getButtonSetFromProfile = function(CO) {
    try {
      const prof = CO.profiles?.[CO.activeProfile];
      const rows = prof?.buttonMap || prof?.buttons || [];
      const names = new Set();
      
      // Try buttonLabels first (most likely format)
      if (prof?.buttonLabels) {
        for (const label of prof.buttonLabels) {
          const lab = (label || '').trim();
          if (lab) names.add(lab.toUpperCase());
        }
      } else {
        // Fallback to buttonMap/buttons
        for (const row of rows) {
          const lab = (row?.label || row?.name || '').trim();
          if (lab) names.add(lab.toUpperCase());
        }
      }
      
      // Safe fallbacks
      ['L','M','H','S','S1','S2','TAG','PARRY','DASH','LP','MP','HP','LK','MK','HK','A1','A2'].forEach(x => names.add(x));
      return names;
    } catch(e) {
      return new Set(['L','M','H','S','S1','S2','TAG','PARRY','DASH','LP','MP','HP','LK','MK','HK','A1','A2']);
    }
  };

  // Normalize symbol names
  eddie._normalizeSymbol = function(s) {
    return String(s).trim().toUpperCase();
  };

  // Lint tokens for bracket matching
  eddie._lintTokens = function(tokens) {
    const open = new Set();
    for (const t of tokens) {
      const mOpen = t.match(/^\[([A-Za-z0-9]+)\]$/);
      const mClose = t.match(/^\]([A-Za-z0-9]+)\[$/);
      if (mOpen) open.add(mOpen[1].toUpperCase());
      else if (mClose) {
        const x = mClose[1].toUpperCase();
        if (!open.has(x)) return `Unmatched close for ${x}`;
        open.delete(x);
      }
    }
    return null;
  };
  
  // Tightened chip parsing + scoped motion chording
  function normLabel(s){
    return (s ?? '').toString().trim().replace(/\s+/g,' ').toUpperCase();
  }
  
  function makeAttackSet(CO){
    const s = new Set(['L','M','H','S','S1','S2','LP','MP','HP','LK','MK','HK','A1','A2']);
    const META_LABS = new Set(['DASH','TAG','PARRY','START','SELECT','L3','R3']);
    try {
      const prof = CO.profiles?.[CO.activeProfile];
      const rows = prof?.buttonMap || prof?.buttons || [];
      for (const row of rows){
        const lab = normLabel(row?.label || row?.name);
        if (lab && !META_LABS.has(lab)) s.add(lab);
      }
    } catch {}
    return s;
  }
  
  function makeMetaSet(){
    return new Set(['DASH','TAG','PARRY','START','SELECT','L3','R3']);
  }
  
  const KNOWN_MOTIONS = new Set(['236','214','623','421','41236','63214']);

  function sanitizeMotionDigits(dirs){
    // If a recognized motion ends the sequence, clamp to that motion
    const s = dirs.join('');
    const keys = Array.from(KNOWN_MOTIONS).sort((a,b)=>b.length-a.length);
    for (const k of keys){
      const i = s.lastIndexOf(k);
      if (i !== -1 && i + k.length === s.length) return k.split('');
    }
    return dirs;
  }

  function parseChipHTMLStrict(html, ATTACK_SET, META_SET){
    const out = { dirs: [], buttons: [], metas: [], holdStarts: [], holdEnds: [] };
    if (!html) return out;
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // 3a) explicit holds like [L] or ]L[
    const textAll = (temp.textContent || '').toString();
    // find bracket tokens exactly
    const holdStartMatches = textAll.match(/\[(L|M|H|S|S1|S2|LP|MP|HP|LK|MK|HK|A1|A2)\]/gi) || [];
    const holdEndMatches   = textAll.match(/\](L|M|H|S|S1|S2|LP|MP|HP|LK|MK|HK|A1|A2)\[/gi) || [];
    for (const m of holdStartMatches){ const b = normLabel(m.replace(/\[|\]/g,'')); if (ATTACK_SET.has(b)) out.holdStarts.push(b); }
    for (const m of holdEndMatches){ const b = normLabel(m.replace(/\]|\[/g,'')); if (ATTACK_SET.has(b)) out.holdEnds.push(b); }

    // 3b) directions from <img alt/src="...">
    const imgs = temp.querySelectorAll('img,img.img');
    for (const img of imgs){
      const src = (img.getAttribute('src') || '').split('/').pop().replace(/\.[a-z]+$/i,'');
      const alt = (img.getAttribute('alt') || '');
      const key = (src || alt || '').toLowerCase();
      const dirMap = {u:'8',d:'2',l:'4',r:'6',ub:'7',uf:'9',db:'1',df:'3',b:'4',f:'6',qcf:'236',qcb:'214',dp:'623',hcf:'41236',hcb:'63214','360':'412369874'};
      // Add DP motions
      const MOTION_ALIASES = {
        'dpf': '623',
        'dpb': '421',
        'dp': '623'
      };
      
      // Check motion aliases first
      if (MOTION_ALIASES[key]) {
        for (const d of MOTION_ALIASES[key].split('')) out.dirs.push(d);
      } else if (dirMap[key]){
        for (const d of dirMap[key].split('')) out.dirs.push(d);
      }
    }

    // 3c) button labels from role-annotated spans only (chip-local only)
    const btnSyms = new Set(['L','M','H','S','S1','S2','LP','MP','HP','LK','MK','HK','A1','A2','DASH','TAG','PARRY','START','SELECT','L3','R3']);
    const spans = temp.querySelectorAll('span[data-role="btn"]');
    const seen = new Set();
    function pushBtnRaw(raw){
      let u = normLabel(raw);
      if (u.startsWith('+')) u = u.slice(1).trim();
      if (!btnSyms.has(u)) return;
      if (seen.has(u)) return;
      seen.add(u);
      if (ATTACK_SET.has(u)) out.buttons.push(u);
      else if (META_SET.has(u)) out.metas.push(u);
    }
    // If this chip is a pure hold marker, do not also treat its spans as presses
    const isPureHoldChip = holdStartMatches.length || holdEndMatches.length;
    if (!isPureHoldChip){
      for (const sp of spans){
        const t = sp.textContent || '';
        if (t.includes('+')){ for (const part of t.split('+')) pushBtnRaw(part); }
        else { pushBtnRaw(t); }
      }
    }

    // 3d) final cleanup: unique dirs, buttons are already unique per chip
    out.dirs = out.dirs.filter((v,i,a)=>a.indexOf(v)===i);
    return out;
  }

  // Get button set from profile (legacy)
  eddie._getButtonSetFromProfile = function(CO) {
    try {
      const prof = CO.profiles?.[CO.activeProfile];
      const rows = prof?.buttonMap || prof?.buttons || [];
      const names = new Set();
      
      // Try buttonLabels first (most common format)
      if (prof?.buttonLabels) {
        for (const label of prof.buttonLabels) {
          const lab = (label || '').trim();
          if (lab) names.add(lab.toUpperCase());
        }
      } else {
        // Fallback to buttonMap/buttons
        for (const row of rows) {
          const lab = (row?.label || row?.name || '').trim();
          if (lab) names.add(lab.toUpperCase());
        }
      }
      
      // Common fallbacks
      ['L','M','H','S','S1','S2','TAG','PARRY','DASH','LP','MP','HP','LK','MK','HK','A1','A2'].forEach(x => names.add(x));
      return names;
    } catch(e) {
      return new Set(['L','M','H','S','S1','S2','TAG','PARRY','DASH','LP','MP','HP','LK','MK','HK','A1','A2']);
    }
  };

  eddie._exportScript = function(options = {}) {
    // Header + safe debug
    const gameConfigName = options.gameConfigName || options.game || 'marvel2';
    const side = options.side || 'P1';
    const debugMode = typeof location !== 'undefined' && location.search.includes('eddieDebug=1');

    const allTokens = [];
    function emit(tok, outputState){
      allTokens.push(tok);
      return eddie._addToOutput(tok, outputState);
    }
    
    const CO = window.ComboOverlay;
    if (!CO.rec || !CO.rec.script || !CO.rec.script.length) {
      return '# Eddie export: no recording available';
    }

    const config = this._makeConfigFromProfile({ game: options.game || 'dbfz', side });
    const script = CO.rec.script;

    // Trim trailing empty snapshots
    let end = script.length - 1;
    while (end >= 0 && ((script[end]?.chipsHTML?.length || 0) === 0)) end--;
    if (end < 0) {
      return `configs\\${gameConfigName}.json\n# Eddie export: ${options.game || gameConfigName} ${side}\n# Generated from Combo Overlay recording\n`;
    }

    // Token classification
    const ATTACK_SET = makeAttackSet(window.ComboOverlay);
    const META_SET = makeMetaSet();
    
    // Output accumulator
    let outputState = { output: '', currentLine: '', lineLength: 0, maxLineLength: 120 };

    // Header path
    outputState.output += `configs/${gameConfigName}.json\n`;
    outputState.output += `# Eddie export: ${options.game || gameConfigName} ${side}\n`;
    outputState.output += `# Generated from Combo Overlay recording\n`;

    // Optional lead-in
    const leadInMs = options.leadInMs || 0;
    const subtractLatencyMs = options.subtractLatencyMs || 0;
    const round = options.round || 'nearest';
    
    if (leadInMs > 0) {
      const f = this._msToFrames(Math.max(0, leadInMs - subtractLatencyMs), { fps: config.FPS, round });
      if (f > 0) emit(`W${f}`, outputState);
    }

    // State tracking
    let heldDir = null;
    const buttonHolds = new Set();
    let lastDirDigit = null; // Track last emitted direction digit

    // Main step loop with strict chip-local parsing
    for (let i = 0; i <= end; i++){
      const step = script[i];
      const stepEmitted = new Set(); // Track what's been emitted this step
      
      // WAIT before next action
      if (i > 0){
        const dtMs = Math.max(0, (script[i].t - script[i-1].t) - subtractLatencyMs);
        const frames = this._msToFrames(dtMs, { fps: config.FPS, round });
        if (frames > 0) emit(`W${frames}`, outputState);
      }

      if (debugMode) {
        console.log('[EDDIE][STEP]', i, {raw: step.chipsHTML});
      }

      // CLEAR step?
      if (!step.chipsHTML || step.chipsHTML.length === 0){
        // close states
        if (heldDir){ emit(`]${heldDir}[`, outputState); heldDir=null; }
        for (const b of Array.from(buttonHolds)){ emit(`]${b}[`, outputState); buttonHolds.delete(b); }
        lastDirDigit = null; // Reset direction state on clear
        continue;
      }

      // Process each chip atomically
      // track motion repetition inside this step
      let stepLastMotion = null;   // string like '236'
      
      for (let c = 0; c < step.chipsHTML.length; c++){
        const html = step.chipsHTML[c];
        const r = parseChipHTMLStrict(html, ATTACK_SET, META_SET);

        if (debugMode) {
          console.log('[EDDIE][PARSE]', {dirs: r.dirs, buttons: r.buttons, metas: r.metas, holdStarts: r.holdStarts, holdEnds: r.holdEnds});
        }

        // MOTION or SINGLE-DIR for this chip only
        const motionDirs = sanitizeMotionDigits(r.dirs);
        const isMotion   = motionDirs.length >= 2;

        // --- NEW: single-dir + attacks in the SAME chip => emit direct chords, NO dir-hold
        const attacks = r.buttons.filter(u => ATTACK_SET.has(u));
        const metas   = r.buttons.filter(u => META_SET.has(u));
        const loneDir = (motionDirs.length === 1);

        // 1) Emit direction-only changes (free directions between buttons)
        if (motionDirs.length > 0 && attacks.length === 0 && metas.length === 0) {
          const d = motionDirs[motionDirs.length - 1]; // Use the most recent direction
          if (d && d !== lastDirDigit && !stepEmitted.has(d)) {
            emit(d, outputState);
            stepEmitted.add(d);
            lastDirDigit = d;
          }
        }

        if (!isMotion && loneDir && attacks.length) {
          const dir = motionDirs[0];

          // Do NOT open a dir hold here. Emit chords directly.
          for (const a of attacks) {
            const chord = `${dir}+${a}`;
            if (!stepEmitted.has(chord)) {
              emit(chord, outputState);
              stepEmitted.add(chord);
              lastDirDigit = dir; // Update direction state for chords
            }
          }
          // metas print separately
          for (const m of metas) emit(m, outputState);

          // Do NOT modify heldDir in this branch
          continue; // proceed to next chip
        }

        if (debugMode) {
          console.log('[EDDIE][CHIP]', {
            stepIndex: i,
            chipIndex: c,
            html,
            parsed: r,
            motionDirs,
            isMotion,
            heldDir,
            stepLastMotion,
          });
        }

        // Direction-hold state (only on lone dir; never on motion frames)
        // Also: only if the chip has NO buttons (prevents [6] on f+H chips)
        if (!isMotion && motionDirs.length === 1 && r.buttons.length === 0) {
          const dir = motionDirs[0];

          // Optional: look-ahead suppression if the next chip starts a motion with the same head
          let nextStartsWithThis = false;
          if (c + 1 < step.chipsHTML.length) {
            const rNext = parseChipHTMLStrict(step.chipsHTML[c + 1], ATTACK_SET, META_SET);
            const nextMotion = sanitizeMotionDigits(rNext.dirs);
            nextStartsWithThis = (nextMotion.length >= 2 && nextMotion[0] === dir);
          }

          if (!nextStartsWithThis) {
            if (heldDir !== dir) {
              if (heldDir) emit(`]${heldDir}[`, outputState);
              emit(`[${dir}]`, outputState);
              heldDir = dir;
            }
          }
        }

        // OPEN holds for this chip before pressing
        for (const b of r.holdStarts){
          if (!buttonHolds.has(b)){ emit(`[${b}]`, outputState); buttonHolds.add(b); }
        }

        if (isMotion){
          // NEW: close lingering dir-hold before printing a motion
          if (heldDir) { emit(`]${heldDir}[`, outputState); heldDir = null; }

          // print head digits (all but last)
          for (const x of motionDirs.slice(0, -1)) emit(x, outputState);
          const tail = motionDirs[motionDirs.length - 1];

          const attacks = r.buttons.filter(u => ATTACK_SET.has(u));
          const metas   = r.buttons.filter(u => META_SET.has(u));

          if (attacks.length) {
            for (const a of attacks) {
              const chord = `${tail}+${a}`;
              if (!stepEmitted.has(chord)) {
                emit(chord, outputState);
                stepEmitted.add(chord);
                lastDirDigit = tail; // Update direction state for chords
              }
            }
          } else {
            emit(tail, outputState);
          }

          for (const m of metas) emit(m, outputState);
          continue;
        }

        // Non-motion: emit buttons; chord with heldDir only for ATTACK_SET
        for (const u of r.buttons){
          if (ATTACK_SET.has(u)) {
            if (heldDir) emit(`${heldDir}+${u}`, outputState);
            else emit(u, outputState);
          }
        }
        for (const m of r.metas || []) emit(m, outputState);

        // CLOSE holds for this chip after pressing
        for (const b of r.holdEnds){
          if (buttonHolds.has(b)){ emit(`]${b}[`, outputState); buttonHolds.delete(b); }
          else { emit(`]${b}[`, outputState); }
        }
      }
    }

    // after loop: close any lingering states
    if (heldDir) emit(`]${heldDir}[`, outputState);
    for (const b of Array.from(buttonHolds)){ emit(`]${b}[`, outputState); buttonHolds.delete(b); }

      if (outputState.currentLine.trim().length > 0) {
        outputState.output += outputState.currentLine.trim() + '\n';
      }
      
    // Safe debug
    if (debugMode){
      const sample = allTokens.length>300 ? allTokens.slice(0,300).concat(['…',`(total ${allTokens.length})`]) : allTokens;
      console.log('[EDDIE][DEBUG] token stream:', sample);
      console.log('[EDDIE][DEBUG] output text:\n' + outputState.output);
    }

    return outputState.output;
  };
  
  // Helper to find macro matches in direction sequences
  eddie._findMacroMatch = function(dirString, macros) {
    // Try longest matches first
    const macroKeys = Object.keys(macros).sort((a, b) => b.length - a.length);
    
    for (const key of macroKeys) {
      if (dirString.includes(key)) {
        return macros[key];
      }
    }
    
    return null;
  };
  
  // Helper to compress direction sequences into macros
  eddie._compressDirections = function(dirs, { useMacros = true, macrosMap = {} } = {}) {
    if (!useMacros || !macrosMap || dirs.length === 0) {
      return dirs;
    }
    
    const result = [];
    let i = 0;
    
    while (i < dirs.length) {
      let matched = false;
      
      // Try to find the longest matching macro from current position
      const macroKeys = Object.keys(macrosMap).sort((a, b) => b.length - a.length);
      
      for (const key of macroKeys) {
        const keyDigits = key.replace('*', '').split('');
        const remaining = dirs.slice(i, i + keyDigits.length);
        
        if (arraysEqual(remaining, keyDigits)) {
          // Found a matching macro sequence
          result.push(macrosMap[key]);
          i += keyDigits.length;
          matched = true;
          break;
        }
      }
      
      if (!matched) {
        // No macro match, add the single digit
        result.push(dirs[i]);
        i++;
      }
    }
    
    return result;
  };
  
  // Helper to compare arrays
  function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  
  // Helper to manage output line formatting
  eddie._addToOutput = function(token, state) {
    const tokenLength = token.length + 1; // +1 for space
    
    if (state.lineLength + tokenLength > state.maxLineLength && state.lineLength > 0) {
      // Start new line
      state.output += state.currentLine.trim() + '\n';
      state.currentLine = token + ' ';
      state.lineLength = tokenLength;
    } else {
      // Continue current line
      state.currentLine += token + ' ';
      state.lineLength += tokenLength;
    }
    
    return state;
  };
  
  // Helper to detect hold duration and format appropriately
  eddie._detectHold = function(step, context, { holdStyle = 'auto', fps = 60, round = 'nearest' } = {}) {
    if (!step.hold || !step.hold.button) {
      return null;
    }
    
    // Check if this is a hold start with duration information
    if (step.hold.start && step.hold.durationMs) {
      const durationMs = step.hold.durationMs;
      const releaseAfterFrames = this._msToFrames(durationMs, { fps, round });
      
      // For 'auto' style, use bracket if duration meets threshold
      const useBracket = holdStyle === 'bracket' || 
                        (holdStyle === 'auto' && durationMs >= 250); // Default 250ms threshold
      
      if (useBracket && releaseAfterFrames > 0) {
        return {
          press: step.hold.button,
          releaseAfterFrames: releaseAfterFrames
        };
      }
    }
    
    // Check if this is a hold start (even without duration)
    if (step.hold.start) {
      // For bracket style without duration, use default duration
      if (holdStyle === 'bracket') {
        return {
          press: step.hold.button,
          releaseAfterFrames: this._msToFrames(250, { fps, round }) // Default 250ms
        };
      }
    }
    
    return null;
  };
  
  // Helper to find the release step for a hold
  eddie._findHoldRelease = function(holdStartStep, context) {
    // This would need access to the full script to find the matching release
    // For now, return null as we don't have access to the full context
    return null;
  };
  
  // Attach to global namespace
  CO.eddie = eddie;
  
  // Log initialization
  console.log('[EDDIE] Module loaded successfully');
  
  // Quick test runner for development
  if (location.search.includes('eddieTest=1')) {
    setTimeout(() => {
      console.group('[EDDIE] quick tests');
      
      // Test msToFrames
      const frames = window.ComboOverlay.eddie.msToFrames(1000);
      console.assert(frames === 60, 'msToFrames: expected 60, got', frames);
      
      // Test config generation
      const cfg = window.ComboOverlay.eddie.makeConfigFromProfile({game:'dbfz'});
      console.assert(cfg && cfg.Symbols && cfg.FPS === 60, 'config shape: expected FPS=60 and Symbols');
      console.assert(cfg.Symbols.L === 'L', 'config symbols: expected L symbol');
      
      // Test empty script export
      const emptyScript = window.ComboOverlay.eddie.exportScript({game:'dbfz'});
      console.assert(emptyScript.includes('no recording available'), 'empty script export');
      
      console.groupEnd();
      console.log('[EDDIE] Tests completed - check for assertions above');
    }, 100);
  }
  
})();

