import {
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { createBookingReference } from "./shared-booking-logic.js";
import { showAlert } from "./dialogs.js";
import { auth, db } from "./firebase-app.js";

const PAYMENT_DEADLINE_HOURS = 72;
const getPaymentDueAt = () => new Date(Date.now() + PAYMENT_DEADLINE_HOURS * 60 * 60 * 1000);

// Shared formatting and date helpers.
class AppUtils {
  static parseSeminarDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value === "object" && typeof value.seconds === "number") {
      return new Date(value.seconds * 1000);
    }
    if (typeof value === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split("-").map(Number);
        return new Date(year, month - 1, day);
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  static formatSeminarDate(value) {
    const date = AppUtils.parseSeminarDate(value);
    if (!date) return typeof value === "string" ? value : "";
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  static formatCurrency(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return "";
    return `\u20B1${amount.toLocaleString("en-US")}`;
  }

  static normalizeStatusKey(value) {
    return String(value || "pending")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  }

  static isCompletedStatus(status) {
    const normalized = AppUtils.normalizeStatusKey(status);
    return (
      normalized === "completed" ||
      normalized === "approved" ||
      normalized === "accepted" ||
      normalized === "confirmed"
    );
  }

  static isSeatReservedStatus(status) {
    const normalized = AppUtils.normalizeStatusKey(status);
    return (
      normalized === "awaiting_payment" ||
      normalized === "payment_submitted" ||
      AppUtils.isCompletedStatus(normalized)
    );
  }

  static isUpcoming(dateValue) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const seminarDate = AppUtils.parseSeminarDate(dateValue);
    if (!seminarDate) return true;

    const normalized = new Date(seminarDate);
    normalized.setHours(0, 0, 0, 0);
    return normalized >= today;
  }

  static getSafeAssetUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    try {
      const parsed = new URL(raw, window.location.origin);
      if (parsed.protocol === "https:") return parsed.href;

      const isLocalhost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";
      if (isLocalhost && parsed.protocol === "http:") return parsed.href;
      return "";
    } catch {
      return "";
    }
  }
}

// Tiny DOM helpers to keep selectors consistent.
class Dom {
  static qs(selector, root = document) {
    return root.querySelector(selector);
  }

  static setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || "";
  }
}

// Renders seminar list and fills booking details on the booking page.
class SeminarCatalog {
  constructor() {
    this.seminarMap = new Map();
    this.seminars = [];
    this.currentSeminar = null;
  }

  setSeminars(seminars) {
    this.seminarMap.clear();
    this.seminars = seminars.map((seminar) => {
      this.seminarMap.set(seminar.id, seminar);
      return seminar;
    });
  }

  renderList() {
    const list = document.getElementById("seminarList");
    if (!list) return;

    list.innerHTML = "";
    let upcomingCount = 0;

    this.seminars.forEach((seminar) => {
      if (!AppUtils.isUpcoming(seminar.date)) return;

      const item = document.createElement("a");
      item.className = "seminar-option";
      const isClosed = seminar.bookingOpen === false;
      if (isClosed) {
        item.classList.add("disabled");
        item.href = "#";
        item.setAttribute("aria-disabled", "true");
      } else {
        item.href = `seminar-booking.html?id=${encodeURIComponent(seminar.id)}`;
      }
      const dateLabel = AppUtils.formatSeminarDate(seminar.date);
      item.setAttribute(
        "aria-label",
        `${seminar.title} on ${dateLabel}${isClosed ? " (booking closed)" : ""}`
      );

      const title = document.createElement("span");
      title.className = "option-title";
      title.textContent = seminar.title;

      const meta = document.createElement("span");
      meta.className = "option-meta";
      const metaParts = [dateLabel];
      if (seminar.time) metaParts.push(seminar.time);
      if (isClosed) metaParts.push("Booking closed");
      meta.textContent = metaParts.join(" | ");

      item.append(title, meta);
      list.appendChild(item);
      upcomingCount += 1;
    });

    const noUpcoming = document.getElementById("noUpcoming");
    if (noUpcoming) {
      noUpcoming.hidden = upcomingCount !== 0;
    }
  }

  fillBookingDetails() {
    const titleEl = document.getElementById("seminarTitle");
    if (!titleEl) return;

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const seminar = this.seminarMap.get(id);

    const invalidCard = document.getElementById("invalidSeminar");
    const submitBtn = document.getElementById("submitSeminar");

    if (!seminar || !AppUtils.isUpcoming(seminar.date)) {
      if (invalidCard) {
        invalidCard.hidden = false;
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add("disabled");
      }
      return;
    }

    if (seminar.bookingOpen === false) {
      if (invalidCard) {
        const messageEl = document.getElementById("invalidSeminarMessage");
        if (messageEl) {
          messageEl.textContent =
            "This workshop is currently closed for booking. Please choose another date.";
        }
        invalidCard.hidden = false;
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add("disabled");
      }
    }

    this.currentSeminar = seminar;

    const dateEl = document.getElementById("seminarDate");
    const timeEl = document.getElementById("seminarTime");
    const locationEl = document.getElementById("seminarLocation");
    const priceEl = document.getElementById("seminarPrice");
    const descEl = document.getElementById("seminarDesc");
    const imageEl = document.getElementById("seminarImage");

    const dateLabel = AppUtils.formatSeminarDate(seminar.date);

    titleEl.textContent = seminar.title;
    if (dateEl) dateEl.textContent = dateLabel;
    if (timeEl) timeEl.textContent = seminar.time ? ` - ${seminar.time}` : "";
    if (locationEl) locationEl.textContent = seminar.location || "";
    if (priceEl) priceEl.textContent = AppUtils.formatCurrency(seminar.price);
    if (descEl) descEl.textContent = seminar.description || "";
    if (imageEl) {
      const imageUrl = AppUtils.getSafeAssetUrl(seminar.image);
      if (imageUrl) {
        imageEl.src = imageUrl;
        imageEl.alt = `${seminar.title} cover`;
        imageEl.hidden = false;
      } else {
        imageEl.hidden = true;
        imageEl.removeAttribute("src");
      }
    }

    const slotInput = document.getElementById("slotCount");
    const totalEl = document.getElementById("seminarTotal");
    if (slotInput && totalEl) {
      const slotValue = Math.max(1, Math.floor(Number(slotInput.value || 1)));
      const priceValue = Number(seminar.price || 0);
      totalEl.textContent =
        Number.isFinite(priceValue) && priceValue > 0
          ? AppUtils.formatCurrency(priceValue * slotValue)
          : "";
    }

    document.dispatchEvent(new CustomEvent("seminar:loaded", { detail: seminar }));
  }

  getCurrentSeminar() {
    return this.currentSeminar;
  }
}

// Handles booking submission logic for the seminar booking page.
class BookingHandler {
  constructor({ db, getCurrentSeminar, getCurrentUser, getUserProfile }) {
    this.db = db;
    this.getCurrentSeminar = getCurrentSeminar;
    this.getCurrentUser = getCurrentUser;
    this.getUserProfile = getUserProfile;
    this.currentSeminar = null;
    this.availability = { bookingOpen: true, remaining: null, maxSlots: null };
  }

  init() {
    const submitBtn = document.getElementById("submitSeminar");
    const slotInput = document.getElementById("slotCount");
    if (!submitBtn) return;

    submitBtn.disabled = true;
    submitBtn.classList.add("disabled");
    submitBtn.addEventListener("click", () => this.handleSubmit());
    if (slotInput) {
      slotInput.addEventListener("input", () => this.renderAdditionalAttendees());
      this.renderAdditionalAttendees();
    }
    document.addEventListener("seminar:loaded", (event) => {
      this.currentSeminar = event.detail || this.getCurrentSeminar();
      this.loadAvailability(this.currentSeminar);
      this.updateTotals();
    });
  }

  updateTotals() {
    const totalEl = document.getElementById("seminarTotal");
    const slotInput = document.getElementById("slotCount");
    const seminar = this.getCurrentSeminar();

    if (!totalEl || !slotInput) return;

    const slotValue = Math.max(1, Math.floor(Number(slotInput.value || 1)));
    const priceValue = Number(seminar?.price || 0);
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      totalEl.textContent = "";
      return;
    }

    totalEl.textContent = AppUtils.formatCurrency(priceValue * slotValue);
    this.updateAvailabilityUI();
  }

  async loadAvailability(seminar) {
    if (!seminar) return;
    this.availability = await this.getAvailability(seminar);
    this.updateAvailabilityUI();
  }

  async getAvailability(seminar) {
    if (!seminar) return { bookingOpen: false, remaining: 0, maxSlots: null };
    if (seminar.bookingOpen === false) {
      return { bookingOpen: false, remaining: 0, maxSlots: seminar.maxSlots ?? null };
    }

    const maxSlotsValue = Number(seminar.maxSlots);
    if (!Number.isFinite(maxSlotsValue) || maxSlotsValue <= 0) {
      return { bookingOpen: true, remaining: null, maxSlots: null };
    }

    const bookedSlots = await this.fetchBookedSlots(seminar.id);
    const fallbackBooked = Number.isFinite(bookedSlots) ? bookedSlots : 0;
    const remaining = Math.max(0, maxSlotsValue - fallbackBooked);
    return { bookingOpen: true, remaining, maxSlots: maxSlotsValue };
  }

  async fetchBookedSlots(seminarId) {
    if (!seminarId) return 0;
    const bookingsRef = collection(this.db, "bookings");
    const bookingsQuery = query(bookingsRef, where("seminarId", "==", seminarId));
    try {
      const snapshot = await getDocs(bookingsQuery);
      return snapshot.docs.reduce((total, docSnap) => {
        const data = docSnap.data();
        const statusKey = AppUtils.normalizeStatusKey(data.status);
        const reservesSeat = AppUtils.isSeatReservedStatus(statusKey);
        if (!reservesSeat) return total;
        const slots = Number(data.slotCount);
        const slotCount = Number.isFinite(slots) && slots > 0 ? Math.floor(slots) : 1;
        return total + slotCount;
      }, 0);
    } catch (error) {
      console.error("Unable to load booked slots:", error);
      return null;
    }
  }

  updateAvailabilityUI() {
    const slotsEl = document.getElementById("seminarSlotsLeft");
    const noteEl = document.getElementById("seminarAvailabilityNote");
    const submitBtn = document.getElementById("submitSeminar");
    const invalidCard = document.getElementById("invalidSeminar");
    const invalidMessage = document.getElementById("invalidSeminarMessage");
    const slotInput = document.getElementById("slotCount");
    const slotValue = Math.max(1, Math.floor(Number(slotInput?.value || 1)));

    if (!this.availability.bookingOpen) {
      if (slotsEl) slotsEl.textContent = "";
      if (noteEl) noteEl.textContent = "Booking is currently closed.";
      if (invalidCard) invalidCard.hidden = false;
      if (invalidMessage) {
        invalidMessage.textContent =
          "This workshop is currently closed for booking. Please choose another date.";
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add("disabled");
      }
      return;
    }

    if (this.availability.remaining === null) {
      if (slotsEl) slotsEl.textContent = "Unlimited";
      if (noteEl) noteEl.textContent = "";
      if (slotInput) slotInput.removeAttribute("max");
      if (invalidCard) invalidCard.hidden = true;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove("disabled");
      }
      return;
    }

    if (slotsEl) slotsEl.textContent = String(this.availability.remaining);
    if (slotInput) {
      slotInput.max = String(this.availability.remaining);
    }

    if (this.availability.remaining <= 0) {
      if (noteEl) noteEl.textContent = "Fully booked.";
      if (invalidCard) invalidCard.hidden = false;
      if (invalidMessage) {
        invalidMessage.textContent =
          "This workshop is fully booked. Please choose another date.";
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add("disabled");
      }
      return;
    }

    if (slotValue > this.availability.remaining) {
      if (noteEl) {
        noteEl.textContent = `Only ${this.availability.remaining} slot(s) left.`;
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add("disabled");
      }
      return;
    }

    if (noteEl) noteEl.textContent = "";
    if (invalidCard) invalidCard.hidden = true;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.classList.remove("disabled");
    }
  }

  renderAdditionalAttendees() {
    const slotInput = document.getElementById("slotCount");
    const list = document.getElementById("additionalAttendees");
    const card = document.getElementById("additionalAttendeesCard");
    if (!slotInput || !list || !card) return;

    const slotValue = Math.max(1, Math.floor(Number(slotInput.value || 1)));
    const extraCount = Math.max(0, slotValue - 1);

    list.innerHTML = "";
    if (extraCount === 0) {
      card.hidden = true;
      this.updateTotals();
      return;
    }

    card.hidden = false;
    for (let i = 0; i < extraCount; i += 1) {
      const index = i + 1;
      const wrapper = document.createElement("div");
      wrapper.className = "attendee-card";

      const heading = document.createElement("h3");
      heading.textContent = `Attendee ${index + 1}`;

      const grid = document.createElement("div");
      grid.className = "attendee-grid";

      const nameLabel = document.createElement("label");
      nameLabel.textContent = "Full Name";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.id = `attendeeName${index}`;
      nameInput.placeholder = "Enter attendee full name";
      nameInput.required = true;

      const emailLabel = document.createElement("label");
      emailLabel.textContent = "Email";
      const emailInput = document.createElement("input");
      emailInput.type = "email";
      emailInput.id = `attendeeEmail${index}`;
      emailInput.placeholder = "Enter attendee email address";
      emailInput.required = true;

      nameLabel.appendChild(nameInput);
      emailLabel.appendChild(emailInput);
      grid.append(nameLabel, emailLabel);

      wrapper.append(heading, grid);
      list.appendChild(wrapper);
    }

    this.updateTotals();
  }

  async handleSubmit() {
    const slotInput = document.getElementById("slotCount");
    const slotValue = Number(slotInput?.value);
    const currentSeminar = this.getCurrentSeminar();
    const currentUser = this.getCurrentUser();
    const currentUserProfile = this.getUserProfile();

    if (!currentSeminar) {
      await showAlert("Please choose a workshop from the upcoming list first.");
      return;
    }

    if (!Number.isFinite(slotValue) || slotValue <= 0) {
      await showAlert("Please enter a valid number of attendees.");
      return;
    }

    let availability = { bookingOpen: true, remaining: null };
    try {
      availability = await this.getAvailability(currentSeminar);
    } catch (error) {
      console.error("Unable to verify availability:", error);
    }
    if (!availability.bookingOpen) {
      await showAlert("This workshop is currently closed for booking.");
      return;
    }
    if (availability.remaining !== null && slotValue > availability.remaining) {
      await showAlert(`Only ${availability.remaining} slot(s) are available.`);
      return;
    }

    const additionalAttendees = [];
    const extraCount = Math.max(0, Math.floor(slotValue) - 1);
    for (let i = 0; i < extraCount; i += 1) {
      const index = i + 1;
      const name = document.getElementById(`attendeeName${index}`)?.value?.trim();
      const email = document.getElementById(`attendeeEmail${index}`)?.value?.trim();
      if (!name || !email) {
        await showAlert("Please complete the details for all additional attendees.");
        return;
      }
      additionalAttendees.push({ name, email });
    }

    if (!currentUser) {
      await showAlert("Please log in again.");
      window.location.href = "login-register.html";
      return;
    }

    const bookingDocRef = doc(collection(this.db, "bookings"));
    const bookingRef = createBookingReference(bookingDocRef.id, "seminar");

    const perPersonPrice = Number(currentSeminar.price) || 0;
    if (!Number.isFinite(perPersonPrice) || perPersonPrice <= 0) {
      await showAlert("Workshop price is not set yet. Please contact the organizer.");
      return;
    }
    const totalAmount = perPersonPrice * Math.floor(slotValue);

    const bookingData = {
      userId: currentUser.uid,
      userEmail: currentUser.email,
      userName: currentUserProfile?.name || "",
      bookingType: "seminar",
      bookingRef,
      seminarId: currentSeminar.id,
      seminarTitle: currentSeminar.title,
      seminarDate: AppUtils.formatSeminarDate(currentSeminar.date),
      seminarTime: currentSeminar.time || "",
      seminarLocation: currentSeminar.location || "",
      seminarPrice: perPersonPrice,
      slotCount: Math.floor(slotValue),
      additionalAttendees,
      paymentAmount: totalAmount,
      totalAmount,
      paymentStatus: "awaiting_payment",
      status: "awaiting_payment",
      confirmedAt: serverTimestamp(),
      paymentDueAt: getPaymentDueAt(),
      timestamp: serverTimestamp()
    };

    try {
      await setDoc(bookingDocRef, bookingData);
      window.location.href = `payment.html?bookingId=${bookingDocRef.id}`;
    } catch (error) {
      console.error("Error saving seminar booking:", error);
      await showAlert("Failed to reserve slot. Please try again.");
    }
  }
}

// Fetches and renders basic user profile info.
class UserProfile {
  constructor({ db }) {
    this.db = db;
    this.profile = null;
  }

  getProfile() {
    return this.profile;
  }

  async fill(user) {
    const nameSpan = document.getElementById("display-name");
    const emailSpan = document.getElementById("display-email");
    const uidSpan = document.getElementById("display-uid");
    const fallbackName =
      user.displayName ||
      String(user.email || "").split("@")[0] ||
      "";

    if (!nameSpan && !emailSpan && !uidSpan) return;

    if (emailSpan) emailSpan.textContent = user.email;
    if (uidSpan) uidSpan.textContent = `#${user.uid.substring(0, 6).toUpperCase()}`;
    if (nameSpan) nameSpan.textContent = fallbackName;

    try {
      const userDocRef = doc(this.db, "users", user.uid);
      const userSnap = await getDoc(userDocRef);

      if (userSnap.exists() && nameSpan) {
        const userData = userSnap.data();
        const firstName = String(userData.firstName || "").trim();
        const lastName = String(userData.lastName || "").trim();
        const fullName = `${firstName} ${lastName}`.trim();
        if (fullName) {
          nameSpan.textContent = fullName;
          this.profile = { name: fullName };
        } else {
          this.profile = { name: fallbackName };
        }
      }
    } catch (err) {
      console.error("Error fetching user profile:", err);
      this.profile = { name: fallbackName };
    }
  }
}

// App coordinator: auth gating + Firestore listener.
class SeminarApp {
  constructor({ auth, db }) {
    this.auth = auth;
    this.db = db;

    this.currentUser = null;

    this.catalog = new SeminarCatalog();
    this.userProfile = new UserProfile({ db });
    this.bookingHandler = new BookingHandler({
      db,
      getCurrentSeminar: () => this.catalog.getCurrentSeminar(),
      getCurrentUser: () => this.currentUser,
      getUserProfile: () => this.userProfile.getProfile()
    });
  }

  initUI() {
    window.addEventListener("load", () => {
      document.querySelector(".fade-up")?.classList.add("show");
      this.bookingHandler.init();
    });
  }

  startSeminarListener() {
    const seminarListEl = document.getElementById("seminarList");
    const bookingPage = document.getElementById("seminarTitle");

    if (!seminarListEl && !bookingPage) return;

    const seminarsRef = collection(this.db, "seminars");
    const seminarsQuery = query(seminarsRef, orderBy("date", "asc"));

    onSnapshot(seminarsQuery, (snapshot) => {
      const seminarRecords = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return { id: docSnap.id, ...data };
      });

      this.catalog.setSeminars(seminarRecords);
      this.catalog.renderList();
      this.catalog.fillBookingDetails();
    });
  }

  bindAuth() {
    onAuthStateChanged(this.auth, (user) => {
      const needsAuth = document.getElementById("display-email");
      if (!needsAuth) {
        this.startSeminarListener();
        return;
      }

      if (user) {
        this.currentUser = user;
        this.userProfile.fill(user);
        this.startSeminarListener();
      } else {
        window.location.href = "login-register.html";
      }
    });
  }
}

const seminarApp = new SeminarApp({ auth, db });
seminarApp.initUI();
seminarApp.bindAuth();
