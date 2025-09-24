// /js/firebase-init.js
// Gunakan modular SDK (CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

// --- MASUKKAN CONFIG DARI FIREBASE CONSOLE ---
const firebaseConfig = {
  apiKey: "AIzaSyAyC23ke5IEIoz5FpS41OiT1wyBSKaRDVk",
  authDomain: "e-stock-ff767.firebaseapp.com",
  projectId: "e-stock-ff767",
  storageBucket: "e-stock-ff767.firebasestorage.app",
  messagingSenderId: "158396302579",
  appId: "1:158396302579:web:1626da0203660ce9a3a386"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Persistensi login
await setPersistence(auth, browserLocalPersistence);

// Util: pastikan dokumen user ada
export async function ensureUserDoc(user) {
  if (!user) return;
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: user.email ?? "",
      displayName: user.displayName ?? "",
      role: "viewer",   // default role
      disabled: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
}

// Listener global (opsional, untuk debugging)
onAuthStateChanged(auth, async (user) => {
  if (user) await ensureUserDoc(user);
});


