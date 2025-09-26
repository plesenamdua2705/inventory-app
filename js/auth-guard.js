// /js/auth-guard.js
import { auth, db } from "./firebase-init.js"; // gunakan relative path
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/**
 * Contoh:
 * guardPage({ allow: ['admin', 'contributor'], redirectIfDenied: './index.html', loginPage: './login_main.html' })
 *
 * Opsi:
 * - allow: string[]   -> role yang diizinkan
 * - redirectIfDenied  -> URL fallback jika role tidak diizinkan
 * - loginPage         -> URL halaman login
 */
export function guardPage(
  options = { allow: ['viewer', 'contributor', 'admin'], redirectIfDenied: './index.html', loginPage: './login_main.html' }
) {
  const { allow, redirectIfDenied, loginPage } = options;
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = loginPage;
      return;
    }
    try {
      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      const data = snap.exists() ? snap.data() : {};
      const role = data?.role ?? 'viewer';
      const disabled = !!data?.disabled;

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

// (Opsional) cegah user terautentikasi mengakses halaman login
export function requireAnon(redirectTo = './index.html') {
  onAuthStateChanged(auth, (user) => {
    if (user) window.location.href = redirectTo;
  });
}
