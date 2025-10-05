// src/ui/importDialog.js
import { importComboFromText } from "../import/importCombo.js";

export function attachImportUI() {
  const fileInput = document.getElementById("importFile");
  const textArea  = document.getElementById("importText");
  const btnFile   = document.getElementById("btnImportFile");
  const btnText   = document.getElementById("btnImportText");
  const out       = document.getElementById("importErrors");

  function showErrors(result) {
    out.innerHTML = "";
    if (!result.ok) {
      const errs = (result.errors || []).map(e => `<li>${e}</li>`).join("");
      out.innerHTML = `
        <div class="p-2 rounded bg-red-100 text-red-800">
          <div><strong>Import failed:</strong> ${result.message || result.reason}</div>
          ${errs ? `<ul class="list-disc ml-5 mt-1">${errs}</ul>` : ""}
        </div>`;
    } else {
      out.innerHTML = `<div class="p-2 rounded bg-green-100 text-green-800">Import successful</div>`;
    }
  }

  btnFile?.addEventListener("click", async () => {
    const f = fileInput?.files?.[0];
    if (!f) return showErrors({ ok: false, message: "No file selected" });
    const text = await f.text();
    const res = await importComboFromText(text);
    showErrors(res);
  });

  btnText?.addEventListener("click", async () => {
    const text = textArea?.value || "";
    const res = await importComboFromText(text);
    showErrors(res);
  });

  // URL param (?combo=<url-encoded-json>)
  const params = new URLSearchParams(location.search);
  const comboParam = params.get("combo");
  if (comboParam) {
    try {
      const jsonText = decodeURIComponent(comboParam);
      importComboFromText(jsonText).then(showErrors);
    } catch (e) {
      showErrors({ ok: false, message: "combo param decode failed" });
    }
  }
}

