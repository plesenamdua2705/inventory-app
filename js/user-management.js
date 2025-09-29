// /js/user-management.js
// Penting: pastikan /js/firebase-init.js</script> sudah ter-include lebih dulu.

'use strict';

/* =========================
 * 1) Import dari init yang sudah ada
 * ========================= */
import { app, auth, db } from './firebase-init.js';

// Firebase SDK CDN modular
import { initializeApp, deleteApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  updateProfile, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, updateDoc,
  writeBatch, onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =========================
 * 2) Konstanta selector & util DOM
 * ========================= */
const UI = {
  btnAdd:            '#btnAddUser, [data-action="add-user"]',
  modal:             '#addUserModal',
  btnCloseModal:     '#btnCloseModal',
  btnCloseModal2:    '#btnCloseModal2',
  formAdd:           '#addUserForm',
  table:             '#userTable',
  tableBody:         '#userTable tbody',
  hiddenClass:       'hidden'      // sesuaikan jika CSS Mas memakai kelas lain (mis. 'd-none', 'is-hidden')
};

const $  = (sel, parent=document) => parent.querySelector(sel);
const $$ = (sel, parent=document) => Array.from(parent.querySelectorAll(sel));

const Modal = {
  get el() { return $(UI.modal); },
  show() {
    const el = this.el; if (!el) return;
    try { el.classList.remove(UI.hiddenClass); } catch {}
    el.style.display = 'block';
  },
  hide() {
    const el = this.el; if (!el) return;
    try { el.classList.add(UI.hiddenClass); } catch {}
    el.style.display = 'none';
  }
};

const go = (href) => { window.location.href = href; };

/* =========================
 * 3) Guard: hanya admin
 *    (roles/{uid}.role === 'admin')
 * ========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) { go('login_main.html'); return; }
  try {
    const rSnap = await getDoc(doc(db, 'roles', user.uid));
    const role = rSnap.exists() ? rSnap.data().role : null;
    if (role !== 'admin') { go('index.html'); return; }

    // Pastikan DOM siap sebelum mengikat event
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', initPage, { once: true });
    } else {
      initPage();
    }
  } catch (err) {
    console.error(err);
    alert('Gagal memuat hak akses.');
    go('index.html');
  }
});

/* =========================
 * 4) Inisialisasi halaman
 * ========================= */
function initPage() {
  const btnAdd    = $(UI.btnAdd);
  const form      = $(UI.formAdd);
  const btnClose  = $(UI.btnCloseModal);
  const btnClose2 = $(UI.btnCloseModal2);
  const table     = $(UI.table);
  const tbody     = $(UI.tableBody) || (table ? table.appendChild(document.createElement('tbody')) : null);

  // Binding modal open/close
  btnAdd?.addEventListener('click', () => Modal.show());
  btnClose?.addEventListener('click', () => Modal.hide());
  btnClose2?.addEventListener('click', () => Modal.hide());

  // Realtime: daftar users (skip yang soft-deleted)
  const qUsers = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
  onSnapshot(qUsers, (snap) => {
    if (!tbody) return;
    tbody.innerHTML = '';
    snap.forEach((d) => {
      const u = { id: d.id, ...d.data() };
      if (u.deletedAt) return; // hide soft deleted

      const tr = document.createElement('tr');
      const role = u.role || 'viewer';

      // Kolom Role: dropdown
      const roleSelect = `
        <select class="role-select" data-uid="${u.id}" data-prev="${role}">
          <option value="viewer" ${role==='viewer'?'selected':''}>Viewer</option>
          <option value="contributor" ${role==='contributor'?'selected':''}>Contributor</option>
          <option value="admin" ${role==='admin'?'selected':''}>Admin</option>
        </select>
      `;

      tr.innerHTML = `
        <td>${u.email ?? '-'}</td>
        <td>${u.displayName ?? '-'}</td>
        <td>${roleSelect}</td>
        <td>${u.createdAt?.toDate ? u.createdAt.toDate().toLocaleString() : '-'}</td>
        <td>
          <button class="btn-reset"  data-email="${u.email}">Send Reset Password</button>
          <button class="btn-toggle" data-uid="${u.id}" data-disabled="loading">Loading...</button>
          <button class="btn-delete" data-uid="${u.id}">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);

      // Set label Disable/Enable sesuai roles/{uid}.disabled
      setToggleButtonState(u.id, tr.querySelector('.btn-toggle'));
    });
  });

  // Ubah Role (roles/{uid}.role + mirror users/{uid}.role)
  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (!el.matches('.role-select')) return;
    const uid  = el.dataset.uid;
    const role = el.value;
    const prev = el.dataset.prev || 'viewer';
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'roles', uid), { role }, { merge: true });
      batch.set(doc(db, 'users', uid), { role }, { merge: true });
      await batch.commit();
      el.dataset.prev = role;
    } catch (err) {
      console.error(err);
      alert('Gagal update role. Cek Rules/izin.');
      el.value = prev; // rollback UI
    }
  });

  // Actions: Reset | Disable/Enable | Soft Delete
  tbody?.addEventListener('click', async (e) => {
    const t = e.target;

    // Send Reset Password
    if (t.classList.contains('btn-reset')) {
      const email = t.dataset.email;
      try {
        await sendPasswordResetEmail(auth, email);
        alert('Email reset password dikirim.');
      } catch (err) {
        console.error(err);
        alert('Gagal mengirim reset password.');
      }
    }

    // Toggle Disable/Enable
    if (t.classList.contains('btn-toggle')) {
      const uid = t.dataset.uid;
      const current = t.dataset.disabled;
      let disabled = (current === 'true');
      if (current === 'loading') {
        const rs = await getDoc(doc(db, 'roles', uid));
        disabled = !!(rs.exists() && rs.data().disabled);
      }
      const nextDisabled = !disabled;
      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'roles', uid), { disabled: nextDisabled }, { merge: true });
        batch.set(doc(db, 'users', uid), { disabled: nextDisabled }, { merge: true });
        await batch.commit();
        t.textContent = nextDisabled ? 'Enable' : 'Disable';
        t.dataset.disabled = String(nextDisabled);
        alert(nextDisabled ? 'User di-disable (akses data diblokir Rules).' : 'User di-enable.');
      } catch (err) {
        console.error(err);
        alert('Gagal mengubah status user.');
      }
    }

    // Soft Delete (Firestore saja; akun Auth tidak terhapus)
    if (t.classList.contains('btn-delete')) {
      const uid = t.dataset.uid;
      if (!confirm('Delete user ini? (Soft delete: akun Auth TIDAK terhapus)')) return;
      try {
        await updateDoc(doc(db, 'users', uid), { deletedAt: serverTimestamp() });
        await setDoc(doc(db, 'roles', uid), { deleted: true }, { merge: true });
        alert('User dihapus (soft delete).');
      } catch (err) {
        console.error(err);
        alert('Gagal menghapus user.');
      }
    }
  });

  // Submit Add New User (secondary app agar admin tidak logout)
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email       = form.email?.value?.trim();
    const password    = form.password?.value;
    const displayName = form.displayName?.value?.trim();
    const roleRadio   = form.querySelector('input[name="role"]:checked');
    const role        = roleRadio ? roleRadio.value : 'viewer';

    if (!email || !password) return alert('Email & password wajib diisi');

    // Buat Secondary App dari opsi app utama (tidak perlu export config)
    const secondaryName = 'SecondaryAuth';
    // Hindari duplicate named-app
    const existing = getApps().find(a => a.name === secondaryName);
    if (existing) await deleteApp(existing);

    const secondaryApp  = initializeApp(app.options, secondaryName);
    const secondaryAuth = getAuth(secondaryApp);

    try {
      // create akan auto sign-in DI secondaryAuth (bukan sesi admin)
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      const newUser = cred.user;

      if (displayName) { await updateProfile(newUser, { displayName }); }

      // Tulis roles & users
      const batch = writeBatch(db);
      batch.set(doc(db, 'roles', newUser.uid), { role, disabled: false }, { merge: true });
      batch.set(doc(db, 'users', newUser.uid), {
        email, displayName: displayName || '', role, createdAt: serverTimestamp(), disabled: false
      }, { merge: true });
      await batch.commit();

      // Bersihkan secondary
      await signOut(secondaryAuth);
      await deleteApp(secondaryApp);

      alert('User dibuat. Minta user login dan segera ganti password.');
      form.reset();
      Modal.hide();
    } catch (err) {
      console.error(err);
      alert(`Gagal membuat user: ${err?.code || err?.message || err}`);
      try { await signOut(secondaryAuth); await deleteApp(secondaryApp); } catch {}
    }
  });
}

/* =========================
 * 5) Util: set label disable/enable
 * ========================= */
async function setToggleButtonState(uid, buttonEl) {
  if (!buttonEl) return;
  try {
    const rs = await getDoc(doc(db, 'roles', uid));
    const disabled = !!(rs.exists() && rs.data().disabled);
    buttonEl.textContent = disabled ? 'Enable' : 'Disable';
    buttonEl.dataset.disabled = String(disabled);
  } catch {
    buttonEl.textContent = 'Disable';
    buttonEl.dataset.disabled = 'false';
  }
}
