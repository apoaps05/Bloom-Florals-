import {
  collection,
  setDoc,
  serverTimestamp,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import {
  initializeTimeInputs,
  initializeLocationInputs,
  initializeLocationButtons,
  getLocationData,
  getTimeRange,
  createBookingReference
} from "./shared-booking-logic.js";
import { showAlert } from "./dialogs.js";
import { auth, db } from "./firebase-app.js";

class UserProfileService {
  constructor(dbInstance) {
    this.db = dbInstance;
  }

  async getFullName(user) {
    const fallbackName = user.displayName || String(user.email || "").split("@")[0] || "";
    try {
      const userDocRef = doc(this.db, "users", user.uid);
      const userSnap = await getDoc(userDocRef);
      if (!userSnap.exists()) return fallbackName;

      const userData = userSnap.data() || {};
      const firstName = (userData.firstName || "").trim();
      const lastName = (userData.lastName || "").trim();
      const fullName = `${firstName} ${lastName}`.trim();
      return fullName || fallbackName;
    } catch (error) {
      console.error("Error fetching user profile:", error);
      return fallbackName;
    }
  }
}

class PopupBookingService {
  constructor(dbInstance) {
    this.db = dbInstance;
  }

  async createPopupBooking({ user, userName, location, date, timeRange, notes }) {
    const bookingDocRef = doc(collection(this.db, "bookings"));
    const bookingRef = createBookingReference(bookingDocRef.id, "popup");

    const bookingData = {
      userId: user.uid,
      userEmail: user.email,
      bookingType: "popup",
      userName: userName || "",
      bookingRef,
      location,
      date,
      timeRange,
      notes: notes || "",
      status: "pending",
      timestamp: serverTimestamp()
    };

    await setDoc(bookingDocRef, bookingData);
    return { bookingId: bookingDocRef.id, bookingRef };
  }
}

class PopupBookingController {
  constructor({ authInstance, profileService, bookingService }) {
    this.auth = authInstance;
    this.profileService = profileService;
    this.bookingService = bookingService;

    this.currentUser = null;
    this.currentUserProfile = null;

    this.submitBtn = document.getElementById("submitBtn");
    this.dateInput = document.getElementById("bookingDate");
    this.startTimeInput = document.getElementById("startTime");
    this.endTimeInput = document.getElementById("endTime");
    this.specialRequestsInput = document.getElementById("specialRequests");
    this.bookingTypeDisplay = document.getElementById("display-booking-type");

    this.houseProvinceSelect = document.getElementById("province");
    this.houseCitySelect = document.getElementById("city");
    this.houseBarangayInput = document.getElementById("houseBarangay");
    this.houseStreetInput = document.getElementById("houseStreet");
    this.houseUnitInput = document.getElementById("houseUnit");
    this.venueNameInput = document.getElementById("venueName");
    this.venueProvinceSelect = document.getElementById("venueProvince");
    this.venueCitySelect = document.getElementById("venueCity");

    this.locationControl = null;
  }

  init() {
    if (this.submitBtn) this.submitBtn.disabled = true;
    this.initializeSharedInputs();
    this.setBookingTypeLabel();
    this.bindSubmit();
    onAuthStateChanged(this.auth, (user) => this.handleAuthStateChange(user));
  }

  initializeSharedInputs() {
    initializeTimeInputs();
    initializeLocationInputs();
    this.locationControl = initializeLocationButtons();
  }

  setBookingTypeLabel() {
    if (this.bookingTypeDisplay) {
      this.bookingTypeDisplay.textContent = "Pop-up Booking";
    }
  }

  showForm() {
    const container = document.querySelector(".fade-up");
    if (container) container.classList.add("show");
  }

  static isBlank(value) {
    return !value || !String(value).trim();
  }

  async handleAuthStateChange(user) {
    this.showForm();

    if (!user) {
      if (this.submitBtn) this.submitBtn.disabled = true;
      window.location.href = "login-register.html";
      return;
    }

    this.currentUser = user;
    this.currentUserProfile = {
      name: await this.profileService.getFullName(user)
    };
    this.renderUserHeader(user, this.currentUserProfile.name);

    if (this.submitBtn) this.submitBtn.disabled = false;
  }

  renderUserHeader(user, displayName) {
    const nameSpan = document.getElementById("display-name");
    const emailSpan = document.getElementById("display-email");
    const uidSpan = document.getElementById("display-uid");

    if (emailSpan) emailSpan.textContent = user.email || "";
    if (uidSpan) uidSpan.textContent = `#${user.uid.substring(0, 6).toUpperCase()}`;
    if (nameSpan) nameSpan.textContent = displayName || "";
  }

  getRequiredLocationFields(locationType) {
    if (locationType === "house") {
      return [
        { el: this.houseProvinceSelect, message: "Please select a province." },
        { el: this.houseCitySelect, message: "Please select a city/municipality." },
        { el: this.houseBarangayInput, message: "Please enter your barangay." },
        { el: this.houseStreetInput, message: "Please enter your street or subdivision." },
        { el: this.houseUnitInput, message: "Please enter your house or unit number." }
      ];
    }
    if (locationType === "venue") {
      return [
        { el: this.venueNameInput, message: "Please enter the venue name." },
        { el: this.venueProvinceSelect, message: "Please select the venue province." },
        { el: this.venueCitySelect, message: "Please select the venue city/municipality." }
      ];
    }
    return [];
  }

  async validateBeforeSubmit() {
    const user = this.currentUser || this.auth.currentUser;
    if (!user) {
      await showAlert("Please log in again.");
      window.location.href = "login-register.html";
      return { valid: false };
    }

    if (!this.dateInput?.value) {
      await showAlert("Please select a date.");
      return { valid: false };
    }

    if (!this.startTimeInput?.value || !this.endTimeInput?.value) {
      await showAlert("Please select both start and end time.");
      return { valid: false };
    }

    const locationType = this.locationControl?.getLocationType?.() || "house";
    const requiredFields = this.getRequiredLocationFields(locationType);
    for (const field of requiredFields) {
      if (!field.el) continue;
      if (PopupBookingController.isBlank(field.el.value)) {
        await showAlert(field.message);
        return { valid: false };
      }
    }

    return {
      valid: true,
      user,
      locationType
    };
  }

  bindSubmit() {
    if (!this.submitBtn) return;

    this.submitBtn.addEventListener("click", async (event) => {
      event.preventDefault();

      const validation = await this.validateBeforeSubmit();
      if (!validation.valid) return;

      const location = getLocationData(validation.locationType);

      try {
        const result = await this.bookingService.createPopupBooking({
          user: validation.user,
          userName: this.currentUserProfile?.name || "",
          location,
          date: this.dateInput?.value || "",
          timeRange: getTimeRange(),
          notes: this.specialRequestsInput?.value || ""
        });

        await showAlert(`Success! Your popup request has been sent.\nReference: ${result.bookingRef}`);
        window.location.href = "../index.html";
      } catch (error) {
        console.error("Error saving booking:", error);
        await showAlert("Failed to save booking. Please try again.");
      }
    });
  }
}

const popupBookingController = new PopupBookingController({
  authInstance: auth,
  profileService: new UserProfileService(db),
  bookingService: new PopupBookingService(db)
});

popupBookingController.init();
