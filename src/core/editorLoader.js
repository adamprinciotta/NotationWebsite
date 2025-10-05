// src/core/editorLoader.js
export function loadIntoEditor(combo) {
  // Clear current editor state safely
  window.ComboOverlay?.clearOverlay?.();
  
  // Reset undo/redo stack if available
  if (window.undoManager) {
    window.undoManager.clearAll();
  }
  
  // Verify event ids are unique across root timeline (already ensured by validator)
  // Verify branches reference valid fromEventId (already ensured by validator)
  
  // Load the timeline events into the overlay
  const { timeline, branches = [] } = combo;
  
  // Add each event from the timeline
  timeline.forEach(event => {
    const chipHTML = createChipHTMLFromEvent(event);
    window.ComboOverlay?.addChipElHTML?.(chipHTML);
  });
  
  // Handle branches - this will need to integrate with the existing branching system
  // For now, we'll just store the branch data for future implementation
  if (branches.length > 0) {
    console.log("Branches detected in import:", branches);
    // TODO: Integrate with existing branching system
  }
  
  // Set metadata if available
  if (combo.meta) {
    setMetadata(combo.meta);
  }
  
  // Set profile if specified
  if (combo.profileId) {
    setProfile(combo.profileId);
  }
  
  // Create undo checkpoint for the import if undoManager is available
  if (window.undoManager) {
    window.undoManager.push({
      do: () => {},
      undo: () => {},
      label: `Import combo: ${combo.meta?.title || 'Untitled combo'}`
    });
  }
}

function createChipHTMLFromEvent(event) {
  const { chip, dir, hold, duration, notes } = event;
  
  // Create the basic chip structure
  let html = `<div class="chip" data-chip="${escapeHtml(chip)}" data-dir="${dir}"`;
  
  if (hold) {
    html += ` data-hold="true"`;
  }
  
  if (duration > 0) {
    html += ` data-duration="${duration}"`;
  }
  
  if (notes) {
    html += ` data-notes="${escapeHtml(notes)}"`;
  }
  
  html += `>`;
  
  // Add direction image if needed
  if (dir && dir !== 'n') {
    html += `<img src="images/${dir}.png" alt="${dir}" height="20">`;
  }
  
  // Add the button/chip text
  html += `<span>${escapeHtml(chip)}</span>`;
  
  html += `</div>`;
  
  return html;
}

function setMetadata(meta) {
  // Set metadata fields if they exist in the UI
  const { game, character, title, author, createdAt, updatedAt, tags } = meta;
  
  if (title && document.getElementById('metaName')) {
    document.getElementById('metaName').value = title;
  }
  
  if (game && document.getElementById('metaGame')) {
    document.getElementById('metaGame').value = game;
  }
  
  if (character && document.getElementById('metaCharacters')) {
    document.getElementById('metaCharacters').value = character;
  }
  
  if (author && document.getElementById('metaAuthor')) {
    document.getElementById('metaAuthor').value = author;
  }
  
  // TODO: Handle dates and tags if needed
}

function setProfile(profileId) {
  // Try to find and select the profile
  const profileSelect = document.getElementById('profileSelect');
  if (profileSelect) {
    for (let i = 0; i < profileSelect.options.length; i++) {
      if (profileSelect.options[i].value === profileId) {
        profileSelect.selectedIndex = i;
        profileSelect.dispatchEvent(new Event('change'));
        break;
      }
    }
  }
}

function escapeHtml(s = "") {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
