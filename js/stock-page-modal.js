// /js/stock-page-modal.js
import { auth, db } from "./firebase-init.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc,
  serverTimestamp, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

/**
 * Inisialisasi halaman stok (CRUD + Export + Search + Pagination + Sorting 3-state + Tooltip).
 * @param {Object} cfg
 * @param {string} cfg.collectionName
 * @param {string} cfg.tableSelector
 * @param {Array}  cfg.fields
 *   Contoh: { key:'materialNumber', label:'Material Number', type:'text', required:true }
 * @param {function} [cfg.computeTotals] - (docData) => number|string untuk kolom "Total" (opsional)
 * @param {string}   [cfg.loginUrl='/login_main.html']
 * @param {Object}   [cfg.ui]
 *   @param {'lg'|'xl'|'full'} [cfg.ui.size='xl']
 *   @param {1|2|3}            [cfg.ui.columns=1]
 *   @param {number}           [cfg.ui.maxWidth=1200]
 *   @param {Object}           [cfg.ui.controls] - selector opsional {searchSelector,lengthSelector,infoSelector,pagerSelector}
 * @param {'all'|'filtered'}   [cfg.exportScope='all'] - ekspor semua data atau hanya hasil filter
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
            <h5 class="modal-title">Add New Data</h5>
            <button type="button" class="btn-close" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div id="${MODAL_ID}-msg" class="alert alert-danger d-none mb-3"></div>
            <!-- Dibungkus <form> agar bisa pakai reportValidity() -->
            <form id="${MODAL_ID}-form">
              <div id="${MODAL_ID}-fields" class="row g-3"></div>
            </form>
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

  // ---------- Style ----------
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

      /* Table controls & dropdown Show entries */
      .table-controls { margin: 0.5rem 0; }
      .table-controls select#pageLength {
        width: auto;
        min-width: 70px;
        padding: 0.25rem 1.5rem 0.25rem 0.5rem;
        background-position: right 0.5rem center;
        background-size: 0.65rem auto;
      }
      .table-controls label { margin-bottom: 0; margin-right: 0.25rem; }
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

      /* Sorting header + tooltip */
      table thead th.sortable {
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
        position: relative; /* untuk tooltip */
      }
      table thead th.sortable .sort-indicator {
        margin-left: .35rem;
        font-size: .75rem;
        opacity: .45; /* redup saat netral */
        transition: opacity .12s ease-in-out;
      }
      table thead th.sortable.active .sort-indicator { opacity: .95; }
      table thead th.sortable:hover { background: rgba(13,110,253,.06); }
      table thead th.sortable:hover .sort-indicator { opacity: .8; }

      /* Tooltip ringan */
      table thead th.sortable[data-tip]::after {
        content: attr(data-tip);
        position: absolute;
        bottom: 100%;               /* tampil di atas header; ganti ke top:100% untuk di bawah */
        left: 0;
        transform: translateY(-6px);
        background: rgba(33,37,41,.95);
        color: #fff;
        padding: .25rem .5rem;
        border-radius: .25rem;
        font-size: .75rem;
        line-height: 1;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transition: opacity .12s ease-out, transform .12s ease-out;
        z-index: 12;
      }
      table thead th.sortable:hover::after {
        opacity: .95;
        transform: translateY(-8px);
      }
    `;
    document.head.appendChild(style);
  })();

  // ---------- Referensi elemen modal ----------
  const modalTitle = modalEl.querySelector(".modal-title");
  const formEl     = modalEl.querySelector(`#${MODAL_ID}-form`);
  const fieldsWrap = modalEl.querySelector(`#${MODAL_ID}-fields`);
  const msgEl      = modalEl.querySelector(`#${MODAL_ID}-msg`);
  const btnSave    = modalEl.querySelector('[data-role="save"]');
  const btnCancel  = modalEl.querySelector('[data-role="cancel"]');
  const btnCloseX  = modalEl.querySelector('.btn-close');

  // ---------- State modal ----------
  let mode = "create"; // "create" | "edit"
  let editingId = null;

  // ---------- Modal controller ----------
  let backdropEl = null;
  function createBackdrop(){ backdropEl = document.createElement("div"); backdropEl.className = "modal-backdrop custom"; document.body.appendChild(backdropEl); }
  function removeBackdrop(){ if (backdropEl) backdropEl.remove(), (backdropEl = null); }
  function showModal(){
    modalEl.classList.add("show");
    modalEl.style.display = "block";
    document.body.classList.add("modal-open");
    createBackdrop();
    const firstInput = modalEl.querySelector("input, select, textarea, button");
    if (firstInput) setTimeout(()=> firstInput.focus(), 50);
  }
  function hideModal(){
    modalEl.classList.remove("show");
    modalEl.style.display = "none";
    document.body.classList.remove("modal-open");
    removeBackdrop();
  }
  modalEl.addEventListener("click", (e)=>{ if (e.target === modalEl) hideModal(); });
  btnCloseX?.addEventListener("click", hideModal);
  btnCancel?.addEventListener("click", hideModal);
  document.addEventListener("keydown", (e)=>{ if (e.key === "Escape" && modalEl.classList.contains("show")) hideModal(); });

  // ---------- Build form (dinamis) ----------
  function buildForm(data = {}) {
    const colClass = (columns === 1) ? "col-12" : (columns === 2) ? "col-12 col-md-6" : "col-12 col-md-4";
    fieldsWrap.innerHTML = `
      ${fields.map(f => {
        const id = `${MODAL_ID}-${f.key}`;
        const req = f.required ? "required" : "";
        const type = f.type || "text";
        const val  = (data?.[f.key] ?? "");
        const placeholder = f.placeholder ? `placeholder="${f.placeholder}"` : "";
        const auto = f.autocomplete ? `autocomplete="${f.autocomplete}"` : `autocomplete="off"`;
        const safeVal = (type === 'number') ? String(val ?? "") : String(val ?? "").replace(/"/g, '&quot;');
        return `
          <div class="${colClass}">
            <label for="${id}" class="form-label">${f.label}${f.required ? " *" : ""}</label>
            <input id="${id}" name="${id}" type="${type}" class="form-control" ${req} ${placeholder} ${auto}
                   value="${safeVal}">
          </div>
        `;
      }).join("")}
    `;
  }

  // ---------- Validasi (required) ----------
  function validateForm() {
    if (!formEl) return true;
    // Trim kolom text required + pesan kustom
    for (const f of fields) {
      if (!f.required) continue;
      const el = document.getElementById(`${MODAL_ID}-${f.key}`);
      if (!el) continue;
      el.setCustomValidity("");
      const type = f.type || "text";
      if (type === "text") { el.value = (el.value || "").trim(); }
      if (!el.value) { el.setCustomValidity("Kolom wajib diisi"); }
    }
    const ok = formEl.reportValidity();
    // Bersihkan pesan kustom agar tidak "mengunci"
    for (const f of fields) {
      const el = document.getElementById(`${MODAL_ID}-${f.key}`);
      if (el) el.setCustomValidity("");
    }
    return ok;
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

  async function createDoc(){
    const data = readFormValues();
    data.createdAt = serverTimestamp();
    data.updatedAt = serverTimestamp();
    data.createdBy = auth.currentUser?.uid ?? null;
    await addDoc(collection(db, collectionName), data);
  }
  async function updateDocById(id){
    const data = readFormValues();
    data.updatedAt = serverTimestamp();
    await updateDoc(doc(db, collectionName, id), data);
  }
  async function deleteDocById(id){
    await deleteDoc(doc(db, collectionName, id));
  }

  // ---------- Table Controls ----------
  const controls = ui.controls || {};
  let searchInput  = document.querySelector(controls.searchSelector  || '#tableSearch');
  let lengthSelect = document.querySelector(controls.lengthSelector || '#pageLength');
  let infoEl       = document.querySelector(controls.infoSelector   || '#tableInfo');
  let pagerEl      = document.querySelector(controls.pagerSelector  || '#tablePager');

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

  // ---------- State: data, filter, paging, sorting ----------
  let latestDocs   = [];  // semua dokumen realtime
  let filteredDocs = [];  // hasil filter
  let currentPage  = 1;   // halaman aktif
  let pageSize     = 10;  // 10|25|50|100|-1
  let searchQuery  = "";  // kata kunci

  // Sorting 3-state
  let sortKey = null;     // 'fieldKey' | '__total' | null (none)
  let sortDir = 'asc';    // 'asc' | 'desc' (diabaikan saat none)
  let headerInitDone = false;
  let colMap = [];        // mapping index TH -> fieldKey / '__total' / '__actions'
  let thElems = [];       // cache TH untuk indikator

  // Peta meta type per key (untuk pembanding)
  const fieldMeta = {};
  for (const f of fields) fieldMeta[f.key] = (f.type || 'text');

  // ---------- Tooltip helper ----------
  function tipTextFor(key) {
    if (!key || key === '__actions') return '';
    if (sortKey === key) {
      if (sortDir === 'asc')  return 'Urut naik ▲ (klik: turun ▼, klik lagi: reset ↕)';
      if (sortDir === 'desc') return 'Urut turun ▼ (klik: reset ↕)';
    }
    return 'Klik untuk urut naik ▲';
  }

  // ---------- Sorting header setup ----------
  function initHeaderSorting() {
    const thead = table.querySelector('thead');
    const row = thead?.querySelector('tr');
    if (!row) return; // tidak ada header; lewati

    // Map kolom: semua fields -> (opsional) Total -> Actions
    colMap = [...fields.map(f => f.key)];
    if (includeTotals) colMap.push('__total');
    colMap.push('__actions');

    const ths = Array.from(row.children);
    thElems = ths;

    ths.forEach((th, idx) => {
      const key = colMap[idx];

      // Kolom non-sortable (Actions) / tidak terpetakan
      if (!key || key === '__actions') {
        th.classList.remove('sortable', 'active');
        th.removeAttribute('aria-sort');
        const ex = th.querySelector('.sort-indicator'); if (ex) ex.remove();
        th.removeAttribute('data-tip');
        return;
      }

      th.classList.add('sortable');
      th.setAttribute('aria-sort', 'none');

      // Tambahkan indikator ikon (↕ saat none)
      let ind = th.querySelector('.sort-indicator');
      if (!ind) {
        ind = document.createElement('span');
        ind.className = 'sort-indicator';
        th.appendChild(ind);
      }
      ind.textContent = '↕';

      // Tooltip awal
      th.setAttribute('data-tip', tipTextFor(key));

      // Click handler: ASC → DESC → NONE
      th.addEventListener('click', () => {
        if (sortKey === key) {
          if (sortDir === 'asc') {
            sortDir = 'desc';
          } else if (sortDir === 'desc') {
            sortKey = null;       // reset ke NONE
            sortDir = 'asc';      // default klik berikutnya
          } else {
            sortDir = 'asc';
          }
        } else {
          sortKey = key;
          sortDir = 'asc';
        }
        updateHeaderSortIndicators();
        applyFilterAndPaginate();
      });
    });

    headerInitDone = true;
  }

  function updateHeaderSortIndicators() {
    if (!thElems.length) return;

    thElems.forEach((th, idx) => {
      const key = colMap[idx];
      const ind = th.querySelector('.sort-indicator');

      // Non-sortable
      if (!key || key === '__actions') {
        th.removeAttribute('aria-sort');
        th.classList.remove('active');
        if (ind) ind.textContent = '';
        th.removeAttribute('data-tip');
        return;
      }

      const isActive = (sortKey !== null && key === sortKey);

      if (!isActive) {
        // NONE atau kolom lain yang tidak aktif
        th.classList.remove('active');
        th.setAttribute('aria-sort', 'none');
        if (ind) ind.textContent = '↕';
        th.setAttribute('data-tip', tipTextFor(key));
        return;
      }

      // Aktif: ▲ / ▼ sesuai arah
      th.classList.add('active');
      if (sortDir === 'asc') {
        th.setAttribute('aria-sort', 'ascending');
        if (ind) ind.textContent = '▲';
      } else {
        th.setAttribute('aria-sort', 'descending');
        if (ind) ind.textContent = '▼';
      }
      th.setAttribute('data-tip', tipTextFor(key));
    });
  }

  function getSortValue(snap, key) {
    const data = snap.data() || {};
    if (key === '__total') {
      if (!includeTotals) return null;
      const t = computeTotals(data);
      const n = Number(t);
      return Number.isFinite(n) ? n : (t ?? '');
    }
    const type = fieldMeta[key] || 'text';
    const v = data[key];
    if (v === undefined || v === null) return '';
    if (type === 'number') {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    // 'date' diasumsikan string "YYYY-MM-DD" -> leksikal sudah benar
    return String(v).toLowerCase();
  }

  function applySort() {
    if (!sortKey) return; // NONE: pertahankan urutan default snapshot Firestore
    const dir = (sortDir === 'asc') ? 1 : -1;
    const cmp = (a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va === vb) return 0;
      if (va === '' || va === null) return (dir === 1 ? 1 : -1); // kosong di bawah saat asc
      if (vb === '' || vb === null) return (dir === 1 ? -1 : 1);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    };
    filteredDocs = filteredDocs.slice().sort(cmp);
  }

  function setLatestDocs(docs) {
    latestDocs = docs;
    currentPage = 1;
    if (!headerInitDone) initHeaderSorting();
    updateHeaderSortIndicators(); // pastikan ikon/tooltip sesuai state
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

    // Sorting setelah filter (atau NONE jika sortKey null)
    applySort();

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
    // Window numerik
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

  // ---------- Render baris tabel ----------
  function renderRows(docArray) {
    tbody.innerHTML = "";
    const can = canWrite();

    for (const d of docArray) {
      const data = d.data();
      const tr = document.createElement("tr");

      // Kolom data sesuai urutan fields
      for (const f of fields) {
        const td = document.createElement("td");
        const val = data?.[f.key] ?? "";
        td.textContent = (f.type === "number") ? Number(val || 0) : String(val ?? "");
        tr.appendChild(td);
      }

      // Kolom Total (opsional)
      if (includeTotals) {
        const tdT = document.createElement("td");
        tdT.textContent = computeTotals(data);
        tr.appendChild(tdT);
      }

      // Kolom Aksi
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
    modalTitle.textContent = "Add New Data";
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
    if (!validateForm()) return; // tahan submit jika tidak valid
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

  // Search & Page length
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
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Gagal memuat: " + src));
      document.head.appendChild(s);
    });
  }
  function ensureSheetJS() {
    return new Promise(async (resolve, reject) => {
      if (window.XLSX) return resolve();
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

    // Urutan default dari server: createdAt desc
    const q = query(collection(db, collectionName), orderBy("createdAt", "desc"));
    onSnapshot(
      q,
      (snap) => setLatestDocs(snap.docs),
      (err) => console.error("[stock-page-modal] snapshot error:", err)
    );
  });
}
