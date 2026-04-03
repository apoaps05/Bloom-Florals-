import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-functions.js";
import { showAlert } from "./dialogs.js";
import { auth, db, functions } from "./firebase-app.js";

class InquiryValidationService {
  static isBlank(value) {
    return !value || !String(value).trim();
  }

  static isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
  }

  static getValidationError({ name, email, message }) {
    if (InquiryValidationService.isBlank(name)) {
      return "Please enter your name.";
    }
    if (InquiryValidationService.isBlank(email)) {
      return "Please enter your email.";
    }
    if (!InquiryValidationService.isValidEmail(email)) {
      return "Please enter a valid email address.";
    }
    if (InquiryValidationService.isBlank(message)) {
      return "Please enter your question.";
    }
    return "";
  }
}

class InquirySubmissionService {
  constructor({ submitCallable }) {
    this.submitCallable = submitCallable;
  }

  static getSubmitErrorMessage(error) {
    const code = error?.code || "";
    if (code === "functions/invalid-argument") {
      return error?.message || "Please check the inquiry details and try again.";
    }
    if (code === "inquiry/unavailable") {
      return "Inquiry service is unavailable. Please deploy the inquiry function and try again.";
    }
    return "Unable to send your inquiry. Please try again.";
  }

  async submit(payload) {
    try {
      await this.submitCallable(payload);
      return;
    } catch (error) {
      const code = error?.code || "";
      if (code === "functions/not-found" || code === "functions/unavailable") {
        const fallback = new Error(
          "Inquiry service is unavailable. Please deploy the inquiry function and try again."
        );
        fallback.code = "inquiry/unavailable";
        throw fallback;
      }
      throw error;
    }
  }
}

class InquiryProfileService {
  constructor(dbInstance) {
    this.db = dbInstance;
  }

  async getProfileName(userId) {
    try {
      const userDocRef = doc(this.db, "users", userId);
      const userSnap = await getDoc(userDocRef);
      if (!userSnap.exists()) return "";

      const userData = userSnap.data() || {};
      const firstName = (userData.firstName || "").trim();
      const lastName = (userData.lastName || "").trim();
      const fullName = `${firstName} ${lastName}`.trim();
      return fullName;
    } catch {
      return "";
    }
  }
}

class InquiryPageController {
  constructor({ authInstance, submissionService, profileService, showAlertFn }) {
    this.auth = authInstance;
    this.submissionService = submissionService;
    this.profileService = profileService;
    this.showAlert = showAlertFn;

    this.currentUser = null;
    this.currentUserProfileName = "";

    this.formContainer = document.querySelector(".fade-up");
    this.submitBtn = document.getElementById("submitInquiry");
    this.nameInput = document.getElementById("inquiryName");
    this.emailInput = document.getElementById("inquiryEmail");
    this.subjectInput = document.getElementById("inquirySubject");
    this.messageInput = document.getElementById("inquiryMessage");
  }

  init() {
    window.addEventListener("load", () => this.showForm());
    onAuthStateChanged(this.auth, (user) => this.handleAuthState(user));
    this.submitBtn?.addEventListener("click", (event) => this.handleSubmit(event));
  }

  showForm() {
    if (this.formContainer) this.formContainer.classList.add("show");
  }

  applyUserProfileToForm(user) {
    if (!user) return;
    if (this.emailInput && !this.emailInput.value) {
      this.emailInput.value = user.email || "";
    }

    const fullName = this.currentUserProfileName || user.displayName || "";
    if (this.nameInput && fullName && !this.nameInput.value) {
      this.nameInput.value = fullName;
    }
  }

  async handleAuthState(user) {
    this.currentUser = user || null;
    if (!user) return;

    this.currentUserProfileName = await this.profileService.getProfileName(user.uid);
    this.applyUserProfileToForm(user);
  }

  getFormValues() {
    return {
      name: this.nameInput?.value?.trim() || "",
      email: this.emailInput?.value?.trim() || "",
      subject: this.subjectInput?.value?.trim() || "",
      message: this.messageInput?.value?.trim() || ""
    };
  }

  clearFieldsAfterSuccess() {
    if (this.subjectInput) this.subjectInput.value = "";
    if (this.messageInput) this.messageInput.value = "";
    if (!this.currentUser) {
      if (this.nameInput) this.nameInput.value = "";
      if (this.emailInput) this.emailInput.value = "";
    }
  }

  async handleSubmit(event) {
    event.preventDefault();
    if (!this.submitBtn || this.submitBtn.disabled) return;

    const inquiryPayload = this.getFormValues();
    const validationError = InquiryValidationService.getValidationError(inquiryPayload);
    if (validationError) {
      await this.showAlert(validationError);
      return;
    }

    this.submitBtn.disabled = true;

    try {
      await this.submissionService.submit(inquiryPayload);
      await this.showAlert("Thanks! Your inquiry has been sent. We will reply soon.");
      this.clearFieldsAfterSuccess();
    } catch (error) {
      console.error("Error saving inquiry:", error);
      await this.showAlert(InquirySubmissionService.getSubmitErrorMessage(error));
    } finally {
      this.submitBtn.disabled = false;
    }
  }
}

const submitInquiryCallable = httpsCallable(functions, "submitInquiry");

const inquiryController = new InquiryPageController({
  authInstance: auth,
  submissionService: new InquirySubmissionService({
    submitCallable: submitInquiryCallable
  }),
  profileService: new InquiryProfileService(db),
  showAlertFn: showAlert
});

inquiryController.init();
