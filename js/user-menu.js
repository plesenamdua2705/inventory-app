// /js/user-menu.js (versi lengkap + ikon + modal konfirmasi logout)
// ---------------------------------------------------------------
// Ketergantungan:
//  - ./firebase-init.js export { auth, db }
//  - Firebase CDN v10.12.x (auth, firestore) seperti di halaman lain
//  - (Opsional untuk modal): jQuery + Bootstrap JS (SB Admin 2 default)
// ---------------------------------------------------------------

import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/**
 * Modal Bootstrap 4: #logoutConfirmModal
 */
function ensureLogoutModalInDOM() {
  if (document.getElementById("logoutConfirmModal")) return; // sudah ada

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal fade" id="logoutConfirmModal" tabindex="-1" role="dialog" aria-labelledby="logoutConfirmTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered" role="document">
        <div class="modal-content border-0 shadow">
          <div class="modal-header">
            <h5 class="modal-title" id="logoutConfirmTitle">Konfirmasi Logout</h5>
            <button type="button" class="close" data-dismiss="modal" aria-label="Tutup">
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <div class="modal-body">Apakah Anda yakin ingin keluar?</div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-dismiss="modal">Tidak</button>
            <button type="button" class="btn btn-danger" id="confirmLogoutBtn">Ya, Keluar</button>
          </div>
        </div>
      </div>
    </div>
  `.trim();

  document.body.appendChild(wrapper.firstElementChild);
}

/**
 * Mount user menu (dropdown) ke container.
 */
export function mountUserMenu({
  rootSelector = "#user-menu-root",
  profileUrl  = "./profile.html",
  aboutUrl    = "./about.html",
  loginUrl    = "./login_main.html",
  showRoleBadge = false,
} = {}) {
  const root = document.querySelector(rootSelector);
  if (!root) {
    console.warn("[user-menu] container tidak ditemukan:", rootSelector);
    return () => {};
  }

  // === Wrapper ===
  const wrap = document.createElement("div");
  wrap.className = "user-menu position-relative";
  // Turunkan z-index agar modal Bootstrap (1050) selalu di atas dropdown
  wrap.style.zIndex = "1030";

  // === Button (avatar + name) ===
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "user-menu__button btn btn-light d-flex align-items-center gap-2"; // gap-2 no-op di BS4 (tidak masalah)
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

  // === Dropdown ===
  const dropdown = document.createElement("div");
  dropdown.className = "user-menu__dropdown card shadow-sm";
  Object.assign(dropdown.style, { display: "none", position: "absolute", right: "0", top: "110%", minWidth: "200px" });

  const ul = document.createElement("ul");
  ul.className = "list-group list-group-flush";

  // Item: Profile
  const liP = document.createElement("li"); liP.className = "list-group-item";
  const aP = document.createElement("a");
  aP.href = profileUrl;
  aP.dataset.userMenu = "profile";
  aP.className = "text-decoration-none d-block";
  aP.textContent = "Profile";
  // Ikon Profile (FA4 + FA5)
  {
    const iconP = document.createElement("i");
    iconP.className = "fa fa-user fas fa-user fa-sm fa-fw mr-2 text-gray-400";
    aP.prepend(iconP);
  }
  liP.appendChild(aP);

  // Item: About
  const liA = document.createElement("li"); liA.className = "list-group-item";
  const aA = document.createElement("a");
  aA.href = aboutUrl;
  aA.dataset.userMenu = "about";
  aA.className = "text-decoration-none d-block";
  aA.textContent = "About";
  // Ikon About (FA4 + FA5)
  {
    const iconA = document.createElement("i");
    iconA.className = "fa fa-info fas fa-info fa-sm fa-fw mr-2 text-gray-400";
    aA.prepend(iconA);
  }
  liA.appendChild(aA);

  // Item: Logout
  const liL = document.createElement("li"); liL.className = "list-group-item";
  const btnLogout = document.createElement("button");
  btnLogout.type = "button";
  btnLogout.dataset.userMenu = "logout";
  btnLogout.className = "btn btn-link text-danger p-0";
  btnLogout.textContent = "Logout";
  // Ikon Logout (FA4 + FA5) + fallback otomatis ke FA6
  {
    const iconL = document.createElement("i");
    iconL.className = "fa fa-sign-out fas fa-sign-out-alt fa-sm fa-fw mr-2 text-danger";
    btnLogout.prepend(iconL);

    // Fallback ke FA6 jika FA4/FA5 tidak tersedia
    requestAnimationFrame(() => {
      try {
        const pseudo = getComputedStyle(iconL, '::before');
        const content = pseudo && pseudo.content;
        if (!content || content === 'none' || content === 'normal' || content === '""') {
          iconL.className = "fa-solid fa-right-from-bracket fa-sm fa-fw mr-2 text-danger";
        }
      } catch { /* abaikan */ }
    });
  }
  liL.appendChild(btnLogout);

  // Rakit dropdown
  ul.appendChild(liP);
  ul.appendChild(liA);
  ul.appendChild(liL);
  dropdown.appendChild(ul);

  // Mount
  wrap.appendChild(btn);
  wrap.appendChild(dropdown);
  root.innerHTML = ""; // bersihkan kontainer
  root.appendChild(wrap);

  // === Toggle helpers ===
  const setOpen = (open) => {
    btn.setAttribute("aria-expanded", String(open));
    dropdown.style.display = open ? "block" : "none";
  };
  const toggle = () => setOpen(btn.getAttribute("aria-expanded") !== "true");

  btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggle(); });
  dropdown.addEventListener("click", (e) => e.stopPropagation());

  // Fallback jika anchor dicegah default-nya di tempat lain
  dropdown.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    setTimeout(() => { if (e.defaultPrevented) window.location.assign(a.getAttribute("href")); }, 0);
  }, true);

  // Tutup jika klik di luar / tekan Esc
  const onDocClick = (e) => { if (!root.contains(e.target)) setOpen(false); };
  const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onEsc);

  // === Auth: isi nama/avatar/role ===
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

  // === Inject modal konfirmasi logout ===
  ensureLogoutModalInDOM();

  // === Handler Logout (modal + fallback) ===
  btnLogout.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false); // tutup dropdown dulu

    const hasBootstrapModal = typeof window.$ === "function" && typeof window.$.fn?.modal === "function";
    const modalEl = document.getElementById("logoutConfirmModal");

    if (hasBootstrapModal && modalEl) {
      window.$(modalEl).modal("show");

      const okBtn = document.getElementById("confirmLogoutBtn");
      if (okBtn && okBtn.dataset.bound !== "1") {
        okBtn.dataset.bound = "1";
        okBtn.addEventListener("click", async () => {
          try { await signOut(auth); }
          finally { window.location.href = loginUrl; }
        });
      }
    } else {
      // Fallback native confirm()
      const ok = window.confirm("Apakah Anda yakin ingin keluar?");
      if (!ok) return;
      try { await signOut(auth); }
      finally { window.location.href = loginUrl; }
    }
  });

  // Cleanup (jika perlu di-unmount)
  return () => {
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onEsc);
  };
}

