import { getBookingReferencePrefix } from "../shared-booking-logic.js";

export class AppUtils {
  static setVisibility(isVisible) {
    document.documentElement.style.visibility = isVisible ? "" : "hidden";
  }

  static redirectTo(path) {
    window.location.href = path;
  }

  static parseDate(value) {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-").map(Number);
      return new Date(year, month - 1, day);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  static parseTimestamp(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value === "object" && typeof value.seconds === "number") {
      return new Date(value.seconds * 1000);
    }
    if (typeof value === "number") return new Date(value);
    if (typeof value === "string") {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  static formatDate(value) {
    const date = AppUtils.parseDate(value);
    if (!date) return "";
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  static formatCurrency(value) {
    return `PHP ${Number(value || 0).toLocaleString("en-US")}`;
  }

  static formatAmount(value) {
    if (value === null || value === undefined || value === "") return "";
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return AppUtils.formatCurrency(numeric);
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed ? trimmed : "";
    }
    return "";
  }

  static getAmountValue(booking) {
    if (!booking) return null;
    return (
      booking.paymentAmount ??
      booking.amount ??
      booking.totalAmount ??
      booking.packagePrice ??
      booking.price ??
      booking.seminarPrice ??
      booking.budget
    );
  }

  static getAmountText(booking, label = "Amount") {
    const formatted = AppUtils.formatAmount(AppUtils.getAmountValue(booking));
    return formatted ? `${label}: ${formatted}` : "";
  }

  static getStatusLabel(status) {
    if (!status) return "Pending";
    const normalizedKey = AppUtils.normalizeStatusKey(status);
    if (normalizedKey === "pending_availability") return "Pending";
    if (
      normalizedKey === "approved" ||
      normalizedKey === "accepted" ||
      normalizedKey === "completed" ||
      normalizedKey === "confirmed"
    ) {
      return "Completed";
    }
    const normalized = status.replace(/_/g, " ");
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  static getTypeLabel(type) {
    if (type === "event") return "Event";
    if (type === "seminar") return "Workshop";
    return "Popup";
  }

  static normalizeValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  static getSafeAssetUrl(value) {
    const raw = AppUtils.normalizeValue(value);
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

  static normalizeStatusKey(value) {
    return String(value || "pending")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  }

  static joinParts(parts) {
    return parts.filter(Boolean).join(", ");
  }

  static getSearchableText(booking) {
    const location = booking?.location || {};
    const fields = [
      booking.userName,
      booking.userEmail,
      booking.contact,
      booking.bookingRef,
      booking.reference,
      booking.referenceNumber,
      booking.popupTitle,
      booking.eventTitle,
      booking.seminarTitle,
      booking.packageName,
      booking.seminarLocation,
      location.name,
      location.city,
      location.province,
      location.barangay,
      location.street,
      location.unit,
      location.landmark,
      location.postalCode,
      location.notes,
      booking.notes,
    ];

    return fields
      .map((value) => AppUtils.normalizeValue(value))
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  static getLocationSummary(booking) {
    if (booking.seminarLocation) return booking.seminarLocation;
    const location = booking?.location || {};
    const locationName = AppUtils.normalizeValue(location.name);
    const city = AppUtils.normalizeValue(location.city);
    const province = AppUtils.normalizeValue(location.province);
    const tail = city || province;
    if (locationName && tail) return `${locationName} - ${tail}`;
    return locationName || tail || "";
  }

  static getLocationDetails(booking) {
    if (booking.seminarLocation) {
      return { primary: booking.seminarLocation, secondary: "" };
    }

    const location = booking?.location || {};
    const locationName = AppUtils.normalizeValue(location.name);
    const locationType = AppUtils.normalizeValue(location.type);
    const province = AppUtils.normalizeValue(location.province);
    const city = AppUtils.normalizeValue(location.city);
    const barangay = AppUtils.normalizeValue(location.barangay);
    const street = AppUtils.normalizeValue(location.street);
    const unit = AppUtils.normalizeValue(location.unit);
    const landmark = AppUtils.normalizeValue(location.landmark);
    const postalCode = AppUtils.normalizeValue(location.postalCode);
    const notes = AppUtils.normalizeValue(location.notes);

    const primary =
      locationName ||
      (locationType === "venue"
        ? "Event Venue"
        : locationType === "house"
        ? "Private Residence"
        : "");

    const addressParts = [];
    if (unit) addressParts.push(unit);
    if (street) addressParts.push(street);
    if (barangay) addressParts.push(barangay);
    if (city) addressParts.push(city);
    if (province) addressParts.push(province);
    if (postalCode) addressParts.push(postalCode);

    let secondary = AppUtils.joinParts(addressParts);
    if (landmark) secondary = secondary ? `${secondary} - Landmark: ${landmark}` : `Landmark: ${landmark}`;
    if (notes) secondary = secondary ? `${secondary} - Notes: ${notes}` : `Notes: ${notes}`;

    return { primary: primary || "", secondary: secondary || "" };
  }

  static getBookingReference(booking) {
    const ref = AppUtils.normalizeValue(
      booking.bookingRef || booking.reference || booking.referenceNumber
    );
    if (ref) return ref;
    if (booking.id) {
      const prefix = getBookingReferencePrefix(booking.bookingType);
      return `${prefix}-${String(booking.id).slice(0, 8).toUpperCase()}`;
    }
    return "";
  }

  static getSortableDate(booking) {
    return (
      AppUtils.parseTimestamp(booking.timestamp) ||
      AppUtils.parseTimestamp(booking.createdAt) ||
      AppUtils.parseTimestamp(booking.updatedAt) ||
      AppUtils.parseDate(booking.date || booking.seminarDate)
    );
  }

  static isSameDay(first, second) {
    if (!first || !second) return false;
    return (
      first.getFullYear() === second.getFullYear() &&
      first.getMonth() === second.getMonth() &&
      first.getDate() === second.getDate()
    );
  }

  static isPendingStatus(status) {
    if (!status) return true;
    return status.toLowerCase().includes("pending");
  }

  static isCompletedStatus(status) {
    if (!status) return false;
    const normalized = AppUtils.normalizeStatusKey(status);
    return (
      normalized === "completed" ||
      normalized === "approved" ||
      normalized === "accepted" ||
      normalized === "confirmed"
    );
  }

  static isAcceptedStatus(status) {
    return AppUtils.isCompletedStatus(status);
  }

  static isPastSeminar(seminar) {
    const date = AppUtils.parseDate(seminar.date);
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  }
}

// Small DOM convenience helpers to keep query usage consistent.
export class Dom {
  static qs(selector, root = document) {
    return root.querySelector(selector);
  }

  static qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  static setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (value === null || value === undefined) {
      el.textContent = "";
      return;
    }
    el.textContent = String(value);
  }
}

// Basic modal wrapper with open/close and backdrop handling.
