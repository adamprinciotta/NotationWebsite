/* Combo Overlay – EDDIE UI Module (v1.0)
   Adds EDDIE export buttons to the settings interface
   Depends on window.ComboOverlay.eddie module
*/
;(function() {
  'use strict';
  
  document.addEventListener('DOMContentLoaded', function() {
    // Wait a moment for the DOM to fully initialize
    setTimeout(initEddieUI, 100);
  });
  
  function initEddieUI() {
    try {
      // Find the settings card where export buttons should go
      const settingsCard = findSettingsCard();
      if (!settingsCard) {
        console.warn('[EDDIE UI] Could not find settings card for export buttons');
        return;
      }
      
      // Create EDDIE export controls container
      const eddieControls = createEddieControls();
      
      // Insert the controls into the settings card
      insertAfterExportImport(settingsCard, eddieControls);
      
      // Setup event listeners
      setupEventListeners();
      
      console.log('[EDDIE UI] Module loaded successfully');
      
    } catch (error) {
      console.warn('[EDDIE UI] Initialization error:', error);
    }
  }
  
  function findSettingsCard() {
    // Look for the card containing export/import buttons
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    
    if (exportBtn && exportBtn.closest('.card')) {
      return exportBtn.closest('.card');
    }
    if (importBtn && importBtn.closest('.card')) {
      return importBtn.closest('.card');
    }
    
    // Fallback: look for any card with export/import buttons
    const cards = document.querySelectorAll('.card');
    for (const card of cards) {
      if (card.querySelector('#exportBtn') || card.querySelector('#importBtn')) {
        return card;
      }
    }
    
    return null;
  }
  
  function createEddieControls() {
    const container = document.createElement('div');
    container.className = 'row row-tight';
    container.style.marginTop = '8px';
    container.style.paddingTop = '8px';
    container.style.borderTop = '1px solid #eee';
    
    container.innerHTML = `
      <span class="tiny" style="grid-column:1/-1; margin-bottom:4px;">EDDIE Export:</span>
      <select id="exportEddieGame" class="btn" style="min-width:80px;">
        <option value="dbfz">DBFZ</option>
        <option value="sf6">SF6</option>
      </select>
      <button id="exportEddieBtn" class="btn" title="Export script to Eddie format">Export Script</button>
      <button id="exportEddieCfgBtn" class="btn" title="Export Eddie config JSON">Export Config</button>
    `;
    
    return container;
  }
  
  function insertAfterExportImport(settingsCard, eddieControls) {
    // Find the export/import button row
    const exportImportRow = settingsCard.querySelector('.row-tight:has(#exportBtn), .row-tight:has(#importBtn)');
    
    if (exportImportRow && exportImportRow.parentNode) {
      exportImportRow.parentNode.insertBefore(eddieControls, exportImportRow.nextSibling);
    } else {
      // Fallback: append to the end of the card
      settingsCard.appendChild(eddieControls);
    }
  }
  
  function setupEventListeners() {
    const exportBtn = document.getElementById('exportEddieBtn');
    const exportCfgBtn = document.getElementById('exportEddieCfgBtn');
    
    if (exportBtn) {
      exportBtn.addEventListener('click', handleScriptExport);
    }
    
    if (exportCfgBtn) {
      exportCfgBtn.addEventListener('click', handleConfigExport);
    }
  }
  
  function handleScriptExport() {
    try {
      if (typeof window.ComboOverlay === 'undefined' || !window.ComboOverlay.eddie) {
        alert('EDDIE export module not loaded. Please ensure app.eddie.js is loaded.');
        return;
      }
      
      const game = document.getElementById('exportEddieGame')?.value || 'dbfz';
      const txt = window.ComboOverlay.eddie.exportScript({ 
        game, 
        useMacros: true 
      });
      
      // Download as .txt file
      const blob = new Blob([txt], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${game}-eddie-script.txt`;
      a.click();
      
      // Clean up
      setTimeout(() => URL.revokeObjectURL(a.href), 100);
      
    } catch (error) {
      console.error('[EDDIE UI] Script export error:', error);
      alert('Error exporting script: ' + error.message);
    }
  }
  
  function handleConfigExport() {
    try {
      if (typeof window.ComboOverlay === 'undefined' || !window.ComboOverlay.eddie) {
        alert('EDDIE export module not loaded. Please ensure app.eddie.js is loaded.');
        return;
      }
      
      const game = document.getElementById('exportEddieGame')?.value || 'dbfz';
      const config = window.ComboOverlay.eddie.makeConfigFromProfile({ game });
      const json = JSON.stringify(config, null, 2);
      
      // Download as .json file
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `eddie.${game}.json`;
      a.click();
      
      // Clean up
      setTimeout(() => URL.revokeObjectURL(a.href), 100);
      
    } catch (error) {
      console.error('[EDDIE UI] Config export error:', error);
      alert('Error exporting config: ' + error.message);
    }
  }
  
})();
