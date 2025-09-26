// /js/stock-page.js
<script type="module">
// Import
import { auth, db } from "./firebase-init.js";
import {
  collection, addDoc, serverTimestamp, query, orderBy,
  onSnapshot, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

/**
 * Inisialisasi halaman stok generik.
 * @param {Object} cfg
 * @param {string} cfg.collectionName  // 'office' | 'ppe' | 'souvenir' | 'supplier'
 * @param {string} [cfg.tableSelector] // selector tabel target (default: tabel pertama di halaman)
 * @param {Array}  cfg.fields          // [{ key, label, type, required }]
 * @param {string} [cfg.loginUrl='/login_main.html']
 * @param {boolean}[cfg.enableRealtime=true]
 * @param {function}[cfg.computeTotals] // (docData) => number|string
 */
export function initStockPage(cfg) {
  const {
    collectionName,
    tableSelector,
    fields,
    loginUrl = "/login_main.html",
    enableRealtime = true,
    computeTotals,
  } = cfg;

  if (!collectionName || !fields || !Array.isArray(fields)) {
    console.error("[stock-page] Konfigurasi tidak valid.");
    return;
  }

  // --- Ambil referensi tabel ---
  let table = tableSelector ? document.querySelector(tableSelector) : document.querySelector("table");
  if (!table) {
    console.warn("[stock-page] Tabel target tidak ditemukan. Pastikan markup <table> ada di halaman.");
    return;
  }

  // Pastikan ada <tbody>
  let tbody = table.querySelector("tbody");
  if (!tbody) {
    tbody = document.createElement("tbody");
    table.appendChild(tbody);
  }

  // Sisipkan kontainer form di atas tabel
  const formRoot = document.createElement("div");
  formRoot.id = "stock-form-root";
  formRoot.style.margin = "10px 0";
  table.parentNode.insertBefore(formRoot, table);

  // State role user
  let currentRole = "viewer";

  // Render form Add New
  function renderForm() {
    const canWrite = currentRole === "admin" || currentRole === "contributor";
    if (!canWrite) {
      formRoot.innerHTML = "";
      return;
    }

    const formHtml = `
      <form id="stockForm" class="border rounded p-3 bg-light">
        <div class="row g-3">
          ${fields.map(f => {
            const required = f.required ? "required" : "";
            const id = `sp_${f.key}`;
            const type = f.type || "text";
            return `
              <div class="col-md-3">
                <label for="${id}" class="form-label">${f.label}${f.required ? " *" : ""}</label>
                <input id="${id}" name="${id}" type="${type}" class="form-control" ${required}>
              </div>
            `;
          }).join("")}
        </div>
        <div class="mt-3 d-flex gap-2">
          <button class="btn btn-primary" type="submit">Save</button>
          <button class="btn btn-secondary" type="button" id="btnReset">Reset</button>
        </div>
        <div id="stockMsg" class="mt-2 small" style="display:none"></div>
      </form>
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
        if (f.type === "number") val = Number(val || 0);
        else val = (val || "").trim();
        data[f.key] = val;
      }

      try {
        data.createdAt = serverTimestamp();
        data.updatedAt = serverTimestamp();
        data.createdBy = auth.currentUser?.uid || null;

        await addDoc(collection(db, collectionName), data);
        msg.textContent = "Data berhasil ditambahkan.";
        msg.style.display = "block";
        msg.className = "mt-2 small text-success";
        form.reset();
      } catch (err) {
        console.error(err);
        msg.textContent = "Gagal menambahkan data.";
        msg.style.display = "block";
        msg.className = "mt-2 small text-danger";
      }
    });
  }

  // Render baris tabel
  function renderRows(docs) {
    tbody.innerHTML = "";
    for (const d of docs) {
      const data = d.data();
      const tr = document.createElement("tr");

      // Kolom sesuai urutan fields
      for (const f of fields) {
        const td = document.createElement("td");
        let val = data[f.key];
        if (f.type === "number") val = (val ?? 0);
        td.textContent = (val ?? "").toString();
        tr.appendChild(td);
      }

      // Kolom Total (opsional)
      if (typeof computeTotals === "function") {
        const tdTotal = document.createElement("td");
        tdTotal.textContent = computeTotals(data);
        tr.appendChild(tdTotal);
      }

      // Kolom aksi (placeholder)
      const tdAct = document.createElement("td");
      tdAct.textContent = ""; // nanti bisa diisi edit/delete
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }
  }

  // Auth + Realtime
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
      onSnapshot(q,
        (snap) => renderRows(snap.docs),
        (err) => console.error("[stock-page] snapshot error:", err)
      );
    }
  });
}

