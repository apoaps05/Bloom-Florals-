import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-functions.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-storage.js";
import { showAlert } from "./dialogs.js";
import { app, auth, db, functions } from "./firebase-app.js";

const MAX_PAYMENT_PROOF_SIZE_BYTES = 5 * 1024 * 1024;
const PAYMENT_PROOF_FILE_TOO_LARGE_MESSAGE = "Payment proof must be 5 MB or smaller.";
const PAYMENT_PROOF_FILE_TYPE_MESSAGE = "Payment proof must be an image or PDF file.";

class PaymentFormatters {
  static parseTimestampLike(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === "function") return value.toDate();
    if (typeof value === "object" && typeof value.seconds === "number") {
      return new Date(value.seconds * 1000);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  static getPaymentDueDate(record) {
    return PaymentFormatters.parseTimestampLike(record?.paymentDueAt);
  }

  static isPaymentExpired(record) {
    const dueAt = PaymentFormatters.getPaymentDueDate(record);
    if (!dueAt) return false;
    return dueAt.getTime() <= Date.now();
  }

  static formatCurrency(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return "";
    return `\u20B1${amount.toLocaleString("en-US")}`;
  }

  static formatDate(value) {
    if (!value) return "";
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? String(value)
      : parsed.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  static formatDateTime(value) {
    const parsed = PaymentFormatters.parseTimestampLike(value);
    if (!parsed) return "";
    return parsed.toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  static formatLocation(record) {
    if (!record) return "";
    if (record.bookingType === "seminar" && record.seminarLocation) {
      return record.seminarLocation;
    }
    const location = record.location || {};
    const parts = [location.name, location.city, location.province].filter(Boolean);
    return parts.length ? parts.join(", ") : "";
  }

  static getTotalAmount(record) {
    const explicit =
      record?.paymentAmount ??
      record?.totalAmount ??
      record?.amount ??
      record?.packagePrice;
    const explicitNumber = Number(explicit);
    if (Number.isFinite(explicitNumber) && explicitNumber > 0) return explicitNumber;

    if (record?.bookingType === "seminar") {
      const price = Number(record.seminarPrice || record.price || 0);
      const slots = Number(record.slotCount || 1);
      if (Number.isFinite(price) && price > 0 && Number.isFinite(slots) && slots > 0) {
        return price * slots;
      }
    }

    return 0;
  }
}

class BookingRepository {
  constructor(database) {
    this.db = database;
  }

  getRef(bookingId) {
    return doc(this.db, "bookings", bookingId);
  }

  async getById(bookingId) {
    const snapshot = await getDoc(this.getRef(bookingId));
    if (!snapshot.exists()) return null;
    return { id: snapshot.id, ...snapshot.data() };
  }
}

class PaymentSubmissionService {
  constructor(storage, submitPaymentCallable) {
    this.storage = storage;
    this.submitPayment = submitPaymentCallable;
  }

  static isAllowedProofType(contentType) {
    const normalized = String(contentType || "").toLowerCase();
    return normalized.startsWith("image/") || normalized === "application/pdf";
  }

  static validateProofFile(file) {
    if (!file) {
      return { valid: false, message: "Please upload proof of payment." };
    }

    if (!PaymentSubmissionService.isAllowedProofType(file.type)) {
      return { valid: false, message: PAYMENT_PROOF_FILE_TYPE_MESSAGE };
    }

    const size = Number(file.size || 0);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_PAYMENT_PROOF_SIZE_BYTES) {
      return { valid: false, message: PAYMENT_PROOF_FILE_TOO_LARGE_MESSAGE };
    }

    return { valid: true, message: "" };
  }

  static getSubmitErrorMessage(error) {
    const code = error?.code || "";
    if (!code && error?.message) {
      return error.message;
    }
    if (
      code === "functions/already-exists" ||
      code === "functions/failed-precondition" ||
      code === "functions/permission-denied" ||
      code === "functions/invalid-argument"
    ) {
      return error?.message || "Unable to submit payment. Please refresh and try again.";
    }

    if (code === "functions/not-found") {
      return "Booking not found.";
    }

    if (code === "functions/unauthenticated") {
      return "Please sign in again and retry payment submission.";
    }

    return "Unable to submit payment. Please try again.";
  }

  async uploadPaymentProof({ booking, file, userId }) {
    const validation = PaymentSubmissionService.validateProofFile(file);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const sanitizedFileName = String(file.name || "payment-proof")
      .trim()
      .replace(/[^\w.\-]+/g, "_")
      .slice(0, 120) || "payment-proof";
    const proofFolder = booking.bookingType === "seminar" ? "seminar-payments" : "event-payments";
    const proofPath = `${proofFolder}/${booking.id}/${sanitizedFileName}`;
    const proofRef = storageRef(this.storage, proofPath);
    const metadata = {
      contentType: file.type || "application/octet-stream",
      customMetadata: {
        ownerId: userId
      }
    };

    await uploadBytes(proofRef, file, metadata);
    const paymentProofUrl = await getDownloadURL(proofRef);

    return {
      paymentProofName: sanitizedFileName,
      paymentProofPath: proofPath,
      paymentProofUrl
    };
  }

  async submitBookingPayment({
    bookingId,
    paymentMethod,
    paymentProofName,
    paymentProofPath,
    paymentProofUrl,
    paymentNotes,
    paymentAmount
  }) {
    await this.submitPayment({
      bookingId,
      paymentMethod,
      paymentProofName,
      paymentProofPath,
      paymentProofUrl,
      paymentNotes,
      paymentAmount
    });
  }
}

class PaymentEligibilityPolicy {
  constructor({ showAlertFn, redirectToProfile }) {
    this.showAlert = showAlertFn;
    this.redirectToProfile = redirectToProfile;
  }

  async ensurePayable(record) {
    const status = String(record.status || "").trim().toLowerCase();
    if (status === "awaiting_payment") {
      if (PaymentFormatters.isPaymentExpired(record)) {
        await this.showAlert("Payment deadline has passed for this booking.");
        this.redirectToProfile();
        return false;
      }
      return true;
    }

    if (status === "payment_submitted") {
      await this.showAlert("Payment already submitted. Please wait for admin confirmation.");
    } else if (status.startsWith("pending")) {
      await this.showAlert("Availability is still being confirmed. Payment will open once confirmed.");
    } else if (
      status === "completed" ||
      status === "approved" ||
      status === "accepted" ||
      status === "confirmed"
    ) {
      await this.showAlert("Your booking is already confirmed.");
    } else {
      await this.showAlert("This booking is not eligible for payment.");
    }

    this.redirectToProfile();
    return false;
  }
}

class PaymentPageController {
  constructor({
    appInstance,
    authInstance,
    bookingRepository,
    submissionService,
    eligibilityPolicy,
    showAlertFn
  }) {
    this.app = appInstance;
    this.auth = authInstance;
    this.bookingRepository = bookingRepository;
    this.submissionService = submissionService;
    this.eligibilityPolicy = eligibilityPolicy;
    this.showAlert = showAlertFn;

    this.storage = getStorage(this.app);
    this.selectedFile = null;
    this.currentUser = null;
    this.booking = null;

    this.dom = {
      paymentMethod: document.getElementById("paymentMethod"),
      gcashInstructions: document.getElementById("gcash-instructions"),
      bankInstructions: document.getElementById("bank-instructions"),
      paymayaInstructions: document.getElementById("paymaya-instructions"),
      proofInput: document.getElementById("proof"),
      filePreview: document.getElementById("filePreview"),
      previewImage: document.getElementById("previewImage"),
      removeFileBtn: document.getElementById("removeFile"),
      fileUploadDisplay: document.querySelector(".file-upload-display"),
      agreeTermsCheckbox: document.getElementById("agreeTerms"),
      submitBtn: document.getElementById("submitPayment")
    };
  }

  init() {
    window.addEventListener("DOMContentLoaded", () => this.showForm());
    this.bindEvents();
    onAuthStateChanged(this.auth, (user) => this.handleAuthStateChanged(user));
  }

  showForm() {
    const container = document.querySelector(".fade-up");
    if (container) container.classList.add("show");
  }

  bindEvents() {
    const {
      paymentMethod,
      proofInput,
      removeFileBtn,
      agreeTermsCheckbox,
      submitBtn
    } = this.dom;

    paymentMethod?.addEventListener("change", (event) => this.handlePaymentMethodChange(event));
    proofInput?.addEventListener("change", (event) => this.handleProofInputChange(event));
    removeFileBtn?.addEventListener("click", () => this.handleRemoveProof());
    agreeTermsCheckbox?.addEventListener("change", (event) => this.handleTermsToggle(event));
    submitBtn?.addEventListener("click", () => this.handleSubmit());
  }

  getBookingId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("bookingId") || params.get("id");
  }

  getReturnPath() {
    const path = window.location.pathname.split("/").pop() || "payment.html";
    const search = window.location.search || "";
    const hash = window.location.hash || "";
    return `${path}${search}${hash}`;
  }

  redirectToLogin(returnTo = "") {
    const target = returnTo
      ? `login-register.html?redirect=${encodeURIComponent(returnTo)}`
      : "login-register.html";
    window.location.href = target;
  }

  redirectToProfile() {
    window.location.href = "profile.html#bookings";
  }

  setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || "";
  }

  updateSummary(record) {
    const isSeminar = record.bookingType === "seminar";
    this.setText("booking-reference", record.bookingRef || record.reference || record.referenceNumber || "");
    this.setText("service-type", isSeminar ? "Workshop Booking" : "Event Booking");
    this.setText("package-name", isSeminar ? record.seminarTitle || "" : record.packageName || "");
    this.setText("event-date", PaymentFormatters.formatDate(isSeminar ? record.seminarDate : record.date));
    this.setText("event-time", isSeminar ? record.seminarTime || "" : record.timeRange || record.time || "");
    this.setText("event-location", PaymentFormatters.formatLocation(record));
    this.setText(
      "payment-deadline",
      PaymentFormatters.formatDateTime(record.paymentDueAt) || "Within 72 hours of availability confirmation"
    );

    const total = PaymentFormatters.formatCurrency(PaymentFormatters.getTotalAmount(record));
    this.setText("total-amount", total);
    this.setText("gcash-amount", total);
    this.setText("bank-amount", total);
    this.setText("paymaya-amount", total);
  }

  async handleAuthStateChanged(user) {
    if (!user) {
      this.redirectToLogin(this.getReturnPath());
      return;
    }

    this.currentUser = user;
    try {
      await this.loadBooking(user);
    } catch (error) {
      console.error("Failed to load booking:", error);
      await this.showAlert("Unable to load booking. Please try again.");
      this.redirectToProfile();
    }
  }

  async loadBooking(user) {
    const bookingId = this.getBookingId();
    if (!bookingId) {
      await this.showAlert("Missing booking reference.");
      this.redirectToProfile();
      return;
    }

    const record = await this.bookingRepository.getById(bookingId);
    if (!record) {
      await this.showAlert("Booking not found.");
      this.redirectToProfile();
      return;
    }

    if (record.userId !== user.uid) {
      await this.showAlert("Please sign in with your account to access this booking.");
      try {
        await signOut(this.auth);
      } catch (error) {
        console.error("Failed to sign out:", error);
      }
      this.redirectToLogin(this.getReturnPath());
      return;
    }

    if (record.bookingType !== "event" && record.bookingType !== "seminar") {
      await this.showAlert("This payment page is only for event or workshop bookings.");
      this.redirectToProfile();
      return;
    }

    this.updateSummary(record);
    this.booking = record;

    await this.eligibilityPolicy.ensurePayable(record);
  }

  handlePaymentMethodChange(event) {
    const { gcashInstructions, bankInstructions, paymayaInstructions } = this.dom;
    if (gcashInstructions) gcashInstructions.style.display = "none";
    if (bankInstructions) bankInstructions.style.display = "none";
    if (paymayaInstructions) paymayaInstructions.style.display = "none";

    if (event.target.value === "gcash" && gcashInstructions) {
      gcashInstructions.style.display = "block";
    } else if (event.target.value === "bank" && bankInstructions) {
      bankInstructions.style.display = "block";
    } else if (event.target.value === "paymaya" && paymayaInstructions) {
      paymayaInstructions.style.display = "block";
    }
  }

  async handleProofInputChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const validation = PaymentSubmissionService.validateProofFile(file);
    if (!validation.valid) {
      this.handleRemoveProof();
      if (this.dom.proofInput) this.dom.proofInput.value = "";
      await this.showAlert(validation.message);
      return;
    }

    this.selectedFile = file;

    const { filePreview, previewImage, fileUploadDisplay } = this.dom;
    if (previewImage && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        previewImage.src = readerEvent.target?.result;
        if (filePreview) filePreview.style.display = "block";
        if (fileUploadDisplay) fileUploadDisplay.style.display = "none";
      };
      reader.readAsDataURL(file);
      return;
    }

    if (filePreview) filePreview.style.display = "block";
    if (previewImage) previewImage.removeAttribute("src");
    if (fileUploadDisplay) fileUploadDisplay.style.display = "none";
  }

  handleRemoveProof() {
    const { proofInput, filePreview, fileUploadDisplay } = this.dom;
    this.selectedFile = null;
    if (proofInput) proofInput.value = "";
    if (filePreview) filePreview.style.display = "none";
    if (fileUploadDisplay) fileUploadDisplay.style.display = "block";
  }

  handleTermsToggle(event) {
    if (this.dom.submitBtn) {
      this.dom.submitBtn.disabled = !event.target.checked;
    }
  }

  async getLatestBookingForSubmit() {
    const latestBooking = await this.bookingRepository.getById(this.booking.id);
    if (!latestBooking) {
      await this.showAlert("Booking not found.");
      this.redirectToProfile();
      return null;
    }

    if (latestBooking.userId !== this.currentUser.uid) {
      await this.showAlert("Please sign in with your account to access this booking.");
      this.redirectToLogin(this.getReturnPath());
      return null;
    }

    const latestStatus = String(latestBooking.status || "").trim().toLowerCase();
    if (latestStatus !== "awaiting_payment") {
      await this.showAlert("This booking is no longer open for payment.");
      this.redirectToProfile();
      return null;
    }

    if (PaymentFormatters.isPaymentExpired(latestBooking)) {
      await this.showAlert("Payment deadline has passed for this booking.");
      this.redirectToProfile();
      return null;
    }

    return latestBooking;
  }

  async handleSubmit() {
    if (!this.booking || !this.currentUser) return;

    const method = this.dom.paymentMethod?.value;
    const notes = document.getElementById("notes")?.value?.trim() || "";
    const agreedToTerms = Boolean(this.dom.agreeTermsCheckbox?.checked);

    if (!agreedToTerms) {
      await this.showAlert("Please agree to the terms and conditions");
      return;
    }

    if (!method) {
      await this.showAlert("Please select a payment method");
      return;
    }

    if (!this.selectedFile) {
      await this.showAlert("Please upload proof of payment");
      return;
    }
    const proofValidation = PaymentSubmissionService.validateProofFile(this.selectedFile);
    if (!proofValidation.valid) {
      await this.showAlert(proofValidation.message);
      return;
    }

    const latestBooking = await this.getLatestBookingForSubmit();
    if (!latestBooking) return;
    this.booking = latestBooking;

    if (this.dom.submitBtn) {
      this.dom.submitBtn.disabled = true;
      this.dom.submitBtn.textContent = "Submitting...";
    }

    try {
      const proof = await this.submissionService.uploadPaymentProof({
        booking: this.booking,
        file: this.selectedFile,
        userId: this.currentUser.uid
      });

      await this.submissionService.submitBookingPayment({
        bookingId: this.booking.id,
        paymentMethod: method,
        paymentProofName: proof.paymentProofName,
        paymentProofPath: proof.paymentProofPath,
        paymentProofUrl: proof.paymentProofUrl,
        paymentNotes: notes,
        paymentAmount: PaymentFormatters.getTotalAmount(this.booking)
      });

      await this.showAlert("Payment submitted! We'll review it within 24-48 hours.");
      this.redirectToProfile();
    } catch (error) {
      console.error("Payment submission failed:", error);
      await this.showAlert(PaymentSubmissionService.getSubmitErrorMessage(error));
      if (this.dom.submitBtn) {
        this.dom.submitBtn.disabled = false;
        this.dom.submitBtn.textContent = "Submit Payment";
      }
    }
  }
}

const storage = getStorage(app);
const submitBookingPaymentCallable = httpsCallable(functions, "submitBookingPayment");

const bookingRepository = new BookingRepository(db);
const submissionService = new PaymentSubmissionService(storage, submitBookingPaymentCallable);

const appController = new PaymentPageController({
  appInstance: app,
  authInstance: auth,
  bookingRepository,
  submissionService,
  eligibilityPolicy: new PaymentEligibilityPolicy({
    showAlertFn: showAlert,
    redirectToProfile: () => {
      window.location.href = "profile.html#bookings";
    }
  }),
  showAlertFn: showAlert
});

appController.init();
