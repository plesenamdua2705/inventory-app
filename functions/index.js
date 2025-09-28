// functions/index.js
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

async function requireAdmin(context) {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Harus login.');
  const snap = await db.collection('users').doc(context.auth.uid).get();
  const role = snap.exists ? snap.data().role : 'viewer';
  if (role !== 'admin') throw new HttpsError('permission-denied', 'Admin only.');
}

// Fungsi minimal: buat user + set role di Firestore + (opsional) klaim
exports.createUserAndInitRole = onCall({ region: 'asia-southeast2' }, async (req) => {
  await requireAdmin(req);

  const { email, displayName = '', role = 'viewer' } = req.data || {};
  if (!email) throw new HttpsError('invalid-argument', 'Email wajib.');
  if (!['admin', 'contributor', 'viewer'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Role tidak valid.');
  }

  // Cek apakah user sudah ada
  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (_) {
    userRecord = null; // email belum terdaftar
  }

  if (!userRecord) {
    // Buat user baru di Auth
    userRecord = await admin.auth().createUser({ email, displayName, disabled: false });
  } else {
    // Update displayName jika diinput
    if (displayName && userRecord.displayName !== displayName) {
      await admin.auth().updateUser(userRecord.uid, { displayName });
    }
  }

  // Simpan/merge profil & role di Firestore
  await db.collection('users').doc(userRecord.uid).set({
    email,
    displayName,
    role,
    disabled: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: req.auth.uid,
  }, { merge: true });

  // (Opsional) set custom claims (berguna jika kelak dipakai di Rules/cek token)
  await admin.auth().setCustomUserClaims(userRecord.uid, { role });

  // Catatan: pengiriman email reset password akan dilakukan dari client (user.html)
  // via sendPasswordResetEmail(auth, email). (Resmi didukung Web SDK)
  // https://firebase.google.com/docs/reference/js/v8/firebase.auth.Auth#sendpasswordresetemail

  return { uid: userRecord.uid, existed: !!userRecord.metadata?.creationTime && false };
});
