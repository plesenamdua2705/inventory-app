// functions/index.js
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Cek role admin pada pemanggil
async function requireAdmin(context) {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Harus login.');
  const snap = await db.collection('users').doc(context.auth.uid).get();
  const role = snap.exists ? snap.data().role : 'viewer';
  if (role !== 'admin') throw new HttpsError('permission-denied', 'Admin only.');
}

// Set region Jakarta untuk latensi rendah
const region = { region: 'asia-southeast2' };

exports.adminListUsers = onCall(region, async (req) => {
  await requireAdmin(req);
  const list = await admin.auth().listUsers(1000);
  const fsUsersSnap = await db.collection('users').get();
  const roles = {};
  fsUsersSnap.forEach(d => (roles[d.id] = d.data()));

  return list.users.map(u => ({
    uid: u.uid,
    email: u.email || '',
    displayName: u.displayName || '',
    disabled: !!u.disabled,
    creationTime: u.metadata?.creationTime || '',
    lastSignInTime: u.metadata?.lastSignInTime || '',
    role: roles[u.uid]?.role || 'viewer'
  }));
});

exports.adminCreateUser = onCall(region, async (req) => {
  await requireAdmin(req);
  const { email, displayName = '', role = 'viewer' } = req.data || {};
  if (!email) throw new HttpsError('invalid-argument', 'Email wajib.');
  if (!['admin','contributor','viewer'].includes(role))
    throw new HttpsError('invalid-argument', 'Role tidak valid.');

  const user = await admin.auth().createUser({ email, displayName, disabled: false });

  await db.collection('users').doc(user.uid).set({
    email, displayName, role, disabled: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: req.auth.uid
  }, { merge: true });

  await admin.auth().setCustomUserClaims(user.uid, { role });
  return { uid: user.uid };
});

exports.adminUpdateUser = onCall(region, async (req) => {
  await requireAdmin(req);
  const { uid, role, disabled, displayName } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid wajib.');

  const updatesAuth = {};
  const updatesFs = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  if (typeof disabled === 'boolean') {
    updatesAuth.disabled = disabled;
    updatesFs.disabled = disabled;
  }
  if (typeof displayName === 'string') {
    updatesAuth.displayName = displayName;
    updatesFs.displayName = displayName;
  }
  if (role) {
    if (!['admin','contributor','viewer'].includes(role))
      throw new HttpsError('invalid-argument', 'Role tidak valid.');
    updatesFs.role = role;
    await admin.auth().setCustomUserClaims(uid, { role });
  }

  if (Object.keys(updatesAuth).length) await admin.auth().updateUser(uid, updatesAuth);
  if (Object.keys(updatesFs).length) await db.collection('users').doc(uid).set(updatesFs, { merge: true });
  return { ok: true };
});

exports.adminDeleteUser = onCall(region, async (req) => {
  await requireAdmin(req);
  const { uid } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid wajib.');
  await admin.auth().deleteUser(uid);
  await db.collection('users').doc(uid).delete().catch(() => {});
  return { ok: true };
});
