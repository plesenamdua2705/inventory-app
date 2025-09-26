// /js/user-menu.js
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/**
 * Render & kelola dropdown user (kanan atas).
 */
export function mountUserMenu({
  rootSelector = "#user-menu-root",
  profileUrl = "./profile.html",
  aboutUrl = "./about.html",
  loginUrl = "./login_main.html",
  showRoleBadge = false,
} = {}) {
  const root = document.querySelector(rootSelector);
  if (!root) {
    console.warn("[user-menu] container tidak ditemukan:", rootSelector);
    return () => {};
  }

  // Perhatikan: href langsung mengarah ke file yang benar
  root.innerHTML = `
    <div class="user-menu position-relative">
      <button class="user-menu__button btn btn-light d-flex align-items-center gap-2"
              type="button" aria-haspopup="true" aria-expanded="false">
        <span class="user-menu__avatar rounded-circle bg-secondary text-white d-inline-flex
                     align-items-center justify-content-center" style="width:28px;height:28px;font-weight:600">?</span>
        <span class="user-menu__name">Memuat...</span>
      </button>

      <div class="user-menu__dropdown card shadow-sm" style="display:none; position:absolute; right:0; top:110%; min-width:180px; z-index:1050;">
        <ul class="list-group list-group-flush">
          <li class="list-group-item">
            ${profileUrl}Profile</a>
          </li>
          <li class="list-group-item">
            ${aboutUrl}About</a>
          </li>
          <li class="list-group-item">
            <button type="button" data-user-menu="logout" class="btn btn-link text-danger p-0">Logout</button>
          </li>
        </ul>
      </div>
    </div>
  `;

  const btn = root.querySelector(".user-menu__button");
  const dropdown = root.querySelector(".user-menu__dropdown");
  const nameEl = root.querySelector(".user-menu__name");
  const avatarEl = root.querySelector(".user-menu__avatar");
  const btnLogout = root.querySelector('[data-user-menu="logout"]');

  // Toggle dropdown
  const setOpen = (open) => {
    btn.setAttribute("aria-expanded", String(open));
    dropdown.style.display = open ? "block" : "none";
  };
  const toggle = () => setOpen(btn.getAttribute("aria-expanded") !== "true");

  btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggle(); });
  dropdown.addEventListener("click", (e) => e.stopPropagation());
  const onDocClick = (e) => { if (!root.contains(e.target)) setOpen(false); };
  const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onEsc);

  // Muat data user
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
      avatarEl.title = email || "";
    } catch (e) {
      console.error("[user-menu] load profile fail:", e);
      const email = auth.currentUser?.email || "User";
      nameEl.textContent = email;
      avatarEl.textContent = email.charAt(0).toUpperCase();
    }
  });

  // Navigasi Logout
  linkProfile?.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation(); setOpen(false);
    try { await signOut(auth); } finally { window.location.href = profileUrl; }
  });

  linkAbout?.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation(); setOpen(false);
    try { await signOut(auth); } finally { window.location.href = aboutUrl; }
  });
  
  btnLogout?.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation(); setOpen(false);
    try { await signOut(auth); } finally { window.location.href = loginUrl; }
  });

  return () => {
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onEsc);
  };
}

