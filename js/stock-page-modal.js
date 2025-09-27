// /js/stock-page-modal.js
import { auth, db } from "./firebase-init.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc,
  serverTimestamp, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

export function initStockPageModal(cfg) {
  const {
    collectionName,
    tableSelector,
    fields,
    computeTotals,
    loginUrl = "/login_main.html",
    ui = {}
  } = cfg;

  if (!collectionName || !tableSelector || !fields || !fields.length) {
    console.error("[stock-page-modal] konfigurasi tidak lengkap.");
    return;
  }

  // ---------- Referensi DOM tabel & kontrol ----------
  const table = document.querySelector(tableSelector);
  if (!table) {
    console.warn("[stock-page-modal] tabel tidak ditemukan:", tableSelector);
    return;
  }
  let tbody = table.querySelector("tbody");
  if (!tbody) {
    tbody = document.createElement("tbody");
    table.appendChild(tbody);
  }

  const btnAdd      = document.getElementById("btnAddNew");
  const btnExport   = document.getElementById("btnExportExcel");
  const entriesSel  = document.getElementById("entriesSelect");
  const searchInput = document.getElementById("searchMaterial");
  const pagerEl     = document.getElementById("pager");
  const infoEl      = document.getElementById("infoText");

  if (!btnAdd)    console.warn("[stock-page-modal] Tombol #btnAddNew tidak ditemukan.");
  if (!btnExport) console.warn("[stock-page-modal] Tombol #btnExportExcel tidak ditemukan.");
  if (!entriesSel)console.warn("[stock-page-modal] #entriesSelect tidak ditemukan.");
  if (!searchInput)console.warn("[stock-page-modal] #searchMaterial tidak ditemukan.");
  if (!pagerEl)   console.warn("[stock-page-modal] #pager tidak ditemukan.");
  if (!infoEl)    console.warn("[stock-page-modal] #infoText tidak ditemukan.");

  // ---------- Role & izin ----------
  let role = "viewer";
  const canWrite = () => role === "admin" || role === "contributor";

  // ---------- UI Modal ----------
  const size     = ui.size || "xl";          // 'lg' | 'xl' | 'full'
  const columns  = Number(ui.columns || 2);  // 1 | 2 | 3
  const maxWidth = ui.maxWidth ?? 1200;

  const MODAL_ID = `stockModal-${collectionName}`;
  let modalEl = document.getElementById(MODAL_ID);
  const sizeClass =
    size === "full" ? "modal-fullscreen" :
    size === "xl"   ? "modal-xl" :
    size === "lg"   ? "modal-lg" : "";

  if (!modalEl) {
    modalEl = document.createElement("div");
    modalEl.id = MODAL_ID;
    modalEl.className = "modal fade";
    modalEl.setAttribute("tabindex", "-1");
    modalEl.setAttribute("aria-hidden", "true");
    modalEl.innerHTML = `
      <div class="modal-dialog ${sizeClass}" style="max-width:${size === "full" ? "100%" : (maxWidth + "px")}">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Add New</h5>
            <button type="button" class="btn-close" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="alert alert-danger d-none" id="${MODAL_ID}-msg"></div>
            <form id="${MODAL_ID}-form">
              <div class="row g-3" id="${MODAL_ID}-fields"></div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-role="cancel">Cancel</button>
            <button type="button" class="btn btn-primary" data-role="save">Save</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);
  }

  // ---------- Style tambahan ----------
  (function ensureStyle(){
    const STYLE_ID = `${MODAL_ID}-style`;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID} .form-label { font-weight: 600; }
      #${MODAL_ID} .form-control { font-size: 1rem; padding: .65rem .85rem; }
      #${MODAL_ID} .row.g-3 { row-gap: 1rem; }

      .modal.show { display: block; }
      body.modal-open { overflow: hidden; }
      .modal-backdrop.custom { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 1040; }
      #${MODAL_ID}.modal { z-index: 1050; }

      td .action-buttons { display: inline-flex; align-items: center; gap: .75rem; }
      .btn-icon { display: inline-flex; align-items: center; gap: .5rem; }
      .btn-icon svg { flex: 0 0 auto; }
    `;
   document.head.appendChild(style);
  })();

  // ---------- Referensi modal ----------
  const modalTitle = modalEl.querySelector(".modal-title");
  const fieldsWrap = modalEl.querySelector(`#${MODAL_ID}-fields`);
  const msgEl      = modalEl.querySelector(`#${MODAL_ID}-msg`);
  const btnSave    = modalEl.querySelector('[data-role="save"]');
  const btnCancel  = modalEl.querySelector('[data-role="cancel"]');
  const btnCloseX  = modalEl.querySelector('.btn-close');

  // ---------- State ----------
  let mode = "create";   // 'create' | 'edit'
  let editingId = null;

  // State tabel (filter + pagination)
  const state = {
    page: 1,
    pageSize: entriesSel ? parseInt(entriesSel.value, 10) : 10, // -1 artinya Semua
    search: "" // berdasarkan materialNumber
  };

  // Data cache
  let latestDocs = [];               // Firestore snapshot docs
  let allDocs = [];                  // Array of { id, data }

  // ---------- Modal controller ----------
  let backdropEl = null;
  function createBackdrop() {
    backdropEl = document.createElement("div");
    backdropEl.className = "modal-backdrop custom";
    document.body.appendChild(backdropEl);
  }
  function removeBackdrop() {
    if (backdropEl) backdropEl.remove(), (backdropEl = null);
  }
  function showModal() {
    modalEl.classList.add("show");
    modalEl.style.display = "block";
    document.body.classList.add("modal-open");
    createBackdrop();
    const firstInput = modalEl.querySelector("input, select, textarea, button");
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  }
  function hideModal() {
    modalEl.classList.remove("show");
    modalEl.style.display = "none";
    document.body.classList.remove("modal-open");
    removeBackdrop();
  }
  modalEl.addEventListener("click", (e) => { if (e.target === modalEl) hideModal(); });
  btnCloseX?.addEventListener("click", hideModal);
  btnCancel?.addEventListener("click", hideModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalEl.classList.contains("show")) hideModal();
  });

  // ---------- Form builder ----------
  function buildForm(data = {}) {
    const colClass =
      columns === 1 ? "col-12" :
      columns === 2 ? "col-12 col-md-6" : "col-12 col-md-4";
    fieldsWrap.innerHTML = `
      ${fields.map(f => {
        const id = `${MODAL_ID}-${f.key}`;
        const req = f.required ? "required" : "";
        const type = f.type || "text";
        const val = data?.[f.key] ?? "";
        const placeholder = f.placeholder ? `placeholder="${f.placeholder}"` : "";
        const auto = f.autocomplete ? `autocomplete="${f.autocomplete}"` : `autocomplete="off"`;
        return `
          <div class="${colClass}">
            <label class="form-label" for="${id}">
              ${f.label}${f.required ? " *" : ""}
            </label>
            <input id="${id}" name="${f.key}" type="${type}"
                   class="form-control" ${req} ${placeholder} ${auto}
                   value="${type === "number" ? (Number(val) || 0) : String(val)}" />
          </div>
        `;
      }).join("")}
    `;
  }

  function readFormValues() {
    const out = {};
    for (const f of fields) {
      const el = document.getElementById(`${MODAL_ID}-${f.key}`);
      if (!el) continue;
      let v = el.value;
      out[f.key] = (f.type === "number") ? Number(v || 0) : (v || "").trim();
    }
    return out;
  }

  async function createDoc() {
    const data = readFormValues();
    data.createdAt = serverTimestamp();
    data.updatedAt = serverTimestamp();
    data.createdBy = auth.currentUser?.uid ?? null;
    await addDoc(collection(db, collectionName), data);
  }

  async function updateDocById(id) {
    const data = readFormValues();
    data.updatedAt = serverTimestamp();
    await updateDoc(doc(db, collectionName, id), data);
  }

  async function deleteDocById(id) {
    await deleteDoc(doc(db, collectionName, id));
  }

  // ---------- FILTER + PAGINATION ----------
  function getFilteredRows() {
    const term = (state.search || "").trim().toLowerCase();
    if (!term) return allDocs;
    return allDocs.filter(({ data }) => {
      const val = (data?.materialNumber ?? "").toString().toLowerCase();
      return val.includes(term);
    });
  }

  function renderInfo(total, startIdx, endIdx) {
    if (!infoEl) return;
    const s = total === 0 ? 0 : (startIdx + 1);
    const e = total === 0 ? 0 : endIdx;
    infoEl.textContent = `Menampilkan ${s} sampai ${e} dari ${total} entri`;
  }

  function renderPager(total, pageSize) {
    if (!pagerEl) return;
    pagerEl.innerHTML = "";
    const totalPages = pageSize === -1 ? 1 : Math.max(1, Math.ceil(total / pageSize));
    if (state.page > totalPages) state.page = totalPages;

    // Helper buat item
    const addItem = (label, page, disabled = false, active = false) => {
      const li = document.createElement("li");
      li.className = `page-item${disabled ? " disabled" : ""}${active ? " active" : ""}`;
      const a = document.createElement("a");
      a.className = "page-link";
      a.href = "#";
      a.textContent = label;
      if (!disabled && !active) {
        a.addEventListener("click", (e) => {
          e.preventDefault();
          state.page = page;
          drawTable(); // rerender
        });
      }
      li.appendChild(a);
      pagerEl.appendChild(li);
    };

    // Prev
    addItem("«", Math.max(1, state.page - 1), state.page === 1);

    // Numbered pages (ringkas dgn elipsis)
    const maxButtons = 7;
    if (totalPages <= maxButtons) {
      for (let p = 1; p <= totalPages; p++) addItem(String(p), p, false, p === state.page);
    } else {
      const addEllipsis = () => {
        const li = document.createElement("li");
        li.className = "page-item disabled";
        li.innerHTML = `<span class="page-link">…</span>`;
        pagerEl.appendChild(li);
      };
      const pages = new Set([1, 2, totalPages, totalPages - 1, state.page, state.page - 1, state.page + 1]);
      const list = [...pages].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);
      let prev = 0;
      for (const p of list) {
        if (p - prev > 1) addEllipsis();
        addItem(String(p), p, false, p === state.page);
        prev = p;
      }
    }

    // Next
    addItem("»", Math.min(totalPages, state.page + 1), state.page === totalPages);
  }

  function drawTable() {
    const pageSize = state.pageSize;
    const filtered = getFilteredRows();
    const total = filtered.length;

    // Hitung slice
    let start = 0, end = total;
    if (pageSize !== -1) {
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      if (state.page > totalPages) state.page = totalPages;
      start = (state.page - 1) * pageSize;
      end = Math.min(total, start + pageSize);
    }

    // Render body
    tbody.innerHTML = "";
    const slice = filtered.slice(start, end);
    for (const { id, data } of slice) {
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
      if (canWrite()) {
        const btnE = document.createElement("button");
        btnE.type = "button";
        btnE.className = "btn btn-sm btn-outline-secondary";
        btnE.textContent = "Edit";
        btnE.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          openEdit(id, data);
        });

        const btnD = document.createElement("button");
        btnD.type = "button";
        btnD.className = "btn btn-sm btn-outline-danger";
        btnD.textContent = "Delete";
        btnD.addEventListener("click", async (e) => {
          e.preventDefault(); e.stopPropagation();
          if (!confirm("Hapus data ini?")) return;
          try { await deleteDocById(id); }
          catch (err) { console.error(err); alert("Gagal menghapus."); }
        });

        const actionsWrap = document.createElement("div");
        actionsWrap.className = "action-buttons";
        actionsWrap.append(btnE, btnD);
        tdA.appendChild(actionsWrap);
      }
      tr.appendChild(tdA);
      tbody.appendChild(tr);
    }

    renderInfo(total, start, end);
    renderPager(total, pageSize);
  }

  // dipanggil saat snapshot datang
  function renderRows(snapshotDocs) {
    latestDocs = snapshotDocs;
    allDocs = snapshotDocs.map(d => ({ id: d.id, data: d.data() }));
    // reset ke halaman 1 bila data berubah drastis
    if (state.page > 1 && (state.page - 1) * state.pageSize >= allDocs.length) state.page = 1;
    drawTable();
  }

  // ---------- Modal open ----------
  function openCreate() {
    mode = "create"; editingId = null;
    modalTitle.textContent = "Add New";
    buildForm({});
    msgEl.classList.add("d-none");
    showModal();
  }
  function openEdit(id, data) {
    mode = "edit"; editingId = id;
    modalTitle.textContent = "Edit Data";
    buildForm(data);
    msgEl.classList.add("d-none");
    showModal();
  }

  // ---------- Events ----------
  if (btnAdd) {
    btnAdd.addEventListener("click", (e) => {
      e.preventDefault();
      if (canWrite()) openCreate();
    });
  }
  btnSave?.addEventListener("click", async () => {
    msgEl.classList.add("d-none");
    try {
      if (mode === "create") await createDoc();
      else if (mode === "edit" && editingId) await updateDocById(editingId);
      hideModal();
    } catch (err) {
      console.error(err);
      msgEl.textContent = "Gagal menyimpan data.";
      msgEl.classList.remove("d-none");
    }
  });

  // Kontrol: Show entries
  entriesSel?.addEventListener("change", () => {
    state.pageSize = parseInt(entriesSel.value, 10);
    state.page = 1;
    drawTable();
  });

  // Kontrol: Search (by material number)
  let searchTimer = null;
  searchInput?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = searchInput.value || "";
      state.page = 1;
      drawTable();
    }, 150); // debounce ringan
  });

  // ====== EXPORT EXCEL ======
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true; // jangan type="module"
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Gagal memuat: " + src));
      document.head.appendChild(s);
    });
  }
  function isSameOrigin(url) {
    try { return new URL(url, location.href).origin === location.origin; }
    catch { return false; }
  }
  async function okSameOrigin(url) {
    try { const resp = await fetch(url, { method: "HEAD", cache: "no-store" }); return resp.ok; }
    catch { return false; }
  }
  function ensureSheetJS() {
    return new Promise(async (resolve, reject) => {
      if (window.XLSX) return resolve();
      const urls = (window.SHEETJS_URLS && Array.isArray(window.SHEETJS_URLS))
        ? window.SHEETJS_URLS
        : [
            "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
            "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js",
            "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.full.min.js"
          ];
      const DEBUG = !!window.SHEETJS_DEBUG;
      let lastErr;
      for (const url of urls) {
        try {
          if (isSameOrigin(url) && !(await okSameOrigin(url))) {
            if (DEBUG) console.warn("[SheetJS] lewati (tidak ditemukan):", url);
            continue;
          }
          await loadScript(url);
          if (window.XLSX) return resolve();
        } catch (e) {
          lastErr = e;
          if (DEBUG) console.warn("[SheetJS] gagal memuat dari:", url);
        }
      }
      reject(lastErr || new Error("Tidak bisa memuat SheetJS dari semua sumber."));
    });
  }
  function toLocalDatetimeStamp() {
    const d = new Date(); const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  }
  function docsToRows(docs) {
    const includeTotals = typeof computeTotals === "function";
    const rows = [];
    for (const snap of docs) {
      const data = snap.data() || {};
      const row = {};
      for (const f of fields) {
        const val = data?.[f.key];
        row[f.label || f.key] = (f.type === "number") ? Number(val || 0) : (val ?? "");
      }
      if (includeTotals) row["Total"] = computeTotals(data);
      if (data.createdAt?.toDate) row["Created At"] = data.createdAt.toDate().toISOString();
      if (data.updatedAt?.toDate) row["Updated At"] = data.updatedAt.toDate().toISOString();
      rows.push(row);
    }
    return rows;
  }
  async function exportToExcel() {
    try {
      // Default: export SEMUA data (bukan hanya yang terfilter/terlihat)
      if (!latestDocs.length) { alert("Data belum tersedia untuk diexport."); return; }
      await ensureSheetJS();
      const rows = docsToRows(latestDocs);
      const ws = XLSX.utils.json_to_sheet(rows, { cellDates: false });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Data");
      XLSX.writeFile(wb, `${collectionName}_${toLocalDatetimeStamp()}.xlsx`);
    } catch (err) {
      console.error(err);
      alert("Export gagal. Coba refresh atau cek koneksi/CDN.");
    }
  }
  if (btnExport) {
    btnExport.addEventListener("click", (e) => {
      e.preventDefault();
      exportToExcel();
    });
  }
  // ====== END EXPORT EXCEL ======

  // ---------- Auth & realtime ----------
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = loginUrl; return; }
    try {
      const usSnap = await getDoc(doc(db, "users", user.uid));
      role = usSnap.exists() ? (usSnap.data()?.role ?? "viewer") : "viewer";
    } catch { role = "viewer"; }

    if (btnAdd) btnAdd.style.display = canWrite() ? "" : "none";

    const q = query(collection(db, collectionName), orderBy("createdAt", "desc"));
    onSnapshot(
      q,
      (snap) => renderRows(snap.docs),
      (err) => console.error("[stock-page-modal] snapshot error:", err)
    );
  });

  // ---------- Aksi modal ----------
  function openCreate() {
    mode = "create"; editingId = null;
    modalTitle.textContent = "Add New";
    buildForm({});
    msgEl.classList.add("d-none");
    showModal();
  }
  function openEdit(id, data) {
    mode = "edit"; editingId = id;
    modalTitle.textContent = "Edit Data";
    buildForm(data);
    msgEl.classList.add("d-none");
    showModal();
  }
