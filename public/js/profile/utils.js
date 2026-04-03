class ProfileUtils {
  static setText(el, value) {
    if (el) el.textContent = value;
  }

  static setValue(el, value) {
    if (el) el.value = value;
  }

  static setHidden(el, hidden) {
    if (el) el.hidden = hidden;
  }

  static normalizeStatus(status) {
    return typeof status === "string" ? status.trim().toLowerCase() : "";
  }

  static normalizeStatusKey(value) {
    return ProfileUtils.normalizeStatus(value).replace(/\s+/g, "_");
  }

  static parseDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value === "object" && typeof value.seconds === "number") {
      return new Date(value.seconds * 1000);
    }
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-").map(Number);
      return new Date(year, month - 1, day);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  static formatDateValue(value) {
    const date = ProfileUtils.parseDateValue(value);
    if (!date) return typeof value === "string" && value.trim() ? value : "";
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  static formatStatusLabel(status) {
    if (!status) return "Pending";
    const normalized = status.replace(/_/g, " ");
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  static sanitizeAssetUrl(value) {
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

export const setText = (el, value) => ProfileUtils.setText(el, value);
export const setValue = (el, value) => ProfileUtils.setValue(el, value);
export const setHidden = (el, hidden) => ProfileUtils.setHidden(el, hidden);
export const normalizeStatus = (status) => ProfileUtils.normalizeStatus(status);
export const normalizeStatusKey = (value) => ProfileUtils.normalizeStatusKey(value);
export const parseDateValue = (value) => ProfileUtils.parseDateValue(value);
export const formatDateValue = (value) => ProfileUtils.formatDateValue(value);
export const formatStatusLabel = (status) => ProfileUtils.formatStatusLabel(status);
export const sanitizeAssetUrl = (value) => ProfileUtils.sanitizeAssetUrl(value);
