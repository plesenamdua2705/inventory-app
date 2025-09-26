// /js/user-menu.js
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

export function mountUserMenu({
  rootSelector = "#user-menu-root",
  profileUrl = "./profile.html",
  aboutUrl   = "./about.html",
  loginUrl   = "./login_main.html",
  showRoleBadge = false
} = {}) {
  const root = document.querySelector(rootSelector);
  if (!root) {
    console.warn("[user-menu] container tidak ditemukan:", rootSelector);
    return () => {};
  }

  // Render markup dropdown (styling minimal; tidak mengubah CSS Mas)
  root.innerHTML = `
    <div class="user-menu__wrapper" style="display:flex;align-items:center;gap:.5rem;position:relative;">
      <button class="user-menu__button" type="button" aria-haspopup="true" aria-expanded="false"
              style="display:flex;align-items:center;gap:.5rem;background:transparent;border:0;cursor:pointer;">
        <span class="user-menu__avatar" aria-hidden="true"
              style="width:28px;height:28px;border-radius:50%;display:inline-grid;place-items:center;background:#e5e7eb;color:#111;font-weight:700;">?</span>
        <span class="user-menu__name" style="font-weight:600;">Memuat...</span>
      </button>
      <div class="user-menu__dropdown" role="menu" aria-hidden="true"
           style="display:none;position:absolute;right:0;top:calc(100% + 6px);min-width:160px;z-index:9999;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 8px 20px rgba(0,0,0,.08);">
        <ul style="margin:0;padding:.25rem 0;list-style:none;">
          <li>${profileUrl}Profile</a></li>
          <li><a data-user-menu="about"
          <li><button data-user-menu="logout" type="button" role="menuitem"
                      style="display:block;width:100%;text-align:left;padding:.5rem .75rem;background:transparent;border:0;cursor:pointer;color:#b91c1c;">Logout</button></li>
        </ul>
      </div>
    </div>
  `;

  const btn = root.querySelector(".user-menu__button");
  const dropdown = root.querySelector(".user-menu__dropdown");
  const nameEl = root.querySelector(".user-menu__name");
  const avatarEl = root.querySelector(".user-menu__avatar");
  const linkProfile = root.querySelector('[data-user-menu="profile"]');
  const linkAbout   = root.querySelector('[data-user-menu="about"]');
  const btnLogout   = root.querySelector('[data-user-menu="logout"]');

  // --- Helpers dropdown ---
  const setOpen = (open) => {
    btn.setAttribute("aria-expanded", String(open));
    dropdown.style.display = open ? "block" : "none";
  };
  const toggle = () => setOpen(btn.getAttribute("aria-expanded") !== "true");

  // Cegah bubbling ke <a> induk (jika container ditempatkan di dalam anchor)
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });

  // Klik di dalam dropdown jangan menutup karena anchor induk
  dropdown.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // Tutup saat klik di luar / tekan Esc
  const onDocClick = (e) => { if (!root.contains(e.target)) setOpen(false); };
  const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onEsc);

  // --- Data user ---
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = loginUrl; return; }
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.exists() ? snap.data() : {};
      const displayName = (data?.displayName || user.displayName || "").trim();
      const email = user.email || data?.email || "";
      const role = data?.role || "viewer";
      const text = displayName || email || "User";
      nameEl.textContent = showRoleBadge ? `${text} (${role})` : text;
      const initial = (displayName || email || "?").trim().charAt(0).toUpperCase();
      avatarEl.textContent = initial;
      avatarEl.title = email;
    } catch (e) {
      console.error("[user-menu] load profile fail:", e);
      const email = auth.currentUser?.email || "User";
      nameEl.textContent = email;
      avatarEl.textContent = email.charAt(0).toUpperCase();
    }
  });

  // --- Navigasi eksplisit (kebal anchor induk) ---
  linkProfile?.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    setOpen(false);
    window.location.href = profileUrl;
  });
  linkAbout?.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    setOpen(false);
    window.location.href = aboutUrl;
  });
  btnLogout?.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    setOpen(false);
    try { await signOut(auth); } finally { window.location.href = loginUrl; }
  });

  // Cleanup untuk SPA (kalau diperlukan)
  return () => {
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onEsc);
  };
}
