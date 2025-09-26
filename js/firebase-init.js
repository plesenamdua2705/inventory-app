// /js/firebase-init.js
// Gunakan Modular SDK (CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getAuth /* setPersistence dipindah ke halaman login */ } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

// -- PASTIKAN CONFIG PERSIS DARI FIREBASE CONSOLE --
const firebaseConfig = {
  apiKey: "AIzaSyAyC23ke5IEIoz5FpS41OiT1wyBSKaRDVk",
  authDomain: "e-stock-ff767.firebaseapp.com",
  projectId: "e-stock-ff767",
  // Disarankan verifikasi storageBucket dari Console (biasanya .appspot.com):
  storageBucket: "e-stock-ff767.appspot.com",
  messagingSenderId: "158396302579",
  appId: "1:158396302579:web:1626da0203660ce9a3a386"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Util: pastikan dokumen user ada
export async function ensureUserDoc(user) {
  if (!user) return;
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: user.email ?? "",
      displayName: user.displayName ?? "",
      role: "viewer",       // default role
      disabled: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
}

// (Opsional) listener untuk debugging
// import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
// onAuthStateChanged(auth, (user) => { console.log('Auth:', !!user, user?.uid); });
