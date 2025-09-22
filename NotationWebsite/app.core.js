// /* Combo Overlay – Core (v13.7)
//    Responsibilities:
//    - UI wiring (profiles, colors, PNG export, OBS URL)
//    - Overlay chip add/remove/edit + popover
//    - Gamepad detection + live capture (including j. prefix via UP)
//    - Public API surface for feature modules (e.g., recording)

//    Modules can hook via window.ComboOverlay.on(event, fn)
//    Events: 'chip:add' (chipEl), 'chip:remove' (chipEl), 'chip:replace' (chipEl),
//            'status' (msg), 'overlay:clear'
// */
// (function(){
//   const $ = (s)=>document.querySelector(s);
//   const overlay = $('#overlay');
//   const statusEl = $('#status');
//   const q = new URLSearchParams(location.search);

//   /* ===== Simple event bus ===== */
//   const bus = {
//     listeners:new Map(),
//     on(evt,fn){ const arr=this.listeners.get(evt)||[]; arr.push(fn); this.listeners.set(evt,arr); },
//     emit(evt,...args){ const arr=this.listeners.get(evt); if(arr) for(const f of arr){ try{ f(...args);}catch(e){ console.warn('[bus]',e); } } }
//   };
//   function setStatus(msg){ if(statusEl) statusEl.textContent = msg; console.log('[overlay]', msg); bus.emit('status', msg); }

//   /* ===== Profiles / persistence ===== */
//   const LS_PROFILES='gp_profiles_obs_v13_7';
//   const LS_ACTIVE='gp_active_profile_obs_v13_7';
//   const DEFAULT_BUTTON_LABELS=['L','M','H','S','LB','RB','LT','RT','Select','Start','L3','R3','D↑','D↓','D←','D→'];
//   const DEFAULT_BUTTON_COLORS=Array(16).fill('#000000');
//   const DEFAULT_BUTTON_BG=Array(16).fill('#f5f5f5');
//   function defaultProfile(){return {name:'Default',buttonLabels:[...DEFAULT_BUTTON_LABELS],buttonColors:[...DEFAULT_BUTTON_COLORS],buttonBgColors:[...DEFAULT_BUTTON_BG],deadzone:0.5,chordWindow:80,repeatLockout:110,holdMs:250,motionWindow:700,motionCoupleMs:130,chargeFrames:30,chargeWindow:180,facing:'right',resetAction:'none',separator:'>'}};
//   function loadProfiles(){try{const raw=localStorage.getItem(LS_PROFILES); if(!raw) return [defaultProfile()]; const arr=JSON.parse(raw); return Array.isArray(arr)&&arr.length?arr:[defaultProfile()];}catch{return [defaultProfile()];}}
//   function saveProfiles(){localStorage.setItem(LS_PROFILES, JSON.stringify(profiles));}
//   function loadActive(){const v=parseInt(localStorage.getItem(LS_ACTIVE)||'0',10);return Number.isFinite(v)&&v>=0&&v<profiles.length? v:0;}
//   function saveActive(){localStorage.setItem(LS_ACTIVE, String(activeProfile));}
//   let profiles=loadProfiles(); let activeProfile=loadActive();

//   // Import profiles via ?config or ?configUrl
//   (async function bootConfigFromQuery(){
//     try{
//       if(q.get('config')){
//         const json=JSON.parse(atob(q.get('config'))); if(Array.isArray(json)&&json.length){ profiles=json; activeProfile=0; saveProfiles(); saveActive(); refreshProfileUI(); }
//       }else if(q.get('configUrl')){
//         const url=q.get('configUrl'); if(/^https?:/i.test(url)){ const res=await fetch(url,{cache:'no-store'}); const json=await res.json(); if(Array.isArray(json)&&json.length){ profiles=json; activeProfile=0; saveProfiles(); saveActive(); refreshProfileUI(); } }
//       }
//     }catch(e){ console.warn('Config import error', e); }
//   })();

//   // UI refs
//   const profileSelect=$('#profileSelect'), profileName=$('#profileName');
//   const newProfileBtn=$('#newProfile'), dupProfileBtn=$('#dupProfile'), delProfileBtn=$('#delProfile'), saveProfileBtn=$('#saveProfile');
//   const exportBtn=$('#exportBtn'), importBtn=$('#importBtn'), importInput=$('#importInput');
//   const makeObsUrlBtn=$('#makeObsUrl');
//   const buttonMapTable=$('#buttonMapTable');

//   const chipFontInp=$('#chipFont'), chipImgHInp=$('#chipImgH'), chipPadXInp=$('#chipPadX'), chipPadYInp=$('#chipPadY'),
//         chipGapInp=$('#chipGap'), chipRadiusInp=$('#chipRadius'), overlayWidthInp=$('#overlayWidth'),
//         separatorInp=$('#separator'), chipBgAllInp=$('#chipBgAll'), chipTextAllInp=$('#chipTextAll'), useGlobalColors=$('#useGlobalColors');

//   const resetSel=$('#resetAction'); const facingSel=$('#facing');

//   function applyCssKnobs(){
//     document.documentElement.style.setProperty('--chip-font', chipFontInp.value+'px');
//     document.documentElement.style.setProperty('--chip-img-h', chipImgHInp.value+'px');
//     document.documentElement.style.setProperty('--chip-pad-x', chipPadXInp.value+'px');
//     document.documentElement.style.setProperty('--chip-pad-y', chipPadYInp.value+'px');
//     document.documentElement.style.setProperty('--chip-gap', chipGapInp.value+'px');
//     document.documentElement.style.setProperty('--chip-radius', chipRadiusInp.value+'px');
//     document.documentElement.style.setProperty('--overlay-width', overlayWidthInp.value+'px');
//     document.documentElement.style.setProperty('--chip-bg', chipBgAllInp.value);
//     document.documentElement.style.setProperty('--chip-text', chipTextAllInp.value);
//     document.body.classList.toggle('global-override', !!useGlobalColors.checked);
//   }

//   const practiceToggle = document.querySelector('#practiceToggle');
//     const practiceBar    = document.querySelector('#practiceBar');
//     let practiceMode = false;

//     function setPracticeMode(on){
//     practiceMode = !!on;
//     document.body.classList.toggle('practice', practiceMode);
//     if (practiceBar) practiceBar.style.display = practiceMode ? '' : 'none';
//     if (practiceToggle) practiceToggle.textContent = `Practice Mode: ${practiceMode ? 'On' : 'Off'} (P)`;
//     // status hint
//     setStatus(practiceMode ? 'Practice Mode ON: use compact playback controls.' : 'Practice Mode OFF.');
//     }

//     practiceToggle?.addEventListener('click', ()=> setPracticeMode(!practiceMode));

//     // Hotkey: P toggles Practice Mode
//     window.addEventListener('keydown', (e)=>{
//     const k=(e.key||'').toLowerCase();
//     if(k==='p'){ e.preventDefault(); setPracticeMode(!practiceMode); }
//     });


//   function setInputValue(sel, val){ const el=document.querySelector(sel); if(el) el.value=val; }

//   function refreshProfileUI(){ if(activeProfile<0||activeProfile>=profiles.length) activeProfile=0; const p=profiles[activeProfile];
//     if(profileSelect) profileSelect.innerHTML=profiles.map((pp,i)=>`<option value="${i}" ${i===activeProfile?'selected':''}>${escapeHtml(pp.name||`Profile ${i+1}`)}</option>`).join('');
//     if(profileName) profileName.value=p.name||''; renderButtonMap();
//     if(resetSel) resetSel.innerHTML = ['none', ...Array.from({length:16},(_,i)=>`button:${i}`)].map(v=>`<option value="${v}" ${p.resetAction===v?'selected':''}>${v}</option>`).join('');
//     if(facingSel) facingSel.value=p.facing||'right';
//     setInputValue('#deadzone',       p.deadzone);
//     setInputValue('#chordWindow',    p.chordWindow);
//     setInputValue('#repeatLockout',  p.repeatLockout);
//     setInputValue('#holdMs',         p.holdMs);
//     setInputValue('#motionWindow',   p.motionWindow);
//     setInputValue('#motionCoupleMs', p.motionCoupleMs);
//     setInputValue('#chargeFrames',   p.chargeFrames);
//     setInputValue('#chargeWindow',   p.chargeWindow);
//     setInputValue('#indicatorMs', p.indicatorMs ?? 1000);
//     applyCssKnobs();
//   }

//   function renderButtonMap(){ const p=profiles[activeProfile]; if(!buttonMapTable) return; let rows='<tr><th>#</th><th>Label</th><th>Text</th><th>Chip BG</th></tr>'; const N=Math.max(16,p.buttonLabels.length);
//     for(let i=0;i<N;i++){ const label=p.buttonLabels[i]??''; const color=p.buttonColors[i]??'#000000'; const bg=p.buttonBgColors[i]??'#f5f5f5';
//       rows+=`<tr><td>#${i}</td><td><input data-btn="${i}" class="btn-label" type="text" value="${escapeHtml(label)}"></td><td><input data-btn-color="${i}" class="btn-color" type="color" value="${color}"></td><td><input data-btn-bg="${i}" class="btn-bg" type="color" value="${bg}"></td></tr>`; }
//     buttonMapTable.innerHTML=rows;
//   }

//   profileSelect?.addEventListener('change',e=>{activeProfile=parseInt(e.target.value,10);saveActive();refreshProfileUI();});
//   newProfileBtn?.addEventListener('click',()=>{profiles.push(defaultProfile());activeProfile=profiles.length-1;saveProfiles();saveActive();refreshProfileUI();});
//   dupProfileBtn?.addEventListener('click',()=>{const copy=JSON.parse(JSON.stringify(profiles[activeProfile])); copy.name=(copy.name||'Profile')+' (copy)'; profiles.push(copy); activeProfile=profiles.length-1; saveProfiles(); saveActive(); refreshProfileUI();});
//   delProfileBtn?.addEventListener('click',()=>{ if(profiles.length<=1) return; profiles.splice(activeProfile,1); activeProfile=0; saveProfiles(); saveActive(); refreshProfileUI();});
//   saveProfileBtn?.addEventListener('click',()=>{ const p=profiles[activeProfile]; p.name=profileName?.value.trim()||`Profile ${activeProfile+1}`; p.facing=facingSel?.value||p.facing; p.resetAction=resetSel?.value||p.resetAction; p.separator=separatorInp.value||'>'; p.deadzone=parseFloat($('#deadzone')?.value)||p.deadzone; p.chordWindow=parseInt($('#chordWindow')?.value)||p.chordWindow; p.repeatLockout=parseInt($('#repeatLockout')?.value)||p.repeatLockout; p.holdMs=parseInt($('#holdMs')?.value)||p.holdMs; p.motionWindow=parseInt($('#motionWindow')?.value)||p.motionWindow; p.motionCoupleMs=parseInt($('#motionCoupleMs')?.value)||p.motionCoupleMs; p.chargeFrames=parseInt($('#chargeFrames')?.value)||p.chargeFrames; p.chargeWindow=parseInt($('#chargeWindow')?.value)||p.chargeWindow; saveProfiles(); refreshProfileUI();});

//   exportBtn?.addEventListener('click',()=>{const blob=new Blob([JSON.stringify(profiles,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='gamepad_profiles.json'; a.click(); URL.revokeObjectURL(url);});
//   importBtn?.addEventListener('click',()=>importInput?.click());
//   importInput?.addEventListener('change',async(e)=>{const f=e.target.files?.[0]; if(!f) return; const text=await f.text(); try{ const arr=JSON.parse(text); if(Array.isArray(arr)&&arr.length){ profiles=arr; activeProfile=0; saveProfiles(); saveActive(); refreshProfileUI(); } }catch(err){ console.warn('Import error', err); }});
//   makeObsUrlBtn?.addEventListener('click',()=>{ try{ const b64=btoa(JSON.stringify(profiles)); const here=location.href.split('?')[0]; const url=`${here}?obs=1&config=${b64}`; navigator.clipboard?.writeText(url); setStatus('Copied OBS URL with embedded config'); }catch{ setStatus('Could not encode config (too large?)'); }});

//   // Live CSS knobs + global override
//   document.addEventListener('input',(e)=>{
//     const p=profiles[activeProfile]; if(!p) return; const t=e.target;
//     if(t.matches?.('.btn-label')) p.buttonLabels[parseInt(t.dataset.btn,10)] = t.value;
//     if(t.matches?.('.btn-color')) p.buttonColors[parseInt(t.dataset.btnColor,10)] = t.value;
//     if(t.matches?.('.btn-bg')) p.buttonBgColors[parseInt(t.dataset.btnBg,10)] = t.value;
//     if([chipFontInp,chipImgHInp,chipPadXInp,chipPadYInp,chipGapInp,chipRadiusInp,overlayWidthInp,chipBgAllInp,chipTextAllInp].includes(t)) applyCssKnobs();
//     if(t===separatorInp){ p.separator=separatorInp.value||'>'; rebuildBuffer(); }
//     if(t===useGlobalColors){ applyCssKnobs(); }
//     saveProfiles();
//   });

//   /* ===== Drag & Drop import ===== */
//   ;['dragenter','dragover','drop','dragleave'].forEach(evt=>window.addEventListener(evt,(e)=>{ if(evt!=='drop') e.preventDefault(); if(evt==='drop'){ const f=e.dataTransfer?.files?.[0]; if(f){ f.text().then(txt=>{ try{const arr=JSON.parse(txt); if(Array.isArray(arr)&&arr.length){ profiles=arr; activeProfile=0; saveProfiles(); saveActive(); refreshProfileUI(); setStatus('Imported profile (drag & drop)'); } }catch(err){ console.warn('DnD import error',err); } }); } } }));

//   /* ===== Overlay helpers ===== */
//   function addSeparator(){ if(overlay.children.length){const s=document.createElement('span');s.className='sep'; s.textContent=(profiles[activeProfile].separator||'>'); overlay.appendChild(s);} }
//   function currentSeparator(){ return ' ' + (profiles[activeProfile].separator||'>') + ' '; }
//   function rebuildBuffer(){ const chips=[...overlay.querySelectorAll('.chip')]; buffer = chips.map(ch=>ch.innerText.trim()); }
//   let buffer=[];

//   function addChipElHTML(html, perButtonBg){
//     if(overlay.children.length) addSeparator();
//     const c=document.createElement('span'); c.className='chip'; c.innerHTML=html; c.tabIndex=0;
//     if(!useGlobalColors?.checked && perButtonBg) c.style.backgroundColor = perButtonBg;
//     c.addEventListener('click', (ev)=>{ selectChip(c); openPopover(c); ev.stopPropagation(); });
//     c.addEventListener('dblclick', (ev)=>{ selectChip(c); openPopover(c, true); ev.stopPropagation(); });
//     overlay.appendChild(c); overlay.scrollLeft=overlay.scrollWidth; rebuildBuffer();
//     bus.emit('chip:add', c);
//     return c;
//   }

//   function clearOverlay(){ overlay.innerHTML=''; buffer.length=0; activeButtonChips.clear(); lastCharged={tok:null,at:0}; closePopover(); currentSelectedChip=null; editCapture=false; bus.emit('overlay:clear'); }
//   $('#clearBtn')?.addEventListener('click', clearOverlay);
//   $('#copyBtn')?.addEventListener('click', ()=>{ const txt=buffer.join(currentSeparator().trim()); navigator.clipboard?.writeText(txt); setStatus('Copied text.'); });
//   let modeLive=true; $('#toggleMode')?.addEventListener('click',()=>{ modeLive=!modeLive; $('#toggleMode').textContent='Mode: '+(modeLive?'Live':'Record'); setStatus('Mode toggled.'); });

//   // PNG Copy/Export
//   async function overlayToCanvas(){
//     const node=overlay; const rect=node.getBoundingClientRect();
//     const width=Math.ceil(rect.width); const height=Math.ceil(rect.height);
//     const inlineStyles=[...document.head.querySelectorAll('style')].map(s=>s.textContent).join('\n');
//     const html = `<div xmlns="http://www.w3.org/1999/xhtml" class="export-root">`+
//                  `<style>${inlineStyles}</style>`+
//                  `<div id="overlay" style="max-width:${width}px">${node.innerHTML}</div>`+
//                  `</div>`;
//     const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>`+
//                 `<foreignObject width='100%' height='100%'>${html}</foreignObject>`+
//                 `</svg>`;
//     const svgBlob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'}); const url=URL.createObjectURL(svgBlob);
//     await new Promise(r=>requestAnimationFrame(r));
//     const img=new Image(); img.decoding='async'; img.onload=()=>URL.revokeObjectURL(url); img.src=url; await img.decode();
//     const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height; const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0);
//     return canvas;
//   }
//   async function copyPNG(){ try{ const canvas=await overlayToCanvas(); const blob=await new Promise(res=>canvas.toBlob(res,'image/png')); await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]); setStatus('Copied overlay as PNG to clipboard.'); }catch(err){ console.warn(err); setStatus('Copy PNG failed (browser permissions?)'); } }
//   async function exportPNG(){ try{ const canvas=await overlayToCanvas(); const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download='overlay.png'; a.click(); setStatus('Exported overlay as PNG.'); }catch(err){ console.warn(err); setStatus('Export PNG failed.'); } }
//   $('#copyPngBtn')?.addEventListener('click', copyPNG);
//   $('#exportPngBtn')?.addEventListener('click', exportPNG);

//   /* ===== Gamepad ===== */
//   let gamepadIndex=null; let prevButtons=[]; let lastButtonTime=new Map();
//   const holdTimers=new Map();
//   const activeButtonChips=new Map(); // declared once
//   window.addEventListener('gamepadconnected',e=>{gamepadIndex=e.gamepad.index;prevButtons=e.gamepad.buttons.map(b=>b.pressed); setStatus(`Connected: ${e.gamepad.id}`);});
//   window.addEventListener('gamepaddisconnected',()=>{gamepadIndex=null; setStatus('Gamepad disconnected');});
//   function now(){return performance.now();}
//   function poll(){const gps=navigator.getGamepads?.(); let gp=(gamepadIndex!=null)?gps[gamepadIndex]:null; if(!gp){for(const g of gps){if(g){gp=g;gamepadIndex=g.index;prevButtons=g.buttons.map(b=>b.pressed);break;}}}
//     if(gp){handleButtons(gp);trackDirections(gp);} requestAnimationFrame(poll);} requestAnimationFrame(poll);

//   /* ===== Directions & motions ===== */
//   function tokenFromAxes(ax,ay,dz=0.5){let h=null,v=null;if(Math.abs(ax)>=dz)h=ax<0?'l':'r';if(Math.abs(ay)>=dz)v=ay<0?'u':'d';if(h&&v)return v+h;return h||v||'n';}
//   function dirToImg(tok){const map={u:'u',d:'d',l:'b',r:'f',ul:'ub',ur:'uf',dl:'db',dr:'df'};if(!map[tok])return null;return `<img class=\"img\" src=\"images/${map[tok]}.png\" alt=\"${map[tok]}\">`;}
//   let dirHistory=[]; let lastTok='n'; let lastUpPrefixAt=0;
//   let editCapture=false; // controller capture mode
//   let captureDirTok='n'; // buffered dir while capturing

//   function trackDirections(gp){
//     const p=profiles[activeProfile];
//     const dU=gp.buttons[12]?.pressed, dD=gp.buttons[13]?.pressed, dL=gp.buttons[14]?.pressed, dR=gp.buttons[15]?.pressed;
//     let tok='n'; if(dL) tok='l'; else if(dR) tok='r'; if(dU) tok=(tok==='r')?'ur':(tok==='l')?'ul':'u'; else if(dD) tok=(tok==='r')?'dr':(tok==='l')?'dl':'d';
//     if(tok==='n') tok=tokenFromAxes(gp.axes[0]||0,gp.axes[1]||0,p.deadzone||0.5);
//     const t=now();
//     if(!dirHistory.length||dirHistory[dirHistory.length-1].token!==tok){ dirHistory.push({t,token:tok}); const win=Math.max(700, p.motionWindow||700)+200; while(dirHistory.length && (t-dirHistory[0].t) > win) dirHistory.shift(); }
//     updateCharge(tok);

//     // Allow adding j. via UP direction (D‑pad or stick) outside of capture
//     if(!editCapture && currentSelectedChip && lastTok!=='u' && tok==='u' && (t-lastUpPrefixAt>200)){
//       addJPrefix(currentSelectedChip); lastUpPrefixAt=t;
//     }

//     // In controller capture, buffer direction only (no DOM spam)
//     if(editCapture){ captureDirTok = tok; }
//     lastTok=tok;
//   }
//   function facingMap(tok){ if((profiles[activeProfile].facing||'right')==='right') return tok; return tok.replace(/l/g,'R').replace(/r/g,'l').replace(/R/g,'r'); }
//   function compressedSeqWithin(ms){ const t=now(), start=t-ms; const seq=dirHistory.filter(e=>e.t>=start).map(e=>e.token).filter(x=>x!=='n').map(facingMap); const comp=[]; for(const s of seq){ if(!comp.length||comp[comp.length-1]!==s) comp.push(s);} return comp; }
//   function matchPattern(seq, pattern){ let i=0; for(const p of pattern){ i=seq.indexOf(p,i); if(i===-1) return false; i++; } return true; }
//   function detectMotionForButton(){ const p=profiles[activeProfile]; const seq=compressedSeqWithin(p.motionWindow||700);
//     const tests=[ ['qcf',['d','dr','r']], ['qcb',['d','dl','l']], ['dpf',['r','d','dr']], ['dpb',['l','d','dl']], ['hcf',['l','d','r']], ['hcb',['r','d','l']] ];
//     for(const [key,pat] of tests){ if(matchPattern(seq,pat)) return `<img class=\"img\" src=\"images/${key}.png\" alt=\"${key}\">`; }
//     const set=new Set(seq); if(['u','d','l','r'].every(k=>set.has(k))) return `<img class=\"img\" src=\"images/360.png\" alt=\"360\">`;
//     return null; }
//   function snapshotDirection(){ const last=dirHistory.length?dirHistory[dirHistory.length-1].token:'n'; return last==='n'?null:last; }

//   /* ===== Charge ===== */
//   let currentDirTok='n', currentDirStart=0, lastCharged={tok:null, at:0};
//   function updateCharge(latestTok){ const p=profiles[activeProfile]; const t=now(); if(latestTok!==currentDirTok){ if(currentDirTok!=='n'){ const heldMs=t-currentDirStart; const needMs=(p.chargeFrames||30)*(1000/60); if(heldMs>=needMs){ lastCharged={tok:currentDirTok, at:t}; } } currentDirTok=latestTok; currentDirStart=t; } }
//   function isOpposite(a,b){ if(a?.includes('l') && b?.includes('r')) return true; if(a?.includes('r') && b?.includes('l')) return true; if(a?.includes('u') && b?.includes('d')) return true; if(a?.includes('d') && b?.includes('u')) return true; return false; }

//   /* ===== Buttons & holds ===== */
//   function handleButtons(gp){ const p=profiles[activeProfile]; if(!prevButtons.length) prevButtons=gp.buttons.map(b=>b.pressed); const t=now(); const justPressed=[], justReleased=[];
//     for(let i=0;i<gp.buttons.length;i++){
//       const pressed=!!gp.buttons[i].pressed, was=!!prevButtons[i];
//       if(pressed && !was){ const last=lastButtonTime.get(i)||0; if(t-last >= (p.repeatLockout||110)){
//           if((p.resetAction||'none')===`button:${i}`){
//             clearOverlay();
//             // If Practice Mode is ON, also restart recording/playback accordingly.
//             if (practiceMode && window.ComboOverlay?.rec){
//                 const rec = window.ComboOverlay.rec;
//                 if (rec.mode === 'record'){ rec.stop(); rec.startRecord(); }
//                 else if (rec.mode === 'play'){ rec.stop(); rec.play(); }
//                 // idle -> nothing
//             }
//             lastButtonTime.set(i,t);
//             prevButtons[i]=pressed;
//             continue;
//             }

//           if(editCapture && currentSelectedChip && i<12){ replaceChipFromController(i); lastButtonTime.set(i,t); prevButtons[i]=pressed; continue; }
//           if(currentSelectedChip && i===12 && !editCapture){ addJPrefix(currentSelectedChip); lastButtonTime.set(i,t); prevButtons[i]=pressed; continue; }
//           justPressed.push(i); lastButtonTime.set(i,t);
//         } }
//       if(!pressed && was){ justReleased.push(i); }
//       prevButtons[i]=pressed;
//     }

//     for(const i of justPressed){ if(i>=12&&i<=15) continue; if(editCapture && currentSelectedChip) continue; let html=null;
//       const age=t-(lastCharged.at||0); const nowDir=snapshotDirection()||'';
//       if(lastCharged.tok && age <= (p.chargeWindow||180) && isOpposite(lastCharged.tok, nowDir)){
//         const first=dirToImg(lastCharged.tok)||lastCharged.tok.toUpperCase();
//         const second=dirToImg(nowDir)||nowDir.toUpperCase();
//         html = `${first} ${second} ${buttonHTML(i)}`; lastCharged.tok=null;
//       }
//       if(!html){ const motionHTML=detectMotionForButton(); if(motionHTML){ html = `${motionHTML} ${buttonHTML(i)}`; } }
//       if(!html){ const dirTok=snapshotDirection(); if(dirTok){ const dirHTML=dirToImg(dirTok)||dirTok.toUpperCase(); html = `${dirHTML} + ${buttonHTML(i)}`; } else { html = buttonHTML(i); } }
//       const chip = addChipElHTML(html, (profiles[activeProfile].buttonBgColors[i]||'#f5f5f5'));
//       activeButtonChips.set(i,{chip,label:(profiles[activeProfile].buttonLabels[i]||`#${i}`),pressAt:t,held:false});
//       const holdId=setTimeout(()=>{ const obj=activeButtonChips.get(i); if(!obj) return; obj.held=true; mutateLabelText(obj.chip, obj.label, `[${obj.label}]`); rebuildBuffer(); }, p.holdMs||250); holdTimers.set(i,holdId);
//     }

//     for(const i of justReleased){ const obj=activeButtonChips.get(i); const id=holdTimers.get(i); if(id) clearTimeout(id); holdTimers.delete(i); if(obj){ if(obj.held){ addChipElHTML(buttonHTML(i, `]${obj.label}[`), (profiles[activeProfile].buttonBgColors[i]||'#f5f5f5')); } activeButtonChips.delete(i); rebuildBuffer(); } }
//   }

//   function buttonHTML(btnIndex, override){ const p=profiles[activeProfile]; const text = override ?? (p.buttonLabels[btnIndex] || `#${btnIndex}`);
//     const color = useGlobalColors?.checked ? getComputedStyle(document.documentElement).getPropertyValue('--chip-text').trim() : (p.buttonColors[btnIndex] || '#000000');
//     return `<span style=\"color:${color}\">${escapeHtml(text)}</span>`; }

//   function addJPrefix(chip){ const lastSpan=chip.querySelector('span:last-of-type'); if(!lastSpan) return; const cur=lastSpan.textContent.trim(); if(cur.toLowerCase().startsWith('j.')) return; lastSpan.textContent='j.'+cur; rebuildBuffer(); }

//   function replaceChipFromController(btnIndex){ if(!currentSelectedChip) return; const dirTok = editCapture ? captureDirTok : (snapshotDirection()||'n'); const motionHTML = detectMotionForButton(); const p=profiles[activeProfile]; let finalLabel=(p.buttonLabels[btnIndex]||`#${btnIndex}`); if(dirTok==='u' && !/^j\./i.test(finalLabel)) finalLabel='j.'+finalLabel; let html; if(motionHTML){ html = `${motionHTML} ${buttonHTML(btnIndex, finalLabel)}`; } else if(dirTok && dirTok!=='n'){ const dirHTML=dirToImg(dirTok)||dirTok.toUpperCase(); html = `${dirHTML} + ${buttonHTML(btnIndex, finalLabel)}`; } else { html = buttonHTML(btnIndex, finalLabel); } currentSelectedChip.innerHTML=html; rebuildBuffer(); closePopover(); bus.emit('chip:replace', currentSelectedChip); }

//   function mutateLabelText(chipEl, oldText, newText){ const spans = chipEl.querySelectorAll('span'); for(let i = spans.length - 1; i >= 0; i--){ const sp = spans[i]; if(sp.textContent.trim() === oldText){ sp.textContent = newText; return; } } chipEl.innerHTML = chipEl.innerHTML.replace(new RegExp(escapeRegExp(oldText) + '(?!.*' + escapeRegExp(oldText) + ')'), ' ' + newText + ' '); }
//   function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
//   function escapeHtml(s=''){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

//   /* ===== Chip selection + editor popover ===== */
//   let currentSelectedChip=null, popEl=null;
//   document.addEventListener('click', (e)=>{ if(popEl && !popEl.contains(e.target) && currentSelectedChip && !currentSelectedChip.contains(e.target)){ closePopover(); deselectChip(); } });
//   function selectChip(chip){ if(currentSelectedChip===chip) return; deselectChip(); currentSelectedChip=chip; chip.classList.add('selected'); chip.focus(); }
//   function deselectChip(){ if(currentSelectedChip){ currentSelectedChip.classList.remove('selected'); currentSelectedChip.classList.remove('capture'); currentSelectedChip=null; } }

//   function openPopover(chip, startInEdit=false){
//     closePopover();
//     const rect=chip.getBoundingClientRect();
//     const p=document.createElement('div'); p.className='popover';
//     p.style.left = Math.max(8, Math.min(window.innerWidth-300, rect.left))+'px';
//     p.style.top  = (rect.bottom + 6)+'px';
//     p.innerHTML = `
//       <h5>Chip actions</h5>
//       <div class=\"row\" style=\"grid-template-columns:1fr auto\">
//         <input id=\"renameInput\" type=\"text\" placeholder=\"New label…\" />
//         <button id=\"applyBtn\" class=\"btn\">Apply</button>
//       </div>
//       <div class=\"row\" style=\"margin-top:8px;grid-template-columns:1fr 1fr\">
//         <button id=\"captureBtn\" class=\"btn\">Use controller…</button>
//         <button id=\"delBtn\" class=\"btn danger\">Delete</button>
//       </div>
//       <div class=\"row\" style=\"margin-top:8px;grid-template-columns:1fr 1fr\">
//         <button id=\"clearDirBtn\" class=\"btn\">Clear direction</button>
//         <button id=\"clearMotionBtn\" class=\"btn\">Clear motion</button>
//       </div>
//       <div class=\"tiny\" style=\"margin-top:6px\">Tips: Enter to apply · Esc to cancel · Up/Space adds \"j.\" (outside capture). In capture: tilt for direction, press to set.</div>`;
//     document.body.appendChild(p); popEl=p;

//     const renameInput=$('#renameInput'), applyBtn=$('#applyBtn'), delBtn=$('#delBtn'), captureBtn=$('#captureBtn');
//     const clearDirBtn=$('#clearDirBtn'), clearMotionBtn=$('#clearMotionBtn');
//     const lastSpan = chip.querySelector('span:last-of-type');
//     if(renameInput) renameInput.value = lastSpan ? lastSpan.textContent.trim() : '';
//     if(startInEdit){ renameInput?.blur(); startControllerCapture(chip); } else { renameInput?.focus(); }

//     applyBtn?.addEventListener('click', ()=>{ const oldTxt = lastSpan ? lastSpan.textContent.trim() : ''; const newTxt = renameInput?.value.trim(); if(newTxt && oldTxt && newTxt!==oldTxt){ mutateLabelText(chip, oldTxt, newTxt); rebuildBuffer(); } closePopover(); });
//     renameInput?.addEventListener('apply-enter', ()=>applyBtn?.click());
//     delBtn?.addEventListener('click', ()=>{ removeChip(chip); closePopover(); });
//     captureBtn?.addEventListener('click', ()=> startControllerCapture(chip));
//     clearDirBtn?.addEventListener('click', ()=>{ const imgs=[...chip.querySelectorAll('img')]; for(const img of imgs){ const a=img.alt; if(['u','d','b','f','ub','uf','db','df'].includes(a)) img.remove(); } const span=chip.querySelector('span:last-of-type'); if(span){ span.textContent=span.textContent.trim().replace(/^j\./i,''); } rebuildBuffer(); });
//     clearMotionBtn?.addEventListener('click', ()=>{ [...chip.querySelectorAll('img')].forEach(img=>{ if(['qcf','qcb','dpf','dpb','hcf','hcb','360'].includes(img.alt)) img.remove(); }); rebuildBuffer(); });
//   }
//   function closePopover(){ if(popEl){ popEl.remove(); popEl=null; } if(currentSelectedChip) currentSelectedChip.classList.remove('capture'); editCapture=false; }

//   function removeChip(chip){ if(!chip) return; const prev = chip.previousSibling, next = chip.nextSibling; if(prev && prev.classList && prev.classList.contains('sep')) prev.remove(); else if(next && next.classList && next.classList.contains('sep')) next.remove(); chip.remove(); if(currentSelectedChip===chip) currentSelectedChip=null; rebuildBuffer(); bus.emit('chip:remove', chip); }

//   function startControllerCapture(chip){ editCapture=true; selectChip(chip); chip.classList.add('capture'); setStatus('Capture: tilt D‑pad/stick for direction (buffered), press a button to set; UP also prefixes j.'); }

//   /* ===== Gamepad loop start ===== */
//   requestAnimationFrame(poll);

//   /* ===== Global API (exposed) ===== */
//   const API = {
//     version:'13.7', bus,
//     get overlay(){ return overlay; },
//     get selectedChip(){ return currentSelectedChip; },
//     get useGlobalColors(){ return !!useGlobalColors?.checked; },
//     get profiles(){ return profiles; },
//     get activeProfile(){ return activeProfile; },
//     set activeProfile(v){ activeProfile = v; saveActive(); refreshProfileUI(); },
//     addChipHTML: addChipElHTML,
//     removeChip, selectChip, openPopover, closePopover,
//     buttonHTML, addJPrefix, replaceChipFromController,
//     clearOverlay, rebuildBuffer, currentSeparator,
//     ctrl:{ startCapture(){ if(currentSelectedChip) startControllerCapture(currentSelectedChip); } },
//     gamepad:{ snapshotDirection, detectMotionForButton },
//     png:{ copyPNG, exportPNG },
//     settings:{ applyCssKnobs },
//     on:(evt,fn)=>bus.on(evt,fn),
//     setStatus
//   };
//   window.ComboOverlay = API;

//   /* ===== Keyboard shortcuts & OBS toggle ===== */
//   if(q.get('obs')==='1'||window.obsstudio){document.body.classList.add('obs');}
//   if(q.get('edit')==='1'){document.body.classList.remove('obs');}
//   window.addEventListener('keydown',(e)=>{const k=e.key.toLowerCase();
//     if(k==='e') document.body.classList.toggle('obs');
//     if(k==='c') clearOverlay();
//     if((k==='delete'||k==='backspace') && currentSelectedChip){ removeChip(currentSelectedChip); closePopover(); }
//     if((k==='arrowup' || k===' ') && currentSelectedChip && !editCapture){ addJPrefix(currentSelectedChip); }
//     const ri=$('#renameInput'); if(ri && document.activeElement===ri){ if(k==='enter'){ ri.dispatchEvent(new Event('apply-enter')); } if(k==='escape'){ closePopover(); }}
//   });

//   /* ===== Init ===== */
//   refreshProfileUI();
//   applyCssKnobs();
// })();


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
  function defaultProfile(){return {name:'Default',buttonLabels:[...DEFAULT_BUTTON_LABELS],buttonColors:[...DEFAULT_BUTTON_COLORS],buttonBgColors:[...DEFAULT_BUTTON_BG],deadzone:0.5,chordWindow:80,repeatLockout:110,holdMs:250,motionWindow:700,motionCoupleMs:130,chargeFrames:30,chargeWindow:180,facing:'right',resetAction:'none',separator:'>'}};
  function loadProfiles(){try{const raw=localStorage.getItem(LS_PROFILES); if(!raw) return [defaultProfile()]; const arr=JSON.parse(raw); return Array.isArray(arr)&&arr.length?arr:[defaultProfile()];}catch{return [defaultProfile()];}}
  function saveProfiles(){localStorage.setItem(LS_PROFILES, JSON.stringify(profiles));}
  function loadActive(){const v=parseInt(localStorage.getItem(LS_ACTIVE)||'0',10);return Number.isFinite(v)&&v>=0&&v<profiles.length? v:0;}
  function saveActive(){localStorage.setItem(LS_ACTIVE, String(activeProfile));}
  let profiles=loadProfiles(); let activeProfile=loadActive();
  
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
const MASH_WINDOW_MS = 350;  // time window for a rapid mash burst
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

  // continuing same-burst?
  if(mashState.key === key && (t - mashState.firstTime) <= MASH_WINDOW_MS){
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

    // Hotkey: P toggles Practice Mode
    window.addEventListener('keydown', (e)=>{
    const k=(e.key||'').toLowerCase();
    if(k==='p'){ e.preventDefault(); setPracticeMode(!practiceMode); }
    });


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
  saveProfileBtn?.addEventListener('click',()=>{ const p=profiles[activeProfile]; p.name=profileName?.value.trim()||`Profile ${activeProfile+1}`; p.facing=facingSel?.value||p.facing; p.resetAction=resetSel?.value||p.resetAction; p.separator=separatorInp.value||'>'; p.deadzone=parseFloat($('#deadzone')?.value)||p.deadzone; p.chordWindow=parseInt($('#chordWindow')?.value)||p.chordWindow; p.repeatLockout=parseInt($('#repeatLockout')?.value)||p.repeatLockout; p.holdMs=parseInt($('#holdMs')?.value)||p.holdMs; p.motionWindow=parseInt($('#motionWindow')?.value)||p.motionWindow; p.motionCoupleMs=parseInt($('#motionCoupleMs')?.value)||p.motionCoupleMs; p.chargeFrames=parseInt($('#chargeFrames')?.value)||p.chargeFrames; p.chargeWindow=parseInt($('#chargeWindow')?.value)||p.chargeWindow; saveProfiles(); refreshProfileUI();});

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
  saveProfiles();
});


  /* ===== Drag & Drop import ===== */
  ;['dragenter','dragover','drop','dragleave'].forEach(evt=>window.addEventListener(evt,(e)=>{ if(evt!=='drop') e.preventDefault(); if(evt==='drop'){ const f=e.dataTransfer?.files?.[0]; if(f){ f.text().then(txt=>{ try{const arr=JSON.parse(txt); if(Array.isArray(arr)&&arr.length){ profiles=arr; activeProfile=0; saveProfiles(); saveActive(); refreshProfileUI(); setStatus('Imported profile (drag & drop)'); } }catch(err){ console.warn('DnD import error',err); } }); } } }));

  /* ===== Overlay helpers ===== */
  function addSeparator(){ if(overlay.children.length){const s=document.createElement('span');s.className='sep'; s.textContent=(profiles[activeProfile].separator||'>'); overlay.appendChild(s);} }
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
    return c;
  }

  function clearOverlay(){ overlay.innerHTML=''; buffer.length=0; activeButtonChips.clear(); lastCharged={tok:null,at:0}; closePopover(); currentSelectedChip=null; editCapture=false; bus.emit('overlay:clear'); }
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
    let tok='n'; if(dL) tok='l'; else if(dR) tok='r'; if(dU) tok=(tok==='r')?'ur':(tok==='l')?'ul':'u'; else if(dD) tok=(tok==='r')?'dr':(tok==='l')?'dl':'d';
    if(tok==='n') tok=tokenFromAxes(gp.axes[0]||0,gp.axes[1]||0,p.deadzone||0.5);
    const t=now();
    if(!dirHistory.length||dirHistory[dirHistory.length-1].token!==tok){ dirHistory.push({t,token:tok}); const win=Math.max(700, p.motionWindow||700)+200; while(dirHistory.length && (t-dirHistory[0].t) > win) dirHistory.shift(); }
    updateCharge(tok);

    // Allow adding j. via UP direction (D‑pad or stick) outside of capture
    if(!editCapture && currentSelectedChip && lastTok!=='u' && tok==='u' && (t-lastUpPrefixAt>200)){
      addJPrefix(currentSelectedChip); lastUpPrefixAt=t;
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

    // ===== Mash collapse pass (may delete the chip we just added) =====
    const mashResult = updateMashAfterAdd(html, chip);
    if(mashResult === 'removed' || mashResult === 'collapsed'){
      // If removed/collapsed, do not track hold state for this press
      continue;
    }

    // Normal hold tracking for this press
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

  // ===== Handle releases (close holds, emit ]L[ chip) =====
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

  function replaceChipFromController(btnIndex){ if(!currentSelectedChip) return; const dirTok = editCapture ? captureDirTok : (snapshotDirection()||'n'); const motionHTML = detectMotionForButton(); const p=profiles[activeProfile]; let finalLabel=(p.buttonLabels[btnIndex]||`#${btnIndex}`); if(dirTok==='u' && !/^j\./i.test(finalLabel)) finalLabel='j.'+finalLabel; let html; if(motionHTML){ html = `${motionHTML} ${buttonHTML(btnIndex, finalLabel)}`; } else if(dirTok && dirTok!=='n'){ const dirHTML=dirToImg(dirTok)||dirTok.toUpperCase(); html = `${dirHTML} + ${buttonHTML(btnIndex, finalLabel)}`; } else { html = buttonHTML(btnIndex, finalLabel); } currentSelectedChip.innerHTML=html; rebuildBuffer(); closePopover(); bus.emit('chip:replace', currentSelectedChip); }

  function mutateLabelText(chipEl, oldText, newText){ const spans = chipEl.querySelectorAll('span'); for(let i = spans.length - 1; i >= 0; i--){ const sp = spans[i]; if(sp.textContent.trim() === oldText){ sp.textContent = newText; return; } } chipEl.innerHTML = chipEl.innerHTML.replace(new RegExp(escapeRegExp(oldText) + '(?!.*' + escapeRegExp(oldText) + ')'), ' ' + newText + ' '); }
  function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function escapeHtml(s=''){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

  /* ===== Chip selection + editor popover ===== */
  let currentSelectedChip=null, popEl=null;
  document.addEventListener('click', (e)=>{ if(popEl && !popEl.contains(e.target) && currentSelectedChip && !currentSelectedChip.contains(e.target)){ closePopover(); deselectChip(); } });
  function selectChip(chip){ if(currentSelectedChip===chip) return; deselectChip(); currentSelectedChip=chip; chip.classList.add('selected'); chip.focus(); }
  function deselectChip(){ if(currentSelectedChip){ currentSelectedChip.classList.remove('selected'); currentSelectedChip.classList.remove('capture'); currentSelectedChip=null; } }

  function openPopover(chip, startInEdit=false){
    closePopover();
    const rect=chip.getBoundingClientRect();
    const p=document.createElement('div'); p.className='popover';
    p.style.left = Math.max(8, Math.min(window.innerWidth-300, rect.left))+'px';
    p.style.top  = (rect.bottom + 6)+'px';
    p.innerHTML = `
      <h5>Chip actions</h5>
      <div class=\"row\" style=\"grid-template-columns:1fr auto\">
        <input id=\"renameInput\" type=\"text\" placeholder=\"New label…\" />
        <button id=\"applyBtn\" class=\"btn\">Apply</button>
      </div>
      <div class=\"row\" style=\"margin-top:8px;grid-template-columns:1fr 1fr\">
        <button id=\"captureBtn\" class=\"btn\">Use controller…</button>
        <button id=\"delBtn\" class=\"btn danger\">Delete</button>
      </div>
      <div class=\"row\" style=\"margin-top:8px;grid-template-columns:1fr 1fr\">
        <button id=\"clearDirBtn\" class=\"btn\">Clear direction</button>
        <button id=\"clearMotionBtn\" class=\"btn\">Clear motion</button>
      </div>
      <div class=\"tiny\" style=\"margin-top:6px\">Tips: Enter to apply · Esc to cancel · Up/Space adds \"j.\" (outside capture). In capture: tilt for direction, press to set.</div>`;
    document.body.appendChild(p); popEl=p;

    const renameInput=$('#renameInput'), applyBtn=$('#applyBtn'), delBtn=$('#delBtn'), captureBtn=$('#captureBtn');
    const clearDirBtn=$('#clearDirBtn'), clearMotionBtn=$('#clearMotionBtn');
    const lastSpan = chip.querySelector('span:last-of-type');
    if(renameInput) renameInput.value = lastSpan ? lastSpan.textContent.trim() : '';
    if(startInEdit){ renameInput?.blur(); startControllerCapture(chip); } else { renameInput?.focus(); }

    applyBtn?.addEventListener('click', ()=>{ const oldTxt = lastSpan ? lastSpan.textContent.trim() : ''; const newTxt = renameInput?.value.trim(); if(newTxt && oldTxt && newTxt!==oldTxt){ mutateLabelText(chip, oldTxt, newTxt); rebuildBuffer(); } closePopover(); });
    renameInput?.addEventListener('apply-enter', ()=>applyBtn?.click());
    delBtn?.addEventListener('click', ()=>{ removeChip(chip); closePopover(); });
    captureBtn?.addEventListener('click', ()=> startControllerCapture(chip));
    clearDirBtn?.addEventListener('click', ()=>{ const imgs=[...chip.querySelectorAll('img')]; for(const img of imgs){ const a=img.alt; if(['u','d','b','f','ub','uf','db','df'].includes(a)) img.remove(); } const span=chip.querySelector('span:last-of-type'); if(span){ span.textContent=span.textContent.trim().replace(/^j\./i,''); } rebuildBuffer(); });
    clearMotionBtn?.addEventListener('click', ()=>{ [...chip.querySelectorAll('img')].forEach(img=>{ if(['qcf','qcb','dpf','dpb','hcf','hcb','360'].includes(img.alt)) img.remove(); }); rebuildBuffer(); });
  }
  function closePopover(){ if(popEl){ popEl.remove(); popEl=null; } if(currentSelectedChip) currentSelectedChip.classList.remove('capture'); editCapture=false; }

  function removeChip(chip){ if(!chip) return; const prev = chip.previousSibling, next = chip.nextSibling; if(prev && prev.classList && prev.classList.contains('sep')) prev.remove(); else if(next && next.classList && next.classList.contains('sep')) next.remove(); chip.remove(); if(currentSelectedChip===chip) currentSelectedChip=null; rebuildBuffer(); bus.emit('chip:remove', chip); }

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
    setStatus
  };
  window.ComboOverlay = API;

  /* ===== Keyboard shortcuts & OBS toggle ===== */
  if(q.get('obs')==='1'||window.obsstudio){document.body.classList.add('obs');}
  if(q.get('edit')==='1'){document.body.classList.remove('obs');}
  window.addEventListener('keydown',(e)=>{const k=e.key.toLowerCase();
    if(k==='e') document.body.classList.toggle('obs');
    if(k==='c') clearOverlay();
    if((k==='delete'||k==='backspace') && currentSelectedChip){ removeChip(currentSelectedChip); closePopover(); }
    if((k==='arrowup' || k===' ') && currentSelectedChip && !editCapture){ addJPrefix(currentSelectedChip); }
    const ri=$('#renameInput'); if(ri && document.activeElement===ri){ if(k==='enter'){ ri.dispatchEvent(new Event('apply-enter')); } if(k==='escape'){ closePopover(); }}
  });

  /* ===== Init ===== */
  refreshProfileUI();
  applyCssKnobs();
})();
