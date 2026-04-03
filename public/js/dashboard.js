import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { auth, db, storage } from "./dashboard/firebase.js";
import { AppUtils, Dom } from "./dashboard/utils.js";
import { Modal, ModalManager } from "./dashboard/modals.js";
import { BookingManager } from "./dashboard/booking-manager.js";
import { SeminarManager } from "./dashboard/seminar-manager.js";
import { CalendarManager } from "./dashboard/calendar-manager.js";
import { FlowerManager } from "./dashboard/flower-manager.js";
import { PackageManager } from "./dashboard/package-manager.js";
import { HistoryManager } from "./history.js";
import { AnalyticsManager } from "./analytics.js";
import { showAlert, showConfirm } from "./dialogs.js";
import { resolveStaffAccessWithRetry } from "./staff-access.js";
class DashboardApp {
  constructor({ auth, db, storage }) {
    this.auth = auth;
    this.db = db;
    this.storage = storage;

    this.uiReady = false;
    this.isAuthorized = false;
    this.currentRole = "admin";

    this.modalManager = new ModalManager();
    this.bookingManager = new BookingManager({ db });
    this.seminarManager = new SeminarManager({ db, storage });
    this.calendarManager = new CalendarManager();
    this.flowerManager = new FlowerManager({ db, storage });
    this.packageManager = new PackageManager({ db, flowerManager: this.flowerManager });
    this.historyManager = new HistoryManager({ bookingManager: this.bookingManager });
    this.analyticsManager = new AnalyticsManager({ bookingManager: this.bookingManager });
  }

  initUI() {
    this.bindModals();
    this.bindNav();
    this.bindSignOut();
    this.bindSeminarApplicantsView();
    this.bookingManager.initFilters();
    this.historyManager.initFilters();
    this.analyticsManager.init();

    this.seminarManager.initUI();
    this.seminarManager.initFilters();
    this.calendarManager.initUI();
    this.flowerManager.initUI();
    this.packageManager.initUI();

    this.uiReady = true;
    this.tryStart();
  }

  setAuthorized(role = "admin") {
    this.currentRole = role;
    this.isAuthorized = true;
    this.seminarManager.setRole?.(role);
    this.packageManager.setRole?.(role);
    this.flowerManager.setRole?.(role);
    this.applyRoleUi();
    AppUtils.setVisibility(true);
    this.tryStart();
  }

  tryStart() {
    if (!this.uiReady || !this.isAuthorized) return;
    this.bookingManager.startListener();
    this.seminarManager.startListener();
    if (this.currentRole === "admin") {
      this.packageManager.startListener();
      this.flowerManager.startListener();
    }
  }

  showSection(targetId) {
    const navLinks = Dom.qsa(".nav-link[data-section]");
    const sections = Dom.qsa(".request-section");
    const fallbackSection = "booking-calendar";
    const requestedElement = document.getElementById(targetId);
    const requiresAdmin = requestedElement?.dataset?.roleAccess === "admin";
    const requestedSection = requestedElement && !(requiresAdmin && this.currentRole !== "admin")
      ? targetId
      : fallbackSection;

    sections.forEach((section) => {
      section.hidden = true;
    });
    navLinks.forEach((btn) => btn.classList.remove("active"));

    const targetSection = document.getElementById(requestedSection);
    if (targetSection) targetSection.hidden = false;

    const targetLink = navLinks.find((link) => link.dataset.section === requestedSection && !link.hidden);
    if (targetLink) targetLink.classList.add("active");
  }

  bindModals() {
      const bookingModalEl = document.getElementById("bookingModal");
      const detailsModalEl = document.getElementById("detailsModal");
      const seminarDetailsEl =
        document.getElementById("seminarDetailsModal") || document.getElementById("seminarModal");
      const seminarFormEl = document.getElementById("seminarFormModal");
      const packageFormEl = document.getElementById("packageFormModal");
      const flowerFormEl = document.getElementById("flowerFormModal");

      const bookingModal = new Modal(bookingModalEl, { lockScroll: true });
      const detailsModal = new Modal(detailsModalEl);
      const seminarModal = new Modal(seminarDetailsEl, {
        lockScroll: true,
        hideOnClose: true,
      });
      const seminarFormModal = new Modal(seminarFormEl, { lockScroll: true });
      const packageFormModal = new Modal(packageFormEl, { lockScroll: true });
      const flowerFormModal = new Modal(flowerFormEl, { lockScroll: true });

      this.modalManager.register(bookingModal);
      this.modalManager.register(detailsModal);
      this.modalManager.register(seminarModal);
      this.modalManager.register(seminarFormModal);
      this.modalManager.register(packageFormModal);
      this.modalManager.register(flowerFormModal);

      this.bookingManager.setDetailsModal(detailsModal);
      this.seminarManager.setFormModal(seminarFormModal);
      this.packageManager.setFormModal(packageFormModal);
      this.flowerManager.setFormModal(flowerFormModal);

      window.openModal = () => bookingModal.open();
      window.closeModal = () => bookingModal.close();
      window.openDetailsModal = (id) => this.bookingManager.openDetails(id);  // Expose for inline handlers
      window.closeDetailsModal = () => detailsModal.close();
      window.openSeminarModal = () => seminarModal.open();
      window.closeSeminarModal = () => seminarModal.close();
      window.openSeminarDetails = window.openSeminarModal;
      window.closeSeminarDetails = window.closeSeminarModal;

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        const dialogOpen = document.getElementById("appDialogOverlay")?.classList.contains("show");
        if (dialogOpen) return;
        this.modalManager.closeAll();
      });
    }

  bindNav() {
    const navLinks = Dom.qsa(".nav-link[data-section]");

    navLinks.forEach((link) => {
      link.addEventListener("click", () => {
        if (link.hidden) return;
        this.showSection(link.dataset.section);
      });
    });
  }

  bindSignOut() {
    const signOutButton = Dom.qs(".signout-btn");
    if (signOutButton) {
      signOutButton.addEventListener("click", () => window.signOut());
    }
  }

  bindSeminarApplicantsView() {
    window.viewSeminarApplicants = () => {
      const grid = Dom.qs(".seminar-grid");
      const applicants = document.getElementById("seminar-applicants");

      if (grid) grid.hidden = true;
      if (applicants) applicants.hidden = false;
    };

    window.backToSeminars = () => {
      const grid = Dom.qs(".seminar-grid");
      const applicants = document.getElementById("seminar-applicants");

      if (applicants) applicants.hidden = true;
      if (grid) grid.hidden = false;
    };
  }

  applyRoleUi() {
    const role = this.currentRole === "employee" ? "employee" : "admin";
    const adminOnlyElements = Dom.qsa("[data-role-access='admin']");
    const roleLabel = document.getElementById("staffRoleLabel");
    const welcomeLabel = document.getElementById("dashboardWelcomeLabel");

    document.body.dataset.staffRole = role;
    document.title = role === "employee" ? "Requests | Bloom Employee" : "Requests | Bloom Admin";

    adminOnlyElements.forEach((element) => {
      element.hidden = role !== "admin";
    });

    if (roleLabel) {
      roleLabel.textContent = role === "employee" ? "Employee Panel" : "Admin Panel";
      roleLabel.classList.toggle("employee", role === "employee");
    }

    if (welcomeLabel) {
      welcomeLabel.textContent = role === "employee" ? "Welcome back, Employee" : "Welcome back, Admin";
    }

    this.showSection("booking-calendar");
  }
}

const dashboardApp = new DashboardApp({ auth, db, storage });
window.dashboardApp = dashboardApp; // Expose for legacy handlers

AppUtils.setVisibility(false);

// Gate the UI behind staff auth.
onAuthStateChanged(auth, async (user) => {
  try {
    await verifyStaffAccess(user);
  } catch (error) {
    console.error("Staff check failed:", error);
    await showAlert("Unable to verify staff access. Please try again.");
    AppUtils.redirectTo("../index.html");
  }
});

// Staff check drives the rest of the app start-up.
async function verifyStaffAccess(user) {
  if (!user) {
    AppUtils.redirectTo("login-register.html");
    return;
  }

  const access = await resolveStaffAccessWithRetry(db, user);

  if (!access.role) {
    await showAlert("Access denied. Staff only.");
    AppUtils.redirectTo("../index.html");
    return;
  }

  dashboardApp.setAuthorized(access.role);
}

document.addEventListener("DOMContentLoaded", () => {
  dashboardApp.initUI();
});

// Keep existing global hooks used by the HTML.
window.signOut = async () => {
  const confirmed = await showConfirm({
    title: "Sign out",
    message: "Are you sure you want to sign out?",
    confirmText: "Sign out",
    tone: "primary",
  });
  if (!confirmed) return;
  await firebaseSignOut(auth);
  AppUtils.redirectTo("login-register.html");
};

window.startSeminarEdit = (seminarId) => {
  dashboardApp.seminarManager.startEdit(seminarId);
};

window.deleteSeminar = async (seminarId) => {
  await dashboardApp.seminarManager.delete(seminarId);
};

window.startPackageEdit = (packageId) => {
  dashboardApp.packageManager.startEdit(packageId);
};

window.deletePackage = async (packageId) => {
  await dashboardApp.packageManager.delete(packageId);
};

window.startFlowerEdit = (flowerId) => {
  dashboardApp.flowerManager.startEdit(flowerId);
};

window.deleteFlower = async (flowerId) => {
  await dashboardApp.flowerManager.delete(flowerId);
};
