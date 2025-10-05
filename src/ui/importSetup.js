// src/ui/importSetup.js
import { importComboFromText } from "../import/importCombo.js";
import { attachImportUI } from "./importDialog.js";

// Wire up the existing import button to use our new system
export function setupImportFunctionality() {
  // Wire up the existing import button
  const existingImportBtn = document.getElementById('importBtn');
  const existingImportInput = document.getElementById('importInput');
  
  if (existingImportBtn && existingImportInput) {
    // Replace the existing functionality
    existingImportBtn.addEventListener('click', () => existingImportInput.click());
    
    existingImportInput.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      
      const text = await f.text();
      const result = await importComboFromText(text);
      
      // Show result in status area
      const statusEl = document.getElementById('status');
      if (statusEl) {
        if (result.ok) {
          statusEl.textContent = 'Combo imported successfully';
        } else {
          statusEl.textContent = `Import failed: ${result.message || result.reason}`;
        }
      }
    });
  }
  
  // Attach the new import UI
  attachImportUI();
}

// Call setup when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupImportFunctionality);
} else {
  setupImportFunctionality();
}


