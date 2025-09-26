// /js/stock-page-modal.js
import { auth, db } from "./firebase-init.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc,
  serverTimestamp, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

export function initStockPageModal(cfg) {
  const { collectionName, tableSelector, fields, computeTotals, loginUrl = "/login_main.html" } = cfg;
  if (!collectionName || !tableSelector || !fields || !fields.length) {
    console.error("[stock-page-modal] konfigurasi tidak lengkap."); return;
  }

  const table = document.querySelector(tableSelector);
  if (!table) { console.warn("[stock-page-modal] tabel tidak ditemukan:", tableSelector); return; }
  let tbody = table.querySelector("tbody"); if (!tbody) { tbody = document.createElement("tbody"); table.appendChild(tbody); }

  const btnAdd = document.getElementById("btnAddNew");
  if (!btnAdd) console.warn("[stock-page-modal] Tombol #btnAddNew tidak ditemukan.");

  let role = "viewer";
  const canWrite = () => role === "admin" || role === "contributor";

  // Modal dinamis (tanpa Bootstrap JS)
  const MODAL_ID = `stockModal-${collectionName}`;
  let modalEl = document.getElementById(MODAL_ID);
  // Tambahan: baca opsi UI
const ui = cfg.ui || {};
const size = ui.size || 'xl';        // 'lg' | 'xl' | 'full'
const columns = Number(ui.columns || 2);
const maxWidth = ui.maxWidth || 1200;

// Mapping kelas ukuran (jika Bootstrap CSS tersedia). Kita tetap beri inline width agar aman tanpa Bootstrap.
const sizeClass =
  size === 'full' ? 'modal-fullscreen'
: size === 'xl'   ? 'modal-xl'
: size === 'lg'   ? 'modal-lg'
: '';

if (!modalEl) {
  modalEl = document.createElement("div");
  modalEl.id = MODAL_ID;
  modalEl.className = "modal fade";
  modalEl.setAttribute("tabindex", "-1");
  modalEl.setAttribute("aria-hidden", "true");
  modalEl.innerHTML = `
    <div class="modal-dialog ${sizeClass} modal-dialog-centered modal-dialog-scrollable"
         style="width:min(95vw, ${maxWidth}px); max-width:${maxWidth}px;">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title fw-semibold">Add New</h5>
          <button type="button" class="btn-close" aria-label="Close" data-spm="close"></button>
        </div>
        <div class="modal-body">
          <form></form>
          <div id="${MODAL_ID}-msg" class="mt-2 small text-danger" style="display:none"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-light" data-spm="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-spm="save">Save</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);
}

// Gaya tambahan agar input nyaman dibaca di semua ukuran
(function ensureStyle(){
  const STYLE_ID = `${MODAL_ID}-style`;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${MODAL_ID} .form-label { font-weight:600; }
    #${MODAL_ID} .form-control { font-size:1rem; padding:.65rem .85rem; }
    #${MODAL_ID} .row.g-3 { row-gap:1rem; }
  `;
  document.head.appendChild(style);
})();

// === Build form: kolom dinamis ===
function buildForm(data = {}) {
  const colClass =
    columns === 1 ? 'col-12'
  : columns === 2 ? 'col-12 col-md-6'
  : /* 3 */        'col-12 col-md-4';

  formEl.innerHTML = `
    <div class="row g-3">
      ${fields.map(f => {
        const id = `${MODAL_ID}-${f.key}`;
        const req = f.required ? "required" : "";
        const type = f.type || "text";
        const val = data?.[f.key] ?? "";
        const placeholder = f.placeholder ? `placeholder="${f.placeholder}"` : "";
        const auto = f.autocomplete ? `autocomplete="${f.autocomplete}"` : "autocomplete=off";
        return `
          <div class="${colClass}">
            <label for="${id}" class="form-label">${f.label}${f.required ? " *" : ""}</label>
            <input id="${id}" name="${id}" type="${type}" class="form-control"
                   value="${val}" ${req} ${placeholder} ${auto} />
          </div>
        `;
      }).join("")}
    </div>
  `;
}
  function readFormValues() {
    const out = {};
    for (const f of fields) {
      const el = document.getElementById(`${MODAL_ID}-${f.key}`); if (!el) continue;
      let v = el.value; if (f.type === "number") v = Number(v || 0); else v = (v || "").trim();
      out[f.key] = v;
    }
    return out;
  }

  async function createDoc() {
    const data = readFormValues();
    data.createdAt = serverTimestamp(); data.updatedAt = serverTimestamp(); data.createdBy = auth.currentUser?.uid || null;
    await addDoc(collection(db, collectionName), data);
  }
  async function updateDocById(id) {
    const data = readFormValues(); data.updatedAt = serverTimestamp();
    await updateDoc(doc(db, collectionName, id), data);
  }
  async function deleteDocById(id) { await deleteDoc(doc(db, collectionName, id)); }

  function renderRows(snapshotDocs) {
    tbody.innerHTML = "";
    const can = canWrite();
    for (const d of snapshotDocs) {
      const data = d.data();
      const tr = document.createElement("tr");

      for (const f of fields) {
        const td = document.createElement("td");
        const val = data?.[f.key] ?? "";
        td.textContent = (f.type === "number") ? Number(val || 0) : String(val ?? "");
        tr.appendChild(td);
      }

      if (typeof computeTotals === "function") {
        const tdT = document.createElement("td");
        tdT.textContent = computeTotals(data);
        tr.appendChild(tdT);
      }

      const tdA = document.createElement("td");
      if (can) {
        const btnE = document.createElement("button");
        btnE.type = "button"; btnE.className = "btn btn-sm btn-outline-secondary me-1"; btnE.textContent = "Edit";
        btnE.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openEdit(d.id, data); });

        const btnD = document.createElement("button");
        btnD.type = "button"; btnD.className = "btn btn-sm btn-outline-danger"; btnD.textContent = "Delete";
        btnD.addEventListener("click", async (e) => {
          e.preventDefault(); e.stopPropagation();
          if (!confirm("Hapus data ini?")) return;
          try { await deleteDocById(d.id); } catch (err) { console.error(err); alert("Gagal menghapus."); }
        });

        tdA.appendChild(btnE); tdA.appendChild(btnD);
      }
      tr.appendChild(tdA);

      tbody.appendChild(tr);
    }
  }

  function openCreate() { mode = "create"; editingId = null; modalTitle.textContent = "Add New"; buildForm({}); msgEl.style.display = "none"; showModal(); }
  function openEdit(id, data) { mode = "edit"; editingId = id; modalTitle.textContent = "Edit Data"; buildForm(data); msgEl.style.display = "none"; showModal(); }

  if (btnAdd) btnAdd.addEventListener("click", (e) => { e.preventDefault(); if (canWrite()) openCreate(); });

  btnSave.addEventListener("click", async () => {
    msgEl.style.display = "none";
    try {
      if (mode === "create") await createDoc(); else if (mode === "edit" && editingId) await updateDocById(editingId);
      hideModal();
    } catch (err) { console.error(err); msgEl.textContent = "Gagal menyimpan data."; msgEl.style.display = "block"; }
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = loginUrl; return; }
    try {
      const usSnap = await getDoc(doc(db, "users", user.uid));
      role = usSnap.exists() ? (usSnap.data()?.role || "viewer") : "viewer";
    } catch { role = "viewer"; }

    if (btnAdd) btnAdd.style.display = canWrite() ? "" : "none";

    const q = query(collection(db, collectionName), orderBy("createdAt", "desc"));
    onSnapshot(q, (snap) => renderRows(snap.docs), (err) => console.error("[stock-page-modal] snapshot error:", err));
  });
}

