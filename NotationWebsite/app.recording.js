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
  CO.on('chip:add', (chipEl)=>{  
    if(mode!=='record') return;
    const t=performance.now()-t0; // relative
    
    // Only record the NEW chip that was added, not the entire overlay
    const newChipHTML = chipEl.innerHTML;
    script.push({t, chipsHTML: [newChipHTML]});
    
    // Store time marker for this step
    markers.push({stepIndex: script.length - 1, tMs: t});
    
    CO.setStatus('Recorded: '+ (chipEl.textContent || 'chip'));
  });
  CO.on('overlay:clear', ()=>{
    if(mode==='record'){
      const t=performance.now()-t0;
      script.push({t, chipsHTML:[]});
      
      // Store time marker for clear action
      markers.push({stepIndex: script.length - 1, tMs: t});
      
      CO.setStatus('Recorded: overlay cleared');
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

// Reset action integration (controller "Reset" mapping)
// - If playing: hard stop immediately, then restart from the beginning
// - If recording: stop recording and start playback of what was recorded
// - If idle and sticky replay was armed: start from beginning
CO.on && CO.on('reset:action', ()=>{
  if (mode === 'record'){
    stop();
    if (script.length > 0) {
      requestAnimationFrame(play);
    } else {
      CO.setStatus('Nothing recorded to play.');
    }
    return;
  }
  if (mode === 'play'){
    // HARD reset: stop clears all RAFs, grading, tells, bars
    stop();
    requestAnimationFrame(play);
    return;
  }
  if (replayArmed){
    // play from start when armed
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
    script=[];
    t0=performance.now();
    mode='record';
    CO.setStatus('Recording… perform your sequence.');
  }

  // Convert recorded snapshots into per-chip press times and the final chip list.
  // Assumes your recorder captured a snapshot each time a chip was added.
  function buildPresses(script){
    if(!Array.isArray(script) || !script.length){
      return { finalChips: [], presses: [], totalDur: 0 };
    }
    const finalChips = script[script.length-1].chipsHTML || [];
    const presses = [];

    for(let idx=0; idx<finalChips.length; idx++){
      // first step whose length >= idx+1 is the moment chip #idx first existed
      const step = script.find(s => (s.chipsHTML?.length || 0) >= idx+1);
      let t = step ? step.t : 0;
      // ensure monotonic non-decreasing order
      if(idx>0 && t < presses[idx-1].t) t = presses[idx-1].t + 1;
      presses.push({ idx, t });
    }

    const totalDur = script[script.length-1].t || (presses[presses.length-1]?.t || 0);
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
    if(!finalChips.length){ CO.setStatus('Script has no chips.'); mode='idle'; return; }

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
})();
