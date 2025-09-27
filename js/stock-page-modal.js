// /js/stock-page-modal.js
import { auth, db } from "./firebase-init.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc,
  serverTimestamp, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

/**
 * Inisialisasi halaman stok (CRUD + Export + Search + Pagination).
 * @param {Object} cfg
 * @param {string} cfg.collectionName - Nama koleksi Firestore (office|ppe|souvenir|supplier|...)
 * @param {string} cfg.tableSelector  - CSS selector tabel target (wajib)
 * @param {Array}  cfg.fields         - Daftar field untuk form & render tabel (urutan = kolom tabel)
 *   Contoh item:
 *     { key:'materialNumber', label:'Material Number', type:'text', required:true }
 *     { key:'qtyIn',          label:'Qty In',           type:'number' }
 *     { key:'dateIn',         label:'Date In',          type:'date' }
 * @param {function} [cfg.computeTotals] - (docData) => number|string untuk kolom Total (opsional)
 * @param {string}   [cfg.loginUrl='/login_main.html']
 * @param {Object}   [cfg.ui]
 *   @param {'lg'|'xl'|'full'} [cfg.ui.size='xl']     - ukuran modal
 *   @param {1|2|3}            [cfg.ui.columns=1]     - grid kolom form
 *   @param {number}           [cfg.ui.maxWidth=1200] - max width modal (px)
 *   @param {Object}           [cfg.ui.controls]      - selector kustom (opsional):
 *        { searchSelector, lengthSelector, infoSelector, pagerSelector }
 * @param {'all'|'filtered'} [cfg.exportScope='all']  - export seluruh data atau hasil filter saja
 */
export function initStockPageModal(cfg) {
  const {
    collectionName, tableSelector, fields, computeTotals,
    loginUrl = "/login_main.html",
    ui = {},
    exportScope = 'all'
  } = cfg;

  if (!collectionName || !tableSelector || !fields || !fields.length) {
    console.error("[stock-page-modal] konfigurasi tidak lengkap.");
    return;
  }

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

  const btnAdd    = document.getElementById("btnAddNew");
  const btnExport = document.getElementById("btnExportExcel");
  if (!btnAdd)    console.warn("[stock-page-modal] Tombol #btnAddNew tidak ditemukan.");
  if (!btnExport) console.warn("[stock-page-modal] Tombol #btnExportExcel tidak ditemukan.");

  // ---------- Role & izin ----------
  let role = "viewer";
  const canWrite = () => role === "admin" || role === "contributor";

  // ---------- Opsi UI ----------
  const size     = ui.size ?? "xl";   // 'lg' | 'xl' | 'full'
  const columns  = Number(ui.columns ?? 1); // 1 | 2 | 3
  const maxWidth = ui.maxWidth ?? 1200;
  const includeTotals = (typeof computeTotals === "function");

  // ---------- Modal ----------
  const MODAL_ID = `stockModal-${collectionName}`;
  let modalEl = document.getElementById(MODAL_ID);
  const sizeClass = (size === "full" ? "modal-fullscreen" : (size === "xl" ? "modal-xl" : (size === "lg" ? "modal-lg" : "")));

  if (!modalEl) {
    modalEl = document.createElement("div");
    modalEl.id = MODAL_ID;
    modalEl.className = "modal fade";
    modalEl.setAttribute("tabindex", "-1");
    modalEl.setAttribute("aria-hidden", "true");
    modalEl.setAttribute("role", "dialog");
    modalEl.innerHTML = `
      <div class="modal-dialog ${sizeClass}" style="max-width:${maxWidth}px; width:100%;">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Add New</h5>
            <button type="button" class="btn-close" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div id="${MODAL_ID}-msg" class="alert alert-danger d-none mb-3"></div>
            <div id="${MODAL_ID}-fields" class="row g-3"></div>
          </div>
          <div class="modal-footer">
            <button type="button" data-role="cancel" class="btn btn-light">Cancel</button>
            <button type="button" data-role="save" class="btn btn-primary">Save</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);
  }

  // ---------- Style (modal & table controls & pager) ----------
  (function ensureStyle(){
    const STYLE_ID = `${MODAL_ID}-style`;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Form in modal */
      #${MODAL_ID} .form-label { font-weight: 600; }
      #${MODAL_ID} .form-control { font-size: 1rem; padding: .65rem .85rem; }
      #${MODAL_ID} .row.g-3 { row-gap: 1rem; }

      /* Barebone modal (tanpa Bootstrap JS) */
      .modal.show { display: block; }
      body.modal-open { overflow: hidden; }
      .modal-backdrop.custom { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 1040; }
      #${MODAL_ID}.modal { z-index: 1050; }

      /* Action buttons spacing */
      td .action-buttons { display: inline-flex; align-items: center; gap: .75rem; }

      /* Table controls */
      .table-controls { margin: 0.5rem 0; }
      
      .table-controls select#pageLength {
        width: auto;
        min-width: 70px;
        padding: 0.25rem 1.5rem 0.25rem 0.5rem;
        background-position: right 0.5rem center;
        background-size: 0.65rem auto;
      }

      .table-footer { margin-top: 0.5rem; }

      /* Pagination (tanpa Bootstrap JS) */
      .pagination { display:flex; gap:.25rem; list-style:none; padding:0; margin:0; }
      .page-item {}
      .page-link {
        border:1px solid #dee2e6; padding:.25rem .5rem; cursor:pointer;
        border-radius:.25rem; color:inherit; background:#fff; text-decoration:none; display:block;
      }
      .page-item.active .page-link { background:#0d6efd; color:#fff; border-color:#0d6efd; }
      .page-item.disabled .page-link { opacity:.5; pointer-events:none; }
    `;
    document.head.appendChild(style);
  })();

  // ---------- Referensi elemen modal ----------
  const modalTitle = modalEl.querySelector(".modal-title");
  const fieldsWrap = modalEl.querySelector(`#${MODAL_ID}-fields`);
  const msgEl      = modalEl.querySelector(`#${MODAL_ID}-msg`);
  const btnSave    = modalEl.querySelector('[data-role="save"]');
  const btnCancel  = modalEl.querySelector('[data-role="cancel"]');
  const btnCloseX  = modalEl.querySelector('.btn-close');

  // ---------- State modal ----------
  let mode = "create";      // "create" | "edit"
  let editingId = null;

  // ---------- Modal controller (tanpa Bootstrap JS) ----------
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

  // ---------- Build form (dinamis) ----------
  function buildForm(data = {}) {
    const colClass = (columns === 1) ? "col-12"
                   : (columns === 2) ? "col-12 col-md-6"
                   : "col-12 col-md-4";
    fieldsWrap.innerHTML = `
      ${fields.map(f => {
        const id = `${MODAL_ID}-${f.key}`;
        const req = f.required ? "required" : "";
        const type = f.type || "text";
        const val  = (data?.[f.key] ?? "");
        const placeholder = f.placeholder ? `placeholder="${f.placeholder}"` : "";
        const auto = f.autocomplete ? `autocomplete="${f.autocomplete}"` : `autocomplete="off"`;
        return `
          <div class="${colClass}">
            <label for="${id}" class="form-label">${f.label}${f.required ? " *" : ""}</label>
            <input id="${id}" name="${id}" type="${type}" class="form-control" ${req} ${placeholder} ${auto}
                   value="${(type==='number') ? String(val ?? "") : String(val ?? "").replace(/"/g, '&quot;')}">
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

  // ---------- UI Controls (Show entries + Search + Info + Pager) ----------
  const controls = ui.controls || {};
  let searchInput = document.querySelector(controls.searchSelector || '#tableSearch');
  let lengthSelect = document.querySelector(controls.lengthSelector || '#pageLength');
  let infoEl   = document.querySelector(controls.infoSelector  || '#tableInfo');
  let pagerEl  = document.querySelector(controls.pagerSelector || '#tablePager');

  // Jika elemen belum ada di HTML, buat otomatis
  if (!searchInput || !lengthSelect || !infoEl || !pagerEl) {
    const controlsWrap = document.createElement('div');
    controlsWrap.className = 'table-controls d-flex align-items-center justify-content-between flex-wrap gap-2';
    controlsWrap.innerHTML = `
      <div class="d-flex align-items-center gap-2">
        <label class="mb-0 small">Show</label>
        <select id="pageLength" class="form-select form-select-sm" style="width:auto">
          <option value="10" selected>10</option>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="-1">All</option>
        </select>
        <span class="small">entries</span>
      </div>
      <div class="d-flex align-items-center gap-2 ms-auto">
        <label for="tableSearch" class="mb-0 small">Search:</label>
        <input id="tableSearch" type="search" class="form-control form-control-sm" placeholder="Type to search..." />
      </div>
    `;
    table.parentNode.insertBefore(controlsWrap, table);

    const footerWrap = document.createElement('div');
    footerWrap.className = 'table-footer d-flex align-items-center justify-content-between flex-wrap gap-2';
    footerWrap.innerHTML = `
      <div id="tableInfo" class="small text-muted"></div>
      <ul id="tablePager" class="pagination pagination-sm mb-0"></ul>
    `;
    table.parentNode.insertBefore(footerWrap, table.nextSibling);

    searchInput  = controlsWrap.querySelector('#tableSearch');
    lengthSelect = controlsWrap.querySelector('#pageLength');
    infoEl       = footerWrap.querySelector('#tableInfo');
    pagerEl      = footerWrap.querySelector('#tablePager');
  }

  // ---------- State & logika filter/pagination ----------
  let latestDocs   = [];  // semua dokumen realtime
  let filteredDocs = [];  // hasil filter (search)
  let currentPage  = 1;   // halaman aktif
  let pageSize     = 10;  // 10|25|50|100|-1 (All)
  let searchQuery  = "";  // kata kunci

  function setLatestDocs(docs) {
    latestDocs = docs;
    currentPage = 1;
    applyFilterAndPaginate();
  }

  function applyFilterAndPaginate() {
    const q = (searchQuery || "").trim().toLowerCase();
    if (!q) {
      filteredDocs = latestDocs;
    } else {
      filteredDocs = latestDocs.filter((snap) => {
        const data = snap.data() || {};
        const hay = [];
        for (const f of fields) {
          const v = data[f.key];
          if (v !== undefined && v !== null) hay.push(String(v));
        }
        if (includeTotals) {
          try { hay.push(String(computeTotals(data))); } catch {}
        }
        hay.push(snap.id);
        return hay.join(" ").toLowerCase().includes(q);
      });
    }

    const totalPages = getTotalPages();
    if (currentPage > totalPages) currentPage = totalPages || 1;

    refreshTable();
  }

  function getTotalPages() {
    if (pageSize === -1) return 1;
    return Math.ceil(filteredDocs.length / pageSize);
  }

  function getPageDocs() {
    if (pageSize === -1) return filteredDocs;
    const start = (currentPage - 1) * pageSize;
    return filteredDocs.slice(start, start + pageSize);
  }

  function renderInfo() {
    const total    = latestDocs.length;
    const filtered = filteredDocs.length;
    const start = (filtered === 0) ? 0 : (pageSize === -1 ? 1 : ((currentPage - 1) * pageSize + 1));
    const end   = (pageSize === -1) ? filtered : Math.min(currentPage * pageSize, filtered);
    const base  = `Showing ${start} to ${end} of ${filtered} entries`;
    infoEl.textContent = (filtered !== total) ? `${base} (filtered from ${total} total)` : base;
  }

  function renderPager() {
    const totalPages = getTotalPages();
    pagerEl.innerHTML = "";

    const mkItem = (label, page, disabled = false, active = false) => {
      const li = document.createElement("li");
      li.className = `page-item${disabled ? " disabled" : ""}${active ? " active" : ""}`;
      const a = document.createElement("a");
      a.className = "page-link";
      a.textContent = label;
      a.href = "#";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (disabled || active) return;
        currentPage = page;
        refreshTable();
      });
      li.appendChild(a);
      return li;
    };

    // Prev
    pagerEl.appendChild(mkItem("«", Math.max(1, currentPage - 1), currentPage === 1));

    // window numerik
    const windowSize = 5;
    let start = Math.max(1, currentPage - Math.floor(windowSize / 2));
    let end   = Math.min(totalPages, start + windowSize - 1);
    start     = Math.max(1, end - windowSize + 1);
    for (let p = start; p <= end; p++) {
      pagerEl.appendChild(mkItem(String(p), p, false, p === currentPage));
    }

    // Next
    pagerEl.appendChild(mkItem("»", Math.min(totalPages, currentPage + 1), currentPage === totalPages));
  }

  // ---------- Render baris tabel (untuk halaman aktif saja) ----------
  function renderRows(docArray) {
    tbody.innerHTML = "";
    const can = canWrite();

    for (const d of docArray) {
      const data = d.data();
      const tr = document.createElement("tr");

      // kolom data sesuai urutan fields
      for (const f of fields) {
        const td = document.createElement("td");
        const val = data?.[f.key] ?? "";
        td.textContent = (f.type === "number") ? Number(val || 0) : String(val ?? "");
        tr.appendChild(td);
      }

      // kolom Total (opsional)
      if (includeTotals) {
        const tdT = document.createElement("td");
        tdT.textContent = computeTotals(data);
        tr.appendChild(tdT);
      }

      // kolom Aksi
      const tdA = document.createElement("td");
      if (can) {
        const btnE = document.createElement("button");
        btnE.type = "button";
        btnE.className = "btn btn-sm btn-outline-secondary";
        btnE.textContent = "Edit";
        btnE.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          openEdit(d.id, data);
        });

        const btnD = document.createElement("button");
        btnD.type = "button";
        btnD.className = "btn btn-sm btn-outline-danger";
        btnD.textContent = "Delete";
        btnD.addEventListener("click", async (e) => {
          e.preventDefault(); e.stopPropagation();
          if (!confirm("Hapus data ini?")) return;
          btnD.disabled = true;
          try { await deleteDocById(d.id); }
          catch (err) { console.error(err); alert("Gagal menghapus."); }
          finally { btnD.disabled = false; }
        });

        const actionsWrap = document.createElement("div");
        actionsWrap.className = "action-buttons";
        actionsWrap.append(btnE, btnD);
        tdA.appendChild(actionsWrap);
      }
      tr.appendChild(tdA);

      tbody.appendChild(tr);
    }
  }

  function refreshTable() {
    const pageDocs = getPageDocs();
    renderRows(pageDocs);
    renderInfo();
    renderPager();
  }

  // ---------- Open/Create/Edit ----------
  function openCreate() {
    mode = "create";
    editingId = null;
    modalTitle.textContent = "Add New";
    buildForm({});
    msgEl.classList.add("d-none");
    showModal();
  }
  function openEdit(id, data) {
    mode = "edit";
    editingId = id;
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
    btnSave.disabled = true;
    try {
      if (mode === "create") await createDoc();
      else if (mode === "edit" && editingId) await updateDocById(editingId);
      hideModal();
    } catch (err) {
      console.error(err);
      msgEl.textContent = "Gagal menyimpan data.";
      msgEl.classList.remove("d-none");
    } finally {
      btnSave.disabled = false;
    }
  });

  // ---- Search & Page length ----
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value || "";
      currentPage = 1;
      applyFilterAndPaginate();
    });
  }
  if (lengthSelect) {
    lengthSelect.addEventListener("change", (e) => {
      const v = parseInt(e.target.value, 10);
      pageSize = (v === -1) ? -1 : (isNaN(v) || v <= 0 ? 10 : v);
      currentPage = 1;
      applyFilterAndPaginate();
    });
  }

  // ---------- EXPORT EXCEL ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true; // jangan 'module'
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Gagal memuat: " + src));
      document.head.appendChild(s);
    });
  }
  function ensureSheetJS() {
    return new Promise(async (resolve, reject) => {
      if (window.XLSX) return resolve(); // sudah ada
      const urls = (window.SHEETJS_URLS && Array.isArray(window.SHEETJS_URLS)) ? window.SHEETJS_URLS : [
        "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.full.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
        "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js"
      ];
      let lastErr;
      for (const url of urls) {
        try { await loadScript(url); if (window.XLSX) return resolve(); }
        catch (e) { lastErr = e; console.warn("[SheetJS] gagal memuat dari:", url); }
      }
      reject(lastErr ?? new Error("Tidak bisa memuat SheetJS dari semua sumber."));
    });
  }
  function toLocalDatetimeStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  }
  function docsToRows(docs) {
    const rows = [];
    for (const snap of docs) {
      const data = snap.data() ?? {};
      const row = { ID: snap.id };
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
      const baseDocs = (exportScope === 'filtered') ? filteredDocs : latestDocs;
      if (!baseDocs.length) { alert("Data belum tersedia untuk diexport."); return; }
      await ensureSheetJS();
      const rows = docsToRows(baseDocs);
      const ws = XLSX.utils.json_to_sheet(rows, { cellDates: false });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Data");
      const filename = `${collectionName}_${toLocalDatetimeStamp()}.xlsx`;
      XLSX.writeFile(wb, filename);
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
  // ---------- END EXPORT EXCEL ----------

  // ---------- Auth & realtime ----------
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = loginUrl;
      return;
    }
    try {
      const usSnap = await getDoc(doc(db, "users", user.uid));
      role = usSnap.exists() ? (usSnap.data()?.role ?? "viewer") : "viewer";
    } catch {
      role = "viewer";
    }
    if (btnAdd) btnAdd.style.display = canWrite() ? "" : "none";

    const q = query(collection(db, collectionName), orderBy("createdAt", "desc"));
    onSnapshot(
      q,
      (snap) => setLatestDocs(snap.docs),
      (err) => console.error("[stock-page-modal] snapshot error:", err)
    );
  });
}


