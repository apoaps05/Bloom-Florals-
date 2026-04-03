import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import { showAlert, showConfirm } from "./dialogs.js";
import { auth, db } from "./firebase-app.js";

class NavProfileService {
  constructor({ dbInstance }) {
    this.db = dbInstance;
  }

  static formatDisplayName(profile, user, fallbackEmail) {
    const profileName =
      profile?.displayName ||
      [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim();
    if (profileName) return profileName;
    if (user?.displayName) return user.displayName;
    if (fallbackEmail) return fallbackEmail.split("@")[0] || fallbackEmail;
    return "";
  }

  async getProfile(userId) {
    try {
      const userRef = doc(this.db, "users", userId);
      const snap = await getDoc(userRef);
      return snap.exists() ? snap.data() : null;
    } catch {
      return null;
    }
  }
}

class NavAuthController {
  constructor({ authInstance, profileService }) {
    this.auth = authInstance;
    this.profileService = profileService;

    this.isInPages = window.location.pathname.includes("/pages/");
    this.loginPath = this.isInPages ? "login-register.html" : "pages/login-register.html";
    this.profilePath = this.isInPages ? "profile.html#profile" : "pages/profile.html#profile";

    this.profileMenuItem = document.querySelector(".navbar__profile");
    this.loginCta = document.getElementById("login-cta");
    this.loginCtaItem = this.loginCta ? this.loginCta.closest("li") : null;
    this.guardedLinks = document.querySelectorAll('[data-requires-auth="true"]');
    this.signOutLinks = document.querySelectorAll(".profile-menu .danger");
    this.userNameDisplay = document.getElementById("user-name-display");
    this.userEmailDisplay = document.getElementById("user-email-display");

    this.currentUser = null;
    this.authResolved = false;
  }

  init() {
    if (this.loginCta) {
      this.loginCta.setAttribute("href", this.loginPath);
      this.loginCta.addEventListener("click", (event) => this.handleLoginCtaClick(event));
    }

    if (this.guardedLinks.length) {
      this.guardedLinks.forEach((link) => {
        link.addEventListener("click", (event) => this.handleAuthRequiredClick(event));
      });
    }

    if (this.signOutLinks.length) {
      this.signOutLinks.forEach((link) => {
        link.addEventListener("click", (event) => this.handleSignOutClick(event));
      });
    }

    this.setAuthPendingUi();

    onAuthStateChanged(this.auth, (user) => {
      this.authResolved = true;
      this.currentUser = user || null;
      this.syncAuthUi(user);
    });

    window.addEventListener("pageshow", (event) => this.handlePageShow(event));
  }

  setText(el, value) {
    if (el) el.textContent = value;
  }

  setVisibility(el, isVisible) {
    if (!el) return;
    el.hidden = !isVisible;
    el.style.display = isVisible ? "" : "none";
  }

  setGuestProfile() {
    this.setText(this.userNameDisplay, "Account");
    this.setText(this.userEmailDisplay, "");
  }

  setAuthPendingUi() {
    document.body?.classList.remove("auth-ui-ready");
    this.setVisibility(this.loginCtaItem, false);
    this.setVisibility(this.profileMenuItem, false);
    if (this.loginCta) {
      this.loginCta.setAttribute("aria-disabled", "true");
      this.loginCta.tabIndex = -1;
    }
  }

  buildRedirectTarget(href) {
    if (!href) return "";
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith("#")) return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) return "";

    const normalized = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
    const candidate = normalized.startsWith("pages/")
      ? normalized.slice("pages/".length)
      : normalized;

    if (!candidate || candidate.startsWith("#")) return "";
    if (candidate.includes("\\") || candidate.includes("..")) return "";
    if (/[\u0000-\u001F\u007F]/.test(candidate)) return "";

    return candidate;
  }

  redirectToLogin(target) {
    const redirectTarget = this.buildRedirectTarget(target);
    const loginUrl = redirectTarget
      ? `${this.loginPath}?redirect=${encodeURIComponent(redirectTarget)}`
      : this.loginPath;
    window.location.href = loginUrl;
  }

  handleLoginCtaClick(event) {
    if (!this.loginCta) return;
    if (!this.authResolved) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (this.currentUser) {
      event.preventDefault();
      event.stopPropagation();
      window.location.href = this.profilePath;
    }
  }

  async handleAuthRequiredClick(event) {
    if (!this.authResolved) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (this.currentUser) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget?.getAttribute("href") || "";
    const confirmed = await showConfirm({
      title: "Sign in required",
      message: "Please sign in or create an account to continue.",
      confirmText: "Sign In",
      cancelText: "Not now",
      tone: "primary"
    });
    if (confirmed) {
      this.redirectToLogin(target);
    }
  }

  async updateProfileHeader(user) {
    if (!this.userNameDisplay && !this.userEmailDisplay) return;

    const profileData = await this.profileService.getProfile(user.uid);
    const email = profileData?.email || user.email || "";
    const displayName = NavProfileService.formatDisplayName(profileData, user, email) || "Account";

    this.setText(this.userNameDisplay, displayName);
    this.setText(this.userEmailDisplay, email);
  }

  async handleSignOutClick(event) {
    event.preventDefault();
    try {
      await signOut(this.auth);
      localStorage.removeItem("loggedInUserId");
      window.location.href = this.loginPath;
    } catch (error) {
      console.error("Sign out failed:", error);
      await showAlert("Unable to sign out. Please try again.");
    }
  }

  syncAuthUi(user) {
    document.body?.classList.add("auth-ui-ready");
    const isLoggedIn = Boolean(user);
    this.setVisibility(this.loginCtaItem, !isLoggedIn);
    this.setVisibility(this.profileMenuItem, isLoggedIn);

    if (this.loginCta) {
      this.loginCta.setAttribute("href", isLoggedIn ? this.profilePath : this.loginPath);
      this.loginCta.removeAttribute("aria-disabled");
      this.loginCta.tabIndex = 0;
    }

    if (isLoggedIn) {
      this.updateProfileHeader(user);
    } else {
      this.setGuestProfile();
    }
  }

  handlePageShow(event) {
    if (!event.persisted) return;
    this.setAuthPendingUi();
    const restoredUser = this.auth.currentUser || this.currentUser;
    if (restoredUser) {
      this.authResolved = true;
      this.currentUser = restoredUser;
      this.syncAuthUi(restoredUser);
      return;
    }
    if (this.authResolved) {
      this.syncAuthUi(null);
    }
  }
}

const navAuthController = new NavAuthController({
  authInstance: auth,
  profileService: new NavProfileService({ dbInstance: db })
});

navAuthController.init();
