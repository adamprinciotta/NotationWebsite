/* Combo Overlay – EDDIE Export Module (v1.0)
   Standalone module for converting recordings to EDDIE input format
   Depends on window.ComboOverlay API facade
*/
;(function() {
  'use strict';
  
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
      tMs: step?.t || 0,
      dtMs: 0
    };
    
    if (!step || !step.chipsHTML || step.chipsHTML.length === 0) return result;
    
    // Each step now contains only the new chip that was added
    for (const chipHTML of step.chipsHTML) {
      this._parseChipHTML(chipHTML, result);
    }
    
    // Calculate delta time if previous step available
    if (context.prevStep && context.prevStep.t !== undefined) {
      result.dtMs = result.tMs - context.prevStep.t;
    }
    
    return result;
  };
  
  // Helper to parse individual chip HTML
  eddie._parseChipHTML = function(html, result) {
    // Create temporary element to parse HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // Extract text content for analysis
    const text = temp.textContent || '';
    
    // Check for hold indicators [button]
    const holdMatch = text.match(/\[(.+?)\]/);
    if (holdMatch) {
      const button = holdMatch[1];
      result.hold = {
        button: button,
        start: text.startsWith('['),
        end: text.endsWith(']'),
        durationMs: 0 // Will be calculated from context
      };
      result.buttons.push(button);
      return;
    }
    
    // Check for direction images
    const images = temp.querySelectorAll('img.img');
    for (const img of images) {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';
      
      // Map image filenames to direction digits
      const dirMap = {
        'u': '8', 'd': '2', 'l': '4', 'r': '6',
        'ub': '7', 'uf': '9', 'db': '1', 'df': '3',
        'b': '4', 'f': '6',
        'qcf': '236', 'qcb': '214', 'dp': '623',
        'hcf': '41236', 'hcb': '63214', '360': '412369874'
      };
      
      const filename = src.split('/').pop()?.replace('.png', '') || alt;
      if (dirMap[filename]) {
        result.dirs.push(...dirMap[filename].split(''));
      }
    }
    
    // Extract button text (look for button symbols)
    const buttonSymbols = ['L', 'M', 'H', 'S', 'LP', 'MP', 'HP', 'LK', 'MK', 'HK'];
    const spans = temp.querySelectorAll('span');
    
    for (const span of spans) {
      const text = span.textContent.trim();
      
      // Check for j. prefix (just frame)
      if (text.toLowerCase().startsWith('j.')) {
        const button = text.substring(2);
        if (buttonSymbols.includes(button)) {
          result.buttons.push(button);
        }
        continue;
      }
      
      // Check for chord (L+M+H)
      if (text.includes('+')) {
        const buttons = text.split('+').map(b => b.trim());
        for (const button of buttons) {
          if (buttonSymbols.includes(button)) {
            result.buttons.push(button);
          }
        }
        continue;
      }
      
      // Single button
      if (buttonSymbols.includes(text)) {
        result.buttons.push(text);
      }
    }
    
    // Fallback: extract any remaining button-like text
    const buttonPattern = /\b(L|M|H|S|LP|MP|HP|LK|MK|HK)\b/g;
    let match;
    while ((match = buttonPattern.exec(text)) !== null) {
      if (!result.buttons.includes(match[1])) {
        result.buttons.push(match[1]);
      }
    }
  };
  
  eddie._makeConfigFromProfile = function({ game = 'dbfz', side = 'P1', macrosPreset = 'default' } = {}) {
    // Game templates
    const templates = {
      dbfz: {
        FPS: 60,
        Symbols: {
          L: 'L',
          M: 'M', 
          H: 'H',
          S: 'S',
          A1: 'A1',
          A2: 'A2'
        },
        P1_directions: {
          1: '↙', 2: '↓', 3: '↘',
          4: '←', 5: '・', 6: '→',
          7: '↖', 8: '↑', 9: '↗'
        },
        P2_directions: {
          1: '↘', 2: '↓', 3: '↙',
          4: '→', 5: '・', 6: '←',
          7: '↗', 8: '↑', 9: '↖'
        },
        Macros: {
          '236': 'QCF',
          '214': 'QCB',
          '623': 'DP',
          '41236': 'HCF',
          '63214': 'HCB',
          '*236': 'QCF',
          '*214': 'QCB',
          '*623': 'DP',
          '*41236': 'HCF',
          '*63214': 'HCB'
        }
      },
      sf6: {
        FPS: 60,
        Symbols: {
          LP: 'LP',
          MP: 'MP',
          HP: 'HP',
          LK: 'LK',
          MK: 'MK',
          HK: 'HK'
        },
        P1_directions: {
          1: '↙', 2: '↓', 3: '↘',
          4: '←', 5: '・', 6: '→',
          7: '↖', 8: '↑', 9: '↗'
        },
        P2_directions: {
          1: '↘', 2: '↓', 3: '↙',
          4: '→', 5: '・', 6: '←',
          7: '↗', 8: '↑', 9: '↖'
        },
        Macros: {
          '236': 'QCF',
          '214': 'QCB',
          '623': 'DP',
          '41236': 'HCF',
          '63214': 'HCB',
          '*236': 'QCF',
          '*214': 'QCB',
          '*623': 'DP',
          '*41236': 'HCF',
          '*63214': 'HCB'
        }
      }
    };
    
    return templates[game] || templates.dbfz;
  };
  
  eddie._exportScript = function({
    game = 'dbfz',
    side = 'P1',
    useMacros = true,
    includeBeep = false,
    leadInMs = 0,
    subtractLatencyMs = 0,
    round = 'nearest',
    holdStyle = 'auto',
    mashStyle = 'plus',
    directionMode = 'digits'
  } = {}) {
    // Check if recording exists
    if (!CO.rec || !CO.rec.script || CO.rec.script.length === 0) {
      return '# Eddie export: no recording available';
    }
    
    try {
      const script = CO.rec.script;
      const config = this._makeConfigFromProfile({ game, side });
      let output = '';
      let currentLine = '';
      let lineLength = 0;
      const maxLineLength = 120;
      
      // Create state object for output formatting
      const outputState = {
        output,
        currentLine,
        lineLength,
        maxLineLength
      };
      
      // Add header comment - config file must be first line for EddieInput
      outputState.output += `configs\\${game}.json
`;
      outputState.output += `# Eddie export: ${game} ${side}
`;
      outputState.output += `# Generated from Combo Overlay recording
`;
      
      // Add lead-in wait if specified
      if (leadInMs > 0) {
        const leadInFrames = this._msToFrames(leadInMs - subtractLatencyMs, { fps: config.FPS, round });
        if (leadInFrames > 0) {
          this._addToOutput(`W${leadInFrames}`, outputState);
        }
      }
      
      // Process each step
      let prevStep = null;
      const normalizedSteps = [];
      
      for (let i = 0; i < script.length; i++) {
        const step = script[i];
        const context = { 
          prevStep: i > 0 ? script[i - 1] : null, // Use original script timestamps
          isFirstStep: i === 0 // Flag to identify first step
        };
        const normalized = this._normalizeStep(step, context);
        normalizedSteps.push(normalized);
        
        // --- NEW: emit wait BEFORE the current step (skip for first step) ---
        if (i > 0) {
          const waitMsRaw = Math.max(0, normalized.tMs - (context.prevStep?.t ?? 0) - subtractLatencyMs);
          const waitFrames = this._msToFrames(waitMsRaw, { fps: config.FPS, round });
          if (waitFrames > 0) {
            this._addToOutput(`W${waitFrames}`, outputState);
          }
        }
        // --------------------------------------------------------------------
        
        // Skip steps with no content
        if (normalized.dirs.length === 0 && normalized.buttons.length === 0) {
          continue;
        }
        
        // Process directions
        if (normalized.dirs.length > 0) {
          const dirTokens = (directionMode === 'macro' && useMacros)
            ? this._compressDirections(normalized.dirs, { useMacros: true, macrosMap: config.Macros })
            : normalized.dirs;
          for (const dir of dirTokens) this._addToOutput(dir, outputState);
        }
        
        // Buttons (with hold handling unchanged)
        if (normalized.buttons.length > 0) {
          const buttonToken = normalized.buttons.length === 1
            ? normalized.buttons[0]
            : normalized.buttons.join('+');

          const holdInfo = this._detectHold(normalized, context, { holdStyle, fps: config.FPS, round });
          if (holdInfo) {
            if (holdStyle === 'bracket' && holdInfo.releaseAfterFrames > 0) {
              this._addToOutput(`[${buttonToken}]`, outputState);
              this._addToOutput(`W${holdInfo.releaseAfterFrames}`, outputState);
              this._addToOutput(`]${buttonToken}[`, outputState);
            } else {
              this._addToOutput(buttonToken, outputState);
            }
          } else {
            this._addToOutput(buttonToken, outputState);
          }
        }
        
        prevStep = normalized;
      }
      
      // Flush any remaining content in current line
      if (outputState.currentLine.trim().length > 0) {
        outputState.output += outputState.currentLine.trim() + '\n';
      }
      
      return outputState.output;
      
    } catch (error) {
      console.warn('[EDDIE] Export error:', error);
      return `# Eddie export error: ${error.message}`;
    }
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
