// /js/auth-guard.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/**
 * Panggil guardPage({ allow: ['admin', 'contributor'] })
 * Opsi:
 *  - allow: string[] role yang diizinkan
 *  - redirectIfDenied: URL fallback jika role tidak diizinkan
 *  - loginPage: URL halaman login
 */
export function guardPage(
  options = { allow: ['viewer', 'contributor', 'admin'], redirectIfDenied: '/index.html', loginPage: '/login_main.html' }
) {
  const { allow, redirectIfDenied, loginPage } = options;

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = loginPage;
      return;
    }

    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      const data = userSnap.exists() ? userSnap.data() : {};
      const role = (data && data.role) ?? 'viewer';
      const disabled = !!data.disabled;

      if (disabled) {
        await signOut(auth);
        alert("Akun Anda dinonaktifkan. Silakan hubungi admin.");
        window.location.href = loginPage;
        return;
      }

      if (!allow.includes(role)) {
        alert("Anda tidak memiliki akses ke halaman ini.");
        window.location.href = redirectIfDenied;
      }
    } catch (err) {
      console.error("Guard error:", err);
      window.location.href = loginPage;
    }
  });
}


