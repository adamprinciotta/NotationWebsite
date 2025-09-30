# EDDIE Input Contract - NotationWebsite Analysis

## Chip Model

### Chip Properties
- **HTML Structure**: Chips are `<span>` elements with class `"chip"`
- **Content**: `innerHTML` contains the visual representation
- **Data Attributes**: No explicit data attributes found
- **Visual Elements**: Can contain:
  - Button text (e.g., "L", "M", "H", "S")
  - Direction images (`<img class="img" src="images/{direction}.png">`)
  - Motion input images (360, qcf, qcb, hcf, hcb, etc.)
  - Hold indicators (`[label]` for held buttons)

### Chip Types
- **Button chips**: Simple button presses (e.g., "L", "M", "H", "S")
- **Direction + Button**: Combined inputs (e.g., "→ + M")
- **Motion + Button**: Special inputs (e.g., "qcf + H")
- **Charge motions**: Opposite direction sequences
- **Chord chips**: Multiple buttons pressed simultaneously ("L + M + H")
- **Hold chips**: Button held for duration (indicated with brackets)

### Detection Mechanisms
- **Direction detection**: From gamepad axes/D-pad via `tokenFromAxes()`
- **Motion detection**: Pattern matching via `detectMotionForButton()`
- **Chord detection**: Multiple button presses within `chordWindow` (default: 130ms)
- **Hold detection**: Button held for `holdMs` (default: 250ms)

## Recording Model

### Script Format
Recorded scripts are stored as arrays of snapshots:
```javascript
{
  version: "13.8",
  script: [
    { t: number, chipsHTML: string[] },  // Relative timestamp and chip HTML array
    // ... additional steps
  ],
  markers: [
    { stepIndex: number, tMs: number }   // Time markers for each step
  ]
}
```

### Live Recording Format
- **script[i].t**: Relative timestamp in milliseconds from recording start
- **script[i].chipsHTML**: Array of chip innerHTML strings at that moment
- **Markers**: Additional timing metadata for each step

### Playback Processing
Scripts are processed into per-chip timing via `buildPresses()`:
```javascript
{
  finalChips: string[],    // Final chip HTML array
  presses: [{ idx: number, t: number }],  // Chip index and timestamp
  totalDur: number         // Total duration in ms
}
```

## Timing Base

### Time Source
- **Primary source**: `performance.now()`
- **Recording**: Relative timestamps from `t0 = performance.now()`
- **Playback**: Relative to `state.start = performance.now()`

### FPS Assumption
- **Playback**: Uses `requestAnimationFrame()` (typically 60 FPS)
- **Grading loop**: Runs at display refresh rate via RAF
- **No fixed FPS assumption**: Timing is millisecond-based, not frame-based

## Profile Mapping

### Button Labels → Eddie Symbols
Default button mapping (indices 0-15):
```javascript
const DEFAULT_BUTTON_LABELS = [
  "L",     // 0 -> LP (Light Punch)
  "M",     // 1 -> MP (Medium Punch)  
  "H",     // 2 -> HP (Heavy Punch)
  "S",     // 3 -> SP (Special/Unique)
  "LB",    // 4 -> LB (Left Bumper)
  "RB",    // 5 -> RB (Right Bumper)
  "LT",    // 6 -> LT (Left Trigger)
  "RT",    // 7 -> RT (Right Trigger)
  "Select", // 8 -> Select
  "Start",  // 9 -> Start
  "L3",     // 10 -> L3 (Left Stick)
  "R3",     // 11 -> R3 (Right Stick)
  "D↑",     // 12 -> D-pad Up
  "D↓",     // 13 -> D-pad Down
  "D←",     // 14 -> D-pad Left
  "D→"      // 15 -> D-pad Right
];
```

### Eddie Symbol Mapping
For export to EDDIE format, use these mappings:
- `"L"` → `"LP"` (Light Punch)
- `"M"` → `"MP"` (Medium Punch)
- `"H"` → `"HP"` (Heavy Punch)
- `"S"` → `"SP"` (Special/Unique)
- Other buttons map directly to their labels

### Direction Mapping
Direction tokens map to images:
```javascript
const dirMap = {
  u: "u",     // Up
  d: "d",     // Down
  l: "b",     // Back
  r: "f",     // Forward
  ul: "ub",   // Up-Back
  ur: "uf",   // Up-Forward
  dl: "db",   // Down-Back
  dr: "df",   // Down-Forward
  // ... additional mappings
};
```

## Events System

### Available Events
Hook via `window.ComboOverlay.on(event, callback)`:

**Core Events:**
- `'chip:add'` (chipEl) - Fired when a chip is added to overlay
- `'chip:remove'` (chipEl) - Fired when a chip is removed
- `'chip:replace'` (chipEl) - Fired when a chip is replaced
- `'overlay:clear'` - Fired when overlay is cleared
- `'status'` (msg) - Status message events
- `'reset:action'` - Fired when reset action occurs

**Recording-specific Events:**
- Chip events during recording capture timing
- Overlay clear events also captured

### Event Usage for Export
For EDDIE export, hook:
- `'chip:add'` to capture button/direction inputs
- `'overlay:clear'` to detect combo resets
- Use timing from `performance.now()` for relative timestamps

## Fields for EDDIE Export

### Primary Data Fields
- **script[i].t**: Relative timestamp (ms) - **CRITICAL for timing**
- **script[i].chipsHTML**: Chip content array - **CRITICAL for input sequence**
- **Button indices**: Map to EDDIE symbols (0=L, 1=M, 2=H, 3=S)
- **Direction tokens**: Convert to EDDIE direction notation
- **Motion inputs**: Map to EDDIE motion notation

### Secondary Metadata
- **Profile buttonLabels**: Custom button mappings
- **Markers**: Additional timing reference points
- **Version**: Script format version

### Export Processing
1. Extract timing from `script[i].t`
2. Parse `chipsHTML` to extract:
   - Button inputs (L, M, H, S)
   - Direction inputs
   - Motion inputs
   - Hold durations
3. Map to EDDIE symbol format
4. Preserve relative timing structure
