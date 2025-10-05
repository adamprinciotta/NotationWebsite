/* Combo Overlay – Recording/Playback module (v13.6, Option B fixed)
   Depends on window.ComboOverlay (core). Provides:
   - Record button/direction events with timestamps
   - Save/Load scripts (JSON)
   - Playback with two visual styles: 'sweep' and 'tick'
   - Sticky Replay (re-arm playback via Reset)
   - Option A: right-side vertical tell on each chip during pre-roll
   - Option B: global playline with ticks (fixed scoping/order)
*/
(function(){
  const CO = window.ComboOverlay; if(!CO){ console.error('Recording module: core not loaded'); return; }
  const $ = (s)=>document.querySelector(s);

  // UI refs (prefer Practice Bar, fallback to full settings)
  const recBtn         = document.querySelector('#recBtnPractice')         || document.querySelector('#recBtn');
  const stopBtn        = document.querySelector('#stopBtnPractice')        || document.querySelector('#stopBtn');
  const playBtn        = document.querySelector('#playBtnPractice')        || document.querySelector('#playBtn');
  const saveScriptBtn  = document.querySelector('#saveScriptBtnPractice')  || document.querySelector('#saveScriptBtn');
  const loadScriptBtn  = document.querySelector('#loadScriptBtnPractice')  || document.querySelector('#loadScriptBtn');
  const loadScriptInput= document.querySelector('#loadScriptInputPractice')|| document.querySelector('#loadScriptInput');

  const loopChk   = document.querySelector('#loopChk');          // optional
  const styleSel  = document.querySelector('#playbackStyle');    // optional
  const leadInInp = document.querySelector('#leadInMs');
  const latencyInp= document.querySelector('#latencyMs');

  const freeStartChk = document.querySelector('#freeStart');     // optional
  const threshPerfectInp = document.querySelector('#threshPerfect');
  const threshGreatInp   = document.querySelector('#threshGreat');
  const threshGoodInp    = document.querySelector('#threshGood');
  const threshEdgeInp    = document.querySelector('#threshEdge');


  // Sticky Replay
  let stickyReplay = false;   // user toggle
  let replayArmed  = false;   // becomes true after a playback ends if stickyReplay is on

  // Playback protection + grading state
  let preventAdds = false;         // suppress notation changes during playback
  let gpPollId = null;             // requestAnimationFrame id for gamepad grading poll
  let gpPrev = [];                 // previous button pressed state for edge detection
  let unsubscribeChipAdd = null;   // to remove the chip:add interceptor

  // === Feature flags ===
    const OPTION_B_ENABLED = false; // <- disable the horizontal playline/ticks


  // grading thresholds (ms)
  // const THRESH = {
  //   perfect: 30,
  //   great: 60,
  //   good: 100,
  //   edge: 160,  // early/late window; after this we call it a miss
  // };

  function getThresh(){
  // fallbacks keep your previous defaults
  return {
    perfect: parseInt(threshPerfectInp?.value || '30', 10),
    great:   parseInt(threshGreatInp?.value   || '60', 10),
    good:    parseInt(threshGoodInp?.value    || '100', 10),
    edge:    parseInt(threshEdgeInp?.value    || '160', 10),
  };
}


  // small utilities
  function fmtDelta(ms){ const s = Math.round(ms); return (s>0?`+${s}`:`${s}`); }

  // ===== State =====
  let mode='idle'; // 'idle' | 'record' | 'play'
  let t0=0;        // reference time (ms)
  let script=[];   // [{t:number, chipsHTML:string}] – a snapshot per chip add
  let markers=[];  // [{stepIndex:number, tMs:number}] – time markers for each step
  let rafId=null;

  // === Direction recording state ===
  const DIR_DEADZONE = 0.35;   // tweak for your pad
  let lastDirKey = 'n';        // current derived direction ('n','u','d','l','r','uf','df','ub','db')
  let lastDirAt  = 0;          // timestamp of last direction change (ms)

  function dirKeyFromAxes(x, y) {
    // NOTE: typical gamepads => x: left(-1)↔right(+1), y: up(-1)↔down(+1)
    const xr = Math.abs(x) >= DIR_DEADZONE ? (x > 0 ? 'r' : 'l') : '';
    const yr = Math.abs(y) >= DIR_DEADZONE ? (y > 0 ? 'd' : 'u') : '';
    if (!xr && !yr) return 'n';
    if (xr && yr) return (yr + xr)  // 'dr','dl','ur','ul'
              .replace('ur','uf').replace('ul','ub')  // normalize names to your sprites
              .replace('dr','df').replace('dl','db');
    return (yr || xr);
  }

  // Emit a chip for direction-only changes so exporter can hold/close [dir]
  function emitDirChip(dirKey) {
    // Skip neutral if you don't want explicit 5s; comment out next line to include 5
    if (dirKey === 'n') return;

    const html = `<img class="img" src="images/${dirKey}.png" alt="${dirKey}">`;
    // Reuse your existing recorder hook that creates a new step with this chip
    const chipEl = document.createElement('span');
    chipEl.className = 'chip';
    chipEl.innerHTML = html;
    
    // Trigger the chip:add event to record this direction
    CO.emit('chip:add', chipEl);
    console.log('[rec][dir] emitted', dirKey);
  }

  // Call this from your poll loop each frame while recording
  function onPollAxes(nowMs, axesX, axesY) {
    const k = dirKeyFromAxes(axesX, axesY);
    if (k === lastDirKey) return;
    lastDirKey = k;
    lastDirAt = nowMs;
    emitDirChip(k);
  }

  // === Advanced Direction Recording ===
  const RECORD_DIRECTION_CHIPS = true;
  const AXIS_THRESHOLD = 0.45;
  const DIRECTION_STABLE_MS = 35;
  const SJ_WINDOW_MS = 120;
  const SJ_ACTION_MS = 150;

  let lastEmittedDir = '5';      // last direction actually emitted (numpad digit)
  let lastEmittedAt = 0;         // timestamp of last emission
  let lastRawDir = '5';          // current raw direction from axes
  let lastRawDirAt = 0;          // timestamp when current raw direction started
  let recentDirs = [];           // buffer for superjump detection: {dir, time}

  // Convert axes to numpad digit (1-9, 5=neutral)
  function axesToNumpad(x, y, threshold = AXIS_THRESHOLD) {
    const xr = Math.abs(x) >= threshold ? (x > 0 ? '6' : '4') : '5';
    const yr = Math.abs(y) >= threshold ? (y > 0 ? '2' : '8') : '5';
    
    // Combine for diagonals
    if (xr !== '5' && yr !== '5') {
      if (yr === '2') return xr === '6' ? '3' : '1';  // down-right(3), down-left(1)
      if (yr === '8') return xr === '6' ? '9' : '7';  // up-right(9), up-left(7)
    }
    
    return yr !== '5' ? yr : xr;  // prioritize vertical if both present
  }

  // Emit direction chip with stability check
  function maybeEmitDirectionChip(now, dirDigit) {
    if (!RECORD_DIRECTION_CHIPS) return;
    
    // Check if direction has been stable long enough
    if (dirDigit !== lastRawDir) {
      lastRawDir = dirDigit;
      lastRawDirAt = now;
      return;
    }
    
    const stableTime = now - lastRawDirAt;
    if (stableTime < DIRECTION_STABLE_MS) return;
    
    // Don't emit if same as last emitted
    if (dirDigit === lastEmittedDir) return;
    
    // Skip neutral if desired
    if (dirDigit === '5') return;
    
    // Convert to image format for chip
    const dirMap = {
      '1': 'db', '2': 'd', '3': 'df',
      '4': 'l', '5': 'n', '6': 'r', 
      '7': 'ub', '8': 'u', '9': 'uf'
    };
    
    const imageKey = dirMap[dirDigit];
    const html = `<img class="img" src="images/${imageKey}.png" alt="${imageKey}">`;
    
    // Record direction chip
    const chipEl = document.createElement('span');
    chipEl.className = 'chip';
    chipEl.innerHTML = html;
    
    CO.emit('chip:add', chipEl);
    console.log('[rec][dir] emitted', dirDigit, 'as', imageKey);
    
    // Update state
    lastEmittedDir = dirDigit;
    lastEmittedAt = now;
    
    // Add to superjump detection buffer
    recentDirs.push({dir: dirDigit, time: now});
    if (recentDirs.length > 10) recentDirs.shift();
  }

  // Detect superjump pattern (2 → 9 or 2 → 7)
  function detectSuperjump() {
    if (recentDirs.length < 2) return false;
    
    const lastTwo = recentDirs.slice(-2);
    const [first, second] = lastTwo;
    
    // Check for 2 → 9 or 2 → 7 within time window
    if (first.dir === '2' && (second.dir === '9' || second.dir === '7')) {
      const timeDiff = second.time - first.time;
      return timeDiff <= SJ_WINDOW_MS;
    }
    
    return false;
  }

  // Clear direction state on reset
  function __resetDirRecorder() {
    lastEmittedDir = '5';
    lastEmittedAt = 0;
    lastRawDir = '5';
    lastRawDirAt = 0;
    recentDirs = [];
  }

  // --- DEBUG HUD ---
  let dbg = document.getElementById('recDebug');
  if (!dbg) {
    dbg = document.createElement('div');
    dbg.id = 'recDebug';
    dbg.style.cssText = 'position:fixed;left:10px;bottom:10px;background:#111b;padding:6px 8px;border:1px solid #2a2f3a;border-radius:6px;font:12px system-ui;color:#9aa3b2;z-index:9999';
    dbg.textContent = 'rec: idle · steps: 0';
    document.body.appendChild(dbg);
  }
  function updateDebug(extra='') {
    dbg.textContent = `rec: ${mode} · steps: ${script.length} ${extra}`;
  }
  window.CO_dumpScript = () => console.log(JSON.stringify(script, null, 2));

  // ===== Option B: Global Playline (module scope so stop() can call it) =====
  let playline = null, bar = null, ticksEl = null;

  function ensurePlayline(){
      if (!OPTION_B_ENABLED) return; // no-op when disabled
    if (!playline){
      playline = document.getElementById('playline');
      if (!playline){
        playline = document.createElement('div');
        playline.id = 'playline';
        playline.innerHTML = '<div class="bar"></div><div class="ticks"></div>';
        const wrap = document.getElementById('overlayWrap');
        (wrap?.parentNode || document.body).insertBefore(playline, wrap?.nextSibling || null);
      }
    }
    // (re)grab refs
    bar     = playline.querySelector('.bar');
    ticksEl = playline.querySelector('.ticks');
  }
  function clearPlayline(){
      if (!OPTION_B_ENABLED) return; // no-op when disabled
    ensurePlayline();
    if (bar) bar.style.width = '0%';
    playline?.classList.remove('done');
    if (ticksEl) ticksEl.innerHTML = '';
  }
  function buildTicks(steps){
      if (!OPTION_B_ENABLED) return; // no-op when disabled
    ensurePlayline();
    if (!ticksEl || !steps?.length) return;
    ticksEl.innerHTML = '';
    const total = steps[steps.length-1].t || 1;
    const w = CO.overlay.clientWidth || 1;
    for (const s of steps){
      const x = (s.t / total) * w;
      const i = document.createElement('i');
      i.style.left = `${x}px`;
      ticksEl.appendChild(i);
    }
  }
  // If you want live-resize tick positions, store lastSteps and rebuild here.
  // window.addEventListener('resize', ()=>{ if(lastSteps) buildTicks(lastSteps); });

  // ===== Recording hooks =====
  CO.on('chip:add', (chipEl) => {
    if (mode !== 'record') return;
    const t = performance.now() - t0;

    // Store only the NEW chip's HTML (not cumulative snapshot)
    const newChipHTML = chipEl.innerHTML;
    
    script.push({ t, chipsHTML: [newChipHTML], addedIndex: script.length });
    markers.push({ stepIndex: script.length - 1, tMs: t });

    CO.setStatus('Recorded: ' + (chipEl.textContent || 'chip'));
    updateDebug(`(+chip, idx=${script.length - 1})`);
  });
  CO.on('overlay:clear', () => {
    if (mode === 'record') {
      const t = performance.now() - t0;
      script.push({ t, chipsHTML: [], addedIndex: -1 });
      markers.push({ stepIndex: script.length - 1, tMs: t });
      CO.setStatus('Recorded: overlay cleared');
      updateDebug('(clear)');
    }
  });

  // Expose minimal API
  CO.rec = {
    get mode(){ return mode; }, // 'idle' | 'record' | 'play'
    get script(){ return script; }, // Expose recorded script data
    get markers(){ return markers; }, // Expose time markers
    startRecord, play, stop
  };

  // Practice reset passthrough (legacy)
  CO.on && CO.on('practice:reset', ()=>{
    if (mode === 'record'){ stop(); startRecord(); }
    else if (mode === 'play'){ stop(); play(); }
  });

  // Hard reset function to clear all recording state
  function hardResetRecording() {
    // Stop any current recording timers
    if (rafId) cancelAnimationFrame(rafId), rafId = null;
    if (gpPollId) cancelAnimationFrame(gpPollId), gpPollId = null;

    // Clear overlay DOM
    CO.overlay.innerHTML = '';

    // Clear script and markers
    script = [];
    markers = [];

    // Clear exporter runtime state
    window.heldDir = null;
    if (window.buttonHolds) window.buttonHolds.clear?.();
    if (window.activeButtonChips) window.activeButtonChips.clear?.();

    // Clear direction recording state
    __resetDirRecorder();

    // Reset recording state
    mode = 'idle';
    t0 = 0;
    preventAdds = false;
    replayArmed = false;
    updateReplayPill(false);

    // Clear playback decor
    resetPlaybackDecor();
    if (OPTION_B_ENABLED) clearPlayline();

    CO.setStatus('Hard reset complete');
    updateDebug();
    updateMarkersUI();

    console.log('[RESET] complete');
  }

// Reset action integration (controller "Reset" mapping)
// - If playing: hard stop immediately, then restart from the beginning
// - If recording: restart recording from the beginning
// - If idle and sticky replay was armed: start from beginning
CO.on && CO.on('reset:action', ()=>{
  if (mode === 'record'){
    // Restart recording from the beginning
    hardResetRecording();
    requestAnimationFrame(startRecord);
    return;
  }
  if (mode === 'play'){
    // HARD reset: stop clears all RAFs, grading, tells, bars
    hardResetRecording();
    requestAnimationFrame(play);
    return;
  }
  if (replayArmed){
    // play from start when armed
    hardResetRecording();
    requestAnimationFrame(play);
  }
});


  // ===== Sticky Replay UI on the practice bar =====
  (function ensureStickyReplayUI(){
    const bar = document.querySelector('#practiceBar .right') || document.querySelector('#practiceBar');
    if(!bar) return;

    // Toggle
    if(!document.querySelector('#stickyReplay')){
      const lbl = document.createElement('label');
      lbl.style.display = 'inline-flex';
      lbl.style.alignItems = 'center';
      lbl.style.gap = '6px';
      lbl.innerHTML = `<input id="stickyReplay" type="checkbox"> Sticky Replay`;
      bar.prepend(lbl);
    }

    // Armed pill
    if(!document.querySelector('#replayArmedPill')){
      const pill = document.createElement('div');
      pill.id = 'replayArmedPill';
      pill.textContent = 'Replay armed — press Reset to retry';
      pill.style.cssText = 'display:none;margin-left:8px;padding:4px 8px;border-radius:999px;font-size:12px;background:#283; color:#eaf;';
      bar.appendChild(pill);
    }

    const chk = document.querySelector('#stickyReplay');
    chk?.addEventListener('change', ()=>{ stickyReplay = !!chk.checked; });
  })();

  function updateReplayPill(on){
    const pill = document.querySelector('#replayArmedPill');
    if(pill) pill.style.display = on ? '' : 'none';
    document.body.classList.toggle('replay-armed', !!on);
  }

  // ===== Visual cleanup between runs =====
    function resetPlaybackDecor(){
    CO.overlay.querySelectorAll('.chip').forEach(ch=>{
        ch.classList.remove('playback-sweep','hit','miss','hit-ping','tell-full');
        ch.style.removeProperty('--pct');
        ch.style.removeProperty('--tell'); // <— important: clear tell amount
    });
    const tick=$('#tickCursor'); if(tick) tick.remove();
    }


  // ===== Transport =====
  function stop(){
    gpPrev = [];
    if(rafId) cancelAnimationFrame(rafId), rafId=null;
    
    // Debug logging on stop
    if (mode === 'record') {
      console.log('[rec] steps:', script.length, 'finalChips:', (script.at(-1)?.chipsHTML?.length||0));
    }
    
    mode='idle';

    resetPlaybackDecor();         // clears tells, pulses, cursor
    if (OPTION_B_ENABLED) clearPlayline();

    if (gpPollId) cancelAnimationFrame(gpPollId), gpPollId = null;
    preventAdds = false;
    unsubscribeChipAdd && unsubscribeChipAdd(); // lets chip:add handler go inert

    CO.setStatus('Stopped.');
    replayArmed = false;
    updateReplayPill(false);
  }


  function startRecord(){
    script=[]; markers=[];
    t0=performance.now();
    mode='record';
    CO.setStatus('Recording… perform your sequence.');
    updateDebug();
  }

  // New buildPresses: supports per-chip events (each step has only the newly added chip)
  function buildPresses(script){
    if (!Array.isArray(script) || !script.length) {
      return { finalChips: [], presses: [], totalDur: 0 };
    }

    // Scan the event stream and collect the chips in order of first appearance.
    // Keep the first time each chip index appeared (press time).
    const finalChips = [];
    const presses = [];

    for (let i = 0; i < script.length; i++){
      const step = script[i];
      const chips = Array.isArray(step.chipsHTML) ? step.chipsHTML : [];
      if (chips.length === 0) continue;              // skip clear steps here
      // We only record NEW chip(s) at this step; push them to final list
      for (const html of chips){
        const idx = finalChips.length;
        finalChips.push(html);
        presses.push({ idx, t: step.t });            // press time = this step's time
      }
    }

    // If nothing recorded, bail
    if (finalChips.length === 0) {
      return { finalChips: [], presses: [], totalDur: script[script.length-1]?.t || 0 };
    }

    // Ensure monotonicity
    presses.sort((a,b)=>a.idx-b.idx);
    for (let k=1; k<presses.length; k++){
      if (presses[k].t < presses[k-1].t) presses[k].t = presses[k-1].t + 1;
    }

    const totalDur = script[script.length-1]?.t || presses[presses.length-1].t || 0;
    return { finalChips, presses, totalDur };
  }

  function play(){
    if(!script.length){ CO.setStatus('Nothing to play. Record first.'); return; }
    mode='play';

  
    // latch Sticky Replay toggle at the moment of play
    stickyReplay = !!document.querySelector('#stickyReplay')?.checked;
    replayArmed = false;
    updateReplayPill(false);

    resetPlaybackDecor();

    const style     = (styleSel?.value||'sweep');
    const leadIn    = parseInt(leadInInp?.value||'600',10);
    const latency   = parseInt(latencyInp?.value||'0',10);
    const indicatorMs = parseInt(document.querySelector('#indicatorMs')?.value || '1000', 10); // Option A pre-roll

    // Derive presses (one time per chip) + final snapshot
    const { finalChips, presses, totalDur } = buildPresses(script);
    if (!finalChips.length) {
      CO.setStatus('Script has no chips.');
      updateDebug('(no chips)');
      mode = 'idle';
      return;
    }

    // Render baseline (all chips visible)
    applyFinalSnapshot(finalChips);
    const chipEls=[...CO.overlay.querySelectorAll('.chip')];

    const shifted = presses.map(p=>({ idx:p.idx, t:p.t + leadIn + latency }));
    const steps   = shifted.map(p => ({ chipIndex: p.idx, t: p.t }));

    // Option B: build the playline/ticks only AFTER steps exist
    ensurePlayline();

    let state = {
      start: performance.now(),
      anchorPending: !!freeStartChk?.checked
    };

    requestAnimationFrame(() => startGrading(steps, chipEls, state));



    if (OPTION_B_ENABLED) {
        clearPlayline();
        buildTicks(steps);
        }

    // prevent notation changes during playback
    preventAdds = true;
    const chipAddHandler = (chipEl) => {
      if (!preventAdds) return;
      try { CO.removeChip(chipEl); } catch {}
    };
    CO.on && CO.on('chip:add', chipAddHandler);
    unsubscribeChipAdd = () => { preventAdds = false; };

    // start grading loop (sync to this playback frame)
    gpPrev = []; // clear edge detection

    let nextIdx = 0;

    // Tick cursor element (for tick mode)
    let tickEl=null;
    if(style==='tick'){
      tickEl=document.createElement('div');
      tickEl.id='tickCursor';
      tickEl.className='tick-cursor';
      CO.overlay.appendChild(tickEl);
    }

    function frame(){
      const t = performance.now() - state.start;

      // Option B: move the global progress bar
      if (OPTION_B_ENABLED && bar) {
        const total = steps[steps.length-1].t || 1;
        const pct = Math.max(0, Math.min(1, t / total));
        bar.style.width = (pct*100).toFixed(2) + '%';
      }

      // Option A: drive per-chip vertical tell during pre-roll windows
      const chips = [...CO.overlay.querySelectorAll('.chip')];
      for (const ch of chips) ch.style.removeProperty('--tell');

      const activeWindows = [];
      for (let k = 0; k < steps.length; k++) {
        const s = steps[k];
        const startWin = s.t - indicatorMs;
        if (t >= startWin && t < s.t) {
          activeWindows.push({ s, startWin });
        } else if (t < startWin) {
          break;
        }
      }
      for (const { s, startWin } of activeWindows) {
        const pct = Math.max(0, Math.min(1, (t - startWin) / indicatorMs));
        const target = chips[s.chipIndex];
        if (target) target.style.setProperty('--tell', String(pct));
      }

      // Tick mode cursor
      if(style === 'tick'){
        const totalDur = steps[steps.length-1].t;
        const w = CO.overlay.clientWidth;
        const x = (t / Math.max(1,totalDur)) * w;
        if(tickEl){ tickEl.style.left = `${Math.max(0, Math.min(w, x))}px`; }
      }

      // Mark hits as we pass their timing
      while(nextIdx < steps.length && t >= steps[nextIdx].t){
        const step = steps[nextIdx];
        const target = chips[step.chipIndex];
        if(target){
        //   target.style.removeProperty('--tell'); // clear tell on hit
        //   target.classList.add('highlight','hit-ping');
        target.style.setProperty('--tell', '1');         // keep it full
        target.classList.add('tell-full');               // triggers pulse animation
        target.classList.add('highlight');
          setTimeout(()=> {target.classList.remove('highlight','hit-ping');}, 220);
        }
        nextIdx++;
      }

      // Continue / finish
      const endT = steps[steps.length-1].t;
      if(t <= endT){
        rafId = requestAnimationFrame(frame);
      }else{
        if(loopChk?.checked){
          chips.forEach(ch => { ch.classList.remove('playback-sweep','highlight'); ch.style.removeProperty('--pct'); });
          nextIdx = 0;
          rafId = requestAnimationFrame(() => {
            state.start = performance.now();
            frame();
          });
        }else{
          if(stickyReplay){
            // Arm replay: wait for Reset action to re-trigger play()
            mode = 'idle';
            replayArmed = true;
            updateReplayPill(true);
            if(rafId) cancelAnimationFrame(rafId);
            rafId = null;
            CO.setStatus('Playback finished. Replay armed — press your Reset button to retry.');
          }else{
            playline?.classList.add('done');
            const { edge } = getThresh();
            setTimeout(() => stop(), edge);
          }
        }
      }
    }

    rafId = requestAnimationFrame(frame);
  }

function startGrading(steps, chipEls, state){
  let gradeIdx = 0;
  let graded = new Array(steps.length).fill(false);
  const TH = getThresh();

  function gradeChip(i, kind, delta){
    const s = steps[i];
    const chip = chipEls[s.chipIndex];
    if(!chip) return;
    chip.classList.remove('grade-perfect','grade-great','grade-good','grade-early','grade-late','grade-miss');
    chip.classList.add('grade-' + kind);

    const old = chip.querySelector('.grade-badge');
    if(old) old.remove();
    const badge = document.createElement('div');
    badge.className = 'grade-badge';
    badge.textContent = isNaN(delta) ? 'miss' : fmtDelta(delta);
    chip.appendChild(badge);

    chip.classList.add('highlight');
    setTimeout(()=>chip.classList.remove('highlight'), 180);
  }

  function classifyDelta(delta){
    const ad = Math.abs(delta);
    if(ad <= TH.perfect) return 'perfect';
    if(ad <= TH.great)   return 'great';
    if(ad <= TH.good)    return 'good';
    return delta < 0 ? 'early' : 'late';
  }

  function checkMisses(now){
    const firstWindowOpens = (steps[0]?.t || 0) - TH.edge;
    // If we're waiting for anchor, do not call misses yet
    if (state.anchorPending) return;
    if (now < firstWindowOpens) return;

    for (let i = gradeIdx; i < steps.length; i++){
      if (graded[i]) continue;
      const deadline = steps[i].t + TH.edge;
      if (now >= deadline){
        gradeChip(i, 'miss', NaN);
        graded[i] = true;
        gradeIdx = i + 1;
      } else {
        break;
      }
    }
  }

  function poll(){
    const gps = navigator.getGamepads?.() || [];
    const gp = Array.from(gps).find(g => g && g.connected && g.buttons) || null;

    // IMPORTANT: we read "now" from the *current* startTimeRef (which can shift)
    const now = performance.now() - state.start;

    checkMisses(now);

    if(gp && gp.buttons){
      if(!gpPrev.length) gpPrev = gp.buttons.map(b => !!b.pressed);
      
      // === NEW: Advanced Direction recording ===
      // Get axes values (assuming standard gamepad layout)
      const axesX = gp.axes?.[0] || 0;  // Left stick X
      const axesY = gp.axes?.[1] || 0;  // Left stick Y
      
      // Call advanced direction recorder
      if (mode === 'record') {
        const now = performance.now();
        const dirDigit = axesToNumpad(axesX, axesY);
        maybeEmitDirectionChip(now, dirDigit);
        
        // Superjump detection (for logging/debug)
        if (detectSuperjump()) {
          console.log('[rec][sj] detected superjump pattern');
        }
      }
      
      for(let i=0;i<gp.buttons.length;i++){
        if(i>=12) break; // ignore d-pad indices for grading presses
        const pressed = !!gp.buttons[i].pressed, was = !!gpPrev[i];
        if(pressed && !was){
          // ===== ANCHOR: shift the whole timeline to this first press =====
          if (state.anchorPending){
            // Make this press line up with step 0 exactly.
            // Shift "start" so that steps[0].t == (performance.now() - start)
            const nowAbs = performance.now();
            state.start = nowAbs - steps[0].t;   // <- shift the frame clock
            state.anchorPending = false;

            // Treat the first step as perfect on anchor
            if (!graded[0]){
              gradeChip(0, 'perfect', 0);
              graded[0] = true;
              gradeIdx = 1;
            }
            gpPrev[i] = pressed;
            continue; // next poll loop
          }

          // Normal grading when not anchoring
          const next = gradeIdx < steps.length ? steps[gradeIdx] : null;
          if(next && !graded[gradeIdx]){
            const delta = now - next.t;
            const ad = Math.abs(delta);
            if(ad <= TH.edge){
              gradeChip(gradeIdx, classifyDelta(delta), delta);
              graded[gradeIdx] = true;
              gradeIdx++;
            }else{
              gradeChip(gradeIdx, 'miss', NaN);
              graded[gradeIdx] = true;
              gradeIdx++;
            }
          }
        }
        gpPrev[i] = pressed;
      }
    }
    if(mode === 'play'){
      gpPollId = requestAnimationFrame(poll);
    }
  }

  gpPollId = requestAnimationFrame(poll);
}

  // Render all chips (final snapshot) – keeps them visible during playback
  function applyFinalSnapshot(chipsHTML){
    // Suppress history during playback rendering
    const wasSuppressed = CO.suppressHistory;
    CO.suppressHistory = true;
    
    CO.overlay.innerHTML='';
    chipsHTML.forEach((html,i)=>{
      if(CO.overlay.children.length>0){
        const s=document.createElement('span');
        s.className='sep';
        s.textContent=(CO.profiles[CO.activeProfile].separator||'>');
        CO.overlay.appendChild(s);
      }
      const c=document.createElement('span');
      c.className='chip';
      c.innerHTML=html;
      c.tabIndex=0;

      // Option A: right-side vertical tell scaffold
      const tell = document.createElement('div');
      tell.className = 'tell';
      tell.innerHTML = '<i></i>';
      c.appendChild(tell);

      CO.overlay.appendChild(c);
    });
    
    // Restore previous suppress state
    CO.suppressHistory = wasSuppressed;
  }

  // Save/Load script JSON
  function saveScript(){
    if(!script.length){ CO.setStatus('No script to save.'); return; }
    const blob=new Blob([JSON.stringify({version:CO.version, script, markers}, null, 2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='combo_script.json'; a.click();
    URL.revokeObjectURL(url);
    CO.setStatus('Saved script JSON.');
  }
  function loadScriptFromFile(ev){
    const f=ev.target.files?.[0]; if(!f) return;
    f.text().then(txt=>{
      try{
        const obj=JSON.parse(txt);
        if(Array.isArray(obj.script)){ 
          script=obj.script; 
          markers=obj.markers || []; // Load markers if available
          CO.setStatus(`Loaded script with ${script.length} steps${markers.length ? ' and ' + markers.length + ' markers' : ''}.`); 
        }
        else { CO.setStatus('Invalid script file.'); }
      }catch(e){ CO.setStatus('Failed to parse script file.'); }
    });
  }

  // Wire buttons
  recBtn?.addEventListener('click', ()=>{ if(mode==='play') stop(); startRecord(); });
  stopBtn?.addEventListener('click', ()=> stop());
  playBtn?.addEventListener('click', ()=>{ if(mode==='record') stop(); play(); });
  saveScriptBtn?.addEventListener('click', saveScript);
  loadScriptBtn?.addEventListener('click', ()=> loadScriptInput?.click());
  loadScriptInput?.addEventListener('change', loadScriptFromFile);

  // Create markers UI container
  const markersContainer = document.createElement('div');
  markersContainer.id = 'markersContainer';
  markersContainer.style.cssText = `
    position: fixed;
    right: 20px;
    top: 100px;
    background: rgba(18,18,22,0.9);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 8px;
    padding: 10px;
    max-height: 300px;
    overflow-y: auto;
    font-size: 12px;
    color: #eef0f5;
    z-index: 1000;
  `;
  
  // Add to document
  document.body.appendChild(markersContainer);
  
  // Function to update markers UI
  function updateMarkersUI() {
    if (!markers.length) {
      markersContainer.innerHTML = '<div style="padding: 10px; color: #9aa3b2;">No markers recorded</div>';
      return;
    }
    
    let html = '<div style="margin-bottom: 8px; font-weight: bold; border-bottom: 1px solid #2a2f3a; padding-bottom: 4px;">Time Markers</div>';
    
    markers.forEach((marker, index) => {
      const stepText = script[marker.stepIndex]?.chipsHTML?.length 
        ? `Step ${marker.stepIndex + 1}` 
        : 'Clear';
      
      html += `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px; padding: 2px 0;">
          <span>${stepText}</span>
          <span style="color: #64ffda;">${Math.round(marker.tMs)}ms</span>
        </div>
      `;
    });
    
    markersContainer.innerHTML = html;
  }
  
  // Initial update
  updateMarkersUI();
  
  // Update markers UI when markers change
  const originalPush = markers.push;
  markers.push = function() {
    const result = originalPush.apply(this, arguments);
    updateMarkersUI();
    return result;
  };
  
  // Also update when markers array is modified other ways
  markers.splice = function() {
    const result = Array.prototype.splice.apply(this, arguments);
    updateMarkersUI();
    return result;
  };

  // Console breadcrumbs so the user sees activity
  CO.on('status', msg=>console.log('[recording]', msg));

  // Console instrumentation helpers for debugging
  window.__dumpScript = function(label = 'DUMP') {
    try {
      console.log(`[DUMP] ${label}`);
      if (!script || !script.length) { 
        console.warn('No script found'); 
        return; 
      }
      console.log('stepCount=', script.length);
      script.forEach((s, i) => {
        const len = (s?.chipsHTML || []).length;
        console.log(`[DUMP] step ${i} len=${len}`, { t: s?.t, chipsHTML: s?.chipsHTML });
      });
      console.log('[DUMP] end');
    } catch (e) { console.error(e); }
  };

  window.__verifyReset = function() {
    const ok = {
      scriptEmpty: !script || script.length === 0,
      overlayEmpty: !CO.overlay || CO.overlay.children.length === 0,
      heldDirNull: window.heldDir == null,
      modeIdle: mode === 'idle',
    };
    console.log('[VERIFY RESET]', ok);
    return ok;
  };
})();
