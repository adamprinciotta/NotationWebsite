
/* Combo Overlay – Core (v13.7)
   Responsibilities:
   - UI wiring (profiles, colors, PNG export, OBS URL)
   - Overlay chip add/remove/edit + popover
   - Gamepad detection + live capture (including j. prefix via UP)
   - Public API surface for feature modules (e.g., recording)

   Modules can hook via window.ComboOverlay.on(event, fn)
   Events: 'chip:add' (chipEl), 'chip:remove' (chipEl), 'chip:replace' (chipEl),
           'status' (msg), 'overlay:clear'
*/
(function(){
  const $ = (s)=>document.querySelector(s);
  const overlay = $('#overlay');
  // Ensure the overlay can’t host a caret or gain focus when it’s empty
  overlay.setAttribute('contenteditable', 'false'); // belt-and-suspenders
  overlay.setAttribute('tabindex', '-1');           // it shouldn't be keyboard-focusable

  // If you click the empty overlay (not a chip), prevent default so no caret shows
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) {
      e.preventDefault();      // stops caret/focus behavior in all major browsers
    }
  });

  const statusEl = $('#status');
  const q = new URLSearchParams(location.search);

  /* ===== Simple event bus ===== */
  const bus = {
    listeners:new Map(),
    on(evt,fn){ const arr=this.listeners.get(evt)||[]; arr.push(fn); this.listeners.set(evt,arr); },
    emit(evt,...args){ const arr=this.listeners.get(evt); if(arr) for(const f of arr){ try{ f(...args);}catch(e){ console.warn('[bus]',e); } } }
  };
  function setStatus(msg){ if(statusEl) statusEl.textContent = msg; console.log('[overlay]', msg); bus.emit('status', msg); }

  /* ===== Profiles / persistence ===== */
  const LS_PROFILES='gp_profiles_obs_v13_7';
  const LS_ACTIVE='gp_active_profile_obs_v13_7';
  const DEFAULT_BUTTON_LABELS=['L','M','H','S','LB','RB','LT','RT','Select','Start','L3','R3','D↑','D↓','D←','D→'];
  const DEFAULT_BUTTON_COLORS=Array(16).fill('#000000');
  const DEFAULT_BUTTON_BG=Array(16).fill('#f5f5f5');
  function defaultProfile(){return {name:'Default',buttonLabels:[...DEFAULT_BUTTON_LABELS],buttonColors:[...DEFAULT_BUTTON_COLORS],buttonBgColors:[...DEFAULT_BUTTON_BG],deadzone:0.5,chordWindow:80,repeatLockout:110,holdMs:250,motionWindow:700,motionCoupleMs:130,chargeFrames:30,chargeWindow:180,mashWindowMs:350,facing:'right',resetAction:'none',separator:'>'}};
  function loadProfiles(){try{const raw=localStorage.getItem(LS_PROFILES); if(!raw) return [defaultProfile()]; const arr=JSON.parse(raw); return Array.isArray(arr)&&arr.length?arr:[defaultProfile()];}catch{return [defaultProfile()];}}
  function saveProfiles(){localStorage.setItem(LS_PROFILES, JSON.stringify(profiles));}
  function loadActive(){const v=parseInt(localStorage.getItem(LS_ACTIVE)||'0',10);return Number.isFinite(v)&&v>=0&&v<profiles.length? v:0;}
  function saveActive(){localStorage.setItem(LS_ACTIVE, String(activeProfile));}
  let profiles=loadProfiles(); let activeProfile=loadActive();
  
  /* ===== Undo/Redo Manager ===== */
  const history = { past:[], future:[], max:200 };
  let suppressHistory = false;
  let historyDebounceTimer = null;

  function snapshotOverlay(){
    const chips = [...overlay.querySelectorAll('.chip')];
    const separators = [...overlay.querySelectorAll('.sep')];
    return {
      chips: chips.map(chip => chip.innerHTML),
      separators: separators.map(sep => sep.textContent),
      timestamp: performance.now()
    };
  }

  function restoreOverlay(state){
    // Suppress history during restore
    const wasSuppressed = suppressHistory;
    suppressHistory = true;
    
    // Clear current overlay
    overlay.innerHTML = '';
    buffer.length = 0;
    bus.emit('overlay:clear');
    
    // Rebuild overlay from state
    const { chips, separators } = state;
    let chipIndex = 0;
    let sepIndex = 0;
    
    // Interleave chips and separators (assuming they alternate)
    for(let i = 0; i < chips.length + separators.length; i++){
      if(i % 2 === 0 && chipIndex < chips.length){
        // Add chip
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.innerHTML = chips[chipIndex];
        chip.tabIndex = 0;
        chip.addEventListener('click', (ev)=>{ selectChip(chip); openPopover(chip); ev.stopPropagation(); });
        chip.addEventListener('dblclick', (ev)=>{ selectChip(chip); openPopover(chip, true); ev.stopPropagation(); });
        overlay.appendChild(chip);
        bus.emit('chip:add', chip);
        chipIndex++;
      } else if(sepIndex < separators.length){
        // Add separator
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = separators[sepIndex];
        overlay.appendChild(sep);
        sepIndex++;
      }
    }
    
    rebuildBuffer();
    
    // Restore previous suppress state
    suppressHistory = wasSuppressed;
  }

  function pushHistory(label){
    if(suppressHistory) return;
    
    // Clear debounce timer
    if(historyDebounceTimer){
      clearTimeout(historyDebounceTimer);
    }
    
    // Debounce rapid changes
    historyDebounceTimer = setTimeout(() => {
      const snapshot = snapshotOverlay();
      snapshot.label = label;
      
      // Add to past, clear future
      history.past.push(snapshot);
      history.future = [];
      
      // Trim to max size
      if(history.past.length > history.max){
        history.past.shift();
      }
      
      console.log(`[undo] Pushed: ${label}`);
    }, 250);
  }

  function undo(){
    if(history.past.length === 0) return;
    
    // Move current state to future
    const current = snapshotOverlay();
    current.label = 'Current';
    history.future.unshift(current);
    
    // Restore previous state
    const previous = history.past.pop();
    restoreOverlay(previous);
    
    setStatus(`Undid: ${previous.label || 'Unknown'}`);
    console.log(`[undo] Undid: ${previous.label || 'Unknown'}`);
  }

  function redo(){
    if(history.future.length === 0) return;
    
    // Move current state to past
    const current = snapshotOverlay();
    current.label = 'Current';
    history.past.push(current);
    
    // Restore future state
    const next = history.future.shift();
    restoreOverlay(next);
    
    setStatus(`Redid: ${next.label || 'Unknown'}`);
    console.log(`[undo] Redid: ${next.label || 'Unknown'}`);
  }
  
  /* ===== Context Menu for Chip Insertion ===== */
  let contextMenu = null;
  let pendingInsertion = null;
  let insertPosition = null;
  let insertMode = null; // 'left', 'right', 'between'
  let insertSide = null; // 'left', 'right'
  let clickPosition = null; // Store click coordinates for proper insertion

  function createContextMenu() {
    if (contextMenu) return contextMenu;
    
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.innerHTML = `
      <div class="context-menu-item" data-action="insert-custom">
        <span>Insert here…</span>
        <span style="margin-left: auto; color: #9aa3b2;">Custom text</span>
      </div>
      <div class="context-menu-item" data-action="insert-controller">
        <span>Insert here…</span>
        <span style="margin-left: auto; color: #9aa3b2;">From controller</span>
      </div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="insert-left">
        <span>Insert left</span>
      </div>
      <div class="context-menu-item" data-action="insert-right">
        <span>Insert right</span>
      </div>
    `;
    
    document.body.appendChild(contextMenu);
    
    // Add event listeners
    contextMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.context-menu-item');
      if (!item) return;
      
      const action = item.dataset.action;
      handleContextMenuAction(action);
      hideContextMenu();
    });
    
    return contextMenu;
  }

  function showContextMenu(x, y, chip = null) {
    createContextMenu();
    
    // Store click position for proper insertion calculation
    clickPosition = { x, y };
    
    // Update menu based on context
    const betweenItems = contextMenu.querySelectorAll('[data-action="insert-custom"], [data-action="insert-controller"]');
    const chipItems = contextMenu.querySelectorAll('[data-action="insert-left"], [data-action="insert-right"]');
    
    if (chip) {
      // Right-clicked on a chip
      betweenItems.forEach(item => item.style.display = 'none');
      chipItems.forEach(item => item.style.display = 'flex');
      insertMode = 'chip';
      insertPosition = chip;
    } else {
      // Right-clicked in empty space
      betweenItems.forEach(item => item.style.display = 'flex');
      chipItems.forEach(item => item.style.display = 'none');
      insertMode = 'between';
      insertPosition = null;
    }
    
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.style.display = 'block';
  }

  function hideContextMenu() {
    if (contextMenu) {
      contextMenu.style.display = 'none';
    }
  }

  function handleContextMenuAction(action) {
    switch (action) {
      case 'insert-custom':
        if (insertMode === 'between') {
          insertCustomTextBetween();
        } else if (insertMode === 'chip') {
          insertCustomTextAtChip();
        }
        break;
      case 'insert-controller':
        if (insertMode === 'between') {
          insertFromControllerBetween();
        } else if (insertMode === 'chip') {
          insertFromControllerAtChip();
        }
        break;
      case 'insert-left':
        insertFromControllerAtChip('left');
        break;
      case 'insert-right':
        insertFromControllerAtChip('right');
        break;
    }
  }

  function insertCustomTextBetween() {
    const text = prompt('Enter chip text:');
    if (!text || !text.trim()) {
      hideContextMenu();
      return;
    }
    
    const html = `<span style="color:${getComputedStyle(document.documentElement).getPropertyValue('--chip-text').trim()}">${escapeHtml(text.trim())}</span>`;
    const index = getInsertionIndex();
    insertChipAt(index, html);
    hideContextMenu();
  }

  function insertCustomTextAtChip() {
    const text = prompt('Enter chip text:');
    if (!text || !text.trim()) {
      hideContextMenu();
      return;
    }
    
    const html = `<span style="color:${getComputedStyle(document.documentElement).getPropertyValue('--chip-text').trim()}">${escapeHtml(text.trim())}</span>`;
    const chipIndex = getChipIndex(insertPosition);
    insertChipAt(chipIndex, html);
    hideContextMenu();
  }

  function insertFromControllerBetween() {
    insertMode = 'controller-between';
    insertPosition = getInsertionIndex();
    createPendingInsertion();
    setStatus('Controller capture: press a button to insert chip...');
  }

  function insertFromControllerAtChip(side = 'left') {
    insertMode = 'controller-chip';
    insertPosition = insertPosition;
    insertSide = side;
    createPendingInsertion();
    setStatus(`Controller capture: press a button to insert ${side} of chip...`);
  }

  function createPendingInsertion() {
    // Create a placeholder chip to show where insertion will happen
    const placeholder = document.createElement('span');
    placeholder.className = 'chip pending-insertion';
    placeholder.innerHTML = '<span style="color:#9aa3b2">Press controller button...</span>';
    placeholder.tabIndex = 0;
    
    let index;
    if (insertMode === 'controller-between') {
      index = insertPosition;
    } else if (insertMode === 'controller-chip') {
      const chipIndex = getChipIndex(insertPosition);
      const side = insertSide || 'left';
      index = chipIndex + (side === 'right' ? 1 : 0);
    } else {
      index = 0;
    }
    
    // Insert the placeholder using the same logic as regular chips
    const chips = [...overlay.querySelectorAll('.chip')];
    
    if (index === 0) {
      // Insert at the beginning
      overlay.insertBefore(placeholder, overlay.firstChild);
      // Add separator after the placeholder if there are other chips
      if (chips.length > 0) {
        addSeparator();
      }
    } else if (index >= chips.length) {
      // Insert at the end - add separator first, then placeholder (like addChipElHTML)
      if (overlay.children.length > 0) {
        addSeparator();
      }
      overlay.appendChild(placeholder);
    } else {
      // Insert in the middle
      const targetChip = chips[index];
      
      // Insert the placeholder before the target chip
      overlay.insertBefore(placeholder, targetChip);
      
      // Add separator between the inserted placeholder and the target chip
      const separator = document.createElement('span');
      separator.className = 'sep';
      separator.textContent = (profiles[activeProfile].separator || '>');
      overlay.insertBefore(separator, targetChip);
    }
    
    pendingInsertion = placeholder;
  }

  function getInsertionIndex() {
    // Find the index where we should insert based on click position
    const chips = [...overlay.querySelectorAll('.chip')];
    if (chips.length === 0) return 0;
    
    if (!clickPosition) {
      // Fallback to end if no click position stored
      return chips.length;
    }
    
    // Find the chip that the click position is closest to horizontally
    let closestIndex = 0;
    let minDistance = Infinity;
    
    for (let i = 0; i < chips.length; i++) {
      const chip = chips[i];
      const rect = chip.getBoundingClientRect();
      const chipCenterX = rect.left + rect.width / 2;
      const distance = Math.abs(clickPosition.x - chipCenterX);
      
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }
    
    // Determine if we should insert before or after the closest chip
    const closestChip = chips[closestIndex];
    const rect = closestChip.getBoundingClientRect();
    const shouldInsertAfter = clickPosition.x > (rect.left + rect.width / 2);
    
    return shouldInsertAfter ? closestIndex + 1 : closestIndex;
  }

  function getChipIndex(chip) {
    const chips = [...overlay.querySelectorAll('.chip')];
    return chips.indexOf(chip);
  }

  function insertChipAt(index, html, isPlaceholder = false) {
    // Remove any existing pending insertion
    if (pendingInsertion) {
      pendingInsertion.remove();
      pendingInsertion = null;
    }
    
    // Create the chip element
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = html;
    chip.tabIndex = 0;
    
    if (!isPlaceholder) {
      // Add event listeners for real chips
      chip.addEventListener('click', (ev)=>{ selectChip(chip); openPopover(chip); ev.stopPropagation(); });
      chip.addEventListener('dblclick', (ev)=>{ selectChip(chip); openPopover(chip, true); ev.stopPropagation(); });
    }
    
    // Get current chips
    const chips = [...overlay.querySelectorAll('.chip')];
    
    if (index === 0) {
      // Insert at the beginning
      overlay.insertBefore(chip, overlay.firstChild);
      // Add separator after the chip if there are other chips
      if (chips.length > 0) {
        addSeparator();
      }
    } else if (index >= chips.length) {
      // Insert at the end - add separator first, then chip (like addChipElHTML)
      if (overlay.children.length > 0) {
        addSeparator();
      }
      overlay.appendChild(chip);
    } else {
      // Insert in the middle
      const targetChip = chips[index];
      
      // Insert the chip before the target chip
      overlay.insertBefore(chip, targetChip);
      
      // Add separator between the inserted chip and the target chip
      const separator = document.createElement('span');
      separator.className = 'sep';
      separator.textContent = (profiles[activeProfile].separator || '>');
      overlay.insertBefore(separator, targetChip);
    }
    
    if (!isPlaceholder) {
      rebuildBuffer();
      bus.emit('chip:add', chip);
      pushHistory('Insert chip');
    }
    
    return chip;
  }

  function completeInsertionFromController(btnIndex) {
    if (!insertMode || !insertMode.startsWith('controller')) return;
    
    // Build chip HTML using existing logic
    const dirTok = captureDirTok || snapshotDirection() || 'n';
    const motionHTML = detectMotionForButton();
    const p = profiles[activeProfile];
    let finalLabel = (p.buttonLabels[btnIndex] || `#${btnIndex}`);
    if (dirTok === 'u' && !/^j\./i.test(finalLabel)) finalLabel = 'j.' + finalLabel;
    
    let html;
    if (motionHTML) {
      html = `${motionHTML} ${buttonHTML(btnIndex, finalLabel)}`;
    } else if (dirTok && dirTok !== 'n') {
      const dirHTML = dirToImg(dirTok) || dirTok.toUpperCase();
      html = `${dirHTML} + ${buttonHTML(btnIndex, finalLabel)}`;
    } else {
      html = buttonHTML(btnIndex, finalLabel);
    }
    
    // If there's a pending insertion placeholder, replace it
    if (pendingInsertion) {
      const chip = pendingInsertion;
      chip.innerHTML = html;
      chip.className = 'chip';
      chip.tabIndex = 0;
      
      // Add event listeners for the real chip
      chip.addEventListener('click', (ev)=>{ selectChip(chip); openPopover(chip); ev.stopPropagation(); });
      chip.addEventListener('dblclick', (ev)=>{ selectChip(chip); openPopover(chip, true); ev.stopPropagation(); });
      
      // Clean up insertion state
      pendingInsertion = null;
      insertMode = null;
      insertPosition = null;
      insertSide = null;
      clickPosition = null;
      
      rebuildBuffer();
      bus.emit('chip:add', chip);
      pushHistory('Insert chip');
      setStatus('Chip inserted');
      hideContextMenu();
      return;
    }
    
    // Fallback: determine insertion index and insert normally
    let index;
    if (insertMode === 'controller-between') {
      index = insertPosition;
    } else if (insertMode === 'controller-chip') {
      const chipIndex = getChipIndex(insertPosition);
      const side = insertSide || 'left';
      index = chipIndex + (side === 'right' ? 1 : 0);
    } else {
      index = 0;
    }
    
    // Insert the chip
    insertChipAt(index, html);
    
    // Clean up insertion state
    insertMode = null;
    insertPosition = null;
    insertSide = null;
    clickPosition = null;
    setStatus('Chip inserted');
    hideContextMenu();
  }
  
  let resetCaptureActive = false;

  // Import profiles via ?config or ?configUrl
  (async function bootConfigFromQuery(){
    try{
      if(q.get('config')){
        const json=JSON.parse(atob(q.get('config'))); if(Array.isArray(json)&&json.length){ profiles=json; activeProfile=0; saveProfiles(); saveActive(); refreshProfileUI(); }
      }else if(q.get('configUrl')){
        const url=q.get('configUrl'); if(/^https?:/i.test(url)){ const res=await fetch(url,{cache:'no-store'}); const json=await res.json(); if(Array.isArray(json)&&json.length){ profiles=json; activeProfile=0; saveProfiles(); saveActive(); refreshProfileUI(); } }
      }
    }catch(e){ console.warn('Config import error', e); }
  })();

  // UI refs
  const profileSelect=$('#profileSelect'), profileName=$('#profileName');
  const newProfileBtn=$('#newProfile'), dupProfileBtn=$('#dupProfile'), delProfileBtn=$('#delProfile'), saveProfileBtn=$('#saveProfile');
  const exportBtn=$('#exportBtn'), importBtn=$('#importBtn'), importInput=$('#importInput');
  const makeObsUrlBtn=$('#makeObsUrl');
  const buttonMapTable=$('#buttonMapTable');
  const bindResetBtn = $('#bindResetBtn');
  const clearResetBtn = $('#clearResetBtn');
  const resetLabel = $('#resetLabel');


    const chipFontInp=$('#chipFont'), chipImgHInp=$('#chipImgH'), chipPadXInp=$('#chipPadX'), chipPadYInp=$('#chipPadY'),
        chipGapInp=$('#chipGap'), chipRadiusInp=$('#chipRadius'), overlayWidthInp=$('#overlayWidth'),
        separatorInp=$('#separator'), chipBgAllInp=$('#chipBgAll'), chipTextAllInp=$('#chipTextAll'),
        useGlobalColors=$('#useGlobalColors'), overlayFullChk=$('#overlayFullWidth');


  const resetSel=$('#resetAction'); const facingSel=$('#facing');


  bindResetBtn?.addEventListener('click', ()=>{
    resetCaptureActive = true;
    setStatus('Press the controller button you want to use for Reset… (Esc to cancel)');
    });

    clearResetBtn?.addEventListener('click', ()=>{
    const p = profiles[activeProfile];
    p.resetAction = 'none';
    saveProfiles();
    renderResetLabel();
    setStatus('Reset binding cleared.');
    });

    // Allow cancel with Esc while capturing
    window.addEventListener('keydown', (e)=>{
    if (resetCaptureActive && e.key === 'Escape') {
        resetCaptureActive = false;
        setStatus('Reset binding canceled.');
    }
    });


    /* ===== Multi-select / marquee selection ===== */
let currentSelectedChip = null;                 // keep existing single “primary” for compatibility
const selectedChips = new Set();                // multi-select set
let marquee = null;                             // DOM box
let marqueeActive = false;
let marqueeStart = {x:0,y:0};
let popEl = null;


// Prevent the document click-clears right after a marquee release
let suppressNextDocClick = false;

// Cooldown so DOWN doesn't spam remove
let lastDownRemoveAt = 0;

// Remove j. from a single chip
function removeJPrefix(chip){
  if(!chip) return;
  const lastSpan = chip.querySelector('span:last-of-type');
  if(!lastSpan) return;
  const cur = lastSpan.textContent.trim();
  const next = cur.replace(/^j\.\s*/i, '');
  if(next !== cur){
    lastSpan.textContent = next;
    window.ComboOverlay?.rebuildBuffer?.();
  }
}

// Remove j. from all selected chips
function removeJPrefixBulk(){
  if(!selectedChips.size) return;
  for(const ch of selectedChips) removeJPrefix(ch);
  window.ComboOverlay?.rebuildBuffer?.();
  pushHistory(`Remove j. from ${selectedChips.size} chips`);
}



/* ===== Button label PRESETS + guided controller binding ===== */

// 1) Define your presets here.
// Order matters for the guided binding flow—this is the sequence of prompts.
// (You can add more later; the UI auto-pulls keys from this object.)
/* ===== Button label PRESETS + guided controller binding (with banner) ===== */

const BUTTON_PRESETS = {
  '2XKO': {
    labels: ['L','M','H','S1','S2','Tag','Parry','Dash','Start','Select','L3','R3','D↑','D↓','D←','D→'],
  },
  'Street Fighter 6': {
    labels: ['LP','MP','HP','LK','MK','HK','DI','Parry','Start','Select','L3','R3','D↑','D↓','D←','D→'],
  },
};

let presetBind = {
  active: false,
  name: null,
  i: 0,
  queue: [],
};

/* ===== Banner UI ===== */
function ensureBindingBanner(){
  if (document.getElementById('bindingBanner')) return;
  const b = document.createElement('div');
  b.id = 'bindingBanner';
  b.style.cssText = `
    position: fixed; left: 50%; transform: translateX(-50%);
    top: 8px; z-index: 100000;
    display: none; gap: 10px; align-items: center;
    padding: 10px 14px; border-radius: 12px;
    background: #101520; color: #eaf1ff; box-shadow: 0 8px 24px rgba(0,0,0,.35);
    font: 600 14px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  `;
  b.innerHTML = `
    <span id="bindingBannerMsg"></span>
    <button id="bindingBannerCancel" class="btn" style="margin-left:8px">Cancel</button>
  `;
  document.body.appendChild(b);
  document.getElementById('bindingBannerCancel').addEventListener('click', cancelPresetBinding);
}
function showBindingBanner(msg){
  ensureBindingBanner();
  const b = document.getElementById('bindingBanner');
  const m = document.getElementById('bindingBannerMsg');
  if (m) m.textContent = msg || '';
  b.style.display = 'inline-flex';
}
function hideBindingBanner(){
  const b = document.getElementById('bindingBanner');
  if (b) b.style.display = 'none';
}

function startPresetBinding(presetName){
  const preset = BUTTON_PRESETS[presetName];
  if(!preset){ setStatus('Unknown preset.'); return; }
  presetBind.active = true;
  presetBind.name   = presetName;
  presetBind.i      = 0;
  presetBind.queue  = Array.from(preset.labels || []);
  const first = presetBind.queue[0];
  const msg = `Binding “${presetName}”: Press the controller button for “${first}”. (Esc to cancel)`;
  setStatus(msg);
  showBindingBanner(msg);
}

function cancelPresetBinding(){
  if(!presetBind.active) return;
  presetBind.active = false;
  presetBind.name   = null;
  presetBind.queue  = [];
  presetBind.i      = 0;
  hideBindingBanner();
  setStatus('Preset binding canceled.');
}

function stepPresetBindingAssigned(){
  presetBind.i++;
  if(presetBind.i >= presetBind.queue.length){
    const done = `Preset “${presetBind.name}” bound to controller buttons.`;
    setStatus(done);
    hideBindingBanner();
    presetBind.active = false;
    presetBind.name   = null;
    presetBind.queue  = [];
    presetBind.i      = 0;
  }else{
    const next = `Now press the button for “${presetBind.queue[presetBind.i]}”. (Esc to cancel)`;
    setStatus(next);
    showBindingBanner(next);
  }
}

function applyPresetDirect(presetName){
  const preset = BUTTON_PRESETS[presetName];
  if(!preset){ setStatus('Unknown preset.'); return; }
  const p = profiles[activeProfile];
  const N = Math.max(16, p.buttonLabels.length);
  p.buttonLabels = Array.from({length:N}, (_,i)=> preset.labels[i] ?? p.buttonLabels[i] ?? `#${i}`);
  saveProfiles();
  refreshProfileUI();
  setStatus(`Applied preset labels: ${presetName}`);
}

/* Small preset UI (dropdown + buttons), near your button map */
(function ensurePresetUI(){
  const host = document.querySelector('#buttonMapTable')?.parentNode || document.body;
  if(document.getElementById('presetBar')) return;

  const wrap = document.createElement('div');
  wrap.id = 'presetBar';
  wrap.style.cssText = 'margin-top:12px; display:grid; grid-template-columns: 1fr auto auto; gap:8px; align-items:center;';

  const sel  = document.createElement('select');
  sel.id = 'presetSelect';
  sel.style.maxWidth = '280px';
  sel.innerHTML = Object.keys(BUTTON_PRESETS)
    .map(n => `<option value="${n}">${n}</option>`)
    .join('');

  const btnApply = document.createElement('button');
  btnApply.textContent = 'Apply Preset Labels';
  btnApply.className = 'btn';

  const btnBind = document.createElement('button');
  btnBind.textContent = 'Bind Preset via Controller…';
  btnBind.className = 'btn';

  wrap.appendChild(sel);
  wrap.appendChild(btnApply);
  wrap.appendChild(btnBind);
  host.appendChild(wrap);

  btnApply.addEventListener('click', ()=>{
    const name = sel.value;
    applyPresetDirect(name);
  });

  btnBind.addEventListener('click', ()=>{
    const name = sel.value;
    startPresetBinding(name);
  });

  // Esc cancels binding
  window.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape') cancelPresetBinding();
  });
})();





function isChip(el){ return el && el.classList && el.classList.contains('chip'); }

function clearPrimary(){
  if(currentSelectedChip){
    currentSelectedChip.classList.remove('selected');
    currentSelectedChip = null;
  }
}

function updateSelectedStyles(){
  // visual selection ring
  const chips = overlay.querySelectorAll('.chip');
  chips.forEach(ch => ch.classList.toggle('selected', selectedChips.has(ch)));
}

function deselectAll(){
  selectedChips.clear();
  clearPrimary();
  updateSelectedStyles();
}

function selectOnly(chip){
  selectedChips.clear();
  selectedChips.add(chip);
  currentSelectedChip = chip;
  updateSelectedStyles();
}

function addToSelection(chip){
  selectedChips.add(chip);
  currentSelectedChip = chip; // last clicked becomes primary
  updateSelectedStyles();
}

function removeFromSelection(chip){
  selectedChips.delete(chip);
  if (currentSelectedChip === chip) currentSelectedChip = null;
  updateSelectedStyles();
}

function getChipBounds(chip){
  const r = chip.getBoundingClientRect();
  return {left:r.left, top:r.top, right:r.right, bottom:r.bottom};
}

function rectsIntersect(a,b){
  return !(b.left>a.right || b.right<a.left || b.top>a.bottom || b.bottom<a.top);
}

/* ===== Bulk ops ===== */
function addJPrefixBulk(){
  if(!selectedChips.size) return;
  for(const ch of selectedChips) addJPrefix(ch);
  window.ComboOverlay?.rebuildBuffer?.();
  pushHistory(`Add j. to ${selectedChips.size} chips`);
}

function deleteSelectedBulk(){
  if(!selectedChips.size) return;
  // remove in DOM order left→right to keep separators clean
  const arr = Array.from(selectedChips).sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING? -1: 1);
  for(const ch of arr) {
    const prev = ch.previousSibling, next = ch.nextSibling; 
    if(prev && prev.classList && prev.classList.contains('sep')) prev.remove(); 
    else if(next && next.classList && next.classList.contains('sep')) next.remove(); 
    ch.remove(); 
    if(currentSelectedChip===ch) currentSelectedChip=null; 
    bus.emit('chip:remove', ch);
  }
  selectedChips.clear();
  currentSelectedChip = null;
  updateSelectedStyles();
  rebuildBuffer();
  pushHistory(`Delete ${arr.length} chips`);
}

function clearMotionBulk(){
  for(const chip of selectedChips){
    [...chip.querySelectorAll('img')].forEach(img=>{
      if(['qcf','qcb','dpf','dpb','hcf','hcb','360'].includes(img.alt)) img.remove();
    });
  }
  window.ComboOverlay?.rebuildBuffer?.();
  pushHistory(`Clear motion from ${selectedChips.size} chips`);
}

function clearDirBulk(){
  for(const chip of selectedChips){
    const imgs=[...chip.querySelectorAll('img')];
    for(const img of imgs){
      const a=img.alt;
      if(['u','d','b','f','ub','uf','db','df'].includes(a)) img.remove();
    }
    const span=chip.querySelector('span:last-of-type');
    if(span){ span.textContent=span.textContent.trim().replace(/^j\./i,''); }
  }
  window.ComboOverlay?.rebuildBuffer?.();
  pushHistory(`Clear direction from ${selectedChips.size} chips`);
}

/* Rename tail text for all (keeps icons intact) */
function renameTailBulk(newTxt){
  if(!newTxt) return;
  for(const chip of selectedChips){
    const lastSpan = chip.querySelector('span:last-of-type');
    if(lastSpan) lastSpan.textContent = newTxt;
  }
  window.ComboOverlay?.rebuildBuffer?.();
  pushHistory(`Rename tail to "${newTxt}" on ${selectedChips.size} chips`);
}

/* Utility: find chip at event target (click bubbling) */
function chipFromEventTarget(t){
  while(t && t !== document.body){
    if(isChip(t)) return t;
    t = t.parentNode;
  }
  return null;
}


function applyCssKnobs(){
  document.documentElement.style.setProperty('--chip-font', chipFontInp.value+'px');
  document.documentElement.style.setProperty('--chip-img-h', chipImgHInp.value+'px');
  document.documentElement.style.setProperty('--chip-pad-x', chipPadXInp.value+'px');
  document.documentElement.style.setProperty('--chip-pad-y', chipPadYInp.value+'px');
  document.documentElement.style.setProperty('--chip-gap', chipGapInp.value+'px');
  document.documentElement.style.setProperty('--chip-radius', chipRadiusInp.value+'px');

  // FULL-WIDTH: drive the same --overlay-width var so the overlay reacts immediately
  if (overlayFullChk?.checked) {
    document.body.classList.add('fullwidth');
    document.documentElement.style.setProperty('--overlay-width', '100vw');
  } else {
    document.body.classList.remove('fullwidth');
    document.documentElement.style.setProperty('--overlay-width', overlayWidthInp.value+'px');
  }

  document.documentElement.style.setProperty('--chip-bg', chipBgAllInp.value);
  document.documentElement.style.setProperty('--chip-text', chipTextAllInp.value);
  document.body.classList.toggle('global-override', !!useGlobalColors.checked);
}


// ===== Mash collapse config/state =====
const mashState = {
  key: null,         // normalized signature for the input (dir/motion + button)
  firstChip: null,   // the chip element to keep/rename
  firstTime: 0,      // timestamp of first press in the burst
  count: 0           // how many presses in current burst
};

// normalize the HTML signature (stable key for direction/motion+button)
function normalizeHTML(html){
  return html.replace(/\s+/g,' ').trim();
}

// Remove the very last chip + its preceding separator (if present)
function removeLastChip(){
  const last = overlay.lastElementChild;
  if(!last) return;
  // last should be a chip; the previous sibling (if any) is the sep
  if(last.classList && last.classList.contains('chip')){
    // prefer using existing removeChip so it emits events/cleans sep
    removeChip(last);
  }else{
    // fallback: if last isn’t a chip, just remove it
    last.remove();
  }
}

// Turn the kept chip into “mash …”
function mashifyChip(chipEl){
  if(!chipEl) return;
  // Take the current visual contents (e.g., "<img ...> + <span>H</span>")
  // and remove the " + " joiner so it reads like: mash [arrow] H
  const inner = chipEl.innerHTML.replace(/\s\+\s/g, ' ');
  chipEl.innerHTML = `<span class="mash-tag" style="font-weight:900">Mash</span> ${inner}`;
}

// Update mash state after we’ve added a chip; possibly remove recent chips
// Returns: 'kept' | 'collapsed' | 'removed' (removed = the just-added chip got pulled)
function updateMashAfterAdd(newHtml, newChip){
  const key = normalizeHTML(newHtml);
  const t   = now();
  const mashWindow = profiles[activeProfile].mashWindowMs || 350;

  // continuing same-burst?
  if(mashState.key === key && (t - mashState.firstTime) <= mashWindow){
    mashState.count += 1;
    mashState.firstTime = t;

    if(mashState.count === 2){
      // show first two normally
      return 'kept';
    }
    if(mashState.count === 3){
      // collapse to 1: remove the last two chips (current + previous), then mashify the first
      removeLastChip();  // removes current (just-added)
      removeLastChip();  // removes previous duplicate
      mashifyChip(mashState.firstChip);
      rebuildBuffer();
      return 'collapsed';
    }
    // 4th+ identical press within window: discard the new add silently
    removeLastChip();    // remove the just-added one
    rebuildBuffer();
    return 'removed';
  }

  // new series (or outside window): start a fresh burst
  mashState.key = key;
  mashState.firstChip = newChip;
  mashState.firstTime = t;
  mashState.count = 1;
  return 'kept';
}


  const practiceToggle = document.querySelector('#practiceToggle');
    const practiceBar    = document.querySelector('#practiceBar');
    let practiceMode = false;

    function setPracticeMode(on){
    practiceMode = !!on;
    document.body.classList.toggle('practice', practiceMode);
    if (practiceBar) practiceBar.style.display = practiceMode ? '' : 'none';
    if (practiceToggle) practiceToggle.textContent = `Practice Mode: ${practiceMode ? 'On' : 'Off'} (P)`;
    // status hint
    setStatus(practiceMode ? 'Practice Mode ON: use compact playback controls.' : 'Practice Mode OFF.');
    }

    practiceToggle?.addEventListener('click', ()=> setPracticeMode(!practiceMode));



function renderResetLabel(){
  const p = profiles[activeProfile];
  const v = p?.resetAction || 'none';
  if (!resetLabel) return;
  resetLabel.textContent = v === 'none' ? 'Reset: none' : `Reset: ${v}`;
}


  function setInputValue(sel, val){ const el=document.querySelector(sel); if(el) el.value=val; }

  function refreshProfileUI(){ if(activeProfile<0||activeProfile>=profiles.length) activeProfile=0; const p=profiles[activeProfile];
    if(profileSelect) profileSelect.innerHTML=profiles.map((pp,i)=>`<option value="${i}" ${i===activeProfile?'selected':''}>${escapeHtml(pp.name||`Profile ${i+1}`)}</option>`).join('');
    if(profileName) profileName.value=p.name||''; renderButtonMap();
    if(resetSel) resetSel.innerHTML = ['none', ...Array.from({length:16},(_,i)=>`button:${i}`)].map(v=>`<option value="${v}" ${p.resetAction===v?'selected':''}>${v}</option>`).join('');
    if(facingSel) facingSel.value=p.facing||'right';
    if (overlayFullChk) overlayFullChk.checked = !!p.overlayFullWidth; // ensure UI reflects profile

    setInputValue('#deadzone',       p.deadzone);
    setInputValue('#chordWindow',    p.chordWindow);
    setInputValue('#repeatLockout',  p.repeatLockout);
    setInputValue('#holdMs',         p.holdMs);
    setInputValue('#motionWindow',   p.motionWindow);
    setInputValue('#motionCoupleMs', p.motionCoupleMs);
    setInputValue('#chargeFrames',   p.chargeFrames);
    setInputValue('#chargeWindow',   p.chargeWindow);
    setInputValue('#mashWindowMs',   p.mashWindowMs ?? 350);
    setInputValue('#indicatorMs', p.indicatorMs ?? 1000);

    renderResetLabel();
    applyCssKnobs();
  }

  function renderButtonMap(){ const p=profiles[activeProfile]; if(!buttonMapTable) return; let rows='<tr><th>#</th><th>Label</th><th>Text</th><th>Chip BG</th></tr>'; const N=Math.max(16,p.buttonLabels.length);
    for(let i=0;i<N;i++){ const label=p.buttonLabels[i]??''; const color=p.buttonColors[i]??'#000000'; const bg=p.buttonBgColors[i]??'#f5f5f5';
      rows+=`<tr><td>#${i}</td><td><input data-btn="${i}" class="btn-label" type="text" value="${escapeHtml(label)}"></td><td><input data-btn-color="${i}" class="btn-color" type="color" value="${color}"></td><td><input data-btn-bg="${i}" class="btn-bg" type="color" value="${bg}"></td></tr>`; }
    buttonMapTable.innerHTML=rows;
  }

  profileSelect?.addEventListener('change',e=>{activeProfile=parseInt(e.target.value,10);saveActive();refreshProfileUI();});
  newProfileBtn?.addEventListener('click',()=>{profiles.push(defaultProfile());activeProfile=profiles.length-1;saveProfiles();saveActive();refreshProfileUI();});
  dupProfileBtn?.addEventListener('click',()=>{const copy=JSON.parse(JSON.stringify(profiles[activeProfile])); copy.name=(copy.name||'Profile')+' (copy)'; profiles.push(copy); activeProfile=profiles.length-1; saveProfiles(); saveActive(); refreshProfileUI();});
  delProfileBtn?.addEventListener('click',()=>{ if(profiles.length<=1) return; profiles.splice(activeProfile,1); activeProfile=0; saveProfiles(); saveActive(); refreshProfileUI();});
  saveProfileBtn?.addEventListener('click',()=>{ const p=profiles[activeProfile]; p.name=profileName?.value.trim()||`Profile ${activeProfile+1}`; p.facing=facingSel?.value||p.facing; p.resetAction=resetSel?.value||p.resetAction; p.separator=separatorInp.value||'>'; p.deadzone=parseFloat($('#deadzone')?.value)||p.deadzone; p.chordWindow=parseInt($('#chordWindow')?.value)||p.chordWindow; p.repeatLockout=parseInt($('#repeatLockout')?.value)||p.repeatLockout; p.holdMs=parseInt($('#holdMs')?.value)||p.holdMs; p.motionWindow=parseInt($('#motionWindow')?.value)||p.motionWindow; p.motionCoupleMs=parseInt($('#motionCoupleMs')?.value)||p.motionCoupleMs; p.chargeFrames=parseInt($('#chargeFrames')?.value)||p.chargeFrames; p.chargeWindow=parseInt($('#chargeWindow')?.value)||p.chargeWindow; p.mashWindowMs=parseInt($('#mashWindowMs')?.value)||350; saveProfiles(); refreshProfileUI();});

  exportBtn?.addEventListener('click',()=>{const blob=new Blob([JSON.stringify(profiles,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='gamepad_profiles.json'; a.click(); URL.revokeObjectURL(url);});
  importBtn?.addEventListener('click',()=>importInput?.click());
  importInput?.addEventListener('change',async(e)=>{const f=e.target.files?.[0]; if(!f) return; const text=await f.text(); try{ const arr=JSON.parse(text); if(Array.isArray(arr)&&arr.length){ profiles=arr; activeProfile=0; saveProfiles(); saveActive(); refreshProfileUI(); } }catch(err){ console.warn('Import error', err); }});
  makeObsUrlBtn?.addEventListener('click',()=>{ try{ const b64=btoa(JSON.stringify(profiles)); const here=location.href.split('?')[0]; const url=`${here}?obs=1&config=${b64}`; navigator.clipboard?.writeText(url); setStatus('Copied OBS URL with embedded config'); }catch{ setStatus('Could not encode config (too large?)'); }});

  // Live CSS knobs + global override
document.addEventListener('input',(e)=>{
  const p=profiles[activeProfile]; if(!p) return; const t=e.target;

  if(t.matches?.('.btn-label')) p.buttonLabels[parseInt(t.dataset.btn,10)] = t.value;
  if(t.matches?.('.btn-color')) p.buttonColors[parseInt(t.dataset.btnColor,10)] = t.value;
  if(t.matches?.('.btn-bg')) p.buttonBgColors[parseInt(t.dataset.btnBg,10)] = t.value;

  if ([chipFontInp, chipImgHInp, chipPadXInp, chipPadYInp, chipGapInp, chipRadiusInp,
       overlayWidthInp, chipBgAllInp, chipTextAllInp, overlayFullChk].includes(t)) {
    // persist the full-width choice whenever width controls change
    if (t === overlayFullChk || t === overlayWidthInp) {
      p.overlayFullWidth = !!overlayFullChk?.checked;
    }
    applyCssKnobs();
  }

  if (t===separatorInp){ p.separator=separatorInp.value||'>'; rebuildBuffer(); }
  if (t===useGlobalColors){ applyCssKnobs(); }
  if (t?.id === 'mashWindowMs'){ p.mashWindowMs = parseInt(t.value) || 350; }
  saveProfiles();
});


  /* ===== Drag & Drop import ===== */
  ;['dragenter','dragover','drop','dragleave'].forEach(evt=>window.addEventListener(evt,(e)=>{ if(evt!=='drop') e.preventDefault(); if(evt==='drop'){ const f=e.dataTransfer?.files?.[0]; if(f){ f.text().then(txt=>{ try{const arr=JSON.parse(txt); if(Array.isArray(arr)&&arr.length){ profiles=arr; activeProfile=0; saveProfiles(); saveActive(); refreshProfileUI(); setStatus('Imported profile (drag & drop)'); } }catch(err){ console.warn('DnD import error',err); } }); } } }));

  /* ===== Overlay helpers ===== */
  function addSeparator(){ 
    if(overlay.children.length){
      // Check if the last child is already a separator
      const lastChild = overlay.lastElementChild;
      if(!lastChild || !lastChild.classList.contains('sep')){
        const s=document.createElement('span');
        s.className='sep'; 
        s.textContent=(profiles[activeProfile].separator||'>'); 
        overlay.appendChild(s);
      }
    }
  }
  function currentSeparator(){ return ' ' + (profiles[activeProfile].separator||'>') + ' '; }
  function rebuildBuffer(){ const chips=[...overlay.querySelectorAll('.chip')]; buffer = chips.map(ch=>ch.innerText.trim()); }
  let buffer=[];

  function addChipElHTML(html, perButtonBg){
    if(overlay.children.length) addSeparator();
    const c=document.createElement('span'); c.className='chip'; c.innerHTML=html; c.tabIndex=0;
    if(!useGlobalColors?.checked && perButtonBg) c.style.backgroundColor = perButtonBg;
    c.addEventListener('click', (ev)=>{ selectChip(c); openPopover(c); ev.stopPropagation(); });
    c.addEventListener('dblclick', (ev)=>{ selectChip(c); openPopover(c, true); ev.stopPropagation(); });
    overlay.appendChild(c); overlay.scrollLeft=overlay.scrollWidth; rebuildBuffer();
    bus.emit('chip:add', c);
    pushHistory('Add chip');
    return c;
  }

  function clearOverlay(){ overlay.innerHTML=''; buffer.length=0; activeButtonChips.clear(); lastCharged={tok:null,at:0}; closePopover(); currentSelectedChip=null; editCapture=false; bus.emit('overlay:clear'); pushHistory('Clear overlay'); }
  $('#clearBtn')?.addEventListener('click', clearOverlay);
  $('#copyBtn')?.addEventListener('click', ()=>{ const txt=buffer.join(currentSeparator().trim()); navigator.clipboard?.writeText(txt); setStatus('Copied text.'); });
  let modeLive=true; $('#toggleMode')?.addEventListener('click',()=>{ modeLive=!modeLive; $('#toggleMode').textContent='Mode: '+(modeLive?'Live':'Record'); setStatus('Mode toggled.'); });

  // PNG Copy/Export
  async function overlayToCanvas(){
    const node=overlay; const rect=node.getBoundingClientRect();
    const width=Math.ceil(rect.width); const height=Math.ceil(rect.height);
    const inlineStyles=[...document.head.querySelectorAll('style')].map(s=>s.textContent).join('\n');
    const html = `<div xmlns="http://www.w3.org/1999/xhtml" class="export-root">`+
                 `<style>${inlineStyles}</style>`+
                 `<div id="overlay" style="max-width:${width}px">${node.innerHTML}</div>`+
                 `</div>`;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>`+
                `<foreignObject width='100%' height='100%'>${html}</foreignObject>`+
                `</svg>`;
    const svgBlob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'}); const url=URL.createObjectURL(svgBlob);
    await new Promise(r=>requestAnimationFrame(r));
    const img=new Image(); img.decoding='async'; img.onload=()=>URL.revokeObjectURL(url); img.src=url; await img.decode();
    const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height; const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0);
    return canvas;
  }
  async function copyPNG(){ try{ const canvas=await overlayToCanvas(); const blob=await new Promise(res=>canvas.toBlob(res,'image/png')); await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]); setStatus('Copied overlay as PNG to clipboard.'); }catch(err){ console.warn(err); setStatus('Copy PNG failed (browser permissions?)'); } }
  async function exportPNG(){ try{ const canvas=await overlayToCanvas(); const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download='overlay.png'; a.click(); setStatus('Exported overlay as PNG.'); }catch(err){ console.warn(err); setStatus('Export PNG failed.'); } }
  $('#copyPngBtn')?.addEventListener('click', copyPNG);
  $('#exportPngBtn')?.addEventListener('click', exportPNG);

  /* ===== Gamepad ===== */
  let gamepadIndex=null; let prevButtons=[]; let lastButtonTime=new Map();
  const holdTimers=new Map();
  const activeButtonChips=new Map(); // declared once
  window.addEventListener('gamepadconnected',e=>{gamepadIndex=e.gamepad.index;prevButtons=e.gamepad.buttons.map(b=>b.pressed); setStatus(`Connected: ${e.gamepad.id}`);});
  window.addEventListener('gamepaddisconnected',()=>{gamepadIndex=null; setStatus('Gamepad disconnected');});
  function now(){return performance.now();}
  function poll(){const gps=navigator.getGamepads?.(); let gp=(gamepadIndex!=null)?gps[gamepadIndex]:null; if(!gp){for(const g of gps){if(g){gp=g;gamepadIndex=g.index;prevButtons=g.buttons.map(b=>b.pressed);break;}}}
    if(gp){handleButtons(gp);trackDirections(gp);} requestAnimationFrame(poll);} requestAnimationFrame(poll);

  /* ===== Directions & motions ===== */
  function tokenFromAxes(ax,ay,dz=0.5){let h=null,v=null;if(Math.abs(ax)>=dz)h=ax<0?'l':'r';if(Math.abs(ay)>=dz)v=ay<0?'u':'d';if(h&&v)return v+h;return h||v||'n';}
  function dirToImg(tok){const map={u:'u',d:'d',l:'b',r:'f',ul:'ub',ur:'uf',dl:'db',dr:'df'};if(!map[tok])return null;return `<img class=\"img\" src=\"images/${map[tok]}.png\" alt=\"${map[tok]}\">`;}
  let dirHistory=[]; let lastTok='n'; let lastUpPrefixAt=0;
  let editCapture=false; // controller capture mode
  let captureDirTok='n'; // buffered dir while capturing

function trackDirections(gp){
  const p=profiles[activeProfile];
  const dU=gp.buttons[12]?.pressed, dD=gp.buttons[13]?.pressed, dL=gp.buttons[14]?.pressed, dR=gp.buttons[15]?.pressed;
  let tok='n';
  if(dL) tok='l'; else if(dR) tok='r';
  if(dU) tok=(tok==='r')?'ur':(tok==='l')?'ul':'u';
  else if(dD) tok=(tok==='r')?'dr':(tok==='l')?'dl':'d';

  if(tok==='n') tok=tokenFromAxes(gp.axes[0]||0,gp.axes[1]||0,p.deadzone||0.5);

  const t=now();
  if(!dirHistory.length||dirHistory[dirHistory.length-1].token!==tok){
    dirHistory.push({t,token:tok});
    const win=Math.max(700, p.motionWindow||700)+200;
    while(dirHistory.length && (t-dirHistory[0].t) > win) dirHistory.shift();
  }
  updateCharge(tok);

  // Quick edits outside capture:
  if(!editCapture){
    // UP -> add j.
    if(currentSelectedChip && lastTok!=='u' && tok==='u' && (t - lastUpPrefixAt > 200)){
      if(selectedChips.size){ addJPrefixBulk(); } else { addJPrefix(currentSelectedChip); }
      lastUpPrefixAt = t;
    }
    // DOWN -> remove j.
    if(currentSelectedChip && lastTok!=='d' && tok==='d' && (t - lastDownRemoveAt > 200)){
      if(selectedChips.size){ removeJPrefixBulk(); } else { removeJPrefix(currentSelectedChip); }
      lastDownRemoveAt = t;
    }
  }

  // In controller capture, buffer direction only (no DOM spam)
  if(editCapture){ captureDirTok = tok; }
  lastTok=tok;
}

  function facingMap(tok){ if((profiles[activeProfile].facing||'right')==='right') return tok; return tok.replace(/l/g,'R').replace(/r/g,'l').replace(/R/g,'r'); }
  function compressedSeqWithin(ms){ const t=now(), start=t-ms; const seq=dirHistory.filter(e=>e.t>=start).map(e=>e.token).filter(x=>x!=='n').map(facingMap); const comp=[]; for(const s of seq){ if(!comp.length||comp[comp.length-1]!==s) comp.push(s);} return comp; }
  function matchPattern(seq, pattern){ let i=0; for(const p of pattern){ i=seq.indexOf(p,i); if(i===-1) return false; i++; } return true; }
  function detectMotionForButton(){ const p=profiles[activeProfile]; const seq=compressedSeqWithin(p.motionWindow||700);
    const tests=[ ['qcf',['d','dr','r']], ['qcb',['d','dl','l']], ['dpf',['r','d','dr']], ['dpb',['l','d','dl']], ['hcf',['l','d','r']], ['hcb',['r','d','l']] ];
    for(const [key,pat] of tests){ if(matchPattern(seq,pat)) return `<img class=\"img\" src=\"images/${key}.png\" alt=\"${key}\">`; }
    const set=new Set(seq); if(['u','d','l','r'].every(k=>set.has(k))) return `<img class=\"img\" src=\"images/360.png\" alt=\"360\">`;
    return null; }
  function snapshotDirection(){ const last=dirHistory.length?dirHistory[dirHistory.length-1].token:'n'; return last==='n'?null:last; }

  /* ===== Charge ===== */
  let currentDirTok='n', currentDirStart=0, lastCharged={tok:null, at:0};
  function updateCharge(latestTok){ const p=profiles[activeProfile]; const t=now(); if(latestTok!==currentDirTok){ if(currentDirTok!=='n'){ const heldMs=t-currentDirStart; const needMs=(p.chargeFrames||30)*(1000/60); if(heldMs>=needMs){ lastCharged={tok:currentDirTok, at:t}; } } currentDirTok=latestTok; currentDirStart=t; } }
  function isOpposite(a,b){ if(a?.includes('l') && b?.includes('r')) return true; if(a?.includes('r') && b?.includes('l')) return true; if(a?.includes('u') && b?.includes('d')) return true; if(a?.includes('d') && b?.includes('u')) return true; return false; }

  /* ===== Buttons & holds ===== */
function handleButtons(gp){
  const p=profiles[activeProfile];
  if(!prevButtons.length) prevButtons=gp.buttons.map(b=>b.pressed);
  const t=now();
  const justPressed=[], justReleased=[];

  for(let i=0;i<gp.buttons.length;i++){
    const pressed=!!gp.buttons[i].pressed, was=!!prevButtons[i];

    if(pressed && !was){

      // ===== Guided PRESET binding (ignore D-pad 12–15) =====
      if(presetBind.active){
        if(i>=12 && i<=15){
          // Ignore directional presses for binding—keep waiting
          prevButtons[i]=pressed;
          continue;
        }
        const label = presetBind.queue[presetBind.i];
        if(typeof label === 'string'){
          p.buttonLabels[i] = label;
          saveProfiles();
          refreshProfileUI();
        }
        stepPresetBindingAssigned();
        prevButtons[i]=pressed;
        continue; // do not create a chip for this press
      }
      // ======================================================

      const last=lastButtonTime.get(i)||0;

      if(t-last >= (p.repeatLockout||110)){

        // Controller-bound reset (clears + broadcasts)
        if((p.resetAction||'none')===`button:${i}`){
          clearOverlay();
          bus.emit('reset:action');
          lastButtonTime.set(i,t);
          prevButtons[i]=pressed;
          continue;
        }

        // In-chip capture mode: replace selected chip and continue
        if(editCapture && currentSelectedChip && i<12){
          replaceChipFromController(i);
          lastButtonTime.set(i,t);
          prevButtons[i]=pressed;
          continue;
        }

        // Insertion capture mode: create chip at pending position
        if(insertMode && insertMode.startsWith('controller') && i<12){
          completeInsertionFromController(i);
          lastButtonTime.set(i,t);
          prevButtons[i]=pressed;
          continue;
        }

        // Quick “j.” prefix via D-pad UP button index (12) when editing
        if(currentSelectedChip && i===12 && !editCapture){
          addJPrefix(currentSelectedChip);
          lastButtonTime.set(i,t);
          prevButtons[i]=pressed;
          continue;
        }

        justPressed.push(i);
        lastButtonTime.set(i,t);
      }
    }

    if(!pressed && was){ justReleased.push(i); }
    prevButtons[i]=pressed;
  }

  // ===== Handle new presses =====
  for(const i of justPressed){
    // Ignore D-pad as “buttons” for chip adds (12–15)
    if(i>=12 && i<=15) continue;
    if(editCapture && currentSelectedChip) continue;

    // Build the chip HTML (charge -> motion -> dir + button -> button)
    let html=null;
    const age = t-(lastCharged.at||0);
    const nowDir = snapshotDirection()||'';
    if(lastCharged.tok && age <= (p.chargeWindow||180) && isOpposite(lastCharged.tok, nowDir)){
      const first = dirToImg(lastCharged.tok)||lastCharged.tok.toUpperCase();
      const second= dirToImg(nowDir)||nowDir.toUpperCase();
      html = `${first} ${second} ${buttonHTML(i)}`;
      lastCharged.tok=null;
    }
    if(!html){
      const motionHTML = detectMotionForButton();
      if(motionHTML){ html = `${motionHTML} ${buttonHTML(i)}`; }
    }
    if(!html){
      const dirTok = snapshotDirection();
      if(dirTok){
        const dirHTML=dirToImg(dirTok)||dirTok.toUpperCase();
        html = `${dirHTML} + ${buttonHTML(i)}`;
      }else{
        html = buttonHTML(i);
      }
    }

    // Add the chip to the overlay
    const chip = addChipElHTML(html, (profiles[activeProfile].buttonBgColors[i]||'#f5f5f5'));

    // ===== Mash collapse pass =====
    const mashResult = updateMashAfterAdd(html, chip);
    if(mashResult === 'removed' || mashResult === 'collapsed'){
      continue;
    }

    // Hold tracking
    activeButtonChips.set(i,{
      chip,
      label:(profiles[activeProfile].buttonLabels[i]||`#${i}`),
      pressAt:t,
      held:false
    });

    const holdId=setTimeout(()=>{
      const obj=activeButtonChips.get(i);
      if(!obj) return;
      obj.held=true;
      mutateLabelText(obj.chip, obj.label, `[${obj.label}]`);
      rebuildBuffer();
    }, p.holdMs||250);
    holdTimers.set(i,holdId);
  }

  // ===== Handle releases =====
  for(const i of justReleased){
    const obj=activeButtonChips.get(i);
    const id=holdTimers.get(i);
    if(id) clearTimeout(id);
    holdTimers.delete(i);

    if(obj){
      if(obj.held){
        addChipElHTML(buttonHTML(i, `]${obj.label}[`), (profiles[activeProfile].buttonBgColors[i]||'#f5f5f5'));
      }
      activeButtonChips.delete(i);
      rebuildBuffer();
    }
  }
}




  function buttonHTML(btnIndex, override){ const p=profiles[activeProfile]; const text = override ?? (p.buttonLabels[btnIndex] || `#${btnIndex}`);
    const color = useGlobalColors?.checked ? getComputedStyle(document.documentElement).getPropertyValue('--chip-text').trim() : (p.buttonColors[btnIndex] || '#000000');
    return `<span style=\"color:${color}\">${escapeHtml(text)}</span>`; }

  function addJPrefix(chip){ const lastSpan=chip.querySelector('span:last-of-type'); if(!lastSpan) return; const cur=lastSpan.textContent.trim(); if(cur.toLowerCase().startsWith('j.')) return; lastSpan.textContent='j.'+cur; rebuildBuffer(); }

  function replaceChipFromController(btnIndex){ if(!currentSelectedChip) return; const dirTok = editCapture ? captureDirTok : (snapshotDirection()||'n'); const motionHTML = detectMotionForButton(); const p=profiles[activeProfile]; let finalLabel=(p.buttonLabels[btnIndex]||`#${btnIndex}`); if(dirTok==='u' && !/^j\./i.test(finalLabel)) finalLabel='j.'+finalLabel; let html; if(motionHTML){ html = `${motionHTML} ${buttonHTML(btnIndex, finalLabel)}`; } else if(dirTok && dirTok!=='n'){ const dirHTML=dirToImg(dirTok)||dirTok.toUpperCase(); html = `${dirHTML} + ${buttonHTML(btnIndex, finalLabel)}`; } else { html = buttonHTML(btnIndex, finalLabel); } currentSelectedChip.innerHTML=html; rebuildBuffer(); closePopover(); bus.emit('chip:replace', currentSelectedChip); pushHistory('Replace chip'); }

  function mutateLabelText(chipEl, oldText, newText){ const spans = chipEl.querySelectorAll('span'); for(let i = spans.length - 1; i >= 0; i--){ const sp = spans[i]; if(sp.textContent.trim() === oldText){ sp.textContent = newText; return; } } chipEl.innerHTML = chipEl.innerHTML.replace(new RegExp(escapeRegExp(oldText) + '(?!.*' + escapeRegExp(oldText) + ')'), ' ' + newText + ' '); }
  function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function escapeHtml(s=''){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

  /* ===== Chip selection + editor popover ===== */
  popEl=null;
/* ===== Chip selection + editor popover (multi-aware) ===== */


function selectChip(chip, opts={}){
  const {add=false, toggle=false} = opts;
  if(toggle){
    if(selectedChips.has(chip)) removeFromSelection(chip);
    else addToSelection(chip);
    return;
  }
  if(add){
    addToSelection(chip);
    return;
  }
  // default: single select
  selectOnly(chip);
}

function deselectChip(){
  deselectAll();
  closePopover();
}


/* ===== Marquee selection (Shift + drag) ===== */
overlay.addEventListener('mousedown', (e)=>{
  if(e.button !== 0) return;

  const chip = chipFromEventTarget(e.target);
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;

  if(chip && !additive){
    // normal single click
    selectChip(chip);
    openPopover(chip);
    e.preventDefault();
    return;
  }

  if(chip && additive){
    // toggle chip into selection
    selectChip(chip, {toggle:true});
    e.preventDefault();
    return;
  }

  // Start marquee only if Shift is held on empty overlay area
  if(!chip && e.shiftKey){
    marqueeActive = true;
    marqueeStart = {x:e.clientX, y:e.clientY};
    marquee = document.createElement('div');
    marquee.style.cssText = 'position:fixed;z-index:99999;border:1px solid #4c8dff;background:rgba(76,141,255,.15);pointer-events:none;';
    document.body.appendChild(marquee);
    deselectAll();
    e.preventDefault();
  }
  
  // For empty overlay clicks without shift, let the first handler prevent caret
  // and let the document click handler close popover
});

/* ===== Right-click context menu ===== */
overlay.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  
  const chip = chipFromEventTarget(e.target);
  showContextMenu(e.clientX, e.clientY, chip);
});

// Hide context menu when clicking elsewhere
document.addEventListener('click', (e) => {
  if (contextMenu && !contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

// Hide context menu on escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && contextMenu && contextMenu.style.display !== 'none') {
    hideContextMenu();
  }
});

window.addEventListener('mousemove', (e)=>{
  if(!marqueeActive || !marquee) return;
  const x1 = Math.min(marqueeStart.x, e.clientX);
  const y1 = Math.min(marqueeStart.y, e.clientY);
  const x2 = Math.max(marqueeStart.x, e.clientX);
  const y2 = Math.max(marqueeStart.y, e.clientY);
  marquee.style.left = x1+'px';
  marquee.style.top = y1+'px';
  marquee.style.width = (x2-x1)+'px';
  marquee.style.height = (y2-y1)+'px';

  // hit test chips
  const box = {left:x1, top:y1, right:x2, bottom:y2};
  selectedChips.clear();
  overlay.querySelectorAll('.chip').forEach(ch=>{
    const r = ch.getBoundingClientRect();
    const c = {left:r.left, top:r.top, right:r.right, bottom:r.bottom};
    if(rectsIntersect(box,c)) selectedChips.add(ch);
  });
  currentSelectedChip = selectedChips.size ? Array.from(selectedChips)[0] : null;
  updateSelectedStyles();
});

window.addEventListener('mouseup', ()=>{
  if(!marqueeActive) return;
  marqueeActive = false;
  if(marquee){ marquee.remove(); marquee=null; }

  // prevent the immediate "outside click" from clearing this selection
  suppressNextDocClick = true;

  if(selectedChips.size > 1){
    const first = Array.from(selectedChips)[0];
    openPopover(first); // multi popover
  }
});


/* ===== Click handling on chips (open popover, respect multi) ===== */
/* Click on chips: normal or additive select, open popover */
overlay.addEventListener('click', (e)=>{
  const ch = chipFromEventTarget(e.target);
  if(!ch) {
    // Click on empty overlay space - let document click handler close popover
    return;
  }
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  selectChip(ch, additive ? {toggle:true} : {});
  openPopover(ch);
  e.stopPropagation();
});


// Close popover when clicking anywhere that's not inside the popup.
// (Still respects suppressNextDocClick from marquee mouseup.)
document.addEventListener('click', (e)=>{
  if (suppressNextDocClick) {
    suppressNextDocClick = false;   // swallow the post-marquee click
    return;
  }
  // If there's a popover and the click wasn't inside it, close it.
  if (popEl && !e.target.closest('.popover')) {
    closePopover();
    // Note: we keep the selection; remove the next line if you also want to clear selection.
    // deselectAll();
  }
});




/* ===== Keyboard shortcuts for bulk & quick edits ===== */
window.addEventListener('keydown',(e)=>{
  const k = (e.key||'').toLowerCase();
  const isInput = /input|textarea/i.test(document.activeElement?.tagName||'');
  if(isInput) return;

  // Add j. to selection
  if((k==='arrowup' || k===' ') && selectedChips.size){
    e.preventDefault();
    addJPrefixBulk();
  }

  // Remove j. from selection
  if(k==='arrowdown' && selectedChips.size){
    e.preventDefault();
    removeJPrefixBulk();
  }

  // Delete selected
  if((k==='delete' || k==='backspace') && selectedChips.size){
    e.preventDefault();
    deleteSelectedBulk();
  }

  // Select all chips (Ctrl/Cmd + A)
  if(k==='a' && (e.metaKey || e.ctrlKey)){
    e.preventDefault();
    selectedChips.clear();
    overlay.querySelectorAll('.chip').forEach(ch=>selectedChips.add(ch));
    currentSelectedChip = selectedChips.size ? Array.from(selectedChips)[0] : null;
    updateSelectedStyles();
    if(currentSelectedChip) openPopover(currentSelectedChip);
  }
});




function openPopover(target, startInEdit=false){
  closePopover();

  const isMulti = selectedChips.size > 1;
  const rect = target.getBoundingClientRect();
  const p = document.createElement('div');
  p.className = 'popover';
  p.style.left = Math.max(8, Math.min(window.innerWidth-300, rect.left))+'px';
  p.style.top  = (rect.bottom + 6)+'px';

  if(!isMulti){
    // single-chip popover (keeps your existing affordances)
    const lastSpan = target.querySelector('span:last-of-type');
    const curTxt = lastSpan ? lastSpan.textContent.trim() : '';
    p.innerHTML = `
      <h5>Chip actions</h5>
      <div class="row" style="grid-template-columns:1fr auto">
        <input id="renameInput" type="text" placeholder="New label…" value="${(curTxt||'').replace(/"/g,'&quot;')}"/>
        <button id="applyBtn" class="btn">Apply</button>
      </div>
      <div class="row" style="margin-top:8px;grid-template-columns:1fr 1fr">
        <button id="captureBtn" class="btn">Use controller…</button>
        <button id="delBtn" class="btn danger">Delete</button>
      </div>
      <div class="row" style="margin-top:8px;grid-template-columns:1fr 1fr">
        <button id="clearDirBtn" class="btn">Clear direction</button>
        <button id="clearMotionBtn" class="btn">Clear motion</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button id="bulkToSingleBtn" class="btn ghost">Switch to Bulk (select more)</button>
      </div>
      <div class="tiny" style="margin-top:6px">Tips: Shift-drag to marquee select · Shift-click adds to selection · Ctrl/Cmd-A selects all · Delete removes.</div>
    `;
    document.body.appendChild(p);
    popEl = p;

    const renameInput=$('#renameInput'), applyBtn=$('#applyBtn'), delBtn=$('#delBtn'), captureBtn=$('#captureBtn');
    const clearDirBtn=$('#clearDirBtn'), clearMotionBtn=$('#clearMotionBtn');

    if(startInEdit){ renameInput?.blur(); window.ComboOverlay?.ctrl?.startCapture?.(); } else { renameInput?.focus(); }
    applyBtn?.addEventListener('click', ()=>{
      const newTxt = renameInput?.value.trim();
      if(newTxt && lastSpan && newTxt!==curTxt){
        lastSpan.textContent = newTxt;
        window.ComboOverlay?.rebuildBuffer?.();
      }
      closePopover();
    });
    renameInput?.addEventListener('apply-enter', ()=>applyBtn?.click());
    delBtn?.addEventListener('click', ()=>{ removeChip(target); closePopover(); });
    captureBtn?.addEventListener('click', ()=> window.ComboOverlay?.ctrl?.startCapture?.());
    clearDirBtn?.addEventListener('click', ()=>{ 
      const imgs=[...target.querySelectorAll('img')];
      for(const img of imgs){ const a=img.alt; if(['u','d','b','f','ub','uf','db','df'].includes(a)) img.remove(); }
      const span=target.querySelector('span:last-of-type');
      if(span){ span.textContent=span.textContent.trim().replace(/^j\./i,''); }
      window.ComboOverlay?.rebuildBuffer?.();
    });
    clearMotionBtn?.addEventListener('click', ()=>{
      [...target.querySelectorAll('img')].forEach(img=>{
        if(['qcf','qcb','dpf','dpb','hcf','hcb','360'].includes(img.alt)) img.remove();
      });
      window.ComboOverlay?.rebuildBuffer?.();
    });

  }else{
    // multi-chip popover
    p.innerHTML = `
      <h5>${selectedChips.size} chips selected</h5>
      <div class="row" style="grid-template-columns:1fr 1fr">
        <button id="bulkJ" class="btn">Add j. to all</button>
        <button id="bulkDelete" class="btn danger">Delete all</button>
      </div>
      <div class="row" style="grid-template-columns:1fr 1fr; margin-top:8px">
        <button id="bulkClearDir" class="btn">Clear direction</button>
        <button id="bulkClearMotion" class="btn">Clear motion</button>
      </div>
      <div class="row" style="grid-template-columns:1fr auto; margin-top:8px">
        <input id="bulkRenameTail" type="text" placeholder="Set new tail label…"/>
        <button id="bulkApplyRename" class="btn">Apply</button>
      </div>
      <div class="tiny" style="margin-top:6px">Tips: Shift-drag to marquee select · Shift/Ctrl-click adds/toggles · Delete removes.</div>
    `;
    document.body.appendChild(p);
    popEl = p;

    $('#bulkJ')?.addEventListener('click', ()=>{ addJPrefixBulk(); closePopover(); });
    $('#bulkDelete')?.addEventListener('click', ()=>{ deleteSelectedBulk(); closePopover(); });
    $('#bulkClearDir')?.addEventListener('click', ()=>{ clearDirBulk(); closePopover(); });
    $('#bulkClearMotion')?.addEventListener('click', ()=>{ clearMotionBulk(); closePopover(); });
    $('#bulkApplyRename')?.addEventListener('click', ()=>{
      const v = $('#bulkRenameTail')?.value?.trim();
      if(v) renameTailBulk(v);
      closePopover();
    });
  }
}

function closePopover(){
  if(popEl){ popEl.remove(); popEl=null; }
}

  function closePopover(){ if(popEl){ popEl.remove(); popEl=null; } if(currentSelectedChip) currentSelectedChip.classList.remove('capture'); editCapture=false; }

  function removeChip(chip){ if(!chip) return; const prev = chip.previousSibling, next = chip.nextSibling; if(prev && prev.classList && prev.classList.contains('sep')) prev.remove(); else if(next && next.classList && next.classList.contains('sep')) next.remove(); chip.remove(); if(currentSelectedChip===chip) currentSelectedChip=null; rebuildBuffer(); bus.emit('chip:remove', chip); pushHistory('Remove chip'); }

  function startControllerCapture(chip){ editCapture=true; selectChip(chip); chip.classList.add('capture'); setStatus('Capture: tilt D‑pad/stick for direction (buffered), press a button to set; UP also prefixes j.'); }

  /* ===== Gamepad loop start ===== */
  requestAnimationFrame(poll);

  /* ===== Global API (exposed) ===== */
  const API = {
    version:'13.7', bus,
    get overlay(){ return overlay; },
    get selectedChip(){ return currentSelectedChip; },
    get useGlobalColors(){ return !!useGlobalColors?.checked; },
    get profiles(){ return profiles; },
    get activeProfile(){ return activeProfile; },
    set activeProfile(v){ activeProfile = v; saveActive(); refreshProfileUI(); },
    addChipHTML: addChipElHTML,
    removeChip, selectChip, openPopover, closePopover,
    buttonHTML, addJPrefix, replaceChipFromController,
    clearOverlay, rebuildBuffer, currentSeparator,
    ctrl:{ startCapture(){ if(currentSelectedChip) startControllerCapture(currentSelectedChip); } },
    gamepad:{ snapshotDirection, detectMotionForButton },
    png:{ copyPNG, exportPNG },
    settings:{ applyCssKnobs },
    on:(evt,fn)=>bus.on(evt,fn),
    setStatus,
    undo, redo,
    get suppressHistory(){ return suppressHistory; },
    set suppressHistory(v){ suppressHistory = !!v; }
  };
  window.ComboOverlay = API;

  /* ===== Keyboard shortcuts & OBS toggle ===== */
  if(q.get('obs')==='1'||window.obsstudio){document.body.classList.add('obs');}
  if(q.get('edit')==='1'){document.body.classList.remove('obs');}
  // window.addEventListener('keydown',(e)=>{const k=e.key.toLowerCase();
  //   if(k==='e') document.body.classList.toggle('obs');
  //   if(k==='c') clearOverlay();
  //   if((k==='delete'||k==='backspace') && currentSelectedChip){ removeChip(currentSelectedChip); closePopover(); }
  //   if((k==='arrowup' || k===' ') && currentSelectedChip && !editCapture){ addJPrefix(currentSelectedChip); }
  //   const ri=$('#renameInput'); if(ri && document.activeElement===ri){ if(k==='enter'){ ri.dispatchEvent(new Event('apply-enter')); } if(k==='escape'){ closePopover(); }}
  // });

  /* ===== Global hotkeys with typing lockout ===== */
function isTyping(){
  const ae = document.activeElement;
  if(!ae) return false;
  const tag = (ae.tagName||'').toLowerCase();
  if(tag === 'input' || tag === 'textarea') return true;
  if(ae.isContentEditable) return true;
  return false;
}

/* Capture-phase guard: if typing, swallow global hotkeys */
window.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  const tag = (ae?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || ae?.isContentEditable) {
    // stop ALL other keydown handlers from seeing this event
    e.stopImmediatePropagation?.();
    e.stopPropagation();
    // don't preventDefault so the field still receives the character / backspace
  }
}, true); // <-- capture phase


// OBS / editor / overlay shortcuts
window.addEventListener('keydown',(e)=>{
  if(isTyping()) return; // <-- lockout while typing

  const k=(e.key||'').toLowerCase();

  if(k==='e') document.body.classList.toggle('obs');
  if(k==='p'){
    // If you have setPracticeMode available in scope, call it; otherwise toggle the UI like before
    const toggleBtn = document.querySelector('#practiceToggle');
    toggleBtn?.click();
  }
  if(k==='c') clearOverlay();

  // Undo/Redo shortcuts
  if(k==='z' && (e.metaKey || e.ctrlKey)){
    e.preventDefault();
    if(e.shiftKey){
      redo(); // Ctrl/Cmd+Shift+Z
    } else {
      undo(); // Ctrl/Cmd+Z
    }
  }
  if(k==='y' && (e.metaKey || e.ctrlKey)){
    e.preventDefault();
    redo(); // Ctrl/Cmd+Y
  }

  // single-selection delete fallback
  if((k==='delete'||k==='backspace') && window.ComboOverlay?.selectedChip){
    removeChip(window.ComboOverlay.selectedChip);
    window.ComboOverlay.closePopover?.();
  }

  // Quick j. on primary selected chip
  if((k==='arrowup' || k===' ') && window.ComboOverlay?.selectedChip && !editCapture){
    addJPrefix(window.ComboOverlay.selectedChip);
  }

  // Multi-select: Ctrl/Cmd+A handled elsewhere; keep it global too if you want
});


  /* ===== Init ===== */
  refreshProfileUI();
  applyCssKnobs();
  
  // Create initial history snapshot
  pushHistory('Initial state');
})();
