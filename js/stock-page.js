// /js/stock-page.js
import { auth, db } from "./firebase-init.js";
import {
  collection, addDoc, serverTimestamp, query, orderBy, onSnapshot, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

/**
 * Inisialisasi halaman stok generik.
 * @param {Object} cfg
 * @param {string} cfg.collectionName     - Nama koleksi Firestore (office|ppe|souvenir|supplier)
 * @param {string} [cfg.tableSelector]    - CSS selector tabel target (default: 'table' pertama di halaman)
 * @param {Array}  cfg.fields             - Daftar field untuk form & render tabel (urutan = kolom tabel)
 *   Contoh item field:
 *     { key:'materialNumber', label:'Material Number', type:'text', required:true }
 *     { key:'qtyIn', label:'Qty In', type:'number' }
 *     { key:'dateIn', label:'Date In', type:'date' }
 * @param {string} [cfg.loginUrl='/login_main.html']
 * @param {boolean} [cfg.enableRealtime=true]
 * @param {function} [cfg.computeTotals]  - (docData) => number | string untuk kolom Total Stock
 */
export function initStockPage(cfg) {
  const {
    collectionName,
    tableSelector,
    fields,
    loginUrl = "/login_main.html",
    enableRealtime = true,
    computeTotals
  } = cfg;

  if (!collectionName || !fields || !Array.isArray(fields)) {
    console.error("[stock-page] Konfigurasi tidak valid.");
    return;
  }

  // --- Ambil referensi tabel ---
  let table = null;
  if (tableSelector) {
    table = document.querySelector(tableSelector);
  } else {
    table = document.querySelector("table"); // fallback: tabel pertama
  }
  if (!table) {
    console.warn("[stock-page] Tabel target tidak ditemukan. Buat <table> di halaman.");
    return;
  }

  // Pastikan <tbody> ada
  let tbody = table.querySelector("tbody");
  if (!tbody) {
    tbody = document.createElement("tbody");
    table.appendChild(tbody);
  }

  // Sisipkan kontainer form tepat di atas tabel (tanpa sentuh CSS)
  const formRoot = document.createElement("div");
  formRoot.id = "stock-form-root";
  formRoot.style.margin = "10px 0";
  table.parentNode.insertBefore(formRoot, table);

  // State role user
  let currentRole = "viewer";

  // Render form Add New
  function renderForm() {
    // Tampilkan form hanya untuk contributor/admin
    const canWrite = currentRole === "admin" || currentRole === "contributor";
    if (!canWrite) {
      formRoot.innerHTML = ""; // viewer: tidak ada form
      return;
    }

    const formHtml = `
      <form id="stockForm" novalidate style="display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: .5rem;">
        ${fields.map(f => {
          const req = f.required ? "required" : "";
          const name = `sp_${f.key}`;
          const type = f.type || "text";
          return `
            <label style="display:flex;flex-direction:column;gap:4px;">
              <span>${f.label}${f.required ? " *" : ""}</span>
              <input id="${name}" name="${name}" type="${type}" ${req} />
            </label>
          `;
        }).join("")}
        <div style="align-self:end; display:flex; gap:.5rem;">
          <button id="btnSave" type="submit">Save</button>
          <button id="btnReset" type="button">Reset</button>
        </div>
      </form>
      <div id="stockMsg" role="status" style="display:none; margin-top:.25rem;"></div>
    `;
    formRoot.innerHTML = formHtml;

    const form = document.getElementById("stockForm");
    const msg  = document.getElementById("stockMsg");
    const btnReset = document.getElementById("btnReset");

    btnReset.addEventListener("click", () => form.reset());

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.style.display = "none";

      // Ambil nilai per field
      const data = {};
      for (const f of fields) {
        const el = document.getElementById(`sp_${f.key}`);
        if (!el) continue;
        let val = el.value;
        if (f.type === "number") {
          val = Number(val || 0);
        } else {
          val = (val || "").trim();
        }
        data[f.key] = val;
      }

      try {
        // catatan tambahan
        data.createdAt = serverTimestamp();
        data.updatedAt = serverTimestamp();
        data.createdBy = auth.currentUser?.uid || null;

        await addDoc(collection(db, collectionName), data);

        msg.textContent = "Data berhasil ditambahkan.";
        msg.style.display = "block";
        form.reset();
      } catch (err) {
        console.error(err);
        msg.textContent = "Gagal menambahkan data.";
        msg.style.display = "block";
      }
    });
  }

  // Render baris tabel dari dokumen
  function renderRows(docs) {
    tbody.innerHTML = "";
    for (const d of docs) {
      const data = d.data();
      const tr = document.createElement("tr");

      // Render kolom sesuai urutan fields
      for (const f of fields) {
        const td = document.createElement("td");
        let val = data[f.key];

        // Format tanggal sederhana (YYYY-MM-DD) tetap apa adanya
        if (f.type === "number") val = (val ?? 0);
        td.textContent = (val ?? "").toString();
        tr.appendChild(td);
      }

      // Kolom Total Stock (opsional)
      if (typeof computeTotals === "function") {
        const tdTotal = document.createElement("td");
        tdTotal.textContent = computeTotals(data);
        tr.appendChild(tdTotal);
      }

      // Kolom aksi (placeholder; bisa ditambah edit/delete nanti)
      const tdAct = document.createElement("td");
      tdAct.textContent = ""; // kosong dulu
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }
  }

  // Dapatkan role user & pasang realtime listener
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = loginUrl;
      return;
    }

    // Ambil role user dari /users/{uid}
    try {
      const us = await getDoc(doc(db, "users", user.uid));
      const udata = us.exists() ? us.data() : {};
      currentRole = udata?.role || "viewer";
    } catch (e) {
      console.warn("[stock-page] gagal membaca role user:", e);
    }

    renderForm();

    const q = query(collection(db, collectionName), orderBy("createdAt", "desc"));
    if (enableRealtime) {
      onSnapshot(q, (snap) => {
        renderRows(snap.docs);
      }, (err) => {
        console.error("[stock-page] snapshot error:", err);
      });
    } else {
      // fallback: sekali ambil (bisa ditambahkan kalau diperlukan)
    }
  });
}