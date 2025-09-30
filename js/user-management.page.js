// /js/user-management.page.js
// Halaman: user.html
// Fitur: List users (Firestore), Add (secondary app), Edit Role (Edit->Save/Cancel), Reset Password, Soft Delete
// Ketergantungan: /js/firebase-init.js harus export { app, auth, db }

'use strict';

/* =========================
 * 0) KONFIG SELECTOR (ubah jika ID di HTML berbeda)
 * ========================= */
const UI = {
  btnAdd:        '#btnAddUser',
  modal:         '#addUserModal',
  btnClose1:     '#btnCloseModal',
  btnClose2:     '#btnCloseModal2',
  formAdd:       '#addUserForm',
  table:         '#userTable',

};

/* =========================
 * 1) IMPORTS
 * ========================= */
import { app, auth, db } from './firebase-init.js';

import { initializeApp, deleteApp, getApps } 
  from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';

import { 
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  updateProfile, signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';

import {
  collection, doc, getDoc, setDoc, updateDoc, writeBatch, onSnapshot,
  serverTimestamp, query, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';

/* =========================
 * 2) UTIL DOM
 * ========================= */
const $ = (sel, parent=document) => parent.querySelector(sel);

function show(el) { if (!el) return; el.classList?.remove(UI.hiddenClass); el.style.display = 'block'; el.setAttribute('aria-hidden', 'false'); }
function hide(el) { if (!el) return; el.classList?.add(UI.hiddenClass);  el.style.display = 'none'; }

const fmt = (ts) => { try { return ts?.toDate ? ts.toDate().toLocaleString() : '-'; } catch { return '-'; } };

/* =========================
 * 3) RENDER TABLE
 * ========================= */
function renderRow(u) {
  const tr = document.createElement('tr');
  const role = u.role || 'viewer';
  const statusText = u.disabled ? 'Disabled' : 'Enabled';

  tr.innerHTML = `
    <td>${u.email ?? '-'}</td>
    <td>${u.displayName ?? '-'}</td>
    <td class="col-role" data-uid="${u.id}">
      <span class="role-text">${role}</span>
    </td>
    <td class="status" data-uid="${u.id}">${statusText}</td>
    <td>${fmt(u.createdAt)}</td>
    <td>${fmt(u.lastSignInTime)}</td>
    <td>
      <button class="btn-edit"   data-uid="${u.id}">Edit</button>
      <button class="btn-reset"  data-email="${u.email}">Reset Password</button>
      <button class="btn-delete" data-uid="${u.id}">Delete</button>
    </td>
  `;
  return tr;
}

function enterEditRole(cell, uid, currentRole) {
  if (!cell || cell.dataset.editing === 'true') return;
  cell.dataset.editing = 'true';
  cell.innerHTML = `
    <select class="role-select" data-uid="${uid}" data-prev="${currentRole}">
      <option value="viewer" ${currentRole==='viewer'?'selected':''}>Viewer</option>
      <option value="contributor" ${currentRole==='contributor'?'selected':''}>Contributor</option>
      <option value="admin" ${currentRole==='admin'?'selected':''}>Admin</option>
    </select>
    <button class="btn-save"   data-uid="${uid}">Save</button>
    <button class="btn-cancel" data-uid="${uid}">Cancel</button>
  `;
}

function exitEditRole(cell, newRoleText) {
  if (!cell) return;
  cell.dataset.editing = 'false';
  cell.innerHTML = `<span class="role-text">${newRoleText}</span>`;
}

/* =========================
 * 4) SECONDARY APP (untuk Add User tanpa logout admin)
 * ========================= */
const SECONDARY_NAME = 'SecondaryAuth';

async function getFreshSecondaryApp() {
  const existing = getApps().find(a => a.name === SECONDARY_NAME);
  if (existing) { try { await deleteApp(existing); } catch {} }
  const secondary = initializeApp(app.options, SECONDARY_NAME);
  return { secondary, secondaryAuth: getAuth(secondary) };
}

/* =========================
 * 5) MAIN
 * ========================= */
export function initUserManagementPage() {
  const btnAdd   = $(UI.btnAdd);
  const modal    = $(UI.modal);
  const btnClose = $(UI.btnClose1) || $(UI.btnClose2);
  const form     = $(UI.formAdd);
  const table    = $(UI.table);
  const tbody    = table?.querySelector('tbody');

  if (!table || !tbody) {
    console.error('Tabel #userTable atau <tbody> tidak ditemukan. Pastikan sesuai ID kontrak.');
    return;
  }

  // Open/Close modal
  btnAdd?.addEventListener('click', () => show(modal));
  btnClose?.addEventListener('click', () => hide(modal));

  // Auth guard minimal (redirect ke login jika belum login)
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'login_main.html'; return; }

    // (Opsional) cek dokumen user login (selaras rules Mas)
    try { await getDoc(doc(db, 'users', user.uid)); } catch {}

    // LIST: rules Mas umumnya hanya admin boleh list users -> jika error, tampilkan pesan
    const qUsers = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    onSnapshot(qUsers, {
      next: (snap) => {
        tbody.innerHTML = '';
        snap.forEach(d => {
          const data = d.data();
          if (data.deletedAt) return; // sembunyikan yang soft-deleted
          tbody.appendChild(renderRow({ id: d.id, ...data }));
        });
      },
      error: (err) => {
        console.warn('Gagal list users:', err?.message || err);
        tbody.innerHTML = '<tr><td colspan="7">Tidak punya izin melihat daftar users.</td></tr>';
      }
    });

    // ADD USER (secondary app)
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email       = form.email?.value?.trim();
      const password    = form.password?.value;
      const displayName = form.displayName?.value?.trim();
      const role        = form.querySelector('input[name="role"]:checked')?.value || 'viewer';

      if (!email || !password) { alert('Email & password wajib diisi'); return; }

      let secondary, secondaryAuth;
      try {
        ({ secondary, secondaryAuth } = await getFreshSecondaryApp());

        // 1) Create Auth di secondary (sesi admin utama aman)
        const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const newUser = cred.user;

        // 2) Set displayName (opsional)
        if (displayName) { await updateProfile(newUser, { displayName }); }

        // 3) Buat dokumen users/{uid}
        const batch = writeBatch(db);
        batch.set(doc(db, 'users', newUser.uid), {
          email,
          displayName: displayName || '',
          role,
          disabled: false,
          createdAt: serverTimestamp()
        }, { merge: true });
        await batch.commit();

        // 4) Cleanup secondary
        await signOut(secondaryAuth);
        try { await deleteApp(secondary); } catch {}

        alert('User berhasil dibuat. Minta user login dan segera ganti password.');
        form.reset(); hide(modal);
      } catch (err) {
        console.error(err);
        alert(`Gagal membuat user: ${err?.code || err?.message || err}`);
        try { if (secondaryAuth) await signOut(secondaryAuth); } catch {}
        try { if (secondary) await deleteApp(secondary); } catch {}
      }
    });

    // ACTIONS di tabel
    table?.addEventListener('click', async (e) => {
      const t = e.target;

      // Edit -> masuk mode edit role
      if (t.classList.contains('btn-edit')) {
        const uid  = t.dataset.uid;
        const cell = t.closest('tr')?.querySelector('.col-role');
        const cur  = cell?.querySelector('.role-text')?.textContent?.trim() || 'viewer';
        enterEditRole(cell, uid, cur);
      }

      // Save role
      if (t.classList.contains('btn-save')) {
        const uid  = t.dataset.uid;
        const row  = t.closest('tr');
        const cell = row?.querySelector('.col-role');
        const sel  = cell?.querySelector('.role-select');
        const newRole = sel?.value || 'viewer';
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, 'users', uid), { role: newRole });
          await batch.commit();
          exitEditRole(cell, newRole);
          alert('Role berhasil disimpan.');
        } catch (err) {
          console.error(err);
          alert('Gagal menyimpan role. Cek Rules/izin.');
        }
      }

      // Cancel edit role
      if (t.classList.contains('btn-cancel')) {
        const row  = t.closest('tr');
        const cell = row?.querySelector('.col-role');
        const prev = cell?.querySelector('.role-select')?.getAttribute('data-prev') 
                  || cell?.querySelector('.role-select')?.value 
                  || 'viewer';
        exitEditRole(cell, prev);
      }

      // Reset Password
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

      // Delete (soft)
      if (t.classList.contains('btn-delete')) {
        const uid = t.dataset.uid;
        if (!confirm('Delete user ini? (Soft delete: akun Auth TIDAK terhapus)')) return;
        try {
          await updateDoc(doc(db, 'users', uid), { deletedAt: serverTimestamp() });
          const row = t.closest('tr'); row?.parentNode?.removeChild(row);
        } catch (err) {
          console.error(err);
          alert('Gagal menghapus user.');
        }
      }
    });
  });
}
