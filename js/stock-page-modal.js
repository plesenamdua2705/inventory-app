// /js/stock-page-modal.js //
<script type="module">
import { auth, db } from "./firebase-init.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc,
  serverTimestamp, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

/**
 * Inisialisasi halaman stok dengan modal (create/edit) + delete.
 * @param {Object} cfg
 * @param {string} cfg.collectionName
 * @param {string} cfg.tableSelector
 * @param {Array}  cfg.fields
 * @param {Function} [cfg.computeTotals]
 * @param {string} [cfg.loginUrl='/login_main.html']
 */
export function initStockPageModal(cfg) {
  const {
    collectionName, tableSelector, fields, computeTotals,
    loginUrl = "/login_main.html"
  } = cfg;

  if (!collectionName || !tableSelector || !fields || !fields.length) {
    console.error("[stock-page-modal] konfigurasi tidak lengkap.");
    return;
  }

  // ====== Ambil elemen kunci ======
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

  // Tombol Add
  const btnAdd = document.getElementById("btnAddNew");
  if (!btnAdd) {
    console.warn("[stock-page-modal] Tombol #btnAddNew tidak ditemukan. Tambahkan tombol Add di halaman.");
  }

  // ====== State role & write access ======
  let role = "viewer";
  const canWrite = () => role === "admin" || role === "contributor";

  // ====== Modal dinamis (tanpa Bootstrap JS) ======
  const MODAL_ID = `stockModal-${collectionName}`;
  let modalEl = document.getElementById(MODAL_ID);
  if (!modalEl) {
    modalEl = document.createElement("div");
    modalEl.id = MODAL_ID;
    modalEl.className = "modal fade";
    modalEl.setAttribute("tabindex", "-1");
    modalEl.setAttribute("aria-hidden", "true");
    modalEl.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h6 class="modal-title">Add New</h6>
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

  const modalTitle = modalEl.querySelector(".modal-title");
  const formEl = modalEl.querySelector("form");
  const msgEl  = modalEl.querySelector(`#${MODAL_ID}-msg`);
  const btnClose  = modalEl.querySelector('[data-spm="close"]');
  const btnCancel = modalEl.querySelector('[data-spm="cancel"]');
  const btnSave   = modalEl.querySelector('[data-spm="save"]');

  let mode = "create"; // 'create' | 'edit'
  let editingId = null;

  // Backdrop & show/hide (fallback jika Bootstrap JS tidak ada)
  let backdropEl = null;
  function showModal() {
    modalEl.style.display = "block";
    modalEl.classList.add("show");
    document.body.classList.add("modal-open");
    backdropEl = document.createElement("div");
    backdropEl.className = "modal-backdrop fade show";
    document.body.appendChild(backdropEl);
    setTimeout(() => modalEl.focus(), 0);
  }
  function hideModal() {
    modalEl.classList.remove("show");
    modalEl.style.display = "none";
    document.body.classList.remove("modal-open");
    if (backdropEl && backdropEl.parentNode) backdropEl.parentNode.removeChild(backdropEl);
    backdropEl = null;
    msgEl.style.display = "none";
  }
  btnClose.addEventListener("click", hideModal);
  btnCancel.addEventListener("click", hideModal);
  modalEl.addEventListener("click", (e) => { if (e.target === modalEl) hideModal(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && modalEl.classList.contains("show")) hideModal(); });

  // Render field ke form
  function buildForm(data = {}) {
    formEl.innerHTML = `
      <div class="row g-3">
        ${fields.map(f => {
          const id = `${MODAL_ID}-${f.key}`;
          const required = f.required ? "required" : "";
          const type = f.type || "text";
          const val = data?.[f.key] ?? "";
          return `
            <div class="col-md-4">
              <label for="${id}" class="form-label">${f.label}${f.required ? " *" : ""}</label>
              <input id="${id}" name="${id}" type="${type}" class="form-control" value="${val}" ${required}>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function readFormValues() {
    const out = {};
    for (const f of fields) {
      const id = `${MODAL_ID}-${f.key}`;
      const el = document.getElementById(id);
      if (!el) continue;
      let v = el.value;
      if (f.type === "number") v = Number(v || 0);
      else v = (v || "").trim();
      out[f.key] = v;
    }
    return out;
  }

  // ====== CRUD ======
  async function createDoc() {
    const data = readFormValues();
    data.createdAt = serverTimestamp();
    data.updatedAt = serverTimestamp();
    data.createdBy = auth.currentUser?.uid || null;
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

  // ====== Tabel & Actions ======
  function renderRows(snapshotDocs) {
    tbody.innerHTML = "";
    const can = canWrite();

    for (const d of snapshotDocs) {
      const data = d.data();
      const tr = document.createElement("tr");

      // Kolom berdasarkan fields
      for (const f of fields) {
        const td = document.createElement("td");
        const val = data?.[f.key] ?? "";
        td.textContent = (f.type === "number") ? Number(val || 0) : String(val ?? "");
        tr.appendChild(td);
      }

      // Total (opsional)
      if (typeof computeTotals === "function") {
        const tdT = document.createElement("td");
        tdT.textContent = computeTotals(data);
        tr.appendChild(tdT);
      }

      // Aksi
      const tdA = document.createElement("td");
      if (can) {
        const btnEdit = document.createElement("button");
        btnEdit.type = "button";
        btnEdit.title = "Edit";
        btnEdit.className = "btn btn-sm btn-outline-secondary me-1";
        btnEdit.textContent = "Edit";
        btnEdit.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openEdit(d.id, data);
        });

        const btnDel = document.createElement("button");
        btnDel.type = "button";
        btnDel.title = "Delete";
        btnDel.className = "btn btn-sm btn-outline-danger";
        btnDel.textContent = "Delete";
        btnDel.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!confirm("Hapus data ini?")) return;
          try {
            await deleteDocById(d.id);
          } catch (err) {
            console.error(err);
            alert("Gagal menghapus.");
          }
        });

        tdA.appendChild(btnEdit);
        tdA.appendChild(btnDel);
      }
      tr.appendChild(tdA);
      tbody.appendChild(tr);
    }
  }

  function openCreate() {
    mode = "create";
    editingId = null;
    modalTitle.textContent = "Add New";
    buildForm({});
    msgEl.style.display = "none";
    showModal();
  }
  function openEdit(id, data) {
    mode = "edit";
    editingId = id;
    modalTitle.textContent = "Edit Data";
    buildForm(data);
    msgEl.style.display = "none";
    showModal();
  }

  btnSave.addEventListener("click", async () => {
    msgEl.style.display = "none";
    try {
      if (mode === "create") await createDoc();
      else if (mode === "edit" && editingId) await updateDocById(editingId);
      hideModal();
    } catch (err) {
      console.error(err);
      msgEl.textContent = "Gagal menyimpan data.";
      msgEl.style.display = "block";
    }
  });

  // ====== Autentikasi + Realtime ======
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = loginUrl;
      return;
    }

    // Ambil role user dari users/{uid}
    try {
      const usSnap = await getDoc(doc(db, "users", user.uid));
      role = usSnap.exists() ? (usSnap.data()?.role || "viewer") : "viewer";
    } catch (e) {
      role = "viewer";
    }

    // Tampilkan/sembunyikan tombol Add
    if (btnAdd) {
      if (canWrite()) {
        btnAdd.style.display = "";
        btnAdd.onclick = (e) => { e.preventDefault(); openCreate(); };
      } else {
        btnAdd.style.display = "none";
      }
    }

    // Pasang listener realtime
    const q = query(collection(db, collectionName), orderBy("createdAt", "desc"));
    onSnapshot(q,
      (snap) => renderRows(snap.docs),
      (err) => console.error("[stock-page-modal] snapshot error:", err)
    );
  });
}
</script>

