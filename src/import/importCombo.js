// src/import/importCombo.js
import { validateComboV1 } from "../validation/comboSchemaV1.js";
import { migrateCombo } from "./migrations.js"; // stub for future versions
import { loadIntoEditor } from "../core/editorLoader.js"; // your existing hook

export async function importComboFromText(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, reason: "invalid_json", message: "JSON parse failed" };
  }

  // version gate (future-proof)
  const version = data?.version;
  if (version !== "1.0.0") {
    const migrated = migrateCombo(data);
    if (!migrated.ok) {
      return { ok: false, reason: "unsupported_version", message: migrated.message };
    }
    data = migrated.data;
  }

  const res = validateComboV1(data);
  if (!res.ok) {
    return { ok: false, reason: "schema_errors", message: "Validation failed", errors: res.errs };
  }

  // Final safety: deep freeze or clone to avoid external mutation
  const safeData = structuredClone ? structuredClone(data) : JSON.parse(JSON.stringify(data));

  try {
    loadIntoEditor(safeData);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "load_failed", message: e?.message || "Failed to load combo" };
  }
}

