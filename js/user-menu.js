// /js/user-menu.js (versi tanpa template HTML)
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

export function mountUserMenu({
  rootSelector = "#user-menu-root",
  profileUrl = "./profile.html",
  aboutUrl = "./about.html",
  loginUrl = "./login_main.html",
  showRoleBadge = false,
} = {}) {
  const root = document.querySelector(rootSelector);
  if (!root) { console.warn("[user-menu] container tidak ditemukan:", rootSelector); return () => {}; }

  // Wrapper
  const wrap = document.createElement("div");
  wrap.className = "user-menu position-relative";
  wrap.style.zIndex = "1050";

  // Button
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "user-menu__button btn btn-light d-flex align-items-center gap-2";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");

  const avatar = document.createElement("span");
  avatar.className = "user-menu__avatar rounded-circle bg-secondary text-white d-inline-flex align-items-center justify-content-center";
  avatar.style.width = "28px";
  avatar.style.height = "28px";
  avatar.style.fontWeight = "600";
  avatar.textContent = "?";

  const nameEl = document.createElement("span");
  nameEl.className = "user-menu__name";
  nameEl.textContent = "Memuat...";

  btn.appendChild(avatar);
  btn.appendChild(nameEl);

  // Dropdown
  const dropdown = document.createElement("div");
  dropdown.className = "user-menu__dropdown card shadow-sm";
  Object.assign(dropdown.style, { display: "none", position: "absolute", right: "0", top: "110%", minWidth: "200px" });

  const ul = document.createElement("ul");
  ul.className = "list-group list-group-flush";

  const liP = document.createElement("li"); liP.className = "list-group-item";
  const aP = document.createElement("a");
  aP.href = profileUrl; aP.dataset.userMenu = "profile"; aP.className = "text-decoration-none d-block"; aP.textContent = "Profile";
  liP.appendChild(aP);

  const liA = document.createElement("li"); liA.className = "list-group-item";
  const aA = document.createElement("a");
  aA.href = aboutUrl; aA.dataset.userMenu = "about"; aA.className = "text-decoration-none d-block"; aA.textContent = "About";
  liA.appendChild(aA);

  const liL = document.createElement("li"); liL.className = "list-group-item";
  const btnLogout = document.createElement("button");
  btnLogout.type = "button"; btnLogout.dataset.userMenu = "logout"; btnLogout.className = "btn btn-link text-danger p-0";
  btnLogout.textContent = "Logout";
  liL.appendChild(btnLogout);

  // Profile: fa v4 + fas v5
  const iconP = document.createElement('i');
  iconP.className = 'fa fa-user fas fa-user fa-sm fa-fw mr-2 text-gray-400';
  aP.prepend(iconP);
  
  // About: fa v4 + fas v5 (pakai info; kalau lebih suka lingkaran, ganti ke fa-info-circle / fas fa-info-circle)
  const iconA = document.createElement('i');
  iconA.className = 'fa fa-info fas fa-info fa-sm fa-fw mr-2 text-gray-400';
  aA.prepend(iconA);
  
  // Logout: fa v4 + fas v5 (sign-out vs sign-out-alt)
  // Jika ingin tampilan yang lebih umum di FA5, ganti ke 'fas fa-sign-out-alt'
  const iconL = document.createElement('i');
  iconL.className = 'fa fa-sign-out fas fa-sign-out-alt fa-sm fa-fw mr-2 text-danger';

  ul.appendChild(liP); ul.appendChild(liA); ul.appendChild(liL);
  dropdown.appendChild(ul);

  wrap.appendChild(btn);
  wrap.appendChild(dropdown);
  root.innerHTML = ""; // bersihkan kontainer, lalu mount
  root.appendChild(wrap);

  // Toggle
  const setOpen = (open) => { btn.setAttribute("aria-expanded", String(open)); dropdown.style.display = open ? "block" : "none"; };
  const toggle = () => setOpen(btn.getAttribute("aria-expanded") !== "true");

  btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggle(); });
  dropdown.addEventListener("click", (e) => e.stopPropagation());

  // Fallback jika ada preventDefault di tempat lain
  dropdown.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    setTimeout(() => { if (e.defaultPrevented) window.location.assign(a.getAttribute("href")); }, 0);
  }, true);

  // Tutup di luar / Esc
  const onDocClick = (e) => { if (!root.contains(e.target)) setOpen(false); };
  const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onEsc);

  // Auth
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
      avatar.textContent = initial;
      avatar.title = email || "";
    } catch (e) {
      console.error("[user-menu] load profile fail:", e);
      const email = auth.currentUser?.email || "User";
      nameEl.textContent = email;
      avatar.textContent = email.charAt(0).toUpperCase();
    }
  });

  // Logout
  btnLogout.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation(); setOpen(false);
    try { await signOut(auth); } finally { window.location.href = loginUrl; }
  });

  return () => {
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onEsc);
  };
}

