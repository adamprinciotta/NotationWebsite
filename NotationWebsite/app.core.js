/* Combo Overlay Core (v13.7)
   Responsibilities:
   - UI wiring (profiles, colors, PNG export, OBS URL)
   - Overlay chip add/remove/edit + popover
   - Gamepad detection + live capture (including j. prefix via UP)
   - Public API surface for feature modules (e.g., recording)

   Modules can hook via window.ComboOverlay.on(event, fn)
   Events: 'chip:add' (chipEl), 'chip:remove' (chipEl), 'chip:replace' (chipEl),
           'status' (msg), 'overlay:clear'
*/
(function () {
  // console.log('App core script loaded - console.log is working'); // Test console
  const $ = (s) => document.querySelector(s);
  const overlay = $("#overlay");
  // Ensure the overlay can't host a caret or gain focus when it's empty
  overlay.setAttribute("contenteditable", "false"); // belt-and-suspenders
  overlay.setAttribute("tabindex", "-1"); // it shouldn't be keyboard-focusable

  // If you click the empty overlay (not a chip), prevent default so no caret shows
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) {
      e.preventDefault(); // stops caret/focus behavior in all major browsers
    }
  });

  const statusEl = $("#status");
  const q = new URLSearchParams(location.search);

  /* ===== Simple event bus ===== */
  const bus = {
    listeners: new Map(),
    on(evt, fn) {
      const arr = this.listeners.get(evt) || [];
      arr.push(fn);
      this.listeners.set(evt, arr);
    },
    emit(evt, ...args) {
      const arr = this.listeners.get(evt);
      if (arr)
        for (const f of arr) {
          try {
            f(...args);
          } catch (e) {
            console.warn("[bus]", e);
          }
        }
    },
  };

  /* ===== Combo Branching Data Model ===== */
  let comboGraph = {
    nodes: [],
    edges: [],
    rootId: null,
    activeId: null,
  };

  function createComboNode(label, chipsHTML) {
    return {
      id: "node_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9),
      label: label,
      chipsHTML: chipsHTML || [],
    };
  }

  function saveCurrentAsNode(label) {
    const chips = [...overlay.querySelectorAll(".chip")];
    const chipsHTML = chips.map((chip) => chip.innerHTML);
    const node = createComboNode(label, chipsHTML);

    comboGraph.nodes.push(node);

    if (!comboGraph.rootId) {
      comboGraph.rootId = node.id;
    }

    comboGraph.activeId = node.id;
    updateNodeSelector();
    setStatus(`Saved node: ${label}`);
    return node;
  }

  function branchFromActiveNode() {
    if (!comboGraph.activeId) {
      setStatus("No active node to branch from");
      return null;
    }

    const activeNode = comboGraph.nodes.find(
      (n) => n.id === comboGraph.activeId
    );
    if (!activeNode) {
      setStatus("Active node not found");
      return null;
    }

    const branchLabel = activeNode.label + " (branch)";
    const branchNode = createComboNode(branchLabel, [...activeNode.chipsHTML]);

    comboGraph.nodes.push(branchNode);
    comboGraph.edges.push({ from: comboGraph.activeId, to: branchNode.id });
    comboGraph.activeId = branchNode.id;

    updateNodeSelector();
    setStatus(`Branched from ${activeNode.label}`);
    return branchNode;
  }

  function switchToNode(nodeId) {
    const node = comboGraph.nodes.find((n) => n.id === nodeId);
    if (!node) {
      setStatus("Node not found");
      return;
    }

    // Save current state before switching
    if (comboGraph.activeId) {
      const currentChips = [...overlay.querySelectorAll(".chip")];
      const currentChipsHTML = currentChips.map((chip) => chip.innerHTML);
      const activeNode = comboGraph.nodes.find(
        (n) => n.id === comboGraph.activeId
      );
      if (activeNode) {
        activeNode.chipsHTML = currentChipsHTML;
        // Push a snapshot for the node we're leaving
        pushHistory(`Switch from ${activeNode.label}`);
      }
    }

    comboGraph.activeId = nodeId;
    updateNodeSelector();

    // Restore the node's chips
    restoreNodeChips(node);

    // Push a snapshot for the node we're switching to
    pushHistory(`Switch to ${node.label}`);
    setStatus(`Switched to: ${node.label}`);
  }

  function restoreNodeChips(node) {
    // Suppress history during restoration
    const wasSuppressed = suppressHistory;
    suppressHistory = true;

    // Clear current overlay
    overlay.innerHTML = "";
    buffer.length = 0;
    bus.emit("overlay:clear");

    // Restore chips from node
    node.chipsHTML.forEach((html, i) => {
      if (i > 0) {
        addSeparator();
      }

      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = html;
      chip.tabIndex = 0;
      chip.addEventListener("click", (ev) => {
        selectChip(chip);
        openPopover(chip);
        ev.stopPropagation();
      });
      chip.addEventListener("dblclick", (ev) => {
        selectChip(chip);
        openPopover(chip, true);
        ev.stopPropagation();
      });
      overlay.appendChild(chip);
    });

    rebuildBuffer();

    // Restore previous suppress state
    suppressHistory = wasSuppressed;
  }

  function updateNodeSelector() {
    const selector = $("#nodeSelector");
    if (!selector) return;

    selector.innerHTML = "";

    if (comboGraph.nodes.length === 0) {
      selector.innerHTML = '<option value="">No nodes saved</option>';
      selector.disabled = true;
      return;
    }

    selector.disabled = false;
    comboGraph.nodes.forEach((node) => {
      const option = document.createElement("option");
      option.value = node.id;
      option.textContent = node.label;
      if (node.id === comboGraph.activeId) {
        option.selected = true;
      }
      selector.appendChild(option);
    });
  }
  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
    console.log("[overlay]", msg);
    bus.emit("status", msg);
  }

  /* ===== Profiles / persistence ===== */
  const LS_PROFILES = "gp_profiles_obs_v13_7";
  const LS_ACTIVE = "gp_active_profile_obs_v13_7";
  const DEFAULT_BUTTON_LABELS = [
    "L",
    "M",
    "H",
    "S",
    "LB",
    "RB",
    "LT",
    "RT",
    "Select",
    "Start",
    "L3",
    "R3",
    "D↑",
    "D↓",
    "D←",
    "D→",
  ];
  const DEFAULT_BUTTON_COLORS = Array(16).fill("#000000");
  const DEFAULT_BUTTON_BG = Array(16).fill("#f5f5f5");
  function defaultProfile() {
    return {
      name: "Default",
      buttonLabels: [...DEFAULT_BUTTON_LABELS],
      buttonColors: [...DEFAULT_BUTTON_COLORS],
      buttonBgColors: [...DEFAULT_BUTTON_BG],
      deadzone: 0.5,
      chordWindow: 130,
      repeatLockout: 110,
      holdMs: 250,
      motionWindow: 700,
      motionCoupleMs: 130,
      chargeFrames: 30,
      chargeWindow: 180,
      mashWindowMs: 350,
      facing: "right",
      resetAction: "none",
      separator: ">",
      notationMode: "images",
      motionInputsEnabled: true,
    };
  }
  function loadProfiles() {
    try {
      const raw = localStorage.getItem(LS_PROFILES);
      if (!raw) return [defaultProfile()];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.length ? arr : [defaultProfile()];
    } catch {
      return [defaultProfile()];
    }
  }
  function saveProfiles() {
    localStorage.setItem(LS_PROFILES, JSON.stringify(profiles));
  }
  function loadActive() {
    const v = parseInt(localStorage.getItem(LS_ACTIVE) || "0", 10);
    return Number.isFinite(v) && v >= 0 && v < profiles.length ? v : 0;
  }
  function saveActive() {
    localStorage.setItem(LS_ACTIVE, String(activeProfile));
  }
  let profiles = loadProfiles();
  let activeProfile = loadActive();

  /* ===== Undo/Redo Manager (Node-aware) ===== */
  const nodeHistory = new Map(); // nodeId -> { past:[], future:[], max:200 }
  let suppressHistory = false;
  let historyDebounceTimer = null;

  function snapshotOverlay() {
    const chips = [...overlay.querySelectorAll(".chip")];
    const separators = [...overlay.querySelectorAll(".sep")];
    return {
      chips: chips.map((chip) => chip.innerHTML),
      separators: separators.map((sep) => sep.textContent),
      timestamp: performance.now(),
    };
  }

  function restoreOverlay(state) {
    // Suppress history during restore
    const wasSuppressed = suppressHistory;
    suppressHistory = true;

    // Clear current overlay
    overlay.innerHTML = "";
    buffer.length = 0;
    bus.emit("overlay:clear");

    // Rebuild overlay from state
    const { chips, separators } = state;
    let chipIndex = 0;
    let sepIndex = 0;

    // Interleave chips and separators (assuming they alternate)
    for (let i = 0; i < chips.length + separators.length; i++) {
      if (i % 2 === 0 && chipIndex < chips.length) {
        // Add chip
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.innerHTML = chips[chipIndex];
        chip.tabIndex = 0;
        chip.addEventListener("click", (ev) => {
          selectChip(chip);
          openPopover(chip);
          ev.stopPropagation();
        });
        chip.addEventListener("dblclick", (ev) => {
          selectChip(chip);
          openPopover(chip, true);
          ev.stopPropagation();
        });
        overlay.appendChild(chip);
        bus.emit("chip:add", chip);
        chipIndex++;
      } else if (sepIndex < separators.length) {
        // Add separator
        const sep = document.createElement("span");
        sep.className = "sep";
        sep.textContent = separators[sepIndex];
        overlay.appendChild(sep);
        sepIndex++;
      }
    }

    rebuildBuffer();

    // Restore previous suppress state
    suppressHistory = wasSuppressed;
  }

  function getCurrentNodeHistory() {
    if (!comboGraph.activeId) {
      // Create a default history for when no node is active
      const defaultId = "default";
      if (!nodeHistory.has(defaultId)) {
        nodeHistory.set(defaultId, { past: [], future: [], max: 200 });
      }
      return nodeHistory.get(defaultId);
    }

    if (!nodeHistory.has(comboGraph.activeId)) {
      nodeHistory.set(comboGraph.activeId, { past: [], future: [], max: 200 });
    }
    return nodeHistory.get(comboGraph.activeId);
  }

  function pushHistory(label) {
    // Disable old history system to prevent conflicts with new discrete operation system
    return;

    if (suppressHistory) return;

    // Clear debounce timer
    if (historyDebounceTimer) {
      clearTimeout(historyDebounceTimer);
    }

    // Debounce rapid changes
    historyDebounceTimer = setTimeout(() => {
      const snapshot = snapshotOverlay();
      snapshot.label = label;
      snapshot.nodeId = comboGraph.activeId;

      const history = getCurrentNodeHistory();

      // Add to past, clear future
      history.past.push(snapshot);
      history.future = [];

      // Trim to max size
      if (history.past.length > history.max) {
        history.past.shift();
      }

      console.log(
        `[undo] Pushed: ${label} (node: ${comboGraph.activeId || "default"})`
      );
    }, 250);
  }

  function undo() {
    const history = getCurrentNodeHistory();
    if (history.past.length === 0) return;

    // Move current state to future
    const current = snapshotOverlay();
    current.label = "Current";
    current.nodeId = comboGraph.activeId;
    history.future.unshift(current);

    // Restore previous state
    const previous = history.past.pop();
    restoreOverlay(previous);

    setStatus(`Undid: ${previous.label || "Unknown"}`);
    console.log(
      `[undo] Undid: ${previous.label || "Unknown"} (node: ${
        comboGraph.activeId || "default"
      })`
    );
  }

  function redo() {
    const history = getCurrentNodeHistory();
    if (history.future.length === 0) return;

    // Move current state to past
    const current = snapshotOverlay();
    current.label = "Current";
    current.nodeId = comboGraph.activeId;
    history.past.push(current);

    // Restore future state
    const next = history.future.shift();
    restoreOverlay(next);

    setStatus(`Redid: ${next.label || "Unknown"}`);
    console.log(
      `[undo] Redid: ${next.label || "Unknown"} (node: ${
        comboGraph.activeId || "default"
      })`
    );
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

    contextMenu = document.createElement("div");
    contextMenu.className = "context-menu";
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
    contextMenu.addEventListener("click", (e) => {
      const item = e.target.closest(".context-menu-item");
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
    const betweenItems = contextMenu.querySelectorAll(
      '[data-action="insert-custom"], [data-action="insert-controller"]'
    );
    const chipItems = contextMenu.querySelectorAll(
      '[data-action="insert-left"], [data-action="insert-right"]'
    );

    if (chip) {
      // Right-clicked on a chip
      betweenItems.forEach((item) => (item.style.display = "none"));
      chipItems.forEach((item) => (item.style.display = "flex"));
      insertMode = "chip";
      insertPosition = chip;
    } else {
      // Right-clicked in empty space
      betweenItems.forEach((item) => (item.style.display = "flex"));
      chipItems.forEach((item) => (item.style.display = "none"));
      insertMode = "between";
      insertPosition = null;
    }

    contextMenu.style.left = x + "px";
    contextMenu.style.top = y + "px";
    contextMenu.style.display = "block";
  }

  function hideContextMenu() {
    if (contextMenu) {
      contextMenu.style.display = "none";
    }
  }

  function handleContextMenuAction(action) {
    switch (action) {
      case "insert-custom":
        if (insertMode === "between") {
          insertCustomTextBetween();
        } else if (insertMode === "chip") {
          insertCustomTextAtChip();
        }
        break;
      case "insert-controller":
        if (insertMode === "between") {
          insertFromControllerBetween();
        } else if (insertMode === "chip") {
          insertFromControllerAtChip();
        }
        break;
      case "insert-left":
        insertFromControllerAtChip("left");
        break;
      case "insert-right":
        insertFromControllerAtChip("right");
        break;
    }
  }

  function insertCustomTextBetween() {
    const text = prompt("Enter chip text:");
    if (!text || !text.trim()) {
      hideContextMenu();
      return;
    }

    const html = `<span style="color:${getComputedStyle(
      document.documentElement
    )
      .getPropertyValue("--chip-text")
      .trim()}">${escapeHtml(text.trim())}</span>`;
    const index = getInsertionIndex();
    insertChipAt(index, html);
    hideContextMenu();
  }

  function insertCustomTextAtChip() {
    const text = prompt("Enter chip text:");
    if (!text || !text.trim()) {
      hideContextMenu();
      return;
    }

    const html = `<span style="color:${getComputedStyle(
      document.documentElement
    )
      .getPropertyValue("--chip-text")
      .trim()}">${escapeHtml(text.trim())}</span>`;
    const chipIndex = getChipIndex(insertPosition);
    insertChipAt(chipIndex, html);
    hideContextMenu();
  }

  function insertFromControllerBetween() {
    insertMode = "controller-between";
    insertPosition = getInsertionIndex();
    createPendingInsertion();
    setStatus("Controller capture: press a button to insert chip...");
  }

  function insertFromControllerAtChip(side = "left") {
    insertMode = "controller-chip";
    insertPosition = insertPosition;
    insertSide = side;
    createPendingInsertion();
    setStatus(
      `Controller capture: press a button to insert ${side} of chip...`
    );
  }

  function createPendingInsertion() {
    // Create a placeholder chip to show where insertion will happen
    const placeholder = document.createElement("span");
    placeholder.className = "chip pending-insertion";
    placeholder.innerHTML =
      '<span style="color:#9aa3b2">Press controller button...</span>';
    placeholder.tabIndex = 0;

    let index;
    if (insertMode === "controller-between") {
      index = insertPosition;
    } else if (insertMode === "controller-chip") {
      const chipIndex = getChipIndex(insertPosition);
      const side = insertSide || "left";
      index = chipIndex + (side === "right" ? 1 : 0);
    } else {
      index = 0;
    }

    // Insert the placeholder using the same logic as regular chips
    const chips = [...overlay.querySelectorAll(".chip")];

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
      const separator = document.createElement("span");
      separator.className = "sep";
      separator.textContent = profiles[activeProfile].separator || ">";
      overlay.insertBefore(separator, targetChip);
    }

    pendingInsertion = placeholder;
  }

  function getInsertionIndex() {
    // Find the index where we should insert based on click position
    const chips = [...overlay.querySelectorAll(".chip")];
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
    const shouldInsertAfter = clickPosition.x > rect.left + rect.width / 2;

    return shouldInsertAfter ? closestIndex + 1 : closestIndex;
  }

  function getChipIndex(chip) {
    const chips = [...overlay.querySelectorAll(".chip")];
    return chips.indexOf(chip);
  }

  function insertChipAt(index, html, isPlaceholder = false) {
    // Remove any existing pending insertion
    if (pendingInsertion) {
      pendingInsertion.remove();
      pendingInsertion = null;
    }

    // Create the chip element
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = html;
    chip.tabIndex = 0;

    if (!isPlaceholder) {
      // Add event listeners for real chips
      chip.addEventListener("click", (ev) => {
        selectChip(chip);
        openPopover(chip);
        ev.stopPropagation();
      });
      chip.addEventListener("dblclick", (ev) => {
        selectChip(chip);
        openPopover(chip, true);
        ev.stopPropagation();
      });
    }

    // Get current chips
    const chips = [...overlay.querySelectorAll(".chip")];

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
      const separator = document.createElement("span");
      separator.className = "sep";
      separator.textContent = profiles[activeProfile].separator || ">";
      overlay.insertBefore(separator, targetChip);
    }

    if (!isPlaceholder) {
      rebuildBuffer();
      bus.emit("chip:add", chip);

      // Use discrete history system instead of old pushHistory
      const chips = getChipList();
      const chipIndex = chips.indexOf(chip);
      history.push({
        type: "chip:add",
        index: chipIndex,
        html: html,
      });
    }

    return chip;
  }

  function completeInsertionFromController(btnIndex) {
    if (!insertMode || !insertMode.startsWith("controller")) return;

    // Build chip HTML using existing logic
    const dirTok = captureDirTok || snapshotDirection() || "n";
    const motionHTML = detectMotionForButton();
    const p = profiles[activeProfile];
    let finalLabel = p.buttonLabels[btnIndex] || `#${btnIndex}`;
    if (dirTok === "u" && !/^j\./i.test(finalLabel))
      finalLabel = "j." + finalLabel;

    let html;
    if (motionHTML) {
      html = `${motionHTML} ${buttonHTML(btnIndex, finalLabel)}`;
    } else if (dirTok && dirTok !== "n") {
      const dirHTML = dirToImg(dirTok) || dirTok.toUpperCase();
      html = `${dirHTML} + ${buttonHTML(btnIndex, finalLabel)}`;
    } else {
      html = buttonHTML(btnIndex, finalLabel);
    }

    // If there's a pending insertion placeholder, replace it
    if (pendingInsertion) {
      const chip = pendingInsertion;
      chip.innerHTML = html;
      chip.className = "chip";
      chip.tabIndex = 0;

      // Add event listeners for the real chip
      chip.addEventListener("click", (ev) => {
        selectChip(chip);
        openPopover(chip);
        ev.stopPropagation();
      });
      chip.addEventListener("dblclick", (ev) => {
        selectChip(chip);
        openPopover(chip, true);
        ev.stopPropagation();
      });

      // Clean up insertion state
      pendingInsertion = null;
      insertMode = null;
      insertPosition = null;
      insertSide = null;
      clickPosition = null;

      rebuildBuffer();
      bus.emit("chip:add", chip);
      pushHistory("Insert chip");
      setStatus("Chip inserted");
      hideContextMenu();
      return;
    }

    // Fallback: determine insertion index and insert normally
    let index;
    if (insertMode === "controller-between") {
      index = insertPosition;
    } else if (insertMode === "controller-chip") {
      const chipIndex = getChipIndex(insertPosition);
      const side = insertSide || "left";
      index = chipIndex + (side === "right" ? 1 : 0);
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
    setStatus("Chip inserted");
    hideContextMenu();
  }

  let resetCaptureActive = false;

  // Import profiles via ?config or ?configUrl
  (async function bootConfigFromQuery() {
    try {
      if (q.get("config")) {
        const json = JSON.parse(atob(q.get("config")));
        if (Array.isArray(json) && json.length) {
          profiles = json;
          activeProfile = 0;
          saveProfiles();
          saveActive();
          refreshProfileUI();
        }
      } else if (q.get("configUrl")) {
        const url = q.get("configUrl");
        if (/^https?:/i.test(url)) {
          const res = await fetch(url, { cache: "no-store" });
          const json = await res.json();
          if (Array.isArray(json) && json.length) {
            profiles = json;
            activeProfile = 0;
            saveProfiles();
            saveActive();
            refreshProfileUI();
          }
        }
      }
    } catch (e) {
      console.warn("Config import error", e);
    }
  })();

  // UI refs
  const profileSelect = $("#profileSelect"),
    profileName = $("#profileName");
  const newProfileBtn = $("#newProfile"),
    dupProfileBtn = $("#dupProfile"),
    delProfileBtn = $("#delProfile"),
    saveProfileBtn = $("#saveProfile");
  const exportBtn = $("#exportBtn"),
    importBtn = $("#importBtn"),
    importInput = $("#importInput");
  const makeObsUrlBtn = $("#makeObsUrl");
  const buttonMapTable = $("#buttonMapTable");
  const bindResetBtn = $("#bindResetBtn");
  const clearResetBtn = $("#clearResetBtn");
  const resetLabel = $("#resetLabel");

  const chipFontInp = $("#chipFont"),
    chipImgHInp = $("#chipImgH"),
    chipPadXInp = $("#chipPadX"),
    chipPadYInp = $("#chipPadY"),
    chipGapInp = $("#chipGap"),
    chipRadiusInp = $("#chipRadius"),
    overlayWidthInp = $("#overlayWidth"),
    separatorInp = $("#separator"),
    chipBgAllInp = $("#chipBgAll"),
    chipTextAllInp = $("#chipTextAll"),
    useGlobalColors = $("#useGlobalColors"),
    overlayFullChk = $("#overlayFullWidth");

  const resetSel = $("#resetAction");
  const facingSel = $("#facing");

  bindResetBtn?.addEventListener("click", () => {
    resetCaptureActive = true;
    setStatus(
      "Press the controller button you want to use for Reset… (Esc to cancel)"
    );
  });

  clearResetBtn?.addEventListener("click", () => {
    const p = profiles[activeProfile];
    p.resetAction = "none";
    saveProfiles();
    renderResetLabel();
    setStatus("Reset binding cleared.");
  });

  // Allow cancel with Esc while capturing
  window.addEventListener("keydown", (e) => {
    if (resetCaptureActive && e.key === "Escape") {
      resetCaptureActive = false;
      setStatus("Reset binding canceled.");
    }
  });

  /* ===== Multi-select / marquee selection ===== */
  let currentSelectedChip = null; // keep existing single "primary" for compatibility
  const selectedChips = new Set(); // multi-select set
  let marquee = null; // DOM box
  let marqueeActive = false;
  let marqueeStart = { x: 0, y: 0 };
  let popEl = null;

  // Prevent the document click-clears right after a marquee release
  let suppressNextDocClick = false;

  // Cooldown so DOWN doesn't spam remove
  let lastDownRemoveAt = 0;

  // Remove j. from a single chip
  function removeJPrefix(chip) {
    if (!chip) return;
    const lastSpan = chip.querySelector("span:last-of-type");
    if (!lastSpan) return;
    const cur = lastSpan.textContent.trim();
    const next = cur.replace(/^j\.\s*/i, "");
    if (next !== cur) {
      lastSpan.textContent = next;
      window.ComboOverlay?.rebuildBuffer?.();
    }
  }

  // Remove j. from all selected chips
  function removeJPrefixBulk() {
    if (!selectedChips.size) return;
    for (const ch of selectedChips) removeJPrefix(ch);
    window.ComboOverlay?.rebuildBuffer?.();
    pushHistory(`Remove j. from ${selectedChips.size} chips`);
  }

  /* ===== Button label PRESETS + guided controller binding ===== */

  // 1) Define your presets here.
  // Order matters for the guided binding flow—this is the sequence of prompts.
  // (You can add more later; the UI auto-pulls keys from this object.)
  /* ===== Button label PRESETS + guided controller binding (with banner) ===== */

  const BUTTON_PRESETS = {
    "2XKO": {
      labels: [
        "L",
        "M",
        "H",
        "S1",
        "S2",
        "Tag",
        "Parry",
        "Dash",
        "Start",
        "Select",
        "L3",
        "R3",
        "D↑",
        "D↓",
        "D←",
        "D→",
      ],
    },
    "Street Fighter 6": {
      labels: [
        "LP",
        "MP",
        "HP",
        "LK",
        "MK",
        "HK",
        "DI",
        "Parry",
        "Start",
        "Select",
        "L3",
        "R3",
        "D↑",
        "D↓",
        "D←",
        "D→",
      ],
    },
  };

  let presetBind = {
    active: false,
    name: null,
    i: 0,
    queue: [],
  };

  /* ===== Banner UI ===== */
  function ensureBindingBanner() {
    if (document.getElementById("bindingBanner")) return;
    const b = document.createElement("div");
    b.id = "bindingBanner";
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
    document
      .getElementById("bindingBannerCancel")
      .addEventListener("click", cancelPresetBinding);
  }
  function showBindingBanner(msg) {
    ensureBindingBanner();
    const b = document.getElementById("bindingBanner");
    const m = document.getElementById("bindingBannerMsg");
    if (m) m.textContent = msg || "";
    b.style.display = "inline-flex";
  }
  function hideBindingBanner() {
    const b = document.getElementById("bindingBanner");
    if (b) b.style.display = "none";
  }

  function startPresetBinding(presetName) {
    const preset = BUTTON_PRESETS[presetName];
    if (!preset) {
      setStatus("Unknown preset.");
      return;
    }
    presetBind.active = true;
    presetBind.name = presetName;
    presetBind.i = 0;
    presetBind.queue = Array.from(preset.labels || []);
    const first = presetBind.queue[0];
    const msg = `Binding "${presetName}": Press the controller button for "${first}". (Esc to cancel, Space to skip)`;
    setStatus(msg);
    showBindingBanner(msg);
  }

  function cancelPresetBinding() {
    if (!presetBind.active) return;
    presetBind.active = false;
    presetBind.name = null;
    presetBind.queue = [];
    presetBind.i = 0;
    hideBindingBanner();
    setStatus("Preset binding canceled.");
  }

  function stepPresetBindingAssigned() {
    presetBind.i++;
    if (presetBind.i >= presetBind.queue.length) {
      const done = `Preset "${presetBind.name}" bound to controller buttons.`;
      setStatus(done);
      hideBindingBanner();
      presetBind.active = false;
      presetBind.name = null;
      presetBind.queue = [];
      presetBind.i = 0;
    } else {
      const next = `Now press the button for "${
        presetBind.queue[presetBind.i]
      }". (Esc to cancel, Space to skip)`;
      setStatus(next);
      showBindingBanner(next);
    }
  }

  function applyPresetDirect(presetName) {
    const preset = BUTTON_PRESETS[presetName];
    if (!preset) {
      setStatus("Unknown preset.");
      return;
    }
    const p = profiles[activeProfile];
    const N = Math.max(16, p.buttonLabels.length);
    p.buttonLabels = Array.from(
      { length: N },
      (_, i) => preset.labels[i] ?? p.buttonLabels[i] ?? `#${i}`
    );
    saveProfiles();
    refreshProfileUI();
    setStatus(`Applied preset labels: ${presetName}`);
  }

  /* Small preset UI (dropdown + buttons), near your button map */
  (function ensurePresetUI() {
    const host =
      document.querySelector("#buttonMapTable")?.parentNode || document.body;
    if (document.getElementById("presetBar")) return;

    const wrap = document.createElement("div");
    wrap.id = "presetBar";
    wrap.style.cssText =
      "margin-top:12px; display:grid; grid-template-columns: 1fr auto auto; gap:8px; align-items:center;";

    const sel = document.createElement("select");
    sel.id = "presetSelect";
    sel.style.maxWidth = "280px";
    sel.innerHTML = Object.keys(BUTTON_PRESETS)
      .map((n) => `<option value="${n}">${n}</option>`)
      .join("");

    const btnApply = document.createElement("button");
    btnApply.textContent = "Apply Preset Labels";
    btnApply.className = "btn";

    const btnBind = document.createElement("button");
    btnBind.textContent = "Bind Preset via Controller…";
    btnBind.className = "btn";

    wrap.appendChild(sel);
    wrap.appendChild(btnApply);
    wrap.appendChild(btnBind);
    host.appendChild(wrap);

    btnApply.addEventListener("click", () => {
      const name = sel.value;
      applyPresetDirect(name);
    });

    btnBind.addEventListener("click", () => {
      const name = sel.value;
      startPresetBinding(name);
    });

    // Esc cancels binding
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cancelPresetBinding();
    });
  })();

  function isChip(el) {
    return el && el.classList && el.classList.contains("chip");
  }

  function clearPrimary() {
    if (currentSelectedChip) {
      currentSelectedChip.classList.remove("selected");
      currentSelectedChip = null;
    }
  }

  function updateSelectedStyles() {
    // visual selection ring
    const chips = overlay.querySelectorAll(".chip");
    chips.forEach((ch) =>
      ch.classList.toggle("selected", selectedChips.has(ch))
    );
  }

  function deselectAll() {
    selectedChips.clear();
    clearPrimary();
    updateSelectedStyles();
  }

  function selectOnly(chip) {
    selectedChips.clear();
    selectedChips.add(chip);
    currentSelectedChip = chip;
    updateSelectedStyles();
  }

  function addToSelection(chip) {
    selectedChips.add(chip);
    currentSelectedChip = chip; // last clicked becomes primary
    updateSelectedStyles();
  }

  function removeFromSelection(chip) {
    selectedChips.delete(chip);
    if (currentSelectedChip === chip) currentSelectedChip = null;
    updateSelectedStyles();
  }

  function getChipBounds(chip) {
    const r = chip.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  function rectsIntersect(a, b) {
    return !(
      b.left > a.right ||
      b.right < a.left ||
      b.top > a.bottom ||
      b.bottom < a.top
    );
  }

  /* ===== Bulk ops ===== */
  function addJPrefixBulk() {
    if (!selectedChips.size) return;
    for (const ch of selectedChips) addJPrefix(ch);
    window.ComboOverlay?.rebuildBuffer?.();
    pushHistory(`Add j. to ${selectedChips.size} chips`);
  }

  function deleteSelectedBulk() {
    if (!selectedChips.size) return;
    // remove in DOM order left→right to keep separators clean
    const arr = Array.from(selectedChips).sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );
    for (const ch of arr) {
      const prev = ch.previousSibling,
        next = ch.nextSibling;
      if (prev && prev.classList && prev.classList.contains("sep"))
        prev.remove();
      else if (next && next.classList && next.classList.contains("sep"))
        next.remove();
      ch.remove();
      if (currentSelectedChip === ch) currentSelectedChip = null;
      bus.emit("chip:remove", ch);
    }
    selectedChips.clear();
    currentSelectedChip = null;
    updateSelectedStyles();
    rebuildBuffer();
    pushHistory(`Delete ${arr.length} chips`);
  }

  function clearMotionBulk() {
    for (const chip of selectedChips) {
      [...chip.querySelectorAll("img")].forEach((img) => {
        if (["qcf", "qcb", "dpf", "dpb", "hcf", "hcb", "360"].includes(img.alt))
          img.remove();
      });
    }
    window.ComboOverlay?.rebuildBuffer?.();
    pushHistory(`Clear motion from ${selectedChips.size} chips`);
  }

  function clearDirBulk() {
    for (const chip of selectedChips) {
      const imgs = [...chip.querySelectorAll("img")];
      for (const img of imgs) {
        const a = img.alt;
        if (["u", "d", "b", "f", "ub", "uf", "db", "df"].includes(a))
          img.remove();
      }
      const span = chip.querySelector("span:last-of-type");
      if (span) {
        span.textContent = span.textContent.trim().replace(/^j\./i, "");
      }
    }
    window.ComboOverlay?.rebuildBuffer?.();
    pushHistory(`Clear direction from ${selectedChips.size} chips`);
  }

  /* Rename tail text for all (keeps icons intact) */
  function renameTailBulk(newTxt) {
    if (!newTxt) return;
    for (const chip of selectedChips) {
      const lastSpan = chip.querySelector("span:last-of-type");
      if (lastSpan) lastSpan.textContent = newTxt;
    }
    window.ComboOverlay?.rebuildBuffer?.();
    pushHistory(`Rename tail to "${newTxt}" on ${selectedChips.size} chips`);
  }

  /* Utility: find chip at event target (click bubbling) */
  function chipFromEventTarget(t) {
    while (t && t !== document.body) {
      if (isChip(t)) return t;
      t = t.parentNode;
    }
    return null;
  }

  function applyCssKnobs() {
    document.documentElement.style.setProperty(
      "--chip-font",
      chipFontInp.value + "px"
    );
    document.documentElement.style.setProperty(
      "--chip-img-h",
      chipImgHInp.value + "px"
    );
    document.documentElement.style.setProperty(
      "--chip-pad-x",
      chipPadXInp.value + "px"
    );
    document.documentElement.style.setProperty(
      "--chip-pad-y",
      chipPadYInp.value + "px"
    );
    document.documentElement.style.setProperty(
      "--chip-gap",
      chipGapInp.value + "px"
    );
    document.documentElement.style.setProperty(
      "--chip-radius",
      chipRadiusInp.value + "px"
    );

    // FULL-WIDTH: drive the same --overlay-width var so the overlay reacts immediately
    if (overlayFullChk?.checked) {
      document.body.classList.add("fullwidth");
      document.documentElement.style.setProperty("--overlay-width", "100vw");
    } else {
      document.body.classList.remove("fullwidth");
      document.documentElement.style.setProperty(
        "--overlay-width",
        overlayWidthInp.value + "px"
      );
    }

    document.documentElement.style.setProperty("--chip-bg", chipBgAllInp.value);
    document.documentElement.style.setProperty(
      "--chip-text",
      chipTextAllInp.value
    );
    document.body.classList.toggle(
      "global-override",
      !!useGlobalColors.checked
    );
  }

  // ===== Mash collapse config/state =====
  const mashState = {
    key: null, // normalized signature for the input (dir/motion + button)
    firstChip: null, // the chip element to keep/rename
    firstTime: 0, // timestamp of first press in the burst
    count: 0, // how many presses in current burst
  };

  // normalize the HTML signature (stable key for direction/motion+button)
  function normalizeHTML(html) {
    return html.replace(/\s+/g, " ").trim();
  }

  // Remove the very last chip + its preceding separator (if present)
  function removeLastChip() {
    const last = overlay.lastElementChild;
    if (!last) return;
    // last should be a chip; the previous sibling (if any) is the sep
    if (last.classList && last.classList.contains("chip")) {
      // prefer using existing removeChip so it emits events/cleans sep
      removeChip(last);
    } else {
      // fallback: if last isn't a chip, just remove it
      last.remove();
    }
  }

  // Turn the kept chip into "mash ..."
  function mashifyChip(chipEl) {
    if (!chipEl) return;
    // Take the current visual contents (e.g., "<img ...> + <span>H</span>")
    // and remove the " + " joiner so it reads like: mash [arrow] H
    const inner = chipEl.innerHTML.replace(/\s\+\s/g, " ");
    chipEl.innerHTML = `<span class="mash-tag" style="font-weight:900">Mash</span> ${inner}`;
  }

  // Update mash state after we've added a chip; possibly remove recent chips
  // Returns: 'kept' | 'collapsed' | 'removed' (removed = the just-added chip got pulled)
  function updateMashAfterAdd(newHtml, newChip) {
    const key = normalizeHTML(newHtml);
    const t = now();
    const mashWindow = profiles[activeProfile].mashWindowMs || 350;

    // continuing same-burst?
    if (mashState.key === key && t - mashState.firstTime <= mashWindow) {
      mashState.count += 1;
      mashState.firstTime = t;

      if (mashState.count === 2) {
        // show first two normally
        return "kept";
      }
      if (mashState.count === 3) {
        // collapse to 1: remove the last two chips (current + previous), then mashify the first
        removeLastChip(); // removes current (just-added)
        removeLastChip(); // removes previous duplicate
        mashifyChip(mashState.firstChip);
        rebuildBuffer();
        return "collapsed";
      }
      // 4th+ identical press within window: discard the new add silently
      removeLastChip(); // remove the just-added one
      rebuildBuffer();
      return "removed";
    }

    // new series (or outside window): start a fresh burst
    mashState.key = key;
    mashState.firstChip = newChip;
    mashState.firstTime = t;
    mashState.count = 1;
    return "kept";
  }

  const practiceToggle = document.querySelector("#practiceToggle");
  const practiceBar = document.querySelector("#practiceBar");
  let practiceMode = false;

  function setPracticeMode(on) {
    practiceMode = !!on;
    document.body.classList.toggle("practice", practiceMode);
    if (practiceBar) practiceBar.style.display = practiceMode ? "" : "none";
    if (practiceToggle)
      practiceToggle.textContent = `Practice Mode: ${
        practiceMode ? "On" : "Off"
      } (P)`;
    // status hint
    setStatus(
      practiceMode
        ? "Practice Mode ON: use compact playback controls."
        : "Practice Mode OFF."
    );
  }

  practiceToggle?.addEventListener("click", () =>
    setPracticeMode(!practiceMode)
  );

  function renderResetLabel() {
    const p = profiles[activeProfile];
    const v = p?.resetAction || "none";
    if (!resetLabel) return;
    resetLabel.textContent = v === "none" ? "Reset: none" : `Reset: ${v}`;
  }

  function setInputValue(sel, val) {
    const el = document.querySelector(sel);
    if (el) el.value = val;
  }

  function refreshProfileUI() {
    if (activeProfile < 0 || activeProfile >= profiles.length)
      activeProfile = 0;
    const p = profiles[activeProfile];
    if (profileSelect)
      profileSelect.innerHTML = profiles
        .map(
          (pp, i) =>
            `<option value="${i}" ${
              i === activeProfile ? "selected" : ""
            }>${escapeHtml(pp.name || `Profile ${i + 1}`)}</option>`
        )
        .join("");
    if (profileName) profileName.value = p.name || "";
    renderButtonMap();
    if (resetSel)
      resetSel.innerHTML = [
        "none",
        ...Array.from({ length: 16 }, (_, i) => `button:${i}`),
      ]
        .map(
          (v) =>
            `<option value="${v}" ${
              p.resetAction === v ? "selected" : ""
            }>${v}</option>`
        )
        .join("");
    if (facingSel) facingSel.value = p.facing || "right";
    if (overlayFullChk) overlayFullChk.checked = !!p.overlayFullWidth; // ensure UI reflects profile

    // Set motion inputs enabled checkbox
    const motionInputsChk = document.querySelector("#motionInputsEnabled");
    if (motionInputsChk)
      motionInputsChk.checked = p.motionInputsEnabled !== false;

    // Add null checks for all profile values to prevent 'undefined' errors
    setInputValue("#deadzone", p.deadzone || 0.5);
    setInputValue("#chordWindow", p.chordWindow || 130);
    setInputValue("#repeatLockout", p.repeatLockout || 110);
    setInputValue("#holdMs", p.holdMs || 250);
    setInputValue("#motionWindow", p.motionWindow || 700);
    setInputValue("#motionCoupleMs", p.motionCoupleMs || 130);
    setInputValue("#chargeFrames", p.chargeFrames || 30);
    setInputValue("#chargeWindow", p.chargeWindow || 180);
    setInputValue("#mashWindowMs", p.mashWindowMs || 350);
    if (separatorInp) separatorInp.value = p.separator || ">";

    // Set notation mode radio buttons
    const notationRadios = document.querySelectorAll(
      'input[name="notationMode"]'
    );
    notationRadios.forEach((radio) => {
      radio.checked = radio.value === (p.notationMode || "images");
    });

    renderResetLabel();
    applyCssKnobs();
  }

  function renderButtonMap() {
    const p = profiles[activeProfile];
    if (!buttonMapTable) return;
    let rows = "<tr><th>#</th><th>Label</th><th>Text</th><th>Chip BG</th></tr>";
    const N = Math.max(16, p.buttonLabels.length);
    for (let i = 0; i < N; i++) {
      const label = p.buttonLabels[i] ?? "";
      const color = p.buttonColors[i] ?? "#000000";
      const bg = p.buttonBgColors[i] ?? "#f5f5f5";
      rows += `<tr><td>#${i}</td><td><input data-btn="${i}" class="btn-label" type="text" value="${escapeHtml(
        label
      )}"></td><td><input data-btn-color="${i}" class="btn-color" type="color" value="${color}"></td><td><input data-btn-bg="${i}" class="btn-bg" type="color" value="${bg}"></td></tr>`;
    }
    buttonMapTable.innerHTML = rows;
  }

  profileSelect?.addEventListener("change", (e) => {
    activeProfile = parseInt(e.target.value, 10);
    saveActive();
    refreshProfileUI();
  });
  newProfileBtn?.addEventListener("click", () => {
    profiles.push(defaultProfile());
    activeProfile = profiles.length - 1;
    saveProfiles();
    saveActive();
    refreshProfileUI();
  });
  dupProfileBtn?.addEventListener("click", () => {
    const copy = JSON.parse(JSON.stringify(profiles[activeProfile]));
    copy.name = (copy.name || "Profile") + " (copy)";
    profiles.push(copy);
    activeProfile = profiles.length - 1;
    saveProfiles();
    saveActive();
    refreshProfileUI();
  });
  delProfileBtn?.addEventListener("click", () => {
    if (profiles.length <= 1) return;
    profiles.splice(activeProfile, 1);
    activeProfile = 0;
    saveProfiles();
    saveActive();
    refreshProfileUI();
  });
  saveProfileBtn?.addEventListener("click", () => {
    const p = profiles[activeProfile];
    p.name = profileName.value.trim() || `Profile ${activeProfile + 1}`;
    p.facing = facingSel.value;
    p.resetAction = resetSel.value;
    p.separator = separatorInp.value || ">";
    p.deadzone = parseFloat($("#deadzone").value) || p.deadzone;
    p.chordWindow = parseInt($("#chordWindow").value) || 130;
    p.repeatLockout = parseInt($("#repeatLockout").value) || p.repeatLockout;
    p.holdMs = parseInt($("#holdMs").value) || p.holdMs;
    p.motionWindow = parseInt($("#motionWindow").value) || p.motionWindow;
    p.motionCoupleMs = parseInt($("#motionCoupleMs").value) || p.motionCoupleMs;
    p.chargeFrames = parseInt($("#chargeFrames").value) || p.chargeFrames;
    p.chargeWindow = parseInt($("#chargeWindow").value) || p.chargeWindow;
    p.mashWindowMs = parseInt($("#mashWindowMs").value) || p.mashWindowMs;
    p.notationMode =
      document.querySelector('input[name="notationMode"]:checked')?.value ||
      "images";
    p.motionInputsEnabled =
      document.querySelector("#motionInputsEnabled")?.checked !== false;
    saveProfiles();
    refreshProfileUI();
  });

  exportBtn?.addEventListener("click", () => {
    const exportData = {
      version: "1.0",
      meta: comboMetadata,
      graph: comboGraph,
      profile: profiles[activeProfile],
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "combo_data.json";
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Exported combo data with metadata");
  });
  importBtn?.addEventListener("click", () => importInput?.click());
  importInput?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        // Legacy format - just profiles
        profiles = data;
        activeProfile = 0;
        saveProfiles();
        saveActive();
        refreshProfileUI();
        setStatus("Imported profiles (legacy format)");
      } else if (
        data.version === "1.0" &&
        data.meta &&
        data.graph &&
        data.profile
      ) {
        // New format - metadata + graph + profile
        comboMetadata = data.meta;
        comboGraph = data.graph;

        // Replace current profile with imported one
        profiles[activeProfile] = data.profile;
        saveProfiles();
        refreshProfileUI();
        updateNodeSelector();

        // Restore active node if it exists
        if (comboGraph.activeId) {
          const activeNode = comboGraph.nodes.find(
            (n) => n.id === comboGraph.activeId
          );
          if (activeNode) {
            restoreNodeChips(activeNode);
          }
        }

        setStatus("Imported combo data with metadata");
      } else if (data.profiles && Array.isArray(data.profiles)) {
        // Intermediate format - profiles + combo graph
        profiles = data.profiles;
        activeProfile = 0;
        saveProfiles();
        saveActive();
        refreshProfileUI();

        if (data.comboGraph) {
          comboGraph = data.comboGraph;
          updateNodeSelector();
          setStatus("Imported profiles and combo graph");
        } else {
          setStatus("Imported profiles (no combo graph)");
        }
      } else {
        setStatus("Invalid file format");
      }
    } catch (err) {
      console.warn("Import error", err);
      setStatus("Import failed");
    }
  });
  makeObsUrlBtn?.addEventListener("click", () => {
    try {
      const b64 = btoa(JSON.stringify(profiles));
      const here = location.href.split("?")[0];
      const url = `${here}?obs=1&config=${b64}`;
      navigator.clipboard?.writeText(url);
      setStatus("Copied OBS URL with embedded config");
    } catch {
      setStatus("Could not encode config (too large?)");
    }
  });

  // Live CSS knobs + global override
  document.addEventListener("input", (e) => {
    const p = profiles[activeProfile];
    if (!p) return;
    const t = e.target;

    if (t.matches?.(".btn-label"))
      p.buttonLabels[parseInt(t.dataset.btn, 10)] = t.value;
    if (t.matches?.(".btn-color"))
      p.buttonColors[parseInt(t.dataset.btnColor, 10)] = t.value;
    if (t.matches?.(".btn-bg"))
      p.buttonBgColors[parseInt(t.dataset.btnBg, 10)] = t.value;

    if (
      [
        chipFontInp,
        chipImgHInp,
        chipPadXInp,
        chipPadYInp,
        chipGapInp,
        chipRadiusInp,
        overlayWidthInp,
        chipBgAllInp,
        chipTextAllInp,
        overlayFullChk,
      ].includes(t)
    ) {
      // persist the full-width choice whenever width controls change
      if (t === overlayFullChk || t === overlayWidthInp) {
        p.overlayFullWidth = !!overlayFullChk?.checked;
      }
      applyCssKnobs();
    }

    if (t === separatorInp) {
      p.separator = separatorInp.value || ">";
      rebuildBuffer();
    }
    if (t === useGlobalColors) {
      applyCssKnobs();
    }
    if (t?.id === "mashWindowMs") {
      p.mashWindowMs = parseInt(t.value) || 350;
    }
    saveProfiles();
  });

  /* ===== Drag & Drop import ===== */
  ["dragenter", "dragover", "drop", "dragleave"].forEach((evt) =>
    window.addEventListener(evt, (e) => {
      if (evt !== "drop") e.preventDefault();
      if (evt === "drop") {
        const f = e.dataTransfer?.files?.[0];
        if (f) {
          f.text().then((txt) => {
            try {
              const arr = JSON.parse(txt);
              if (Array.isArray(arr) && arr.length) {
                profiles = arr;
                activeProfile = 0;
                saveProfiles();
                saveActive();
                refreshProfileUI();
                setStatus("Imported profile (drag & drop)");
              }
            } catch (err) {
              console.warn("DnD import error", err);
            }
          });
        }
      }
    })
  );

  /* ===== Overlay helpers ===== */
  function addSeparator() {
    if (overlay.children.length) {
      // Check if the last child is already a separator
      const lastChild = overlay.lastElementChild;
      if (!lastChild || !lastChild.classList.contains("sep")) {
        const s = document.createElement("span");
        s.className = "sep";
        s.textContent = profiles[activeProfile].separator || ">";
        overlay.appendChild(s);
      }
    }
  }
  function currentSeparator() {
    return " " + (profiles[activeProfile].separator || ">") + " ";
  }
  function rebuildBuffer() {
    const chips = [...overlay.querySelectorAll(".chip")];
    buffer = chips.map((ch) => ch.innerText.trim());
  }
  let buffer = [];

  // Numpad notation mapping system
  const numpadToDirection = {
    1: "db", // down-back
    2: "d", // down
    3: "df", // down-forward
    4: "b", // back
    5: "", // neutral (no direction)
    6: "f", // forward
    7: "ub", // up-back
    8: "u", // up
    9: "uf", // up-forward
  };

  const directionToNumpad = {
    db: "1",
    bd: "1",
    d: "2",
    df: "3",
    fd: "3",
    b: "4",
    f: "6",
    ub: "7",
    bu: "7",
    u: "8",
    uf: "9",
    fu: "9",
    // Add missing mappings from dirToImg
    l: "4", // left = back
    r: "6", // right = forward
    // Add motion input mappings
    qcf: "236", // quarter circle forward
    qcb: "214", // quarter circle back
    dpf: "623", // dragon punch forward
    dpb: "421", // dragon punch back
    hcf: "41236", // half circle forward
    hcb: "63214", // half circle back
    360: "63214", // full circle
  };

  // Common motion inputs - now with motion names as keys for text detection
  const motionInputs = {
    qcf: "236", // quarter circle forward
    qcb: "214", // quarter circle back
    dp: "623", // dragon punch
    dpb: "421", // dragon punch back
    hcb: "63214", //half circle back
    hcf: "41236", // half circle forward
    360: "63214", // full circle
    doubleqcf: "236236", // double quarter circle forward
    doubleqcb: "214214", // double quarter circle back
  };

  // Reverse mapping for parsing numpad notation (pattern -> name)
  const motionPatterns = {
    236: "qcf",
    214: "qcb",
    623: "dpf",
    421: "dpb",
    63214: "hcb",
    41236: "hcf",
    41236987: "360",
    236236: "qcf qcf", // double quarter circle forward (two separate qcf motions)
    214214: "qcb qcb", // double quarter circle back (two separate qcb motions)
  };

  function chipToNumpadNotation(chipHTML) {
    console.log("=== chipToNumpadNotation DEBUG ===");
    console.log("Input HTML:", chipHTML);

    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = chipHTML;

    // Get all direction images
    const images = tempDiv.querySelectorAll("img");
    console.log("Found", images.length, "images");

    let numpadNotation = "";

    // Extract directions from images
    for (const img of images) {
      const alt = img.alt;
      console.log("Image alt:", alt, "src:", img.src);
      if (directionToNumpad[alt]) {
        console.log("Mapped", alt, "to", directionToNumpad[alt]);
        numpadNotation += directionToNumpad[alt];
      } else {
        console.log("No mapping found for alt:", alt);
      }
    }

    // Check for motion patterns that might be represented by multiple images
    // For example, two qcf images should become 236236
    const imageAlts = Array.from(images).map((img) => img.alt);

    // Handle double quarter circle forward (two qcf images)
    if (
      imageAlts.length === 2 &&
      imageAlts[0] === "qcf" &&
      imageAlts[1] === "qcf"
    ) {
      numpadNotation = "236236";
    }

    // Handle double quarter circle back (two qcb images)
    if (
      imageAlts.length === 2 &&
      imageAlts[0] === "qcb" &&
      imageAlts[1] === "qcb"
    ) {
      numpadNotation = "214214";
    }

    // Extract button text - look for spans with text content
    const spans = tempDiv.querySelectorAll("span");
    console.log("Found", spans.length, "spans");

    let buttonText = "";

    for (const span of spans) {
      const text = span.textContent.trim();
      console.log("Span text:", text);
      if (text && !text.startsWith("j.")) {
        // Skip jump prefix
        buttonText = text;
        break;
      }
    }

    console.log(
      "Final numpadNotation:",
      numpadNotation,
      "buttonText:",
      buttonText
    );
    console.log("Returning:", (numpadNotation || "5") + buttonText);
    console.log("=== END DEBUG ===");

    // If we have a motion pattern (multiple directions), return it
    if (numpadNotation.length > 1) {
      return numpadNotation + buttonText;
    }

    // If we have a single direction, return it
    if (numpadNotation) {
      return numpadNotation + buttonText;
    }

    // If no directions, return neutral (5) + button
    return "5" + buttonText;
  }

  function getNumpadNotationText() {
    const chips = [...overlay.querySelectorAll(".chip")];
    return chips.map((chip) => chipToNumpadNotation(chip.innerHTML)).join(" ");
  }

  function addChipElHTML(html, perButtonBg) {
    if (overlay.children.length) addSeparator();
    const c = document.createElement("span");
    c.className = "chip";
    c.innerHTML = html;
    c.tabIndex = 0;
    if (!useGlobalColors?.checked && perButtonBg)
      c.style.backgroundColor = perButtonBg;
    c.addEventListener("click", (ev) => {
      selectChip(c);
      openPopover(c);
      ev.stopPropagation();
    });
    c.addEventListener("dblclick", (ev) => {
      selectChip(c);
      openPopover(c, true);
      ev.stopPropagation();
    });
    overlay.appendChild(c);
    overlay.scrollLeft = overlay.scrollWidth;
    rebuildBuffer();
    bus.emit("chip:add", c);

    // Push discrete operation to history - get index after adding to DOM
    const chips = getChipList();
    const index = chips.indexOf(c);
    history.push({
      type: "chip:add",
      index: index,
      html: html,
      perButtonBg: perButtonBg,
    });

    return c;
  }

  function clearOverlay() {
    // Capture chip HTMLs before clearing
    const chips = getChipList();
    const chipHTMLs = chips.map((chip) => chip.innerHTML);

    overlay.innerHTML = "";
    buffer.length = 0;
    activeButtonChips.clear();
    lastCharged = { tok: null, at: 0 };
    closePopover();
    currentSelectedChip = null;
    editCapture = false;
    chordManager.reset(); // Reset pending chords on clear
    bus.emit("overlay:clear");

    // Push discrete operation to history
    history.push({
      type: "overlay:clear",
      chips: chipHTMLs,
    });
  }
  $("#clearBtn")?.addEventListener("click", clearOverlay);
  $("#copyBtn")?.addEventListener("click", () => {
    const txt = buffer.join(currentSeparator().trim());
    navigator.clipboard?.writeText(txt);
    setStatus("Copied text.");
  });

  // Add copy numpad notation button
  $("#copyNumpadBtn")?.addEventListener("click", () => {
    const numpadText = getNumpadNotationText();
    navigator.clipboard?.writeText(numpadText);
    setStatus("Copied numpad notation.");
  });
  let modeLive = true;
  $("#toggleMode")?.addEventListener("click", () => {
    modeLive = !modeLive;
    $("#toggleMode").textContent = "Mode: " + (modeLive ? "Live" : "Record");
    setStatus("Mode toggled.");
  });

  // Combo Branching UI Event Handlers
  $("#saveNodeBtn")?.addEventListener("click", () => {
    const label = prompt(
      "Enter node label:",
      `Combo ${new Date().toLocaleTimeString()}`
    );
    if (label && label.trim()) {
      saveCurrentAsNode(label.trim());
    }
  });
  $("#branchNodeBtn")?.addEventListener("click", branchFromActiveNode);
  $("#deleteNodeBtn")?.addEventListener("click", deleteActiveNode);
  $("#nodeSelector")?.addEventListener("change", (e) => {
    const nodeId = e.target.value;
    if (nodeId) {
      switchToNode(nodeId);
    }
  });

  // PNG Copy/Export
  async function overlayToCanvas() {
    const node = overlay;
    const rect = node.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    const inlineStyles = [...document.head.querySelectorAll("style")]
      .map((s) => s.textContent)
      .join("\n");
    const html =
      `<div xmlns="http://www.w3.org/1999/xhtml" class="export-root">` +
      `<style>${inlineStyles}</style>` +
      `<div id="overlay" style="max-width:${width}px">${node.innerHTML}</div>` +
      `</div>`;
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>` +
      `<foreignObject width='100%' height='100%'>${html}</foreignObject>` +
      `</svg>`;
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    await new Promise((r) => requestAnimationFrame(r));
    const img = new Image();
    img.decoding = "async";
    img.onload = () => URL.revokeObjectURL(url);
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return canvas;
  }
  async function copyPNG() {
    try {
      const canvas = await overlayToCanvas();
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      setStatus("Copied overlay as PNG to clipboard.");
    } catch (err) {
      console.warn(err);
      setStatus("Copy PNG failed (browser permissions?)");
    }
  }
  async function exportPNG() {
    try {
      const canvas = await overlayToCanvas();
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "overlay.png";
      a.click();
      setStatus("Exported overlay as PNG.");
    } catch (err) {
      console.warn(err);
      setStatus("Export PNG failed.");
    }
  }
  $("#copyPngBtn")?.addEventListener("click", copyPNG);
  $("#exportPngBtn")?.addEventListener("click", exportPNG);

  /* ===== Gamepad ===== */
  let gamepadIndex = null;
  let prevButtons = [];
  let lastButtonTime = new Map();
  const holdTimers = new Map();
  const activeButtonChips = new Map(); // declared once
  window.addEventListener("gamepadconnected", (e) => {
    gamepadIndex = e.gamepad.index;
    prevButtons = e.gamepad.buttons.map((b) => b.pressed);
    setStatus(`Connected: ${e.gamepad.id}`);
  });
  window.addEventListener("gamepaddisconnected", () => {
    gamepadIndex = null;
    setStatus("Gamepad disconnected");
  });
  function now() {
    return performance.now();
  }
  function poll() {
    const gps = navigator.getGamepads?.();
    let gp = gamepadIndex != null ? gps[gamepadIndex] : null;
    if (!gp) {
      for (const g of gps) {
        if (g) {
          gp = g;
          gamepadIndex = g.index;
          prevButtons = g.buttons.map((b) => b.pressed);
          break;
        }
      }
    }
    if (gp) {
      handleButtons(gp);
      trackDirections(gp);
    }
    requestAnimationFrame(poll);
  }
  requestAnimationFrame(poll);

  /* ===== Deterministic Chord Manager ===== */
  // Batches button presses within a rolling window (from the last press).
  // On finalize: creates a single chord chip (2+) or a single regular chip (1).
  const chordManager = (function () {
    let pending = []; // [{ i: buttonIndex, t: timestamp }]
    let timer = null;

    function windowMs() {
      const p = profiles[activeProfile] || {};
      // Clamp for sanity; you can tune defaults as you like.
      const v = Number(p.chordWindow ?? 120);
      return Math.max(40, Math.min(600, isNaN(v) ? 120 : v));
    }

    function reset() {
      pending.length = 0;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    // Called for every qualifying button press
    function add(i, t) {
      // Reset any existing hold timer for this button to prevent double-tap hold issues
      const holdTimerId = holdTimers.get(i);
      if (holdTimerId) {
        console.log(
          `Clearing hold timer for button ${i} to prevent double-tap hold issue`
        );
        clearTimeout(holdTimerId);
        holdTimers.delete(i);
      }

      // Remove from active button chips to prevent held state interference
      if (activeButtonChips.has(i)) {
        console.log(
          `Removing button ${i} from activeButtonChips to prevent held state`
        );
        activeButtonChips.delete(i);
      }

      // De-duplicate same button within the same pending group; keep earliest press
      if (!pending.some((p) => p.i === i)) {
        pending.push({ i, t });
        // Maintain chronological order for a stable "L + M" ordering
        pending.sort((a, b) => a.t - b.t);
      }

      // Re-arm finalize from NOW (window from the last press)
      if (timer) clearTimeout(timer);
      timer = setTimeout(finalize, windowMs());
    }

    function finalize() {
      timer = null;
      if (!pending.length) return;
      const group = pending.slice(); // copy
      reset();

      if (group.length >= 2) {
        // Build chord chip in the actual order pressed
        const html = group.map((x) => buttonHTML(x.i)).join(" + ");
        const chip = addChipElHTML(html, "#f5f5f5");
        // Let mash collapse evaluate the final rendered chip (optional, safe no-op if absent)
        try {
          if (typeof mash !== "undefined" && mash?.enabled && mash?.onNewChip)
            mash.onNewChip(html, chip);
        } catch {}
        rebuildBuffer();
        bus.emit("chip:add", chip);
      } else {
        // Single press → normal creation with motion detection allowed
        const i = group[0].i;
        createIndividualChip(i, now(), /*skipMotion=*/ false);
      }
    }

    return { add, reset, finalize };
  })();

  /* ===== Directions & motions ===== */
  function tokenFromAxes(ax, ay, dz = 0.5) {
    let h = null,
      v = null;
    if (Math.abs(ax) >= dz) h = ax < 0 ? "l" : "r";
    if (Math.abs(ay) >= dz) v = ay < 0 ? "u" : "d";
    if (h && v) return v + h;
    return h || v || "n";
  }
  function dirToImg(tok) {
    const map = {
      u: "u",
      d: "d",
      l: "b",
      r: "f",
      ul: "ub",
      ur: "uf",
      dl: "db",
      dr: "df",
      db: "db",
      df: "df",
      ub: "ub",
      uf: "uf",
      b: "b",
      f: "f",
    };
    if (!map[tok]) return null;
    return `<img class="img" src="images/${map[tok]}.png" alt="${map[tok]}">`;
  }
  let dirHistory = [];
  let lastTok = "n";
  let lastUpPrefixAt = 0;
  // Double tap dash detection variables
  let lastDashTime = 0;
  let lastDashDirection = "";
  let editCapture = false; // controller capture mode
  let captureDirTok = "n"; // buffered dir while capturing

  function trackDirections(gp) {
    const p = profiles[activeProfile];
    const dU = gp.buttons[12]?.pressed,
      dD = gp.buttons[13]?.pressed,
      dL = gp.buttons[14]?.pressed,
      dR = gp.buttons[15]?.pressed;
    let tok = "n";
    if (dL) tok = "l";
    else if (dR) tok = "r";
    if (dU) tok = tok === "r" ? "ur" : tok === "l" ? "ul" : "u";
    else if (dD) tok = tok === "r" ? "dr" : tok === "l" ? "dl" : "d";

    if (tok === "n")
      tok = tokenFromAxes(gp.axes[0] || 0, gp.axes[1] || 0, p.deadzone || 0.5);

    const t = now();
    if (!dirHistory.length || dirHistory[dirHistory.length - 1].token !== tok) {
      dirHistory.push({ t, token: tok });
      const win = Math.max(700, p.motionWindow || 700) + 200;
      while (dirHistory.length && t - dirHistory[0].t > win) dirHistory.shift();

      // Debug logging for directional inputs
      // console.log(`Direction input: ${tok} at ${t.toFixed(0)}ms`);
    }
    updateCharge(tok);

    // Double tap dash detection - check for forward forward in short window
    if (tok === "r" || tok === "f") {
      const dashWindow = 200; // 200ms window for double tap
      if (
        lastDashDirection === "r" &&
        t - lastDashTime <= dashWindow &&
        lastTok !== "r" &&
        lastTok !== "f"
      ) {
        // Double forward detected - create dash chip (only if previous state wasn't forward)
        const dashChip = addChipElHTML("Dash", "#f5f5f5");
        lastDashTime = 0; // Reset to prevent multiple detections
        lastDashDirection = "";
      } else if (lastTok !== "r" && lastTok !== "f") {
        // Only update timing if we're coming from a non-forward state (detect the first press)
        lastDashTime = t;
        lastDashDirection = "r";
      }
    } else if (tok === "l" || tok === "b") {
      // Reset dash detection if moving in opposite direction
      lastDashTime = 0;
      lastDashDirection = "";
    }

    // Quick edits outside capture:
    if (!editCapture) {
      // UP -> add j.
      if (
        currentSelectedChip &&
        lastTok !== "u" &&
        tok === "u" &&
        t - lastUpPrefixAt > 200
      ) {
        if (selectedChips.size) {
          addJPrefixBulk();
        } else {
          addJPrefix(currentSelectedChip);
        }
        lastUpPrefixAt = t;
      }
      // DOWN -> remove j.
      if (
        currentSelectedChip &&
        lastTok !== "d" &&
        tok === "d" &&
        t - lastDownRemoveAt > 200
      ) {
        if (selectedChips.size) {
          removeJPrefixBulk();
        } else {
          removeJPrefix(currentSelectedChip);
        }
        lastDownRemoveAt = t;
      }
    }

    // In controller capture, buffer direction only (no DOM spam)
    if (editCapture) {
      captureDirTok = tok;
    }
    lastTok = tok;
  }

  function facingMap(tok) {
    if ((profiles[activeProfile].facing || "right") === "right") return tok;
    return tok.replace(/l/g, "R").replace(/r/g, "l").replace(/R/g, "r");
  }
  function compressedSeqWithin(ms) {
    const t = now(),
      start = t - ms;
    const seq = dirHistory
      .filter((e) => e.t >= start)
      .map((e) => e.token)
      .filter((x) => x !== "n")
      .map(facingMap);
    const comp = [];
    for (const s of seq) {
      if (!comp.length || comp[comp.length - 1] !== s) comp.push(s);
    }
    return comp;
  }
  function matchPattern(seq, pattern) {
    let i = 0;
    for (const p of pattern) {
      i = seq.indexOf(p, i);
      if (i === -1) return false;
      i++;
    }
    return true;
  }
  function detectMotionForButton() {
    const p = profiles[activeProfile];
    const seq = compressedSeqWithin(p.motionWindow || 700);

    // Debug logging to see when this function is called and what sequence it processes
    console.log(
      `detectMotionForButton called with sequence: ${JSON.stringify(seq)}`
    );

    // Check if motion inputs are enabled
    if (p.motionInputsEnabled === false) {
      console.log("Motion inputs disabled - returning null");
      return null;
    }

    // Check for 360 first (highest priority - must have all four cardinal directions in any order)
    const set = new Set(seq);
    if (["u", "d", "l", "r"].every((k) => set.has(k))) {
      console.log("360 motion detected");
      return `<img class="img" src="images/360.png" alt="360">`;
    }

    // Check for double quarter circle forward (236236)
    if (matchPattern(seq, ["d", "dr", "r", "d", "dr", "r"])) {
      return `<img class="img" src="images/qcf.png" alt="qcf"> <img class="img" src="images/qcf.png" alt="qcf">`;
    }

    // Check for double quarter circle back (214214)
    if (matchPattern(seq, ["d", "dl", "l", "d", "dl", "l"])) {
      return `<img class="img" src="images/qcb.png" alt="qcb"> <img class="img" src="images/qcb.png" alt="qcb">`;
    }

    // Check regular motion inputs last - prioritize half-circles over quarter-circles
    const tests = [
      ["hcf", ["l", "d", "r"]],
      ["hcb", ["r", "d", "l"]],
      ["qcf", ["d", "dr", "r"]],
      ["qcb", ["d", "dl", "l"]],
      ["dpf", ["r", "d", "dr"]],
      ["dpb", ["l", "d", "dl"]],
    ];
    for (const [key, pat] of tests) {
      if (key === "hcf" || key === "hcb") {
        // For half-circle motions, check for proper order: start -> down variation -> end
        const startDir = key === "hcf" ? "l" : "r";
        const endDir = key === "hcf" ? "r" : "l";
        const downVariations = ["d", "dl", "dr"];

        // Find indices of important directions
        const startIndex = seq.indexOf(startDir);
        const endIndex = seq.lastIndexOf(endDir);

        // Check if we have a valid start -> end order with down variation in between
        const hasValidOrder =
          startIndex !== -1 && endIndex !== -1 && startIndex < endIndex;
        const hasDownInBetween =
          hasValidOrder &&
          seq
            .slice(startIndex, endIndex + 1)
            .some((dir) => downVariations.includes(dir));

        // Debug logging for half-circle detection
        // console.log(`HALF-CIRCLE CHECK (${key}):`);
        // console.log(`  Input sequence: ${JSON.stringify(seq)}`);
        // console.log(`  Start dir (${startDir}) index: ${startIndex}`);
        // console.log(`  End dir (${endDir}) index: ${endIndex}`);
        // console.log(`  Valid order: ${hasValidOrder}`);
        // console.log(`  Down in between: ${hasDownInBetween}`);
        // console.log(`  Would trigger: ${hasValidOrder && hasDownInBetween}`);

        if (hasValidOrder && hasDownInBetween) {
          console.log(`HALF-CIRCLE DETECTED: ${key}`);
          return `<img class="img" src="images/${key}.png" alt="${key}">`;
        }
      } else if (matchPattern(seq, pat)) {
        return `<img class="img" src="images/${key}.png" alt="${key}">`;
      }
    }

    return null;
  }
  function snapshotDirection() {
    const last = dirHistory.length
      ? dirHistory[dirHistory.length - 1].token
      : "n";
    return last === "n" ? null : last;
  }

  /* ===== Charge ===== */
  let currentDirTok = "n",
    currentDirStart = 0,
    lastCharged = { tok: null, at: 0 };
  function updateCharge(latestTok) {
    const p = profiles[activeProfile];
    const t = now();
    if (latestTok !== currentDirTok) {
      if (currentDirTok !== "n") {
        const heldMs = t - currentDirStart;
        const needMs = (p.chargeFrames || 30) * (1000 / 60);
        if (heldMs >= needMs) {
          lastCharged = { tok: currentDirTok, at: t };
        }
      }
      currentDirTok = latestTok;
      currentDirStart = t;
    }
  }
  function isOpposite(a, b) {
    if (a?.includes("l") && b?.includes("r")) return true;
    if (a?.includes("r") && b?.includes("l")) return true;
    if (a?.includes("u") && b?.includes("d")) return true;
    if (a?.includes("d") && b?.includes("u")) return true;
    return false;
  }

  /* ===== Buttons & holds ===== */
  let chordAccumulator = []; // Track buttons pressed within chord window across frames
  let chordAccumulatorTimeout = null;
  let chordPressTimes = new Map(); // Track when each button was last pressed for chord detection
  // let lastButtonTime = new Map(); // Track when each button was last pressed - ALREADY DECLARED ABOVE

  function handleButtons(gp) {
    const p = profiles[activeProfile];
    if (!prevButtons.length) prevButtons = gp.buttons.map((b) => b.pressed);
    const t = now();
    const justPressed = [],
      justReleased = [];

    for (let i = 0; i < gp.buttons.length; i++) {
      const pressed = !!gp.buttons[i].pressed,
        was = !!prevButtons[i];

      if (pressed && !was) {
        // ===== Guided PRESET binding (ignore极速版 D-pad 12–15) =====
        if (presetBind.active) {
          if (i >= 12 && i <= 15) {
            // Ignore directional presses for binding—keep waiting
            prevButtons[i] = pressed;
            continue;
          }

          const label = presetBind.queue[presetBind.i];
          if (typeof label === "string") {
            p.buttonLabels极速版[i] = label;
            saveProfiles();
            refreshProfileUI();
          }
          stepPresetBindingAssigned();
          prevButtons[i] = pressed;
          continue; // do not create a chip for this press
        }
        // ======================================================

        // ===== Reset Button Binding =====
        if (resetBindingActive) {
          if (i >= 12 && i <= 15) {
            // Ignore D-pad buttons for reset binding
            setStatus(
              "D-pad buttons cannot be used for Reset. Press any other button."
            );
            prevButtons[i] = pressed;
            continue;
          }
          setResetButton(i);
          prevButtons[i] = pressed;
          continue; // do not create a chip for this press
        }
        // ======================================================

        const last = lastButtonTime.get(i) || 0;

        if (t - last >= (p.repeatLockout || 110)) {
          // Log time since last press for debugging - use chordPressTimes for accurate timing
          const lastChordTime = chordPressTimes.get(i) || 0;
          const timeSinceLastPress = t - lastChordTime;
          console.log(
            `Button ${i} pressed - time since last press: ${timeSinceLastPress.toFixed(
              1
            )}ms`
          );

          // Update chord timing tracker
          chordPressTimes.set(i, t);

          // Controller-bound reset (clears + broadcasts)
          if ((p.resetAction || "none") === `button:${i}`) {
            if (branchModeActive && comboGraph.activeId) {
              // If in branch mode and in a node/branch, restore the node's saved state instead of clearing
              const activeNode = comboGraph.nodes.find(
                (n) => n.id === comboGraph.active极速版Id
              );
              if (activeNode) {
                restoreNodeChips(activeNode);
                pushHistory("Reset to node state");
              }
            } else {
              // Standard behavior when not in branch mode or no active node极速版
              clearOverlay();
            }
            bus.emit("reset:action");
            lastButtonTime.set(i, t);
            prevButtons[i] = pressed;
            continue;
          }

          // In-chip capture mode: replace selected chip and continue
          if (editCapture && currentSelectedChip && i < 12) {
            replaceChipFromController(i);
            lastButtonTime.set(i, t);
            prevButtons[i] = pressed;
            continue;
          }

          // Insertion capture mode: create chip at pending position
          if (insertMode && insertMode.startsWith("controller") && i < 12) {
            completeInsertionFromController(i);
            lastButtonTime.set(i, t);
            prevButtons[i] = pressed;
            continue;
          }

          // Quick "j." prefix via D-pad UP button index (12) when editing
          if (currentSelectedChip && i === 极速版12 && !editCapture) {
            addJPrefix(currentSelectedChip);
            极速版;
            lastButtonTime.set(i, t);
            prevButtons[i] = pressed;
            continue;
          }

          justPressed.push(i);
          lastButtonTime.set(i, t);
        }
      }

      if (!pressed && was) {
        justReleased.push(i);
      }
      prevButtons[i] = pressed;
    }

    // ===== Handle new presses (via Chord Manager) =====
    for (const i of justPressed) {
      // Ignore D-pad as "buttons" for chip adds (12–15)
      if (i >= 12 && i <= 15) continue;

      // If edit-capture is active, we already replaced the selected chip earlier
      if (editCapture && currentSelectedChip) continue;

      // If insertion capture mode is active, that path already consumed the press
      if (insertMode && insertMode.startsWith("controller") && i < 12) continue;

      // Clear any existing hold state for this button before handing to chord manager
      const holdTimerId = holdTimers.get(i);
      if (holdTimerId) {
        clearTimeout(holdTimerId);
        holdTimers.delete(i);
      }
      activeButtonChips.delete(i);

      // Hand the press to the deterministic chord manager
      chordManager.add(i, t);
    }

    // ===== Handle releases =====
    for (const i of justReleased) {
      const obj = activeButtonChips.get(i);
      const id = holdTimers.get(i);
      if (id) clearTimeout(id);
      holdTimers.delete(i);

      if (obj) {
        if (obj.held) {
          addChipElHTML(
            buttonHTML(i, `]${obj.label}[`),
            profiles[activeProfile].buttonBgColors[i] || "#f5f5f5"
          );
        }
        activeButtonChips.delete(i);
        rebuildBuffer();
      }
    }
  }

  function buttonHTML(btnIndex, override) {
    const p = profiles[activeProfile];
    const text = override ?? (p.buttonLabels[btnIndex] || `#${btnIndex}`);
    const color = useGlobalColors?.checked
      ? getComputedStyle(document.documentElement)
          .getPropertyValue("--chip-text")
          .trim()
      : p.buttonColors[btnIndex] || "#000000";
    return `<span style=\"color:${color}\">${escapeHtml(text)}</span>`;
  }

  function addJPrefix(chip) {
    const lastSpan = chip.querySelector("span:last-of-type");
    if (!lastSpan) return;
    const cur = lastSpan.textContent.trim();
    if (cur.toLowerCase().startsWith("j.")) return;
    lastSpan.textContent = "j." + cur;
    rebuildBuffer();
  }

  function replaceChipFromController(btnIndex) {
    if (!currentSelectedChip) return;

    // Capture HTML before replacement
    const beforeHTML = currentSelectedChip.innerHTML;

    const dirTok = editCapture ? captureDirTok : snapshotDirection() || "n";
    const motionHTML = detectMotionForButton();
    const p = profiles[activeProfile];
    let finalLabel = p.buttonLabels[btnIndex] || `#${btnIndex}`;
    if (dirTok === "u" && !/^j\./i.test(finalLabel))
      finalLabel = "j." + finalLabel;
    let html;
    if (motionHTML) {
      html = `${motionHTML} ${buttonHTML(btnIndex, finalLabel)}`;
    } else if (dirTok && dirTok !== "n") {
      const dirHTML = dirToImg(dirTok) || dirTok.toUpperCase();
      html = `${dirHTML} + ${buttonHTML(btnIndex, finalLabel)}`;
    } else {
      html = buttonHTML(btnIndex, finalLabel);
    }
    currentSelectedChip.innerHTML = html;
    rebuildBuffer();
    closePopover();
    bus.emit("chip:replace", currentSelectedChip);

    // Push discrete operation to history
    const chips = getChipList();
    const index = chips.indexOf(currentSelectedChip);
    history.push({
      type: "chip:replace",
      index: index,
      beforeHTML: beforeHTML,
      afterHTML: html,
    });
  }

  function mutateLabelText(chipEl, oldText, newText) {
    const spans = chipEl.querySelectorAll("span");
    for (let i = spans.length - 1; i >= 0; i--) {
      const sp = spans[i];
      if (sp.textContent.trim() === oldText) {
        sp.textContent = newText;
        return;
      }
    }
    chipEl.innerHTML = chipEl.innerHTML.replace(
      new RegExp(escapeRegExp(oldText) + "(?!.*" + escapeRegExp(oldText) + ")"),
      " " + newText + " "
    );
  }
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function escapeHtml(s = "") {
    return s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c])
    );
  }

  /* ===== Chip selection + editor popover ===== */
  popEl = null;
  /* ===== Chip selection + editor popover (multi-aware) ===== */

  function selectChip(chip, opts = {}) {
    const { add = false, toggle = false } = opts;
    if (toggle) {
      if (selectedChips.has(chip)) removeFromSelection(chip);
      else addToSelection(chip);
      return;
    }
    if (add) {
      addToSelection(chip);
      return;
    }
    // default: single select
    selectOnly(chip);
  }

  function deselectChip() {
    deselectAll();
    closePopover();
  }

  /* ===== Marquee selection (Shift + drag) ===== */
  overlay.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;

    const chip = chipFromEventTarget(e.target);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;

    if (chip && !additive) {
      // normal single click
      selectChip(chip);
      openPopover(chip);
      e.preventDefault();
      return;
    }

    if (chip && additive) {
      // toggle chip into selection
      selectChip(chip, { toggle: true });
      e.preventDefault();
      return;
    }

    // Start marquee only if Shift is held on empty overlay area
    if (!chip && e.shiftKey) {
      marqueeActive = true;
      marqueeStart = { x: e.clientX, y: e.clientY };
      marquee = document.createElement("div");
      marquee.style.cssText =
        "position:fixed;z-index:99999;border:1px solid #4c8dff;background:rgba(76,141,255,.15);pointer-events:none;";
      document.body.appendChild(marquee);
      deselectAll();
      e.preventDefault();
    }

    // For empty overlay clicks without shift, let the first handler prevent caret
    // and let the document click handler close popover
  });

  /* ===== Right-click context menu ===== */
  overlay.addEventListener("contextmenu", (e) => {
    e.preventDefault();

    const chip = chipFromEventTarget(e.target);
    showContextMenu(e.clientX, e.clientY, chip);
  });

  // Hide context menu when clicking elsewhere
  document.addEventListener("click", (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  // Hide context menu on escape
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      contextMenu &&
      contextMenu.style.display !== "none"
    ) {
      hideContextMenu();
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (!marqueeActive || !marquee) return;
    const x1 = Math.min(marqueeStart.x, e.clientX);
    const y1 = Math.min(marqueeStart.y, e.clientY);
    const x2 = Math.max(marqueeStart.x, e.clientX);
    const y2 = Math.max(marqueeStart.y, e.clientY);
    marquee.style.left = x1 + "px";
    marquee.style.top = y1 + "px";
    marquee.style.width = x2 - x1 + "px";
    marquee.style.height = y2 - y1 + "px";

    // hit test chips
    const box = { left: x1, top: y1, right: x2, bottom: y2 };
    selectedChips.clear();
    overlay.querySelectorAll(".chip").forEach((ch) => {
      const r = ch.getBoundingClientRect();
      const c = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      if (rectsIntersect(box, c)) selectedChips.add(ch);
    });
    currentSelectedChip = selectedChips.size
      ? Array.from(selectedChips)[0]
      : null;
    updateSelectedStyles();
  });

  window.addEventListener("mouseup", () => {
    if (!marqueeActive) return;
    marqueeActive = false;
    if (marquee) {
      marquee.remove();
      marquee = null;
    }

    // prevent the immediate "outside click" from clearing this selection
    suppressNextDocClick = true;

    if (selectedChips.size > 1) {
      const first = Array.from(selectedChips)[0];
      openPopover(first); // multi popover
    }
  });

  /* ===== Click handling on chips (open popover, respect multi) ===== */
  /* Click on chips: normal or additive select, open popover */
  overlay.addEventListener("click", (e) => {
    const ch = chipFromEventTarget(e.target);
    if (!ch) {
      // Click on empty overlay space - let document click handler close popover
      return;
    }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    selectChip(ch, additive ? { toggle: true } : {});
    openPopover(ch);
    e.stopPropagation();
  });

  // Close popover when clicking anywhere that's not inside the popup.
  // (Still respects suppressNextDocClick from marquee mouseup.)
  document.addEventListener("click", (e) => {
    if (suppressNextDocClick) {
      suppressNextDocClick = false; // swallow the post-marquee click
      return;
    }
    // If there's a popover and the click wasn't inside it, close it.
    if (popEl && !e.target.closest(".popover")) {
      closePopover();
      // Note: we keep the selection; remove the next line if you also want to clear selection.
      // deselectAll();
    }
  });

  /* ===== Keyboard shortcuts for bulk & quick edits ===== */
  window.addEventListener("keydown", (e) => {
    const k = (e.key || "").toLowerCase();
    const isInput = /input|textarea/i.test(
      document.activeElement?.tagName || ""
    );
    if (isInput) return;

    // Add j. to selection
    if ((k === "arrowup" || k === " ") && selectedChips.size) {
      e.preventDefault();
      addJPrefixBulk();
    }

    // Remove j. from selection
    if (k === "arrowdown" && selectedChips.size) {
      e.preventDefault();
      removeJPrefixBulk();
    }

    // Delete selected
    if ((k === "delete" || k === "backspace") && selectedChips.size) {
      e.preventDefault();
      deleteSelectedBulk();
    }

    // Select all chips (Ctrl/Cmd + A)
    if (k === "a" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      selectedChips.clear();
      overlay.querySelectorAll(".chip").forEach((ch) => selectedChips.add(ch));
      currentSelectedChip = selectedChips.size
        ? Array.from(selectedChips)[0]
        : null;
      updateSelectedStyles();
      if (currentSelectedChip) openPopover(currentSelectedChip);
    }
  });

  function openPopover(target, startInEdit = false) {
    closePopover();

    const isMulti = selectedChips.size > 1;
    const rect = target.getBoundingClientRect();
    const p = document.createElement("div");
    p.className = "popover";
    p.style.left =
      Math.max(8, Math.min(window.innerWidth - 300, rect.left)) + "px";
    p.style.top = rect.bottom + 6 + "px";

    if (!isMulti) {
      // single-chip popover (keeps your existing affordances)
      const lastSpan = target.querySelector("span:last-of-type");
      const curTxt = lastSpan ? lastSpan.textContent.trim() : "";
      p.innerHTML = `
      <h5>Chip actions</h5>
      <div class="row" style="grid-template-columns:1fr auto">
        <input id="renameInput" type="text" placeholder="New label…" value="${(
          curTxt || ""
        ).replace(/"/g, "&quot;")}"/>
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

      const renameInput = $("#renameInput"),
        applyBtn = $("#applyBtn"),
        delBtn = $("#delBtn"),
        captureBtn = $("#captureBtn");
      const clearDirBtn = $("#clearDirBtn"),
        clearMotionBtn = $("#clearMotionBtn");

      if (startInEdit) {
        renameInput?.blur();
        window.ComboOverlay?.ctrl?.startCapture?.();
      } else {
        renameInput?.focus();
      }

      // Debounce typing operations
      let typingDebounceTimer = null;
      let originalText = curTxt;

      renameInput?.addEventListener("input", () => {
        if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
        typingDebounceTimer = setTimeout(() => {
          // Store intermediate state for debounced typing
          const currentText = renameInput?.value.trim();
          if (currentText && currentText !== originalText) {
            // This will be handled on blur/apply
          }
        }, 300);
      });

      applyBtn?.addEventListener("click", () => {
        const newTxt = renameInput?.value.trim();
        if (newTxt && lastSpan && newTxt !== curTxt) {
          lastSpan.textContent = newTxt;
          window.ComboOverlay?.rebuildBuffer?.();

          // Push discrete operation to history (debounced typing)
          const chips = getChipList();
          const index = chips.indexOf(target);
          history.push({
            type: "chip:replace",
            index: index,
            beforeHTML: target.innerHTML.replace(curTxt, newTxt), // Store the HTML before typing
            afterHTML: target.innerHTML,
          });
        }
        closePopover();
      });
      renameInput?.addEventListener("apply-enter", () => applyBtn?.click());

      // Handle blur event to capture final typing state
      renameInput?.addEventListener("blur", () => {
        if (typingDebounceTimer) {
          clearTimeout(typingDebounceTimer);
          typingDebounceTimer = null;
        }
        const newTxt = renameInput?.value.trim();
        if (newTxt && newTxt !== originalText) {
          applyBtn?.click();
        }
      });
      delBtn?.addEventListener("click", () => {
        removeChip(target);
        closePopover();
      });
      captureBtn?.addEventListener("click", () =>
        window.ComboOverlay?.ctrl?.startCapture?.()
      );
      clearDirBtn?.addEventListener("click", () => {
        const imgs = [...target.querySelectorAll("img")];
        for (const img of imgs) {
          const a = img.alt;
          if (["u", "d", "b", "f", "ub", "uf", "db", "df"].includes(a))
            img.remove();
        }
        const span = target.querySelector("span:last-of-type");
        if (span) {
          span.textContent = span.textContent.trim().replace(/^j\./i, "");
        }
        window.ComboOverlay?.rebuildBuffer?.();
      });
      clearMotionBtn?.addEventListener("click", () => {
        [...target.querySelectorAll("img")].forEach((img) => {
          if (
            ["qcf", "qcb", "dpf", "dpb", "hcf", "hcb", "360"].includes(img.alt)
          )
            img.remove();
        });
        window.ComboOverlay?.rebuildBuffer?.();
      });
    } else {
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

      $("#bulkJ")?.addEventListener("click", () => {
        addJPrefixBulk();
        closePopover();
      });
      $("#bulkDelete")?.addEventListener("click", () => {
        deleteSelectedBulk();
        closePopover();
      });
      $("#bulkClearDir")?.addEventListener("click", () => {
        clearDirBulk();
        closePopover();
      });
      $("#bulkClearMotion")?.addEventListener("click", () => {
        clearMotionBulk();
        closePopover();
      });
      $("#bulkApplyRename")?.addEventListener("click", () => {
        const v = $("#bulkRenameTail")?.value?.trim();
        if (v) renameTailBulk(v);
        closePopover();
      });
    }
  }

  function closePopover() {
    if (popEl) {
      popEl.remove();
      popEl = null;
    }
  }

  function closePopover() {
    if (popEl) {
      popEl.remove();
      popEl = null;
    }
    if (currentSelectedChip) currentSelectedChip.classList.remove("capture");
    editCapture = false;
  }

  function removeChip(chip) {
    if (!chip) return;

    // Get index before removing
    const chips = getChipList();
    const index = chips.indexOf(chip);
    const html = chip.innerHTML;

    const prev = chip.previousSibling,
      next = chip.nextSibling;
    if (prev && prev.classList && prev.classList.contains("sep")) prev.remove();
    else if (next && next.classList && next.classList.contains("sep"))
      next.remove();
    chip.remove();
    if (currentSelectedChip === chip) currentSelectedChip = null;
    rebuildBuffer();
    bus.emit("chip:remove", chip);

    // Push discrete operation to history
    history.push({
      type: "chip:remove",
      index: index,
      html: html,
    });
  }

  function startControllerCapture(chip) {
    editCapture = true;
    selectChip(chip);
    chip.classList.add("capture");
    setStatus(
      "Capture: tilt D‑pad/stick for direction (buffered), press a button to set; UP also prefixes j."
    );
  }

  /* ===== Gamepad loop start ===== */
  requestAnimationFrame(poll);

  /* ===== Global API (exposed) ===== */
  const API = {
    version: "13.8",
    bus,
    get overlay() {
      return overlay;
    },
    get selectedChip() {
      return currentSelectedChip;
    },
    get useGlobalColors() {
      return !!useGlobalColors?.checked;
    },
    get profiles() {
      return profiles;
    },
    get activeProfile() {
      return activeProfile;
    },
    set activeProfile(v) {
      activeProfile = v;
      saveActive();
      refreshProfileUI();
    },
    addChipHTML: addChipElHTML,
    removeChip,
    selectChip,
    openPopover,
    closePopover,
    buttonHTML,
    addJPrefix,
    replaceChipFromController,
    clearOverlay,
    rebuildBuffer,
    currentSeparator,
    ctrl: {
      startCapture() {
        if (currentSelectedChip) startControllerCapture(currentSelectedChip);
      },
    },
    gamepad: { snapshotDirection, detectMotionForButton },
    png: { copyPNG, exportPNG },
    settings: { applyCssKnobs },
    on: (evt, fn) => bus.on(evt, fn),
    setStatus,
    undo,
    redo,
    get suppressHistory() {
      return suppressHistory;
    },
    set suppressHistory(v) {
      suppressHistory = !!v;
    },
    // Combo branching API
    combo: {
      get graph() {
        return comboGraph;
      },
      saveNode: saveCurrentAsNode,
      branchFromActive: branchFromActiveNode,
      switchToNode,
      updateNodeSelector,
    },
    // Reset binding API
    get suppressHistory() {
      return suppressHistory;
    },
    set suppressHistory(v) {
      suppressHistory = v;
    },
  };
  window.ComboOverlay = API;

  /* ===== Keyboard shortcuts & OBS toggle ===== */
  if (q.get("obs") === "1" || window.obsstudio) {
    document.body.classList.add("obs");
  }
  if (q.get("edit") === "1") {
    document.body.classList.remove("obs");
  }
  // window.addEventListener('keydown',(e)=>{const k=e.key.toLowerCase();
  //   if(k==='e') document.body.classList.toggle('obs');
  //   if(k==='c') clearOverlay();
  //   if((k==='delete'||k==='backspace') && currentSelectedChip){ removeChip(currentSelectedChip); closePopover(); }
  //   if((k==='arrowup' || k===' ') && currentSelectedChip && !editCapture){ addJPrefix(currentSelectedChip); }
  //   const ri=$('#renameInput'); if(ri && document.activeElement===ri){ if(k==='enter'){ ri.dispatchEvent(new Event('apply-enter')); } if(k==='escape'){ closePopover(); }}
  // });

  /* ===== Global hotkeys with typing lockout ===== */
  function isTyping() {
    const ae = document.activeElement;
    if (!ae) return false;
    const tag = (ae.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return true;
    if (ae.isContentEditable) return true;
    return false;
  }

  /* Capture-phase guard: if typing, swallow global hotkeys */
  window.addEventListener(
    "keydown",
    (e) => {
      const ae = document.activeElement;
      const tag = (ae?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || ae?.isContentEditable) {
        // stop ALL other keydown handlers from seeing this event
        e.stopImmediatePropagation?.();
        e.stopPropagation();
        // don't preventDefault so the field still receives the character / backspace
      }
    },
    true
  ); // <-- capture phase

  // OBS / editor / overlay shortcuts
  window.addEventListener("keydown", (e) => {
    if (isTyping()) return; // <-- lockout while typing

    const k = (e.key || "").toLowerCase();

    if (k === "e") document.body.classList.toggle("obs");
    if (k === "p") {
      // If you have setPracticeMode available in scope, call it; otherwise toggle the UI like before
      const toggleBtn = document.querySelector("#practiceToggle");
      toggleBtn?.click();
    }
    if (k === "c") clearOverlay();

    // Undo/Redo keyboard shortcuts
    if (k === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !isTyping()) {
      e.preventDefault();
      performUndo();
    }

    if (
      (k === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
      (k === "y" && (e.ctrlKey || e.metaKey))
    ) {
      e.preventDefault();
      performRedo();
    }

    // Cancel reset binding with ESC
    if (k === "escape" && resetBindingActive) {
      cancelResetBinding();
      e.preventDefault();
    }

    // Cancel preset binding with ESC
    if (k === "escape" && presetBind.active) {
      presetBind.active = false;
      setStatus("Preset binding cancelled.");
      e.preventDefault();
    }

    // Skip current button binding with SPACE during preset binding
    if (k === " " && presetBind.active) {
      stepPresetBindingAssigned();
      setStatus("Skipped current button binding.");
      e.preventDefault();
    }

    // Caret mode toggle shortcut
    if (k === "i" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      toggleCaretMode();
    }

    // Caret Mode Navigation
    if (caretModeActive) {
      if (k === "arrowleft") {
        moveCaretLeft();
        e.preventDefault();
      }
      if (k === "arrowright") {
        moveCaretRight();
        e.preventDefault();
      }
      if (k === "enter") {
        insertAtCaret();
        e.preventDefault();
      }
      if (k === "escape") {
        toggleCaretMode();
        e.preventDefault();
      }
      if (k === "[" || k === "]") {
        // Alternative bracket keys for caret movement
        if (k === "[") moveCaretLeft();
        if (k === "]") moveCaretRight();
        e.preventDefault();
      }
    }

    // Combo branching shortcuts
    if (k === "s" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const label = prompt(
        "Enter node label:",
        `Combo ${new Date().toLocaleTimeString()}`
      );
      if (label && label.trim()) {
        saveCurrentAsNode(label.trim());
      }
    }
    if (k === "b" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      branchFromActiveNode();
    }

    // Undo/Redo shortcuts
    if (k === "z" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (e.shiftKey) {
        redo(); // Ctrl/Cmd+Shift+Z
      } else {
        undo(); // Ctrl/Cmd+Z
      }
    }
    if (k === "y" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      redo(); // Ctrl/Cmd+Y
    }

    // single-selection delete fallback
    if (
      (k === "delete" || k === "backspace") &&
      window.ComboOverlay?.selectedChip
    ) {
      removeChip(window.ComboOverlay.selectedChip);
      window.ComboOverlay.closePopover?.();
    }

    // Quick j. on primary selected chip
    if (
      (k === "arrowup" || k === " ") &&
      window.ComboOverlay?.selectedChip &&
      !editCapture
    ) {
      addJPrefix(window.ComboOverlay.selectedChip);
    }

    // Multi-select: Ctrl/Cmd+A handled elsewhere; keep it global too if you want
  });

  /* ===== Init ===== */
  refreshProfileUI();
  applyCssKnobs();

  // Create initial history snapshot
  pushHistory("Initial state");

  function deleteNode(nodeId) {
    const nodeIndex = comboGraph.nodes.findIndex((n) => n.id === nodeId);
    if (nodeIndex === -1) {
      setStatus("Node not found");
      return false;
    }

    const node = comboGraph.nodes[nodeIndex];

    // Check if this is the active node
    if (comboGraph.activeId === nodeId) {
      // If deleting active node, switch to another node if available
      const otherNodes = comboGraph.nodes.filter((n) => n.id !== nodeId);
      if (otherNodes.length > 0) {
        switchToNode(otherNodes[0].id);
      } else {
        // No other nodes, clear the overlay
        clearOverlay();
        comboGraph.activeId = null;
      }
    }

    // Remove the node
    comboGraph.nodes.splice(nodeIndex, 1);

    // Remove any edges connected to this node
    comboGraph.edges = comboGraph.edges.filter(
      (edge) => edge.from !== nodeId && edge.to !== nodeId
    );

    // Update rootId if this was the root
    if (comboGraph.rootId === nodeId) {
      comboGraph.rootId =
        comboGraph.nodes.length > 0 ? comboGraph.nodes[0].id : null;
    }

    // Update the node selector
    updateNodeSelector();

    // Clear node history
    nodeHistory.delete(nodeId);

    setStatus(`Deleted node: ${node.label}`);
    return true;
  }

  function deleteActiveNode() {
    if (!comboGraph.activeId) {
      setStatus("No active node to delete");
      return;
    }
    deleteNode(comboGraph.activeId);
  }

  /* ===== Branch Mode Toggle ===== */
  let branchModeActive = false;

  function toggleBranchMode() {
    branchModeActive = !branchModeActive;

    const toggleBtn = $("#branchModeToggle");
    if (toggleBtn) {
      toggleBtn.textContent = `Branch Mode: ${branchModeActive ? "On" : "Off"}`;
      toggleBtn.classList.toggle("active", branchModeActive);
    }

    // Enable/disable branch controls based on mode
    const saveBtn = $("#saveNodeBtn");
    const branchBtn = $("#branchNodeBtn");
    const deleteBtn = $("#deleteNodeBtn");
    const selector = $("#nodeSelector");

    if (saveBtn) saveBtn.disabled = !branchModeActive;
    if (branchBtn) branchBtn.disabled = !branchModeActive;
    if (deleteBtn) deleteBtn.disabled = !branchModeActive;
    if (selector) selector.disabled = !branchModeActive;

    setStatus(`Branch mode ${branchModeActive ? "ON" : "OFF"}`);
  }

  // Initialize branch mode to off on startup
  toggleBranchMode();

  // Add event listener for branch mode toggle
  $("#branchModeToggle")?.addEventListener("click", () => toggleBranchMode());

  /* ===== Reset Button Binding ===== */
  let resetBindingActive = false;

  function startResetBinding() {
    resetBindingActive = true;
    setStatus(
      "Press any controller button (except D-pad) to bind as Reset... Press ESC to cancel."
    );
    document.body.classList.add("binding-active");
  }

  function cancelResetBinding() {
    resetBindingActive = false;
    setStatus("Reset binding cancelled.");
    document.body.classList.remove("binding-active");
  }

  function setResetButton(buttonIndex) {
    if (buttonIndex >= 12 && buttonIndex <= 15) {
      setStatus("D-pad buttons cannot be used for Reset binding.");
      return false;
    }

    const p = profiles[activeProfile];
    p.resetAction = `button:${buttonIndex}`;
    saveProfiles();
    updateResetLabel();
    setStatus(`Reset bound to button ${buttonIndex}`);
    resetBindingActive = false;
    document.body.classList.remove("binding-active");
    return true;
  }

  function clearResetButton() {
    const p = profiles[activeProfile];
    p.resetAction = "none";
    saveProfiles();
    updateResetLabel();
    setStatus("Reset binding cleared.");
  }

  function updateResetLabel() {
    const resetLabel = $("#resetLabel");
    const p = profiles[activeProfile];
    if (resetLabel) {
      if (p.resetAction === "none") {
        resetLabel.textContent = "Reset: none";
      } else {
        const buttonIndex = parseInt(p.resetAction.split(":")[1], 10);
        resetLabel.textContent = `Reset: button ${buttonIndex}`;
      }
    }
  }

  // Add event listeners for reset binding buttons
  $("#bindResetBtn")?.addEventListener("click", startResetBinding);
  $("#clearResetBtn")?.addEventListener("click", clearResetButton);

  // Add CSS for binding active state
  const style = document.createElement("style");
  style.textContent = `
    body.binding-active {
      outline: 3px solid #ff4444 !important;
      outline-offset: -3px;
    }
    body.binding-active::before {
      content: 'Binding Reset Button... Press any button (except D-pad) or ESC to cancel';
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: #ff4444;
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      z-index: 10000;
      font-weight: bold;
    }
  `;
  document.head.appendChild(style);

  /* ===== Metadata Object ===== */
  let comboMetadata = {
    name: "",
    game: "",
    characters: [],
    author: "",
    date: "",
    patch: "",
    tags: [],
    description: "",
  };

  /* ===== Metadata Modal Functions ===== */
  function showMetadataModal() {
    const modal = $("#metadataModal");
    if (!modal) return;

    // Fill form with current metadata
    $("#metaName").value = comboMetadata.name || "";
    $("#metaGame").value = comboMetadata.game || "";
    $("#metaCharacters").value = comboMetadata.characters.join(", ") || "";
    $("#metaAuthor").value = comboMetadata.author || "";
    $("#metaDate").value = comboMetadata.date || "";
    $("#metaPatch").value = comboMetadata.patch || "";
    $("#metaTags").value = comboMetadata.tags.join(", ") || "";
    $("#metaDescription").value = comboMetadata.description || "";

    modal.style.display = "flex";
  }

  function hideMetadataModal() {
    const modal = $("#metadataModal");
    if (modal) modal.style.display = "none";
  }

  function saveMetadata() {
    // Parse comma-separated values into arrays
    comboMetadata = {
      name: $("#metaName").value.trim(),
      game: $("#metaGame").value.trim(),
      characters: $("#metaCharacters")
        .value.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      author: $("#metaAuthor").value.trim(),
      date: $("#metaDate").value,
      patch: $("#metaPatch").value.trim(),
      tags: $("#metaTags")
        .value.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      description: $("#metaDescription").value.trim(),
    };

    hideMetadataModal();
    setStatus("Metadata saved");
  }

  // PNG Copy/Export
  $("#copyPngBtn")?.addEventListener("click", () => {
    exportOverlayAsPng().then((blob) => {
      if (blob)
        navigator.clipboard
          ?.write([new ClipboardItem({ "image/png": blob })])
          .then(() => setStatus("Copied PNG."));
    });
  });
  $("#exportPngBtn")?.addEventListener("click", () => {
    exportOverlayAsPng().then((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "combo_overlay.png";
        a.click();
        URL.revokeObjectURL(url);
        setStatus("Exported PNG.");
      }
    });
  });

  // Metadata Modal Event Handlers
  $("#metadataBtn")?.addEventListener("click", showMetadataModal);
  $("#metaCancel")?.addEventListener("click", hideMetadataModal);
  $("#metaSave")?.addEventListener("click", saveMetadata);

  /* ===== Insertion Caret System ===== */
  let caretModeActive = false;
  let caretPosition = 0; // 0 = before first chip, 1 = after first chip, etc.
  let caretElement = null;

  function toggleCaretMode() {
    caretModeActive = !caretModeActive;

    if (caretModeActive) {
      // Enter caret mode
      caretPosition = overlay.children.length; // Start at end
      showCaret();
      setStatus("Caret mode: Use ← → to move, Enter to insert, Esc to exit");
    } else {
      // Exit caret mode
      hideCaret();
      setStatus("Caret mode exited");
    }
  }

  function showCaret() {
    hideCaret(); // Remove any existing caret

    caretElement = document.createElement("div");
    caretElement.className = "insertion-caret";

    // Insert caret at current position
    if (caretPosition === 0) {
      overlay.insertBefore(caretElement, overlay.firstChild);
    } else if (caretPosition >= overlay.children.length) {
      overlay.appendChild(caretElement);
    } else {
      overlay.insertBefore(caretElement, overlay.children[caretPosition]);
    }
  }

  function hideCaret() {
    if (caretElement && caretElement.parentNode) {
      caretElement.parentNode.removeChild(caretElement);
    }
    caretElement = null;
  }

  function moveCaretLeft() {
    if (!caretModeActive) return;

    if (caretPosition > 0) {
      caretPosition--;
      showCaret();
    }
  }

  function moveCaretRight() {
    if (!caretModeActive) return;

    if (caretPosition < overlay.children.length) {
      caretPosition++;
      showCaret();
    }
  }

  function insertAtCaret() {
    if (!caretModeActive) return;

    const text = prompt("Enter chip text:");
    if (!text || !text.trim()) {
      return;
    }

    const html = `<span style="color:${getComputedStyle(
      document.documentElement
    )
      .getPropertyValue("--chip-text")
      .trim()}">${escapeHtml(text.trim())}</span>`;

    // Calculate the actual chip index based on caret position
    // The caret position counts all children (chips + separators)
    // We need to convert this to a chip-only index for insertChipAt
    const children = [...overlay.children];
    let chipCount = 0;
    let targetIndex = 0;

    for (let i = 0; i < children.length; i++) {
      if (children[i].classList.contains("chip")) {
        chipCount++;
      }
      if (i === caretPosition) {
        // We've reached the caret position, set targetIndex to current chip count
        targetIndex = chipCount;
        break;
      }
    }

    // If caret is at the end, targetIndex should be chipCount
    if (caretPosition >= children.length) {
      targetIndex = chipCount;
    }

    // Insert at the calculated chip index
    insertChipAt(targetIndex, html);

    // Move caret to after the inserted chip
    // The inserted chip adds 1 child (chip) and possibly 1 separator
    const insertedChipIndex = children.findIndex(
      (child) => child === caretElement
    );
    if (insertedChipIndex !== -1) {
      // Find the position after the newly inserted chip
      const newChip = overlay.children[insertedChipIndex];
      const nextSibling = newChip.nextSibling;
      if (nextSibling && nextSibling.classList.contains("sep")) {
        // If there's a separator after the chip, move caret after the separator
        caretPosition = Array.from(overlay.children).indexOf(nextSibling) + 1;
      } else {
        // Otherwise move caret after the chip
        caretPosition = insertedChipIndex + 1;
      }
    } else {
      // Fallback: just increment position
      caretPosition++;
    }

    showCaret();
  }

  // // single-selection delete fallback
  // if((k==='delete'||k==='backspace') && window.ComboOverlay?.selectedChip){
  //   removeChip(window.ComboOverlay.selectedChip);
  //   window.ComboOverlay.closePopover?.();
  // }

  /* ===== LZString Compression Library ===== */
  // Proper LZString implementation for actual compression
  const LZString = {
    compress: function (str) {
      // This is a simplified LZ77-based compression implementation
      if (!str) return "";

      let dict = {};
      let data = (str + "\0").split("");
      let out = [];
      let phrase = data[0];
      let code = 256;
      let currChar;

      for (let i = 1; i < data.length; i++) {
        currChar = data[i];
        if (dict[phrase + currChar] != null) {
          phrase += currChar;
        } else {
          out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
          dict[phrase + currChar] = code;
          code++;
          phrase = currChar;
        }
      }

      out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));

      // Convert to base64
      let result = "";
      for (let i = 0; i < out.length; i++) {
        result += String.fromCharCode(out[i]);
      }
      return btoa(result);
    },

    decompress: function (str) {
      try {
        // Decode from base64
        let compressed = atob(str);
        let data = [];
        for (let i = 0; i < compressed.length; i++) {
          data.push(compressed.charCodeAt(i));
        }

        let dict = {};
        let currChar = String.fromCharCode(data[0]);
        let oldPhrase = currChar;
        let out = [currChar];
        let code = 256;
        let phrase;

        for (let i = 1; i < data.length; i++) {
          let currCode = data[i];
          if (currCode < 256) {
            phrase = String.fromCharCode(currCode);
          } else {
            phrase = dict[currCode] ? dict[currCode] : oldPhrase + currChar;
          }
          out.push(phrase);
          currChar = phrase.charAt(0);
          dict[code] = oldPhrase + currChar;
          code++;
          oldPhrase = phrase;
        }

        return out.join("");
      } catch (e) {
        console.warn("Decompression error:", e);
        return null;
      }
    },
  };

  // Alternative approach: Use encodeURIComponent/decodeURIComponent for Unicode-safe encoding
  const LZStringSafe = {
    compress: function (str) {
      if (!str) return "";

      // Use TextEncoder to convert Unicode string to Uint8Array, then to base64
      const encoder = new TextEncoder();
      const data = encoder.encode(str);

      // Convert Uint8Array to base64
      let binary = "";
      const bytes = new Uint8Array(data);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }

      // Convert to base64 and make it URL-safe (remove padding, replace +/ with -_)
      let base64 = btoa(binary);
      base64 = base64
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      return base64;
    },

    decompress: function (str) {
      try {
        // Convert from URL-safe base64 back to standard base64
        let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
        // Add padding if needed
        while (base64.length % 4) {
          base64 += "=";
        }

        // Decode from base64
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        // Use TextDecoder to convert back to Unicode string
        const decoder = new TextDecoder();
        return decoder.decode(bytes);
      } catch (e) {
        console.warn("Decompression error:", e);
        return null;
      }
    },
  };

  /* ===== Share Functionality ===== */
  const SHARE_PREFIX = "share_";
  let shareCounter = 0;

  // Initialize share counter from localStorage
  function initShareCounter() {
    const lastShare = localStorage.getItem("share_counter");
    shareCounter = lastShare ? parseInt(lastShare, 10) : 0;
  }

  initShareCounter();

  function serializeProject() {
    const exportData = {
      version: "1.0",
      meta: comboMetadata,
      graph: comboGraph,
      profile: profiles[activeProfile],
    };
    return JSON.stringify(exportData);
  }

  function shareProject() {
    console.log("Share button clicked"); // Debug log
    testSimpleLog(); // Add test function call

    // Add visual feedback immediately
    const shareBtn = $("#shareBtn");
    if (shareBtn) {
      shareBtn.classList.add("clicked");
      setTimeout(() => shareBtn.classList.remove("clicked"), 300);
    }

    const jsonData = serializeProject();
    console.log("JSON data length:", jsonData.length); // Debug log

    // Check size limit (150KB)
    if (jsonData.length > 150000) {
      setStatus(
        "Project too large for URL sharing (>150KB). Use Export instead."
      );
      return;
    }

    try {
      console.log("Attempting compression..."); // Debug log
      const compressed = LZStringSafe.compress(jsonData);
      console.log("Compressed data length:", compressed.length); // Debug log

      // Generate short ID and store data in localStorage
      shareCounter++;
      localStorage.setItem("share_counter", shareCounter.toString());
      const shortId = shareCounter.toString(36); // Convert to base36 for shorter IDs
      localStorage.setItem(SHARE_PREFIX + shortId, compressed);

      const shareUrl =
        window.location.origin + window.location.pathname + "#id:" + shortId;
      console.log("Share URL created:", shareUrl); // Debug log

      // Copy to clipboard
      navigator.clipboard
        .write(shareUrl)
        .then(() => {
          console.log("URL copied to clipboard successfully"); // Debug log
          setStatus("Share URL copied to clipboard!");

          // Add visual feedback
          if (shareBtn) {
            shareBtn.textContent = "✓ Copied!";
            setTimeout(() => {
              shareBtn.textContent = "Share";
            }, 2000);
          }
        })
        .catch((err) => {
          console.log("Clipboard copy failed:", err); // Debug log
          // Fallback: show URL in status
          setStatus("Share URL: " + shareUrl);

          // Add visual feedback for fallback too
          if (shareBtn) {
            shareBtn.textContent = "URL in status!";
            setTimeout(() => {
              shareBtn.textContent = "Share";
            }, 2000);
          }
        });

      // Update URL without reloading
      window.history.replaceState(null, "", shareUrl);
      console.log("URL updated in browser history"); // Debug log
    } catch (error) {
      console.error("Error in shareProject:", error); // Debug log
      setStatus("Error creating share URL: " + error.message);
    }
  }

  function loadFromHash() {
    const hash = window.location.hash;

    if (hash.startsWith("#id:")) {
      // Short URL format: #id:abc123
      const shortId = hash.substring(4);
      const compressed = localStorage.getItem(SHARE_PREFIX + shortId);

      if (!compressed) {
        setStatus("Share data not found or expired");
        return;
      }

      const jsonData = LZStringSafe.decompress(compressed);

      if (!jsonData) {
        setStatus("Invalid share data in URL");
        return;
      }

      try {
        const data = JSON.parse(jsonData);

        if (data.version === "1.0" && data.meta && data.graph && data.profile) {
          // New format - metadata + graph + profile
          comboMetadata = data.meta;
          comboGraph = data.graph;

          // Replace current profile with imported one
          profiles[activeProfile] = data.profile;
          saveProfiles();
          refreshProfileUI();
          updateNodeSelector();

          // Restore active node if it exists
          if (comboGraph.activeId) {
            const activeNode = comboGraph.nodes.find(
              (n) => n.id === comboGraph.activeId
            );
            if (activeNode) {
              restoreNodeChips(activeNode);
            }
          }

          setStatus("Project loaded from share URL");
        } else {
          setStatus("Invalid project format in share URL");
        }
      } catch (error) {
        setStatus("Error loading from share URL: " + error.message);
      }
    } else if (hash.startsWith("#data:")) {
      // Legacy format: #data:compressed_data
      const compressed = hash.substring(6);
      const jsonData = LZStringSafe.decompress(compressed);

      if (!jsonData) {
        setStatus("Invalid share data in URL");
        return;
      }

      try {
        const data = JSON.parse(jsonData);

        if (data.version === "1.0" && data.meta && data.graph && data.profile) {
          // New format - metadata + graph + profile
          comboMetadata = data.meta;
          comboGraph = data.graph;

          // Replace current profile with imported one
          profiles[activeProfile] = data.profile;
          saveProfiles();
          refreshProfileUI();
          updateNodeSelector();

          // Restore active node if it exists
          if (comboGraph.activeId) {
            const activeNode = comboGraph.nodes.find(
              (n) => n.id === comboGraph.activeId
            );
            if (activeNode) {
              restoreNodeChips(activeNode);
            }
          }

          setStatus("Project loaded from share URL");
        } else {
          setStatus("Invalid project format in share URL");
        }
      } catch (error) {
        setStatus("Error loading from share URL: " + error.message);
      }
    }
  }

  // Add event listener for Share button
  const shareBtn = $("#shareBtn");
  console.log("Share button element:", shareBtn); // Debug log
  if (shareBtn) {
    shareBtn.addEventListener("click", shareProject);
    console.log("Share button event listener attached"); // Debug log
  } else {
    console.warn("Share button not found in DOM"); // Debug log
    // Fallback: attach listener after DOM is fully loaded
    window.addEventListener("load", () => {
      const shareBtnLoad = $("#shareBtn");
      if (shareBtnLoad) {
        shareBtnLoad.addEventListener("click", shareProject);
        console.log("Share button event listener attached after load"); // Debug log
      } else {
        console.error("Share button still not found after DOM load"); // Debug log
      }
    });
  }

  // Load from hash on startup
  window.addEventListener("load", loadFromHash);

  // Add event listeners for test buttons
  $("#testBtn1")?.addEventListener("click", function () {
    console.log("Test Button 1 clicked");
    this.classList.add("clicked");
    setTimeout(() => this.classList.remove("clicked"), 300);
    testSimpleLog(); // Add test function call
  });

  $("#testBtn2")?.addEventListener("click", function () {
    console.log("Test Button 2 clicked");
    this.classList.add("clicked");
    setTimeout(() => this.classList.remove("clicked"), 300);
    testSimpleLog(); // Add test function call
  });

  // Add a simple test function to verify basic functionality
  function testSimpleLog() {
    console.log("Simple test function executed");
  }

  // Helper functions for discrete undo/redo operations
  function getChipList() {
    return Array.from(overlay.querySelectorAll(".chip"));
  }

  function insertChipAt(index, html, perButtonBg) {
    const chips = getChipList();
    const targetChip = chips[index];

    if (index === chips.length) {
      // Insert at the end
      if (overlay.children.length) addSeparator();
      const c = document.createElement("span");
      c.className = "chip";
      c.innerHTML = html;
      c.tabIndex = 0;
      if (!useGlobalColors?.checked && perButtonBg)
        c.style.backgroundColor = perButtonBg;
      c.addEventListener("click", (ev) => {
        selectChip(c);
        openPopover(c);
        ev.stopPropagation();
      });
      c.addEventListener("dblclick", (ev) => {
        selectChip(c);
        openPopover(c, true);
        ev.stopPropagation();
      });
      overlay.appendChild(c);
      overlay.scrollLeft = overlay.scrollWidth;
      rebuildBuffer();
      bus.emit("chip:add", c);
      return c;
    } else if (targetChip) {
      // Insert before existing chip
      const separator = document.createElement("span");
      separator.className = "sep";
      separator.textContent = currentSeparator();

      const c = document.createElement("span");
      c.className = "chip";
      c.innerHTML = html;
      c.tabIndex = 0;
      if (!useGlobalColors?.checked && perButtonBg)
        c.style.backgroundColor = perButtonBg;
      c.addEventListener("click", (ev) => {
        selectChip(c);
        openPopover(c);
        ev.stopPropagation();
      });
      c.addEventListener("dblclick", (ev) => {
        selectChip(c);
        openPopover(c, true);
        ev.stopPropagation();
      });

      overlay.insertBefore(separator, targetChip);
      overlay.insertBefore(c, targetChip);
      rebuildBuffer();
      bus.emit("chip:add", c);
      return c;
    }
    return null;
  }

  function removeChipAt(index) {
    const chips = getChipList();
    const chip = chips[index];
    if (!chip) return null;

    const prev = chip.previousSibling,
      next = chip.nextSibling;
    const html = chip.innerHTML;

    if (prev && prev.classList && prev.classList.contains("sep")) prev.remove();
    else if (next && next.classList && next.classList.contains("sep"))
      next.remove();

    chip.remove();
    if (currentSelectedChip === chip) currentSelectedChip = null;
    rebuildBuffer();
    bus.emit("chip:remove", chip);

    return { chip, html };
  }

  function replaceChipAt(index, html) {
    const chips = getChipList();
    const chip = chips[index];
    if (!chip) return null;

    const oldHTML = chip.innerHTML;
    chip.innerHTML = html;
    rebuildBuffer();
    bus.emit("chip:replace", chip);

    return { chip, oldHTML, newHTML: html };
  }

  // New history module with discrete operations
  const history = {
    stack: [],
    index: -1,
    maxSize: 200,

    push(op) {
      // Remove any operations after current index
      if (this.index < this.stack.length - 1) {
        this.stack = this.stack.slice(0, this.index + 1);
      }

      this.stack.push(op);
      this.index = this.stack.length - 1;

      // Trim stack if exceeds max size
      if (this.stack.length > this.maxSize) {
        this.stack.shift();
        this.index--;
      }
    },

    undo() {
      if (!this.canUndo()) return null;
      const op = this.stack[this.index];
      this.index--;
      return op;
    },

    redo() {
      if (!this.canRedo()) return null;
      this.index++;
      return this.stack[this.index];
    },

    clearAll() {
      this.stack = [];
      this.index = -1;
    },

    canUndo() {
      return this.index >= 0;
    },

    canRedo() {
      return this.index < this.stack.length - 1;
    },
  };

  // Undo/Redo execution functions
  function performUndo() {
    const op = history.undo();
    if (!op) return;

    console.log(
      "Performing undo:",
      op.type,
      "index:",
      op.index,
      "stack length:",
      history.stack.length,
      "index:",
      history.index
    );

    suppressHistory = true;

    switch (op.type) {
      case "chip:add":
        console.log("Undoing chip:add at index", op.index);
        removeChipAt(op.index);
        break;
      case "chip:remove":
        console.log("Undoing chip:remove at index", op.index);
        insertChipAt(op.index, op.html);
        break;
      case "chip:replace":
        console.log("Undoing chip:replace at index", op.index);
        replaceChipAt(op.index, op.beforeHTML);
        break;
      case "overlay:clear":
        console.log("Undoing overlay:clear with", op.chips.length, "chips");
        // Restore all chips - don't clear first, just rebuild from saved state
        overlay.innerHTML = "";
        op.chips.forEach((html, index) => {
          insertChipAt(index, html);
        });
        break;
    }

    suppressHistory = false;
    setStatus(`Undo: ${op.type}`);
  }

  function performRedo() {
    const op = history.redo();
    if (!op) return;

    suppressHistory = true;

    switch (op.type) {
      case "chip:add":
        insertChipAt(op.index, op.html, op.perButtonBg);
        break;
      case "chip:remove":
        removeChipAt(op.index);
        break;
      case "chip:replace":
        replaceChipAt(op.index, op.afterHTML);
        break;
      case "overlay:clear":
        clearOverlay();
        break;
    }

    suppressHistory = false;
    setStatus(`Redo: ${op.type}`);
  }

  // Add button event listeners and state updates
  function setupUndoRedoButtons() {
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");

    if (undoBtn) {
      undoBtn.addEventListener("click", performUndo);
    }

    if (redoBtn) {
      redoBtn.addEventListener("click", performRedo);
    }

    // Function to update button states
    function updateButtonStates() {
      if (undoBtn) undoBtn.disabled = !history.canUndo();
      if (redoBtn) redoBtn.disabled = !history.canRedo();
    }

    // Update button states after each history operation
    const originalPush = history.push;
    history.push = function (op) {
      originalPush.call(this, op);
      updateButtonStates();
    };

    // Also update after undo/redo operations
    const originalUndo = history.undo;
    history.undo = function () {
      const result = originalUndo.call(this);
      updateButtonStates();
      return result;
    };

    const originalRedo = history.redo;
    history.redo = function () {
      const result = originalRedo.call(this);
      updateButtonStates();
      return result;
    };

    // Initial state update
    updateButtonStates();
  }

  // Set up buttons when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupUndoRedoButtons);
  } else {
    setupUndoRedoButtons();
  }

  function parseNumpadNotation(text) {
    console.log("=== parseNumpadNotation DEBUG ===");
    console.log("Input text:", text);
    const tokens = text.split(/\s+/).filter((token) => token.trim());
    console.log("Tokens:", tokens);
    const chips = [];

    // Sort motion patterns by length (longest first) to ensure proper matching
    const sortedPatterns = Object.entries(motionPatterns).sort(
      (a, b) => b[0].length - a[0].length
    );
    console.log("Sorted patterns:", sortedPatterns);

    for (const token of tokens) {
      console.log("Processing token:", token);
      // Check for motion inputs first
      let motionFound = false;
      for (const [motionPattern, motionName] of sortedPatterns) {
        console.log("Checking pattern:", motionPattern, "->", motionName);
        if (token.startsWith(motionPattern)) {
          console.log("Found matching pattern:", motionPattern);
          const button = token.slice(motionPattern.length);
          console.log("Button part:", button);

          // Handle double motions (qcf qcf, qcb qcb)
          if (motionName.includes(" ")) {
            console.log("Double motion detected:", motionName);
            const motions = motionName.split(" ");
            chips.push({
              type: "double_motion",
              motions: motions,
              button: button,
              original: token,
            });
          } else {
            console.log("Single motion detected:", motionName);
            chips.push({
              type: "motion",
              motion: motionName,
              button: button,
              original: token,
            });
          }
          motionFound = true;
          break;
        }
      }

      if (motionFound) continue;

      // Check for single direction + button
      const match = token.match(/^([1-9]*)([^1-9]*)$/);
      if (match) {
        const [, numpadPart, buttonPart] = match;
        console.log(
          "Direction + button detected:",
          numpadPart,
          "+",
          buttonPart
        );
        chips.push({
          type: "direction",
          directions: numpadPart
            .split("")
            .map((n) => numpadToDirection[n])
            .filter(Boolean),
          button: buttonPart,
          original: token,
        });
      }
    }

    console.log("Final parsed chips:", chips);
    console.log("=== END parseNumpadNotation DEBUG ===");
    return chips;
  }

  function convertNumpadToChips(text) {
    console.log("=== convertNumpadToChips DEBUG ===");
    const parsed = parseNumpadNotation(text);
    console.log("Parsed result:", parsed);
    clearOverlay();

    for (const chip of parsed) {
      console.log("Processing chip:", chip);
      let html = "";

      if (chip.type === "motion") {
        console.log("Creating single motion chip:", chip.motion);
        // Create motion input chip with image
        const motionImage = `<img class="img" src="images/${chip.motion}.png" alt="${chip.motion}">`;
        html = `${motionImage} + ${buttonHTML(0, chip.button)}`;
      } else if (chip.type === "double_motion") {
        console.log("Creating double motion chip:", chip.motions);
        // Create double motion input chip with two images
        const motionImages = chip.motions
          .map(
            (motion) =>
              `<img class="img" src="images/${motion}.png" alt="${motion}">`
          )
          .join(" ");
        html = `${motionImages} + ${buttonHTML(0, chip.button)}`;
      } else if (chip.type === "direction" && chip.directions.length > 0) {
        console.log("Creating direction chip:", chip.directions);
        // Create direction + button chip
        const directionHTML = chip.directions
          .map((dir) => dirToImg(dir))
          .join("");
        html = `${directionHTML} + ${buttonHTML(0, chip.button)}`;
      } else {
        console.log("Creating simple button chip");
        // Simple button chip
        html = buttonHTML(0, chip.button);
      }

      console.log("Final HTML:", html);
      addChipElHTML(html);
    }
    console.log("=== END convertNumpadToChips DEBUG ===");
  }

  // Add keyboard input interface
  function setupKeyboardInput() {
    const inputContainer = document.createElement("div");
    inputContainer.style.position = "fixed";
    inputContainer.style.bottom = "10px";
    inputContainer.style.right = "10px";
    inputContainer.style.background = "white";
    inputContainer.style.padding = "10px";
    inputContainer.style.border = "1px solid #ccc";
    inputContainer.style.borderRadius = "5px";
    inputContainer.style.zIndex = "1000";

    inputContainer.innerHTML = `
      <h4 style="margin: 0 0 10px 0;">Type Numpad Notation</h4>
      <input type="text" id="numpadInput" placeholder="e.g., 2L 5M 236H" style="width: 200px; margin-right: 5px;">
      <button id="convertBtn" class="btn">Convert</button>
      <div class="tiny" style="margin-top: 5px;">Use spaces as separators</div>
    `;

    document.body.appendChild(inputContainer);

    $("#convertBtn")?.addEventListener("click", () => {
      const input = $("#numpadInput");
      if (input?.value) {
        convertNumpadToChips(input.value);
        input.value = "";
      }
    });

    $("#numpadInput")?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        $("#convertBtn")?.click();
      }
    });
  }

  // Set up keyboard input when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupKeyboardInput);
  } else {
    setupKeyboardInput();
  }

  // Add notation mode change event listener
  document.addEventListener("change", function (e) {
    if (e.target.name === "notationMode") {
      const p = profiles[activeProfile];
      p.notationMode = e.target.value;
      saveProfiles();
      // Refresh overlay to apply new notation mode
      refreshOverlayNotation();
    }
  });

  function refreshOverlayNotation() {
    const p = profiles[activeProfile];
    const chips = [...overlay.querySelectorAll(".chip")];

    // Store original chip data for reconstruction
    const chipData = chips.map((chip) => ({
      originalHtml: chip.dataset.originalHtml || chip.innerHTML, // Store original image HTML
      currentHtml: chip.innerHTML,
      bg: chip.style.backgroundColor,
      isNumpad: chip.dataset.isNumpad === "true",
    }));

    clearOverlay();

    chipData.forEach((data) => {
      if (p.notationMode === "numpad") {
        // Convert to numpad notation from original image HTML
        const numpadNotation = chipToNumpadNotation(data.originalHtml);
        const chip = addChipElHTML(numpadNotation, data.bg);
        chip.dataset.isNumpad = "true";
        chip.dataset.originalHtml = data.originalHtml; // Preserve original for switching back
      } else {
        // Convert back to images - use original HTML
        const chip = addChipElHTML(data.originalHtml, data.bg);
        chip.dataset.isNumpad = "false";
        chip.dataset.originalHtml = data.originalHtml; // Keep original reference
      }
    });
  }

  // Real-time update for chord window when input field changes
  const chordWindowInput = document.querySelector("#chordWindow");
  if (chordWindowInput) {
    chordWindowInput.addEventListener("input", function (e) {
      const newValue = parseInt(e.target.value);
      if (!isNaN(newValue) && newValue > 0) {
        profiles[activeProfile].chordWindow = newValue;
        console.log(`Chord window updated to: ${newValue}ms`);
      }
    });
  }

  function createIndividualChip(i, t, skipMotionDetection = false) {
    const p = profiles[activeProfile];
    // Build the chip HTML (charge -> motion -> dir + button -> button)
    let html = null;
    const age = t - (lastCharged.at || 0);
    const nowDir = snapshotDirection() || "";
    if (
      lastCharged.tok &&
      age <= (p.chargeWindow || 180) &&
      isOpposite(lastCharged.tok, nowDir)
    ) {
      const first = dirToImg(lastCharged.tok) || lastCharged.tok.toUpperCase();
      const second = dirToImg(nowDir) || nowDir.toUpperCase();
      html = `${first} ${second} ${buttonHTML(i)}`;
      lastCharged.tok = null;
    }
    if (!html && !skipMotionDetection) {
      const motionHTML = detectMotionForButton();
      if (motionHTML) {
        html = `${motionHTML} ${buttonHTML(i)}`;
      }
    }
    if (!html) {
      const dirTok = snapshotDirection();
      if (dirTok) {
        const dirHTML = dirToImg(dirTok) || dirTok.toUpperCase();
        html = `${dirHTML} + ${buttonHTML(i)}`;
      } else {
        html = buttonHTML(i);
      }
    }

    // Add the chip to the overlay
    const chip = addChipElHTML(
      html,
      profiles[activeProfile].buttonBgColors[i] || "#f5f5f5"
    );
    // console.log(`Created chip: ${html}`);

    // ===== Mash collapse pass =====
    const mashResult = updateMashAfterAdd(html, chip);
    if (mashResult === "removed" || mashResult === "collapsed") {
      return;
    }

    // Hold tracking
    activeButtonChips.set(i, {
      chip,
      label: profiles[activeProfile].buttonLabels[i] || `#${i}`,
      pressAt: t,
      held: false,
    });

    // Hold tracking - only set up hold detection if the button is still pressed
    const holdId = setTimeout(() => {
      const obj = activeButtonChips.get(i);
      if (!obj) return;

      // Check if the button is still pressed before marking as held
      const gp = navigator.getGamepads?.();
      const currentGamepad = gamepadIndex != null ? gp[gamepadIndex] : null;
      if (currentGamepad && currentGamepad.buttons[i]?.pressed) {
        obj.held = true;
        mutateLabelText(obj.chip, obj.label, `[${obj.label}]`);
        rebuildBuffer();
      }
    }, p.holdMs || 250);
    holdTimers.set(i, holdId);
  }
})();
