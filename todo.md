# TODO

## Phase 1 - Core Functionality (MVP)
- [x] Basic recording/playback (already working)
- [x] Notation display with chips, directions, and timing
- [ ] Smarter mash detection
  - [ ] Collapse 3 or more presses of same button plus direction into mash X
  - [ ] Add configurable setting mashWindowMs (default 200ms)
- [ ] Undo/Redo stack
  - [ ] Maintain action history as array of { do, undo }
  - [ ] Support keyboard shortcuts Ctrl+Z / Ctrl+Y
- [ ] Insertion system
  - [ ] Right-click between chips -> "Insert here"
  - [ ] Right-click a chip -> "Insert before" / "Insert after"
  - [ ] Maintain combos as arrays of steps with timestamps and re-render on insert

## Phase 2 - Authoring and Branching
- [ ] Combo branching and variations
  - [ ] Fork at a chip to create branch nodes represented as trees
  - [ ] Support storage format:
```
{
  "type": "branch",
  "branches": [
    { "label": "Option A", "steps": [...] },
    { "label": "Option B", "steps": [...] }
  ]
}
```
- [ ] Insert, edit, and delete anywhere in nested branches via context menus

## Phase 3 - Export and Import
- [ ] Export combos with metadata payload including game, character, author, date, patch, type, tags, script
- [ ] Import JSON with schema validation

## Phase 4 - Sharing
- [ ] Shareable links via base64 or hash in ?combo= param
- [ ] Database hub for hosted combos with metadata, upload, tagging, search
- [ ] Profiles for controller bindings with quick switching

## Phase 5 - Advanced
- [ ] Guided binding modal (centered, visible, darkened background)
- [ ] Video sync with upload or embed, sync point marker, and notation playback
- [ ] Embed mode for mini-viewer (for example, forum posts)
- [ ] Input playback simulation via tools like EddieInput

## Phase 6 - Community Expansion
- [ ] Cloud storage and account system for cross-device sync
- [ ] Mobile-friendly UI for viewing, searching, and editing combos
- [ ] Tagging and discovery tooling with advanced filters (including team tags)

## Implementation Order (Next Steps)
1. Smarter mash detection (mashWindowMs)
2. Undo/Redo stack
3. Insertion system
4. Branching structure
5. Export and import with metadata
