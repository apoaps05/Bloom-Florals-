import {
  collection,
  getDocs,
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

class EventBookingDataService {
  constructor(dbInstance) {
    this.db = dbInstance;
  }

  async getPackageById(packageId) {
    const packageDocRef = doc(this.db, "packages", packageId);
    const packageSnap = await getDoc(packageDocRef);
    if (!packageSnap.exists()) return null;
    return { id: packageSnap.id, ...packageSnap.data() };
  }

  async getAllFlowers() {
    const snapshot = await getDocs(collection(this.db, "flowers"));
    return snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
  }

  async createEventBooking({
    user,
    userName,
    selectedPackage,
    flowerRequirements,
    selectedFlowers,
    location,
    date,
    timeRange,
    notes
  }) {
    const bookingDocRef = doc(collection(this.db, "bookings"));
    const bookingRef = createBookingReference(bookingDocRef.id, "event");

    const bookingData = {
      userId: user.uid,
      userEmail: user.email,
      bookingType: "event",
      userName: userName || "",
      bookingRef,
      packageId: selectedPackage.id,
      packageName: selectedPackage.name,
      packagePrice: selectedPackage.price || 0,
      packagePax: selectedPackage.pax || 0,
      packageFlowers: flowerRequirements.total || 0,
      selectedMainFlowers: selectedFlowers.main,
      selectedFillerFlowers: selectedFlowers.fillers,
      location: {
        type: location.type,
        name: location.name,
        province: location.province,
        city: location.city,
        barangay: location.barangay || "",
        street: location.street || "",
        unit: location.unit || "",
        landmark: location.landmark || "",
        postalCode: location.postalCode || "",
        notes: location.notes || ""
      },
      date,
      timeRange,
      notes: notes || "",
      status: "pending_availability",
      timestamp: serverTimestamp()
    };

    await setDoc(bookingDocRef, bookingData);
    return { bookingId: bookingDocRef.id, bookingRef };
  }
}

class EventBookingController {
  constructor({ authInstance, profileService, dataService }) {
    this.auth = authInstance;
    this.profileService = profileService;
    this.dataService = dataService;

    this.currentUser = null;
    this.currentUserProfile = null;
    this.selectedPackage = null;

    this.flowerRequirements = {
      mainCount: 0,
      fillerCount: 0,
      total: 0,
      enforcePerType: false,
      enforceTotal: false
    };
    this.shouldValidateFlowers = true;
    this.flowerValidationNotice = "";

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

    this.eventPackageCard = document.getElementById("eventPackageCard");
    this.packageNameSpan = document.getElementById("display-package-name");
    this.packagePriceSpan = document.getElementById("display-package-price");
    this.packagePaxSpan = document.getElementById("display-package-pax");
    this.packageFlowersSpan = document.getElementById("display-package-flowers");
    this.packageError = document.getElementById("packageError");

    this.eventFlowersCard = document.getElementById("eventFlowersCard");
    this.flowerLimitText = document.getElementById("flowerLimitText");
    this.eventMainFlowerOptions = document.getElementById("eventMainFlowerOptions");
    this.eventFillerFlowerOptions = document.getElementById("eventFillerFlowerOptions");
    this.eventMainFlowerEmpty = document.getElementById("eventMainFlowerEmpty");
    this.eventFillerFlowerEmpty = document.getElementById("eventFillerFlowerEmpty");

    this.locationControl = null;
  }

  init() {
    if (this.submitBtn) this.submitBtn.disabled = true;
    this.initializeSharedInputs();
    this.setBookingTypeLabel();
    this.bindSubmit();
    this.loadPackageFromUrl();
    onAuthStateChanged(this.auth, (user) => this.handleAuthStateChange(user));
  }

  initializeSharedInputs() {
    initializeTimeInputs();
    initializeLocationInputs();
    this.locationControl = initializeLocationButtons();
  }

  setBookingTypeLabel() {
    if (this.bookingTypeDisplay) this.bookingTypeDisplay.textContent = "Event Booking";
  }

  showForm() {
    const container = document.querySelector(".fade-up");
    if (container) container.classList.add("show");
  }

  static isBlank(value) {
    return !value || !String(value).trim();
  }

  static toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  static getArrayCount(value) {
    return Array.isArray(value) ? value.length : 0;
  }

  static isOutOfStock(flower) {
    if (!flower) return false;
    if (typeof flower.inStock === "boolean") return !flower.inStock;
    if (typeof flower.active === "boolean") return !flower.active;
    if (typeof flower.stock === "number") return flower.stock <= 0;
    if (typeof flower.quantity === "number") return flower.quantity <= 0;
    return false;
  }

  static getSafeAssetUrl(value) {
    const raw = typeof value === "string" ? value.trim() : "";
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

  getPackageFlowerCounts(pkg) {
    const mainCount = EventBookingController.toNumber(pkg?.mainFlowers) ||
      EventBookingController.getArrayCount(pkg?.mainFlowers);
    const fillerCount = EventBookingController.toNumber(pkg?.fillers) ||
      EventBookingController.getArrayCount(pkg?.fillerFlowers);
    const totalOverride = EventBookingController.toNumber(pkg?.flowers);
    const total = totalOverride > 0 ? totalOverride : mainCount + fillerCount;
    const enforcePerType = mainCount > 0 || fillerCount > 0;
    const enforceTotal = !enforcePerType && total > 0;
    return { mainCount, fillerCount, total, enforcePerType, enforceTotal };
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

  setPackageError(message = "") {
    if (!this.packageError) return;
    this.packageError.textContent = message;
    this.packageError.hidden = !message;
  }

  loadPackageFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const packageId = urlParams.get("package");

    if (!packageId) {
      this.setPackageError("No package selected. Please go back and choose a package.");
      return;
    }

    this.loadPackageDetails(packageId);
  }

  async loadPackageDetails(packageId) {
    try {
      const pkg = await this.dataService.getPackageById(packageId);
      if (!pkg) {
        console.error("Package not found:", packageId);
        this.setPackageError("Package not found. Please go back and select a valid package.");
        return;
      }

      this.selectedPackage = pkg;
      this.displayPackageInfo(pkg);
      await this.displayFlowerSelection(pkg);
    } catch (error) {
      console.error("Error loading package:", error);
      this.setPackageError("Error loading package details.");
    }
  }

  displayPackageInfo(pkg) {
    if (this.eventPackageCard) this.eventPackageCard.style.display = "block";
    if (this.packageNameSpan) this.packageNameSpan.textContent = pkg.name || "";

    if (this.packagePriceSpan) {
      const priceValue = Number(pkg.price);
      this.packagePriceSpan.textContent =
        Number.isFinite(priceValue) && priceValue > 0
          ? `\u20B1${priceValue.toLocaleString("en-US")}`
          : "";
    }

    if (this.packagePaxSpan) {
      const paxValue = Number(pkg.pax);
      this.packagePaxSpan.textContent =
        Number.isFinite(paxValue) && paxValue > 0 ? `${paxValue} guests` : "";
    }

    if (this.packageFlowersSpan) {
      const counts = this.getPackageFlowerCounts(pkg);
      if (counts.mainCount || counts.fillerCount) {
        this.packageFlowersSpan.textContent = `${counts.mainCount} main + ${counts.fillerCount} fillers`;
      } else if (counts.total) {
        this.packageFlowersSpan.textContent = `${counts.total} flowers`;
      } else {
        this.packageFlowersSpan.textContent = "No flowers";
      }
    }
  }

  updateFlowerLimitText(counts) {
    if (!this.flowerLimitText) return;

    if (counts.enforcePerType) {
      const parts = [];
      if (counts.mainCount > 0) parts.push(`${counts.mainCount} main`);
      if (counts.fillerCount > 0) parts.push(`${counts.fillerCount} filler`);
      this.flowerLimitText.textContent = `Select exactly ${parts.join(" and ")} flower(s)`;
      this.flowerLimitText.hidden = false;
      return;
    }

    if (counts.enforceTotal) {
      this.flowerLimitText.textContent = `Select exactly ${counts.total} flower(s) total`;
      this.flowerLimitText.hidden = false;
      return;
    }

    this.flowerLimitText.textContent = "No flower selection required.";
    this.flowerLimitText.hidden = false;
  }

  createFlowerCheckbox(flower, type) {
    const flowerName = flower?.name || "Unnamed flower";
    const outOfStock = EventBookingController.isOutOfStock(flower);
    const label = document.createElement("label");
    label.className = "flower-option";
    if (outOfStock) label.classList.add("is-unavailable");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = type === "main" ? "mainFlower" : "fillerFlower";
    checkbox.value = flowerName;
    checkbox.dataset.type = type;
    checkbox.dataset.stockLocked = outOfStock ? "true" : "false";
    if (outOfStock) {
      checkbox.disabled = true;
      checkbox.setAttribute("aria-disabled", "true");
    }

    checkbox.addEventListener("change", () => this.validateFlowerSelection());

    const body = document.createElement("span");
    body.className = "flower-option__body";

    const media = document.createElement("span");
    media.className = "flower-option__media";

    const imageUrl = EventBookingController.getSafeAssetUrl(flower?.image);
    if (imageUrl) {
      const image = document.createElement("img");
      image.className = "flower-option__image";
      image.src = imageUrl;
      image.alt = `${flowerName} preview`;
      media.appendChild(image);
    } else {
      media.classList.add("flower-option__media--fallback");
      media.textContent = flowerName.trim().charAt(0).toUpperCase() || "?";
    }

    const content = document.createElement("span");
    content.className = "flower-option__content";

    const name = document.createElement("span");
    name.className = "flower-option__name";
    name.textContent = flowerName;

    const meta = document.createElement("span");
    meta.className = "flower-option__meta";
    meta.textContent = type === "filler" ? "Filler flower" : "Main flower";

    content.append(name, meta);
    body.append(media, content);
    label.appendChild(checkbox);
    label.appendChild(body);

    if (outOfStock) {
      const stockBadge = document.createElement("span");
      stockBadge.className = "flower-stock";
      stockBadge.textContent = "Out of stock";
      label.appendChild(stockBadge);
    }

    return label;
  }

  validateFlowerSelection() {
    if (!this.selectedPackage || !this.shouldValidateFlowers) return;

    const mainCheckboxes = Array.from(document.querySelectorAll('input[name="mainFlower"]'));
    const fillerCheckboxes = Array.from(document.querySelectorAll('input[name="fillerFlower"]'));

    const mainSelected = mainCheckboxes.filter((cb) => cb.checked).length;
    const fillerSelected = fillerCheckboxes.filter((cb) => cb.checked).length;
    const totalSelected = mainSelected + fillerSelected;

    const updateGroup = (checkboxes, selectedCount, limit) => {
      checkboxes.forEach((cb) => {
        if (cb.dataset.stockLocked === "true") return;
        if (limit === 0 && this.flowerRequirements.enforcePerType) {
          cb.disabled = true;
          return;
        }
        if (!cb.checked && limit > 0 && selectedCount >= limit) {
          cb.disabled = true;
        } else if (!cb.checked) {
          cb.disabled = false;
        }
      });
    };

    if (this.flowerRequirements.enforcePerType) {
      updateGroup(mainCheckboxes, mainSelected, this.flowerRequirements.mainCount);
      updateGroup(fillerCheckboxes, fillerSelected, this.flowerRequirements.fillerCount);
      return;
    }

    if (this.flowerRequirements.enforceTotal) {
      const allCheckboxes = [...mainCheckboxes, ...fillerCheckboxes];
      updateGroup(allCheckboxes, totalSelected, this.flowerRequirements.total);
    }
  }

  getSelectedFlowers() {
    const mainFlowers = Array.from(document.querySelectorAll('input[name="mainFlower"]:checked'))
      .map((cb) => cb.value);
    const fillerFlowers = Array.from(document.querySelectorAll('input[name="fillerFlower"]:checked'))
      .map((cb) => cb.value);

    return {
      main: mainFlowers,
      fillers: fillerFlowers,
      total: mainFlowers.length + fillerFlowers.length
    };
  }

  async displayFlowerSelection(pkg) {
    if (!this.eventFlowersCard) return;

    const allowedFlowerIds = Array.isArray(pkg?.allowedFlowerIds)
      ? pkg.allowedFlowerIds.filter(Boolean)
      : [];
    const legacyMain = Array.isArray(pkg?.mainFlowers) ? pkg.mainFlowers : [];
    const legacyFiller = Array.isArray(pkg?.fillerFlowers) ? pkg.fillerFlowers : [];

    const counts = this.getPackageFlowerCounts(pkg);
    this.flowerRequirements = counts;
    this.shouldValidateFlowers = true;
    this.flowerValidationNotice = "";

    let flowers = [];

    if (allowedFlowerIds.length > 0) {
      const allFlowers = await this.dataService.getAllFlowers();
      flowers = allFlowers.filter((flower) => allowedFlowerIds.includes(flower.id));
    } else if (legacyMain.length || legacyFiller.length) {
      flowers = [
        ...legacyMain.map((name, index) => ({
          id: `legacy-main-${index}`,
          name,
          type: "main",
          active: true
        })),
        ...legacyFiller.map((name, index) => ({
          id: `legacy-filler-${index}`,
          name,
          type: "filler",
          active: true
        }))
      ];
    }

    if (!flowers.length && (counts.enforcePerType || counts.enforceTotal)) {
      this.setPackageError(
        "This package has no allowed flowers configured yet. You can still submit your request and we will confirm the flower details after."
      );
      this.shouldValidateFlowers = false;
    }

    if (!flowers.length) {
      this.eventFlowersCard.style.display = "none";
      return;
    }

    this.eventFlowersCard.style.display = "block";

    const sortByName = (a, b) => String(a?.name || "").localeCompare(String(b?.name || ""));
    const mainFlowers = flowers
      .filter((flower) => (flower.type || "main") === "main")
      .sort(sortByName);
    const fillerFlowers = flowers
      .filter((flower) => flower.type === "filler")
      .sort(sortByName);

    const availableMain = mainFlowers.length;
    const availableFiller = fillerFlowers.length;
    const availableTotal = availableMain + availableFiller;

    if (counts.enforcePerType) {
      if (counts.mainCount > availableMain || counts.fillerCount > availableFiller) {
        this.shouldValidateFlowers = false;
        this.flowerValidationNotice =
          "Flower selection is limited for this package right now. You can submit your request and we will confirm the flower details after.";
      }
    } else if (counts.enforceTotal && counts.total > availableTotal) {
      this.shouldValidateFlowers = false;
      this.flowerValidationNotice =
        "Flower selection is limited for this package right now. You can submit your request and we will confirm the flower details after.";
    }

    if (this.shouldValidateFlowers) {
      this.updateFlowerLimitText(counts);
    } else if (this.flowerLimitText) {
      this.flowerLimitText.textContent =
        this.flowerValidationNotice || "Flower selection is optional for this package.";
      this.flowerLimitText.hidden = false;
    }

    if (this.eventMainFlowerOptions) this.eventMainFlowerOptions.innerHTML = "";
    if (this.eventFillerFlowerOptions) this.eventFillerFlowerOptions.innerHTML = "";

    if (mainFlowers.length) {
      mainFlowers.forEach((flower) => {
        this.eventMainFlowerOptions?.appendChild(this.createFlowerCheckbox(flower, "main"));
      });
      if (this.eventMainFlowerEmpty) this.eventMainFlowerEmpty.hidden = true;
    } else if (this.eventMainFlowerEmpty) {
      this.eventMainFlowerEmpty.hidden = false;
    }

    if (fillerFlowers.length) {
      fillerFlowers.forEach((flower) => {
        this.eventFillerFlowerOptions?.appendChild(this.createFlowerCheckbox(flower, "filler"));
      });
      if (this.eventFillerFlowerEmpty) this.eventFillerFlowerEmpty.hidden = true;
    } else if (this.eventFillerFlowerEmpty) {
      this.eventFillerFlowerEmpty.hidden = false;
    }

    this.validateFlowerSelection();
  }

  async validateBeforeSubmit() {
    const user = this.currentUser || this.auth.currentUser;
    if (!user) {
      await showAlert("Please log in again.");
      window.location.href = "login-register.html";
      return { valid: false };
    }

    if (!this.selectedPackage) {
      await showAlert("No package selected. Please go back and choose a package.");
      return { valid: false };
    }

    if (this.shouldValidateFlowers &&
      (this.flowerRequirements.enforcePerType || this.flowerRequirements.enforceTotal)) {
      const selectedFlowers = this.getSelectedFlowers();
      if (this.flowerRequirements.enforcePerType) {
        if (
          selectedFlowers.main.length !== this.flowerRequirements.mainCount ||
          selectedFlowers.fillers.length !== this.flowerRequirements.fillerCount
        ) {
          await showAlert(
            `Please select exactly ${this.flowerRequirements.mainCount} main and ${this.flowerRequirements.fillerCount} filler flowers.`
          );
          return { valid: false };
        }
      } else if (this.flowerRequirements.enforceTotal) {
        if (selectedFlowers.total !== this.flowerRequirements.total) {
          await showAlert(
            `Please select exactly ${this.flowerRequirements.total} flower(s). You have selected ${selectedFlowers.total}.`
          );
          return { valid: false };
        }
      }
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
      if (EventBookingController.isBlank(field.el.value)) {
        await showAlert(field.message);
        return { valid: false };
      }
    }

    return { valid: true, user, locationType };
  }

  bindSubmit() {
    if (!this.submitBtn) return;

    this.submitBtn.addEventListener("click", async (event) => {
      event.preventDefault();

      const validation = await this.validateBeforeSubmit();
      if (!validation.valid) return;

      const location = getLocationData(validation.locationType);
      const selectedFlowers = this.getSelectedFlowers();

      try {
        const result = await this.dataService.createEventBooking({
          user: validation.user,
          userName: this.currentUserProfile?.name || "",
          selectedPackage: this.selectedPackage,
          flowerRequirements: this.flowerRequirements,
          selectedFlowers,
          location,
          date: this.dateInput?.value || "",
          timeRange: getTimeRange(),
          notes: this.specialRequestsInput?.value || ""
        });

        await showAlert(
          `Success! Your event request has been submitted.\nReference: ${result.bookingRef}\n\nWe will confirm availability before requesting payment.\n\nWe will take you to your booking confirmation next.`
        );
        window.location.href = `profile.html?bookingId=${result.bookingId}#bookings`;
      } catch (error) {
        console.error("Failed to save booking:", error);
        await showAlert("Failed to save booking. Please try again.");
      }
    });
  }
}

const eventBookingController = new EventBookingController({
  authInstance: auth,
  profileService: new UserProfileService(db),
  dataService: new EventBookingDataService(db)
});

eventBookingController.init();
