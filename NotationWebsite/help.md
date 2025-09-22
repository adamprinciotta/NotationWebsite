To adjust the overlay and settings behavior in OBS, here’s how it works with the current code setup:

---

## How to Switch Between Modes

* **OBS Mode:** When you load the file in OBS as a *Browser Source* with `?obs=1` in the URL, the overlay-only view is shown (the settings panel is hidden).

  * Example: `file:///C:/path/to/combo-overlay.html?obs=1`
* **OBS + Edit Mode:** If you want the settings panel visible inside OBS, add `&edit=1`.

  * Example: `file:///C:/path/to/combo-overlay.html?obs=1&edit=1`
* **Browser (for setup):** Just open the file in Chrome/Edge normally (no params) and you’ll see the full overlay + settings.

---

## Hotkeys

* **E** → Toggles settings panel on/off, even in OBS.
* **C** → Clears the overlay instantly (same as Clear button).

---

## Customization in OBS

All the button labels, colors, and reset button mapping are set up through the settings panel:

1. **Open in browser first (not OBS).**

   * Adjust button labels, chip text color, chip background color.
   * Select the reset button mapping (for example, `button:8` for Select).
   * Save your profile.

2. **Profiles are saved in localStorage.**

   * OBS has its own Chromium instance, so the first time you run it in OBS, you’ll need to configure again or export/import the JSON.

3. **Reset Button Behavior:**

   * Select your desired reset button in the dropdown (`Reset action`).
   * When you press that gamepad button, the overlay will clear immediately.
   * Make sure you hit **Save** after setting this.

---

## Troubleshooting

* If the reset button doesn’t work:

  1. Confirm you saved the profile after selecting the button.
  2. Check the status text (bottom of settings) to make sure the gamepad is connected.
  3. Ensure you’re not testing with a D-pad button (12–15), since those are ignored as attack buttons.

* If text or dropdowns look unreadable in OBS:

  * Use `?edit=1` to reveal settings inside OBS and adjust colors.
  * Or, adjust in Chrome and re-save before reloading OBS.

---

👉 Tip: For everyday streaming, run OBS with just `?obs=1`. Only add `&edit=1` if you need to make changes live in OBS.
