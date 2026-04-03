const admin = require("firebase-admin");
// deploy bump
const {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentUpdatedWithAuthContext,
} = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");
const { logger } = require("firebase-functions");

admin.initializeApp();
const db = admin.firestore();

const APP_NAME = defineString("APP_NAME", { default: "Bloom Florals" });
const PUBLIC_APP_URL = defineString("PUBLIC_APP_URL", { default: "" });
const ADMIN_EMAIL = defineString("ADMIN_EMAIL", { default: "" });
const SUPPORT_EMAIL = defineString("SUPPORT_EMAIL", { default: "" });

const MAIL_COLLECTION = "mail";
const DATE_FORMAT = { year: "numeric", month: "long", day: "numeric" };
const AUTO_CANCEL_BATCH_SIZE = 250;
const PAYMENT_TIMEOUT_REASON = "payment_timeout";
const PAYMENT_TIMEOUT_MESSAGE = "Booking auto-cancelled because payment was not submitted on time.";
const PAYMENT_DEADLINE_MS = 72 * 60 * 60 * 1000;
const PAYMENT_METHODS = new Set(["gcash", "bank", "paymaya"]);
const PAYMENT_FINAL_STATUSES = new Set(["submitted", "approved", "declined", "expired"]);
const PAYMENT_PROOF_HOSTS = new Set(["firebasestorage.googleapis.com", "storage.googleapis.com"]);
const BOOKING_HISTORY_COLLECTION = "statusHistory";

const asString = (value) => (value === undefined || value === null ? "" : String(value));
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(asString(value));

const escapeHtml = (value) =>
  asString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeStatus = (status) =>
  asString(status)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const isPaymentRequiredStatus = (status) => {
  const normalized = normalizeStatus(status);
  if (!normalized) return false;
  if (normalized === "awaiting_payment") return true;
  if (normalized === "payment_required") return true;
  if (normalized === "payment_request" || normalized === "payment_requested") return true;
  if (normalized.includes("awaiting") && normalized.includes("payment")) return true;
  if (normalized.includes("payment") && normalized.includes("required")) return true;
  if (normalized.includes("payment") && normalized.includes("request")) return true;
  return false;
};

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const computePaymentDueAt = (booking) => {
  const explicitDueAt = toDate(booking?.paymentDueAt);
  if (explicitDueAt) return explicitDueAt;

  const confirmedAt = toDate(booking?.confirmedAt);
  if (confirmedAt) return new Date(confirmedAt.getTime() + PAYMENT_DEADLINE_MS);

  const bookingType = asString(booking?.bookingType).trim().toLowerCase();
  if (bookingType === "seminar") {
    const createdAt = toDate(booking?.timestamp);
    if (!createdAt) return null;
    return new Date(createdAt.getTime() + PAYMENT_DEADLINE_MS);
  }

  return null;
};

const isPaymentFinalStatus = (status) => PAYMENT_FINAL_STATUSES.has(normalizeStatus(status));

const clampText = (value, maxLength = 2000) => asString(value).trim().slice(0, maxLength);

const isAllowedPaymentProofHost = (host) => {
  const normalizedHost = asString(host).trim().toLowerCase();
  if (!normalizedHost) return false;
  if (PAYMENT_PROOF_HOSTS.has(normalizedHost)) return true;
  return normalizedHost === "firebasestorage.app" || normalizedHost.endsWith(".firebasestorage.app");
};

const isValidPaymentProofUrl = (value) => {
  const raw = asString(value).trim();
  if (!raw) return false;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:") {
      return isAllowedPaymentProofHost(parsed.hostname);
    }

    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    return isLocalhost && parsed.protocol === "http:";
  } catch (_error) {
    return false;
  }
};

const getExpectedProofFolder = (bookingType) => {
  const normalizedType = normalizeStatus(bookingType);
  if (normalizedType === "event") return "event-payments";
  if (normalizedType === "seminar") return "seminar-payments";
  return "";
};

const isValidPaymentProofPath = (bookingType, bookingId, proofPath) => {
  const normalizedPath = asString(proofPath).trim().replace(/\\/g, "/");
  if (!normalizedPath || !bookingId) return false;
  if (normalizedPath.includes("..")) return false;
  if (normalizedPath.startsWith("/") || normalizedPath.endsWith("/")) return false;
  if (normalizedPath.length > 300) return false;

  const expectedFolder = getExpectedProofFolder(bookingType);
  if (!expectedFolder) return false;

  const expectedPrefix = `${expectedFolder}/${bookingId}/`;
  return normalizedPath.startsWith(expectedPrefix) && normalizedPath.length > expectedPrefix.length;
};

const doesPaymentProofUrlMatchPath = (paymentProofUrl, paymentProofPath) => {
  const rawUrl = asString(paymentProofUrl).trim();
  const rawPath = asString(paymentProofPath).trim().replace(/\\/g, "/");
  if (!rawUrl || !rawPath) return false;

  try {
    const parsed = new URL(rawUrl);
    const decodedPathname = decodeURIComponent(parsed.pathname || "");
    if (decodedPathname.includes(`/o/${rawPath}`)) return true;

    const objectName = asString(parsed.searchParams.get("name")).trim();
    if (!objectName) return false;
    return decodeURIComponent(objectName) === rawPath;
  } catch (_error) {
    return false;
  }
};

const resolveAuditActor = ({ before, after, statusChanged, paymentChanged, authId, authType }) => {
  const authActor = asString(authId).trim();
  if (authActor) return authActor;
  if (authType === "system" || authType === "service_account") return authType;

  const explicitActor = asString(after?.updatedBy).trim();
  if (explicitActor) return explicitActor;

  const cancelledBy = asString(after?.cancelledBy).trim();
  if (cancelledBy) return cancelledBy;

  if (statusChanged && normalizeStatus(after?.status) === "payment_submitted") {
    const userId = asString(after?.userId).trim();
    if (userId) return userId;
  }

  if (paymentChanged && normalizeStatus(after?.paymentStatus) === "submitted") {
    const userId = asString(after?.userId).trim();
    if (userId) return userId;
  }

  const legacyActor = asString(before?.updatedBy).trim();
  if (legacyActor) return legacyActor;

  return "unknown";
};

const formatStatus = (status) => {
  if (!status) return "Pending";
  const normalized = asString(status).replace(/_/g, " ").trim();
  if (!normalized) return "Pending";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatDate = (value) => {
  if (!value) return "-";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString("en-US", DATE_FORMAT);
    }
    return value;
  }
  if (typeof value.toDate === "function") {
    return value.toDate().toLocaleDateString("en-US", DATE_FORMAT);
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000).toLocaleDateString("en-US", DATE_FORMAT);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleDateString("en-US", DATE_FORMAT);
};

const formatMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "-";
  return `PHP ${amount.toLocaleString("en-US")}`;
};

const getBookingTitle = (booking) => {
  if (booking?.bookingType === "seminar") return booking.seminarTitle || "Workshop Booking";
  if (booking?.bookingType === "event") {
    if (booking.packageName) return `Event: ${booking.packageName}`;
    return booking.eventTitle || "Event Booking";
  }
  if (booking?.bookingType === "popup") return booking.popupTitle || "Pop-up Booking";
  return booking?.eventTitle || booking?.popupTitle || "Booking";
};

const getBookingTypeLabel = (booking) => {
  const type = asString(booking?.bookingType).toLowerCase();
  if (type === "event") return "Event Booking";
  if (type === "seminar") return "Workshop Booking";
  if (type === "popup") return "Pop-up Booking";
  return "Booking";
};

const getBookingReference = (booking) => {
  const ref = asString(booking?.bookingRef || booking?.reference || booking?.referenceNumber).trim();
  if (ref) return ref;
  if (booking?.id) return `BKG-${String(booking.id).slice(0, 8).toUpperCase()}`;
  return "BKG";
};

const getLocationValue = (booking, key) => {
  const location = booking?.location || {};
  return asString(location?.[key]).trim();
};

const getLocationAddress = (booking) => {
  const parts = [];
  const unit = getLocationValue(booking, "unit");
  const street = getLocationValue(booking, "street");
  const barangay = getLocationValue(booking, "barangay");
  const city = getLocationValue(booking, "city");
  const province = getLocationValue(booking, "province");
  const postalCode = getLocationValue(booking, "postalCode");

  if (unit) parts.push(`Unit ${unit}`);
  if (street) parts.push(street);
  if (barangay) parts.push(`Brgy. ${barangay}`);
  if (city) parts.push(city);
  if (province) parts.push(province);
  if (postalCode) parts.push(postalCode);
  return parts.filter(Boolean).join(", ");
};

const getLocationNotes = (booking) => {
  const parts = [];
  const landmark = getLocationValue(booking, "landmark");
  const notes = getLocationValue(booking, "notes");
  if (landmark) parts.push(`Landmark: ${landmark}`);
  if (notes) parts.push(notes);
  return parts.filter(Boolean).join(" | ");
};

const addRow = (rows, label, value) => {
  if (value === undefined || value === null) return;
  const text = asString(value).trim();
  if (!text) return;
  rows.push({ label, value: text });
};

const buildSections = (booking) => {
  const sections = [];

  const summary = [];
  addRow(summary, "Reference", getBookingReference(booking));
  addRow(summary, "Status", formatStatus(booking?.status));
  addRow(summary, "Type", getBookingTypeLabel(booking));
  addRow(summary, "Title", getBookingTitle(booking));
  addRow(summary, "Submitted", formatDate(booking?.timestamp || booking?.createdAt));
  addRow(summary, "Name", booking?.userName);
  addRow(summary, "Email", booking?.userEmail);
  if (summary.length) sections.push({ title: "Booking Summary", rows: summary });

  const schedule = [];
  addRow(schedule, "Date", formatDate(booking?.date || booking?.seminarDate));
  addRow(schedule, "Time", booking?.timeRange || booking?.seminarTime || booking?.time);
  if (schedule.length) sections.push({ title: "Schedule", rows: schedule });

  const location = [];
  if (booking?.seminarLocation) {
    addRow(location, "Location", booking.seminarLocation);
  } else {
    const locationTypeValue = getLocationValue(booking, "type");
    const locationType =
      locationTypeValue === "venue"
        ? "Venue"
        : locationTypeValue === "house"
        ? "Private Residence"
        : "";
    addRow(location, "Location type", locationType);
    addRow(location, "Location name", getLocationValue(booking, "name"));
    addRow(location, "Address", getLocationAddress(booking));
    addRow(location, "Landmark / Notes", getLocationNotes(booking));
  }
  if (location.length) sections.push({ title: "Location", rows: location });

  if (booking?.bookingType === "event") {
    const eventDetails = [];
    addRow(eventDetails, "Package", booking?.packageName);
    addRow(eventDetails, "Price", formatMoney(booking?.packagePrice));
    addRow(eventDetails, "Guests", booking?.packagePax ? `${booking.packagePax} pax` : "");
    addRow(eventDetails, "Total flowers", booking?.packageFlowers);
    if (Array.isArray(booking?.selectedMainFlowers) && booking.selectedMainFlowers.length) {
      addRow(eventDetails, "Main flowers", booking.selectedMainFlowers.join(", "));
    }
    if (Array.isArray(booking?.selectedFillerFlowers) && booking.selectedFillerFlowers.length) {
      addRow(eventDetails, "Filler flowers", booking.selectedFillerFlowers.join(", "));
    }
    if (eventDetails.length) sections.push({ title: "Event Details", rows: eventDetails });
  }

  if (booking?.bookingType === "seminar") {
    const seminarDetails = [];
    addRow(seminarDetails, "Workshop", booking?.seminarTitle);
    addRow(seminarDetails, "Location", booking?.seminarLocation);
    if (seminarDetails.length) sections.push({ title: "Workshop Details", rows: seminarDetails });
  }

  const payment = [];
  if (booking?.paymentStatus) {
    addRow(payment, "Payment status", formatStatus(booking.paymentStatus));
  }
  if (booking?.paymentMethod) {
    addRow(payment, "Payment method", booking.paymentMethod);
  }
  if (booking?.paymentAmount) {
    addRow(payment, "Payment amount", formatMoney(booking.paymentAmount));
  }
  if (booking?.paymentProofName) {
    addRow(payment, "Proof file", booking.paymentProofName);
  }
  if (payment.length) sections.push({ title: "Payment", rows: payment });

  const notes = [];
  addRow(notes, "Special requests", booking?.notes);
  if (notes.length) sections.push({ title: "Notes", rows: notes });

  const normalizedStatus = normalizeStatus(booking?.status);
  if (
    normalizedStatus.includes("cancel") ||
    normalizedStatus.includes("declined") ||
    normalizedStatus.includes("rejected")
  ) {
    const decision = [];
    addRow(decision, "Reason", booking?.cancelReason || booking?.declineReason);
    addRow(decision, "Message", booking?.cancelMessage || booking?.declineMessage);
    addRow(
      decision,
      normalizedStatus.includes("cancel") ? "Cancelled on" : "Updated on",
      formatDate(booking?.cancelledAt || booking?.declinedAt || booking?.updatedAt)
    );
    if (decision.length) {
      sections.push({
        title: normalizedStatus.includes("cancel") ? "Cancellation" : "Decision",
        rows: decision
      });
    }
  }

  return sections;
};

const getBaseUrl = () => {
  const base = asString(PUBLIC_APP_URL.value()).trim();
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
};

const buildLinks = (booking, status, options = {}) => {
  const base = getBaseUrl();
  if (!base) return [];

  const audience = asString(options.audience).trim().toLowerCase() || "user";
  const isAdmin = audience === "admin";

  const viewUrl = isAdmin
    ? `${base}/pages/dashboard.html#bookings`
    : booking?.id
    ? `${base}/pages/profile.html?bookingId=${booking.id}#bookings`
    : `${base}/pages/profile.html#bookings`;
  const links = [{ label: "View booking", url: viewUrl }];

  if (isAdmin) return links;
  const normalizedStatus = normalizeStatus(status || booking?.status);
  const shouldShowPaymentLink =
    isPaymentRequiredStatus(normalizedStatus) || isPaymentRequiredStatus(booking?.paymentStatus);
  if (shouldShowPaymentLink && booking?.id) {
    links.unshift({
      label: "Pay now",
      url: `${base}/pages/payment.html?bookingId=${booking.id}`
    });
  }

  return links;
};

const renderSectionHtml = (section) => {
  const rows = section.rows
    .map(
      (row) => `
        <tr>
          <td style="padding:8px 0;color:#555;font-size:13px;width:35%;vertical-align:top;">${escapeHtml(
            row.label
          )}</td>
          <td style="padding:8px 0;color:#111;font-size:13px;">${escapeHtml(row.value)}</td>
        </tr>`
    )
    .join("");

  return `
    <h3 style="margin:20px 0 8px 0;font-size:15px;color:#111;">${escapeHtml(section.title)}</h3>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
      ${rows}
    </table>`;
};

const renderSectionText = (section) => {
  const lines = section.rows.map((row) => `${row.label}: ${row.value}`);
  return `${section.title}\n${lines.join("\n")}`;
};

const renderLinksHtml = (links) => {
  if (!links.length) return "";
  const buttons = links
    .map(
      (link) => `
        <a href="${escapeHtml(link.url)}" style="display:inline-block;margin-right:10px;margin-bottom:8px;padding:10px 16px;background:#111;color:#fff;text-decoration:none;font-size:13px;border-radius:4px;">
          ${escapeHtml(link.label)}
        </a>`
    )
    .join("");
  return `<div style="margin:24px 0;">${buttons}</div>`;
};

const renderLinksText = (links) =>
  links.length
    ? `\nLinks\n${links.map((link) => `${link.label}: ${link.url}`).join("\n")}`
    : "";

const buildEmail = ({ subject, headline, intro, booking, statusOverride, linkAudience }) => {
  const sections = buildSections(booking);
  const links = buildLinks(booking, statusOverride, { audience: linkAudience });
  const supportEmail = asString(SUPPORT_EMAIL.value()).trim();
  const appName = asString(APP_NAME.value()).trim() || "Our team";

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f6f6f6;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;padding:24px;font-family:Arial, sans-serif;">
    <p style="margin:0 0 8px 0;color:#666;font-size:12px;">${escapeHtml(appName)}</p>
    <h1 style="margin:0 0 12px 0;font-size:20px;color:#111;">${escapeHtml(headline)}</h1>
    <p style="margin:0 0 18px 0;font-size:14px;color:#333;">${escapeHtml(intro)}</p>
    ${sections.map(renderSectionHtml).join("")}
    ${renderLinksHtml(links)}
    <p style="margin:24px 0 0 0;font-size:12px;color:#666;">${
      supportEmail
        ? `Need help? Reply to this email or contact ${escapeHtml(supportEmail)}.`
        : `Thanks for choosing ${escapeHtml(appName)}.`
    }</p>
  </div>
</body>
</html>`;

  const textSections = sections.map(renderSectionText).join("\n\n");
  const footer = supportEmail
    ? `Need help? Reply to this email or contact ${supportEmail}.`
    : `Thanks for choosing ${appName}.`;
  const text = `${appName}\n${headline}\n${intro}\n\n${textSections}${renderLinksText(links)}\n\n${footer}`;

  return { subject, html, text };
};

const getInquiryReference = (inquiry) => {
  const ref = asString(inquiry?.reference || inquiry?.ref).trim();
  if (ref) return ref;
  if (inquiry?.id) return `INQ-${String(inquiry.id).slice(0, 8).toUpperCase()}`;
  return "INQ";
};

const buildInquirySections = (inquiry) => {
  const sections = [];

  const summary = [];
  addRow(summary, "Reference", getInquiryReference(inquiry));
  addRow(summary, "Submitted", formatDate(inquiry?.createdAt || inquiry?.timestamp));
  addRow(summary, "Name", inquiry?.name);
  addRow(summary, "Email", inquiry?.email);
  addRow(summary, "Subject", inquiry?.subject);
  if (summary.length) sections.push({ title: "Inquiry Summary", rows: summary });

  const message = [];
  addRow(message, "Message", inquiry?.message);
  if (message.length) sections.push({ title: "Message", rows: message });

  return sections;
};

const buildInquiryEmail = ({ subject, headline, intro, inquiry }) => {
  const sections = buildInquirySections(inquiry);
  const supportEmail = asString(SUPPORT_EMAIL.value()).trim();
  const appName = asString(APP_NAME.value()).trim() || "Our team";

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f6f6f6;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;padding:24px;font-family:Arial, sans-serif;">
    <p style="margin:0 0 8px 0;color:#666;font-size:12px;">${escapeHtml(appName)}</p>
    <h1 style="margin:0 0 12px 0;font-size:20px;color:#111;">${escapeHtml(headline)}</h1>
    <p style="margin:0 0 18px 0;font-size:14px;color:#333;">${escapeHtml(intro)}</p>
    ${sections.map(renderSectionHtml).join("")}
    <p style="margin:24px 0 0 0;font-size:12px;color:#666;">${
      supportEmail
        ? `Need help? Reply to this email or contact ${escapeHtml(supportEmail)}.`
        : `Thanks for choosing ${escapeHtml(appName)}.`
    }</p>
  </div>
</body>
</html>`;

  const textSections = sections.map(renderSectionText).join("\n\n");
  const footer = supportEmail
    ? `Need help? Reply to this email or contact ${supportEmail}.`
    : `Thanks for choosing ${appName}.`;
  const text = `${appName}\n${headline}\n${intro}\n\n${textSections}\n\n${footer}`;

  return { subject, html, text };
};

const buildInquiryCopyForUser = (inquiry) => {
  const appName = asString(APP_NAME.value()).trim() || "Our team";
  const name = asString(inquiry?.name).trim();
  const greeting = name ? `Thanks, ${name}` : "Thanks";
  return {
    subject: `${appName} inquiry received - ${getInquiryReference(inquiry)}`,
    headline: "We received your inquiry",
    intro: `${greeting}! Our team will reply as soon as possible.`
  };
};

const buildInquiryCopyForAdmin = (inquiry) => {
  const appName = asString(APP_NAME.value()).trim() || "Our team";
  const subject = asString(inquiry?.subject).trim() || "General question";
  return {
    subject: `${appName} new inquiry - ${subject}`,
    headline: "New inquiry received",
    intro: "A new inquiry was submitted. Review the details below."
  };
};

const sendInquiryEmailToUser = async (inquiry, copy) => {
  const recipient = asString(inquiry?.email).trim();
  if (!recipient) return;
  const replyTo = asString(SUPPORT_EMAIL.value()).trim();
  const message = buildInquiryEmail({ ...copy, inquiry });
  await enqueueEmail({ to: recipient, message, replyTo });
};

const sendInquiryEmailToAdmin = async (inquiry, copy) => {
  const adminEmail = asString(ADMIN_EMAIL.value()).trim();
  if (!adminEmail) return;
  const replyTo = asString(inquiry?.email).trim() || asString(SUPPORT_EMAIL.value()).trim();
  const message = buildInquiryEmail({ ...copy, inquiry });
  await enqueueEmail({ to: adminEmail, message, replyTo });
};

class InquiryCommandService {
  constructor({ dbInstance, adminInstance }) {
    this.db = dbInstance;
    this.admin = adminInstance;
  }

  async submitInquiry(request) {
    const data = request.data || {};
    const name = asString(data.name).trim();
    const email = asString(data.email).trim();
    const subject = asString(data.subject).trim();
    const message = asString(data.message).trim();

    if (!name) {
      throw new HttpsError("invalid-argument", "Name is required.");
    }
    if (!email) {
      throw new HttpsError("invalid-argument", "Email is required.");
    }
    if (!isValidEmail(email)) {
      throw new HttpsError("invalid-argument", "Please provide a valid email address.");
    }
    if (!message) {
      throw new HttpsError("invalid-argument", "Message is required.");
    }

    const inquiryData = {
      name,
      email,
      subject,
      message,
      status: "new",
      userId: request.auth?.uid || "",
      createdAt: this.admin.firestore.FieldValue.serverTimestamp()
    };

    const ref = await this.db.collection("inquiries").add(inquiryData);
    return { id: ref.id };
  }
}

class PaymentCommandService {
  constructor({ dbInstance, adminInstance }) {
    this.db = dbInstance;
    this.admin = adminInstance;
  }

  async submitBookingPayment(request) {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Please sign in to submit payment.");
    }

    const data = request.data || {};
    const bookingId = asString(data.bookingId).trim();
    const paymentMethod = normalizeStatus(data.paymentMethod);
    const paymentProofName = asString(data.paymentProofName).trim();
    const paymentProofPath = asString(data.paymentProofPath).trim();
    const paymentProofUrl = asString(data.paymentProofUrl).trim();
    const paymentNotes = clampText(data.paymentNotes, 1000);
    const paymentAmount = Number(data.paymentAmount);

    if (!bookingId) {
      throw new HttpsError("invalid-argument", "Booking ID is required.");
    }
    if (!PAYMENT_METHODS.has(paymentMethod)) {
      throw new HttpsError("invalid-argument", "Please select a valid payment method.");
    }
    if (!paymentProofName || !paymentProofPath || !paymentProofUrl) {
      throw new HttpsError("invalid-argument", "Payment proof details are required.");
    }
    if (paymentProofName.length > 160) {
      throw new HttpsError("invalid-argument", "Payment proof file name is too long.");
    }
    if (!isValidPaymentProofUrl(paymentProofUrl)) {
      throw new HttpsError("invalid-argument", "Payment proof URL is invalid.");
    }
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      throw new HttpsError("invalid-argument", "Payment amount must be greater than zero.");
    }

    const bookingRef = this.db.collection("bookings").doc(bookingId);
    const now = this.admin.firestore.Timestamp.now();

    await this.db.runTransaction(async (transaction) => {
      const bookingSnap = await transaction.get(bookingRef);
      if (!bookingSnap.exists) {
        throw new HttpsError("not-found", "Booking not found.");
      }

      const booking = bookingSnap.data() || {};
      const bookingOwnerId = asString(booking.userId).trim();
      if (!bookingOwnerId || bookingOwnerId !== request.auth.uid) {
        throw new HttpsError("permission-denied", "You do not have access to this booking.");
      }
      if (!isValidPaymentProofPath(booking.bookingType, bookingId, paymentProofPath)) {
        throw new HttpsError("invalid-argument", "Payment proof path is invalid for this booking.");
      }
      if (!doesPaymentProofUrlMatchPath(paymentProofUrl, paymentProofPath)) {
        throw new HttpsError("invalid-argument", "Payment proof URL does not match the uploaded file.");
      }

      const bookingStatus = normalizeStatus(booking.status);
      if (bookingStatus !== "awaiting_payment") {
        throw new HttpsError("failed-precondition", "This booking is no longer open for payment.");
      }

      if (isPaymentFinalStatus(booking.paymentStatus)) {
        throw new HttpsError("already-exists", "Payment has already been submitted for this booking.");
      }

      const dueAt = computePaymentDueAt(booking);
      if (!dueAt || dueAt.getTime() <= now.toMillis()) {
        throw new HttpsError("failed-precondition", "Payment deadline has passed for this booking.");
      }

      const payload = {
        paymentMethod,
        paymentStatus: "submitted",
        paymentProofName,
        paymentProofPath,
        paymentProofUrl,
        paymentNotes,
        paymentAmount,
        paymentSubmittedAt: this.admin.firestore.FieldValue.serverTimestamp(),
        status: "payment_submitted",
        updatedAt: this.admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: request.auth.uid,
      };

      if (!booking.paymentDueAt) {
        payload.paymentDueAt = this.admin.firestore.Timestamp.fromDate(dueAt);
      }

      transaction.update(bookingRef, payload);
    });

    return { ok: true, bookingId };
  }
}

const buildCreateCopy = (booking) => {
  const reference = getBookingReference(booking);
  const title = getBookingTitle(booking);
  const appName = asString(APP_NAME.value()).trim() || "Our team";

  return {
    subject: `${appName} booking received - ${reference}`,
    headline: "Booking received",
    intro: `We received your booking request for ${title}. Please review the details below.`
  };
};

const buildStatusCopy = (booking, status) => {
  const reference = getBookingReference(booking);
  const title = getBookingTitle(booking);
  const appName = asString(APP_NAME.value()).trim() || "Our team";
  const statusLabel = formatStatus(status);
  const normalized = normalizeStatus(status);
  const declineReason = asString(booking?.cancelReason || booking?.declineReason).trim();
  const cancelReason = asString(booking?.cancelReason || booking?.cancelMessage).trim();

  if (!normalized || normalized.includes("pending")) {
    return {
      subject: `${appName} booking update - ${reference}`,
      headline: "Booking update",
      intro: `Your booking for ${title} is now ${statusLabel.toLowerCase()}.`
    };
  }

  if (isPaymentRequiredStatus(normalized)) {
    return {
      subject: `${appName} payment required - ${reference}`,
      headline: "Payment required",
      intro: `Your booking for ${title} is ready for payment. Use the payment link below to confirm your reservation.`
    };
  }

  if (normalized.includes("payment_submitted")) {
    return {
      subject: `${appName} payment submitted - ${reference}`,
      headline: "Payment submitted",
      intro: `We received your payment for ${title}. Our team will review it shortly.`
    };
  }

  if (normalized.includes("approved") || normalized.includes("accepted")) {
    return {
      subject: `${appName} booking confirmed - ${reference}`,
      headline: "Booking confirmed",
      intro: `Your booking for ${title} is confirmed. See the details below for your records.`
    };
  }

  if (normalized.includes("declined") || normalized.includes("rejected")) {
    const reasonText = declineReason ? ` Reason: ${declineReason}` : "";
    return {
      subject: `${appName} booking declined - ${reference}`,
      headline: "Booking declined",
      intro: `Your booking for ${title} was declined.${reasonText}`
    };
  }

  if (normalized.includes("cancel")) {
    const reasonText = cancelReason ? ` Reason: ${cancelReason}` : "";
    return {
      subject: `${appName} booking cancelled - ${reference}`,
      headline: "Booking cancelled",
      intro: `Your booking for ${title} was cancelled.${reasonText}`
    };
  }

  return {
    subject: `${appName} booking update - ${reference}`,
    headline: `Booking update: ${statusLabel}`,
    intro: `Your booking for ${title} is now ${statusLabel.toLowerCase()}.`
  };
};

const buildPaymentCopy = (booking, paymentStatus) => {
  const reference = getBookingReference(booking);
  const title = getBookingTitle(booking);
  const appName = asString(APP_NAME.value()).trim() || "Our team";
  const statusLabel = formatStatus(paymentStatus);

  return {
    subject: `${appName} payment update - ${reference}`,
    headline: "Payment update",
    intro: `Your payment status for ${title} is now ${statusLabel.toLowerCase()}.`
  };
};

const buildAdminCopy = (booking, reason) => {
  const reference = getBookingReference(booking);
  const title = getBookingTitle(booking);
  const appName = asString(APP_NAME.value()).trim() || "Our team";
  const reasonText = reason ? ` - ${reason}` : "";

  return {
    subject: `${appName} admin notice${reasonText} - ${reference}`,
    headline: "Admin notification",
    intro: `${reason || "Update"}: ${title}.`
  };
};

const enqueueEmail = async ({ to, message, replyTo }) => {
  if (!to || !message) return;
  const payload = {
    to,
    message: {
      subject: message.subject,
      text: message.text,
      html: message.html
    }
  };

  if (replyTo) payload.replyTo = replyTo;

  await db.collection(MAIL_COLLECTION).add(payload);
};

const sendUserEmail = async (booking, copy, statusOverride) => {
  const recipient = asString(booking?.userEmail || booking?.email).trim();
  if (!recipient) {
    logger.warn("Booking has no user email, skipping notification.", { bookingId: booking?.id });
    return;
  }

  const replyTo = asString(SUPPORT_EMAIL.value()).trim();
  const message = buildEmail({ ...copy, booking, statusOverride, linkAudience: "user" });
  await enqueueEmail({ to: recipient, message, replyTo });
};

const sendAdminEmail = async (booking, copy, statusOverride) => {
  const adminEmail = asString(ADMIN_EMAIL.value()).trim();
  if (!adminEmail) return;
  const replyTo = asString(SUPPORT_EMAIL.value()).trim();
  const message = buildEmail({ ...copy, booking, statusOverride, linkAudience: "admin" });
  await enqueueEmail({ to: adminEmail, message, replyTo });
};

class BookingEmailTriggerService {
  async sendBookingEmailOnCreate(event) {
    const snapshot = event.data;
    if (!snapshot) return;

    const booking = { id: snapshot.id, ...snapshot.data() };
    const copy = buildCreateCopy(booking);

    try {
      await sendUserEmail(booking, copy, booking?.status);
      await sendAdminEmail(booking, buildAdminCopy(booking, "New booking"), booking?.status);
    } catch (error) {
      logger.error("Failed to enqueue booking creation emails.", error);
    }
  }

  async sendBookingEmailOnUpdate(event) {
    if (!event.data) return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!before || !after) return;

    const booking = { id: event.data.after.id, ...after };
    const beforeStatus = normalizeStatus(before.status);
    const afterStatus = normalizeStatus(after.status);
    const beforePayment = normalizeStatus(before.paymentStatus);
    const afterPayment = normalizeStatus(after.paymentStatus);

    let copy = null;
    let reason = null;
    let statusOverride = null;

    if (beforeStatus !== afterStatus) {
      copy = buildStatusCopy(booking, afterStatus);
      reason = `Status update: ${formatStatus(afterStatus)}`;
      statusOverride = afterStatus;
    } else if (beforePayment !== afterPayment) {
      copy = buildPaymentCopy(booking, afterPayment);
      reason = `Payment update: ${formatStatus(afterPayment)}`;
      statusOverride = booking?.status;
    } else {
      return;
    }

    try {
      await sendUserEmail(booking, copy, statusOverride);
      await sendAdminEmail(booking, buildAdminCopy(booking, reason), statusOverride);
    } catch (error) {
      logger.error("Failed to enqueue booking update emails.", error);
    }
  }
}

class BookingAuditService {
  constructor({ dbInstance, adminInstance }) {
    this.db = dbInstance;
    this.admin = adminInstance;
  }

  async logBookingStatusHistory(event) {
    if (!event.data) return;

    const before = event.data.before.data() || {};
    const after = event.data.after.data() || {};
    const bookingId = asString(event.params?.bookingId).trim() || event.data.after.id;

    const beforeStatus = normalizeStatus(before.status);
    const afterStatus = normalizeStatus(after.status);
    const beforePaymentStatus = normalizeStatus(before.paymentStatus);
    const afterPaymentStatus = normalizeStatus(after.paymentStatus);

    const statusChanged = beforeStatus !== afterStatus;
    const paymentChanged = beforePaymentStatus !== afterPaymentStatus;

    if (!statusChanged && !paymentChanged) return;

    const actor = resolveAuditActor({
      before,
      after,
      statusChanged,
      paymentChanged,
      authId: event.authId,
      authType: event.authType,
    });

    const now = this.admin.firestore.FieldValue.serverTimestamp();
    const historyRef = event.data.after.ref.collection(BOOKING_HISTORY_COLLECTION);
    const batch = this.db.batch();

    if (statusChanged) {
      batch.set(historyRef.doc(), {
        bookingId,
        field: "status",
        from: beforeStatus,
        to: afterStatus,
        by: actor,
        at: now,
        cancelReason: clampText(after.cancelReason, 250),
      });
    }

    if (paymentChanged) {
      batch.set(historyRef.doc(), {
        bookingId,
        field: "paymentStatus",
        from: beforePaymentStatus,
        to: afterPaymentStatus,
        by: actor,
        at: now,
      });
    }

    await batch.commit();
  }
}

class PaymentAutoCancelService {
  constructor({ dbInstance, adminInstance }) {
    this.db = dbInstance;
    this.admin = adminInstance;
  }

  async autoCancelOverduePayments() {
    const now = this.admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();
    let scanned = 0;
    let cancelled = 0;
    let lastDocId = null;

    while (true) {
      let overdueQuery = this.db
        .collection("bookings")
        .where("status", "==", "awaiting_payment")
        .orderBy(this.admin.firestore.FieldPath.documentId())
        .limit(AUTO_CANCEL_BATCH_SIZE);

      if (lastDocId) {
        overdueQuery = overdueQuery.startAfter(lastDocId);
      }

      const snapshot = await overdueQuery.get();
      if (snapshot.empty) break;

      const batch = this.db.batch();
      let batchCancelled = 0;

      snapshot.docs.forEach((docSnap) => {
        scanned += 1;
        const booking = docSnap.data() || {};
        const dueAt = computePaymentDueAt(booking);
        if (!dueAt) return;
        if (dueAt.getTime() > nowMs) return;

        const payload = {
          status: "cancelled",
          paymentStatus: "expired",
          cancelReason: PAYMENT_TIMEOUT_REASON,
          cancelMessage: PAYMENT_TIMEOUT_MESSAGE,
          cancelledAt: this.admin.firestore.FieldValue.serverTimestamp(),
          cancelledBy: "system",
          updatedBy: "system",
        };

        if (!booking.paymentDueAt) {
          payload.paymentDueAt = this.admin.firestore.Timestamp.fromDate(dueAt);
        }

        batch.update(docSnap.ref, payload);
        batchCancelled += 1;
      });

      if (batchCancelled > 0) {
        await batch.commit();
        cancelled += batchCancelled;
      }

      lastDocId = snapshot.docs[snapshot.docs.length - 1].id;
      if (snapshot.size < AUTO_CANCEL_BATCH_SIZE) break;
    }

    logger.info("Overdue payment auto-cancel run complete.", {
      scanned,
      cancelled,
      now: now.toDate().toISOString(),
    });
  }
}

class InquiryEmailTriggerService {
  async sendInquiryEmailOnCreate(event) {
    const snapshot = event.data;
    if (!snapshot) return;

    const inquiry = { id: snapshot.id, ...snapshot.data() };
    const userCopy = buildInquiryCopyForUser(inquiry);
    const adminCopy = buildInquiryCopyForAdmin(inquiry);

    try {
      await sendInquiryEmailToUser(inquiry, userCopy);
      await sendInquiryEmailToAdmin(inquiry, adminCopy);
    } catch (error) {
      logger.error("Failed to enqueue inquiry emails.", error);
    }
  }
}

const inquiryCommandService = new InquiryCommandService({ dbInstance: db, adminInstance: admin });
const paymentCommandService = new PaymentCommandService({ dbInstance: db, adminInstance: admin });
const bookingEmailTriggerService = new BookingEmailTriggerService();
const bookingAuditService = new BookingAuditService({ dbInstance: db, adminInstance: admin });
const paymentAutoCancelService = new PaymentAutoCancelService({ dbInstance: db, adminInstance: admin });
const inquiryEmailTriggerService = new InquiryEmailTriggerService();

exports.submitInquiry = onCall(async (request) => inquiryCommandService.submitInquiry(request));
exports.submitBookingPayment = onCall(async (request) =>
  paymentCommandService.submitBookingPayment(request)
);

exports.sendBookingEmailOnCreate = onDocumentCreated("bookings/{bookingId}", async (event) =>
  bookingEmailTriggerService.sendBookingEmailOnCreate(event)
);

exports.sendBookingEmailOnUpdate = onDocumentUpdated("bookings/{bookingId}", async (event) =>
  bookingEmailTriggerService.sendBookingEmailOnUpdate(event)
);

exports.logBookingStatusHistory = onDocumentUpdatedWithAuthContext(
  "bookings/{bookingId}",
  async (event) => bookingAuditService.logBookingStatusHistory(event)
);

exports.autoCancelOverduePayments = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "UTC",
  },
  async () => paymentAutoCancelService.autoCancelOverduePayments()
);

exports.sendInquiryEmailOnCreate = onDocumentCreated("inquiries/{inquiryId}", async (event) =>
  inquiryEmailTriggerService.sendInquiryEmailOnCreate(event)
);
