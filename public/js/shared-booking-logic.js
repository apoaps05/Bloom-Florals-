class SharedBookingLogicService {
  static luzonData = {
    "Metro Manila": ["Quezon City", "Manila", "Makati", "Taguig", "Pasig"],
    Cavite: ["Bacoor", "Imus", "Dasmari\u00F1as", "Tagaytay"],
    Laguna: ["Calamba", "Bi\u00F1an", "Santa Rosa", "Los Ba\u00F1os"],
    Bulacan: ["Malolos", "Meycauayan", "San Jose del Monte"]
  };

  static populateTimeSelect(selectElement) {
    if (!selectElement) return;
    selectElement.innerHTML = '<option value="">Select time</option>';

    for (let hour = 0; hour < 24; hour++) {
      for (const min of [0, 30]) {
        const hourStr = hour.toString().padStart(2, "0");
        const minStr = min.toString().padStart(2, "0");
        const value = `${hourStr}:${minStr}`;

        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        const period = hour < 12 ? "AM" : "PM";
        const display = `${displayHour}:${minStr} ${period}`;

        const option = document.createElement("option");
        option.value = value;
        option.textContent = display;
        selectElement.appendChild(option);
      }
    }
  }

  static populateProvinceSelect(selectEl) {
    if (!selectEl) return;
    Object.keys(SharedBookingLogicService.luzonData).forEach((province) => {
      const option = document.createElement("option");
      option.value = province;
      option.textContent = province;
      selectEl.appendChild(option);
    });
  }

  static bindCitySelect(provinceEl, cityEl) {
    if (!provinceEl || !cityEl) return;
    provinceEl.addEventListener("change", () => {
      cityEl.innerHTML = '<option value="">Select City</option>';
      const cities = SharedBookingLogicService.luzonData[provinceEl.value];
      if (!cities) return;
      cities.forEach((city) => {
        const option = document.createElement("option");
        option.value = city;
        option.textContent = city;
        cityEl.appendChild(option);
      });
    });
  }

  static initializeLocationButtons() {
    const locationButtons = document.querySelectorAll("[data-location]");
    const houseLocation = document.getElementById("houseLocation");
    const venueLocation = document.getElementById("venueLocation");

    let locationType = "house";

    locationButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        locationButtons.forEach((button) => button.classList.remove("active"));
        btn.classList.add("active");
        locationType = btn.dataset.location;

        if (houseLocation) houseLocation.style.display = locationType === "house" ? "block" : "none";
        if (venueLocation) venueLocation.style.display = locationType === "venue" ? "block" : "none";
      });
    });

    return { getLocationType: () => locationType };
  }

  static initializeTimeInputs() {
    const startTimeInput = document.getElementById("startTime");
    const endTimeInput = document.getElementById("endTime");

    if (startTimeInput && endTimeInput) {
      SharedBookingLogicService.populateTimeSelect(startTimeInput);
      SharedBookingLogicService.populateTimeSelect(endTimeInput);
    }

    return { startTimeInput, endTimeInput };
  }

  static initializeLocationInputs() {
    const houseProvinceSelect = document.getElementById("province");
    const houseCitySelect = document.getElementById("city");
    const venueProvinceSelect = document.getElementById("venueProvince");
    const venueCitySelect = document.getElementById("venueCity");

    SharedBookingLogicService.populateProvinceSelect(houseProvinceSelect);
    SharedBookingLogicService.populateProvinceSelect(venueProvinceSelect);
    SharedBookingLogicService.bindCitySelect(houseProvinceSelect, houseCitySelect);
    SharedBookingLogicService.bindCitySelect(venueProvinceSelect, venueCitySelect);

    return {
      houseProvinceSelect,
      houseCitySelect,
      venueProvinceSelect,
      venueCitySelect
    };
  }

  static getLocationData(locationType) {
    const houseProvinceSelect = document.getElementById("province");
    const houseCitySelect = document.getElementById("city");
    const houseBarangayInput = document.getElementById("houseBarangay");
    const houseStreetInput = document.getElementById("houseStreet");
    const houseUnitInput = document.getElementById("houseUnit");
    const houseLandmarkInput = document.getElementById("houseLandmark");
    const housePostalCodeInput = document.getElementById("housePostalCode");
    const venueProvinceSelect = document.getElementById("venueProvince");
    const venueCitySelect = document.getElementById("venueCity");
    const venueNameInput = document.getElementById("venueName");
    const venueBarangayInput = document.getElementById("venueBarangay");
    const venueNotesInput = document.getElementById("venueNotes");

    const houseLocationData = {
      type: "house",
      name: "Private Residence",
      province: houseProvinceSelect?.value || "",
      city: houseCitySelect?.value || "",
      barangay: houseBarangayInput?.value || "",
      street: houseStreetInput?.value || "",
      unit: houseUnitInput?.value || "",
      landmark: houseLandmarkInput?.value || "",
      postalCode: housePostalCodeInput?.value || "",
      notes: ""
    };

    const venueLocationData = {
      type: "venue",
      name: venueNameInput?.value || "Event Venue",
      province: venueProvinceSelect?.value || "",
      city: venueCitySelect?.value || "",
      barangay: venueBarangayInput?.value || "",
      street: "",
      unit: "",
      landmark: "",
      postalCode: "",
      notes: venueNotesInput?.value || ""
    };

    return locationType === "venue" ? venueLocationData : houseLocationData;
  }

  static getTimeRange() {
    const startTimeInput = document.getElementById("startTime");
    const endTimeInput = document.getElementById("endTime");

    return startTimeInput?.value && endTimeInput?.value
      ? `${startTimeInput.value} - ${endTimeInput.value}`
      : "";
  }

  static getBookingReferencePrefix(bookingType) {
    const normalized = String(bookingType || "").trim().toLowerCase();
    if (normalized.includes("popup") || normalized.includes("pop-up") || normalized.includes("pop up")) {
      return "POP";
    }
    if (normalized.includes("event")) return "EVT";
    if (normalized.includes("seminar")) return "SEM";
    return "BKG";
  }

  static createBookingReference(docId, bookingType) {
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}`;
    const cleanedId = String(docId || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const idPart = cleanedId.slice(0, 8);
    const randomPart = Math.random().toString(36).slice(2, 10).toUpperCase();
    const tail = idPart || randomPart;
    const prefix = SharedBookingLogicService.getBookingReferencePrefix(bookingType);
    return `${prefix}-${datePart}-${tail}`;
  }
}

export function initializeLocationButtons() {
  return SharedBookingLogicService.initializeLocationButtons();
}

export function initializeTimeInputs() {
  return SharedBookingLogicService.initializeTimeInputs();
}

export function initializeLocationInputs() {
  return SharedBookingLogicService.initializeLocationInputs();
}

export function getLocationData(locationType) {
  return SharedBookingLogicService.getLocationData(locationType);
}

export function getTimeRange() {
  return SharedBookingLogicService.getTimeRange();
}

export function getBookingReferencePrefix(bookingType) {
  return SharedBookingLogicService.getBookingReferencePrefix(bookingType);
}

export function createBookingReference(docId, bookingType) {
  return SharedBookingLogicService.createBookingReference(docId, bookingType);
}
