import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  EmailAuthProvider,
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  fetchSignInMethodsForEmail,
  linkWithCredential
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { setDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import { auth, db } from "./firebase-app.js";
import { resolveStaffAccess, resolveStaffAccessWithRetry } from "./staff-access.js";

class AuthValidationService {
  validateEmail(email) {
    if (typeof email !== "string") return false;

    const normalized = email.trim().toLowerCase();
    if (!normalized || normalized.length > 254) return false;

    const emailRegex = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+$/i;
    if (!emailRegex.test(normalized)) return false;

    return !normalized.includes("..");
  }

  validatePassword(password) {
    if (typeof password !== "string") {
      return { valid: false, message: "Password is required" };
    }
    if (password.length < 8) {
      return { valid: false, message: "Password must be at least 8 characters long" };
    }
    if (password.length > 64) {
      return { valid: false, message: "Password must be 64 characters or less" };
    }
    if (/\s/.test(password)) {
      return { valid: false, message: "Password cannot contain spaces" };
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return { valid: false, message: "Password must include at least one letter and one number" };
    }
    return { valid: true, message: "Password is strong" };
  }

  validateName(name, fieldName) {
    const nameRegex = /^[\p{L}\p{M}\s'-]+$/u;
    const trimmedName = String(name || "").trim();

    if (!trimmedName || trimmedName.length < 2) {
      return { valid: false, message: `${fieldName} must be at least 2 characters long` };
    }
    if (trimmedName.length > 50) {
      return { valid: false, message: `${fieldName} must be less than 50 characters` };
    }
    if (!nameRegex.test(trimmedName)) {
      return {
        valid: false,
        message: `${fieldName} can only contain letters, spaces, hyphens, and apostrophes`
      };
    }
    return { valid: true, message: "Valid name" };
  }

  sanitizeInput(input) {
    return String(input || "").trim().replace(/\s+/g, " ");
  }

  normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }
}

class AuthUiService {
  constructor(validationService) {
    this.validation = validationService;
  }

  showMessage(message, divId, type = "info") {
    const messageDiv = document.getElementById(divId);
    if (!messageDiv) return;

    messageDiv.style.display = "block";
    // Use textContent to avoid rendering injected markup from dynamic messages.
    messageDiv.textContent = message;
    messageDiv.className = `messageDiv ${type}`;
    messageDiv.style.opacity = "1";

    setTimeout(() => {
      messageDiv.style.opacity = "0";
      setTimeout(() => {
        messageDiv.style.display = "none";
      }, 300);
    }, 5000);
  }

  setPasswordToggleState(toggleButton, input, isVisible) {
    if (!toggleButton || !input) return;

    input.type = isVisible ? "text" : "password";
    toggleButton.setAttribute("aria-label", isVisible ? "Hide password" : "Show password");
    toggleButton.setAttribute("aria-pressed", String(isVisible));

    const icon = toggleButton.querySelector("i");
    if (icon) {
      icon.classList.toggle("fa-eye", !isVisible);
      icon.classList.toggle("fa-eye-slash", isVisible);
    }
  }

  setButtonLoading(button, isLoading) {
    if (!button) return;

    if (isLoading) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
      button.style.opacity = "0.7";
      button.style.cursor = "not-allowed";
      return;
    }

    button.disabled = false;
    button.textContent = button.dataset.originalText || "Submit";
    button.style.opacity = "1";
    button.style.cursor = "pointer";
  }

  resetForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return;

    const inputs = form.querySelectorAll("input");
    inputs.forEach((input) => {
      input.value = "";
      input.style.borderColor = "";

      if (/password/i.test(input.id)) {
        const toggleButton = form.querySelector(`.password-toggle[data-target="${input.id}"]`);
        this.setPasswordToggleState(toggleButton, input, false);
      }
    });
  }

  getActiveMessageDivId() {
    const setupForm = document.getElementById("completeAccountSetup");
    if (setupForm && setupForm.style.display !== "none") {
      return "completeSetupMessage";
    }
    const signUpForm = document.getElementById("signup");
    if (signUpForm && signUpForm.style.display !== "none") {
      return "signUpMessage";
    }
    return "signInMessage";
  }

  resetPasswordVisibility(form) {
    if (!form) return;

    const passwordFields = form.querySelectorAll('input[id*="password"], input[id*="Password"]');
    passwordFields.forEach((input) => {
      const toggleButton = form.querySelector(`.password-toggle[data-target="${input.id}"]`);
      this.setPasswordToggleState(toggleButton, input, false);
    });
  }

  setSocialButtonsLoading(isLoading) {
    const socialButtons = document.querySelectorAll(".social-btn");
    socialButtons.forEach((button) => {
      button.disabled = isLoading;
    });
  }

  getRedirectTarget() {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("redirect");
    if (!target) return "";
    const cleaned = target.trim();
    if (!cleaned) return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned) || cleaned.startsWith("//")) return "";

    const normalized = cleaned.startsWith("/") ? cleaned.slice(1) : cleaned;
    if (!normalized || normalized.startsWith("#")) return "";
    if (normalized.includes("\\") || normalized.includes("..")) return "";
    if (/[\u0000-\u001F\u007F]/.test(normalized)) return "";

    return normalized;
  }

  toggleAuthForm(showSignUp) {
    const signInForm = document.getElementById("signIn");
    const signUpForm = document.getElementById("signup");
    const setupForm = document.getElementById("completeAccountSetup");
    if (!signInForm || !signUpForm) return;

    signUpForm.style.display = showSignUp ? "block" : "none";
    signInForm.style.display = showSignUp ? "none" : "block";
    if (setupForm) setupForm.style.display = "none";

    [signInForm, signUpForm, setupForm].forEach((form) => this.resetPasswordVisibility(form));
  }

  showAccountSetup(email = "") {
    const signInForm = document.getElementById("signIn");
    const signUpForm = document.getElementById("signup");
    const setupForm = document.getElementById("completeAccountSetup");
    const setupEmail = document.getElementById("setupEmail");
    const setupPassword = document.getElementById("setupPassword");
    const setupPasswordConfirm = document.getElementById("setupPasswordConfirm");

    if (!signInForm || !signUpForm || !setupForm) return;

    signInForm.style.display = "none";
    signUpForm.style.display = "none";
    setupForm.style.display = "block";

    if (setupEmail) setupEmail.value = email;
    if (setupPassword) setupPassword.value = "";
    if (setupPasswordConfirm) setupPasswordConfirm.value = "";

    this.resetPasswordVisibility(setupForm);
    setupPassword?.focus();
  }
}

class UserProfileService {
  constructor({ dbInstance }) {
    this.db = dbInstance;
  }

  getLinkedProviders(user, providerId) {
    const authProviders = Array.isArray(user?.providerData)
      ? user.providerData.map((entry) => entry?.providerId).filter(Boolean)
      : [];

    return [...new Set([...authProviders, providerId].filter(Boolean))];
  }

  async ensureUserProfile(user, providerId) {
    const userRef = doc(this.db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    const nameParts = (user.displayName || "").trim().split(" ").filter(Boolean);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
    const displayName = user.displayName || (user.email ? user.email.split("@")[0] : "");
    const linkedProviders = this.getLinkedProviders(user, providerId);
    const timestamp = new Date().toISOString();

    const baseProfile = {
      email: user.email || "",
      displayName,
      provider: providerId,
      providers: linkedProviders,
      lastSignInProvider: providerId,
      updatedAt: timestamp
    };

    if (firstName) baseProfile.firstName = firstName;
    if (lastName) baseProfile.lastName = lastName;

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        ...baseProfile,
        firstName,
        lastName,
        contactNumber: "",
        role: "user",
        createdAt: timestamp
      });
      return;
    }

    const existingProfile = userSnap.data() || {};
    const mergedProfile = {
      updatedAt: timestamp,
      lastSignInProvider: providerId,
      providers: [
        ...new Set([...(Array.isArray(existingProfile.providers) ? existingProfile.providers : []), ...linkedProviders])
      ]
    };

    if (!existingProfile.email && user.email) mergedProfile.email = user.email;
    if (!existingProfile.provider && providerId === "password") mergedProfile.provider = "password";
    if (!existingProfile.displayName && displayName) mergedProfile.displayName = displayName;
    if (!existingProfile.firstName && firstName) mergedProfile.firstName = firstName;
    if (!existingProfile.lastName && lastName) mergedProfile.lastName = lastName;

    await setDoc(userRef, mergedProfile, { merge: true });
  }

  async isAdmin(uid) {
    const adminRef = doc(this.db, "admins", uid);
    const adminSnap = await getDoc(adminRef);
    return adminSnap.exists();
  }

  async getDashboardRole(userOrUid) {
    if (typeof userOrUid === "string") {
      const access = await resolveStaffAccess(this.db, userOrUid);
      return access.role;
    }

    const access = await resolveStaffAccessWithRetry(this.db, userOrUid);
    return access.role;
  }
}

class AuthPageController {
  constructor({ authInstance, uiService, validationService, profileService }) {
    this.auth = authInstance;
    this.ui = uiService;
    this.validation = validationService;
    this.profileService = profileService;

    this.googleProvider = new GoogleAuthProvider();
    this.googleProvider.setCustomParameters({ prompt: "select_account" });

    this.facebookProvider = new FacebookAuthProvider();
    this.facebookProvider.setCustomParameters({ display: "popup" });

    this.microsoftProvider = new OAuthProvider("microsoft.com");
    this.microsoftProvider.setCustomParameters({ prompt: "select_account" });

    this.socialProviderMap = {
      google: { provider: this.googleProvider, label: "Google" },
      facebook: { provider: this.facebookProvider, label: "Facebook" },
      microsoft: { provider: this.microsoftProvider, label: "Microsoft" }
    };

    this.pendingLinkCredential = null;
    this.pendingLinkProviderLabel = "";
    this.pendingLinkEmail = "";
  }

  clearPendingLink() {
    this.pendingLinkCredential = null;
    this.pendingLinkProviderLabel = "";
    this.pendingLinkEmail = "";
  }

  hasPasswordProvider(user) {
    const providers = Array.isArray(user?.providerData)
      ? user.providerData.map((provider) => provider?.providerId)
      : [];

    return providers.includes("password");
  }

  requiresAccountSetup(user, providerId) {
    return providerId === "google.com" && Boolean(user?.email) && !this.hasPasswordProvider(user);
  }

  async redirectAfterLogin(user) {
    const redirectTarget = this.ui.getRedirectTarget();
    try {
      const role = await this.profileService.getDashboardRole(user);
      setTimeout(() => {
        if (role) {
          window.location.href = "dashboard.html";
          return;
        }
        if (redirectTarget) {
          window.location.href = redirectTarget;
          return;
        }
        window.location.href = "../index.html";
      }, 1000);
    } catch (adminError) {
      console.error("Error checking staff role:", adminError);
      setTimeout(() => {
        if (redirectTarget) {
          window.location.href = redirectTarget;
          return;
        }
        window.location.href = "../index.html";
      }, 1000);
    }
  }

  async handleSocialSignIn(provider, providerLabel) {
    const messageDivId = this.ui.getActiveMessageDivId();

    try {
      this.ui.setSocialButtonsLoading(true);
      const result = await signInWithPopup(this.auth, provider);
      const user = result.user;
      const providerId = result?.providerId || provider?.providerId || providerLabel.toLowerCase();

      await this.profileService.ensureUserProfile(user, providerId);
      localStorage.setItem("loggedInUserId", user.uid);

      if (this.requiresAccountSetup(user, providerId)) {
        this.ui.showAccountSetup(user.email || "");
        this.ui.showMessage(
          "Create a password to finish setup and enable email + password sign-in.",
          "completeSetupMessage",
          "info"
        );
        return;
      }

      this.ui.showMessage(`${providerLabel} sign-in successful! Redirecting...`, messageDivId, "success");
      await this.redirectAfterLogin(user);
    } catch (error) {
      const errorCode = error.code;
      console.error(`${providerLabel} sign-in error:`, errorCode, error.message);

      switch (errorCode) {
        case "auth/account-exists-with-different-credential":
          this.pendingLinkCredential = error?.credential || null;
          this.pendingLinkProviderLabel = providerLabel;
          this.pendingLinkEmail = error?.customData?.email || "";

          try {
            if (this.pendingLinkEmail) {
              const methods = await fetchSignInMethodsForEmail(this.auth, this.pendingLinkEmail);
              if (methods.includes("password")) {
                this.ui.showMessage(
                  `This email already uses email/password. Sign in with your password to link ${providerLabel}.`,
                  messageDivId,
                  "error"
                );
              } else {
                this.ui.showMessage(
                  "This email is already linked to another sign-in method. Please use your original method.",
                  messageDivId,
                  "error"
                );
              }
            } else {
              this.ui.showMessage(
                "An account already exists with the same email. Please sign in using your original method.",
                messageDivId,
                "error"
              );
            }
          } catch {
            this.ui.showMessage(
              "An account already exists with the same email. Please sign in using your original method.",
              messageDivId,
              "error"
            );
          }

          this.ui.toggleAuthForm(false);
          break;
        case "auth/popup-closed-by-user":
          this.ui.showMessage("Sign-in popup was closed before completing.", messageDivId, "error");
          break;
        case "auth/popup-blocked":
          this.ui.showMessage("Popup blocked. Please allow popups and try again.", messageDivId, "error");
          break;
        case "auth/operation-not-allowed":
          this.ui.showMessage("This sign-in method is not enabled. Please contact support.", messageDivId, "error");
          break;
        case "auth/network-request-failed":
          this.ui.showMessage("Network error. Please check your internet connection.", messageDivId, "error");
          break;
        default:
          this.ui.showMessage("Social sign-in failed. Please try again.", messageDivId, "error");
      }
    } finally {
      this.ui.setSocialButtonsLoading(false);
    }
  }

  bindSignUp() {
    const signUp = document.getElementById("submitSignUp");
    if (!signUp) return;

    signUp.addEventListener("click", async (event) => {
      event.preventDefault();

      const emailInput = document.getElementById("rEmail");
      const passwordInput = document.getElementById("rPassword");
      const confirmPasswordInput = document.getElementById("rPasswordConfirm");
      const firstNameInput = document.getElementById("fName");
      const lastNameInput = document.getElementById("lName");

      if (!emailInput || !passwordInput || !confirmPasswordInput || !firstNameInput || !lastNameInput) {
        this.ui.showMessage("Form elements not found. Please refresh the page.", "signUpMessage", "error");
        return;
      }

      const email = this.validation.normalizeEmail(emailInput.value);
      const password = passwordInput.value;
      const confirmPassword = confirmPasswordInput.value;
      const firstName = this.validation.sanitizeInput(firstNameInput.value);
      const lastName = this.validation.sanitizeInput(lastNameInput.value);

      if (!firstName || !lastName || !email || !password || !confirmPassword) {
        this.ui.showMessage("Please fill in all fields", "signUpMessage", "error");
        return;
      }

      const firstNameValidation = this.validation.validateName(firstName, "First name");
      if (!firstNameValidation.valid) {
        this.ui.showMessage(firstNameValidation.message, "signUpMessage", "error");
        firstNameInput.focus();
        return;
      }

      const lastNameValidation = this.validation.validateName(lastName, "Last name");
      if (!lastNameValidation.valid) {
        this.ui.showMessage(lastNameValidation.message, "signUpMessage", "error");
        lastNameInput.focus();
        return;
      }

      if (!this.validation.validateEmail(email)) {
        this.ui.showMessage("Please enter a valid email address", "signUpMessage", "error");
        emailInput.focus();
        return;
      }
      emailInput.value = email;

      const passwordValidation = this.validation.validatePassword(password);
      if (!passwordValidation.valid) {
        this.ui.showMessage(passwordValidation.message, "signUpMessage", "error");
        passwordInput.focus();
        return;
      }

      if (password !== confirmPassword) {
        this.ui.showMessage("Passwords do not match", "signUpMessage", "error");
        confirmPasswordInput.focus();
        return;
      }

      this.ui.setButtonLoading(signUp, true);

      try {
        const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
        const user = userCredential.user;
        const timestamp = new Date().toISOString();

        const userData = {
          email,
          firstName,
          lastName,
          displayName: `${firstName} ${lastName}`.trim(),
          provider: "password",
          providers: ["password"],
          lastSignInProvider: "password",
          createdAt: timestamp,
          updatedAt: timestamp,
          contactNumber: "",
          role: "user"
        };

        const docRef = doc(db, "users", user.uid);
        await setDoc(docRef, userData);
        try {
          await signOut(this.auth);
        } catch (signOutError) {
          console.error("Post-signup sign-out error:", signOutError);
        }
        localStorage.removeItem("loggedInUserId");

        this.ui.showMessage("Account created successfully! Redirecting to sign in...", "signUpMessage", "success");
        this.ui.setButtonLoading(signUp, false);
        this.ui.resetForm("signup");

        setTimeout(() => {
          this.ui.toggleAuthForm(false);
        }, 1500);
      } catch (error) {
        this.ui.setButtonLoading(signUp, false);

        const errorCode = error.code;
        console.error("Sign up error:", errorCode, error.message);

        switch (errorCode) {
          case "auth/email-already-in-use":
            this.ui.showMessage("This email is already registered. Please sign in instead.", "signUpMessage", "error");
            break;
          case "auth/invalid-email":
            this.ui.showMessage("Invalid email address format", "signUpMessage", "error");
            break;
          case "auth/operation-not-allowed":
            this.ui.showMessage(
              "Email/password accounts are not enabled. Please contact support.",
              "signUpMessage",
              "error"
            );
            break;
          case "auth/weak-password":
            this.ui.showMessage("Password is too weak. Please use a stronger password.", "signUpMessage", "error");
            break;
          case "auth/network-request-failed":
            this.ui.showMessage("Network error. Please check your internet connection.", "signUpMessage", "error");
            break;
          default:
            this.ui.showMessage("Unable to create account. Please try again.", "signUpMessage", "error");
        }
      }
    });
  }

  bindSignIn() {
    const signIn = document.getElementById("submitSignIn");
    if (!signIn) return;

    signIn.addEventListener("click", async (event) => {
      event.preventDefault();

      const emailInput = document.getElementById("email");
      const passwordInput = document.getElementById("password");

      if (!emailInput || !passwordInput) {
        this.ui.showMessage("Form elements not found. Please refresh the page.", "signInMessage", "error");
        return;
      }

      const email = this.validation.normalizeEmail(emailInput.value);
      const password = passwordInput.value;

      if (!email || !password) {
        this.ui.showMessage("Please enter both email and password", "signInMessage", "error");
        return;
      }

      if (!this.validation.validateEmail(email)) {
        this.ui.showMessage("Please enter a valid email address", "signInMessage", "error");
        emailInput.focus();
        return;
      }
      emailInput.value = email;

      if (password.length < 6) {
        this.ui.showMessage("Password must be at least 6 characters long", "signInMessage", "error");
        passwordInput.focus();
        return;
      }

      this.ui.setButtonLoading(signIn, true);

      try {
        const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
        const user = userCredential.user;

        let linkNotice = "";
        if (this.pendingLinkCredential) {
          const pendingEmail = this.pendingLinkEmail || "";
          const emailMatches = !pendingEmail || pendingEmail.toLowerCase() === email.toLowerCase();
          if (emailMatches) {
            try {
              await linkWithCredential(user, this.pendingLinkCredential);
              linkNotice = ` ${this.pendingLinkProviderLabel || "Social"} account linked.`;
            } catch (linkError) {
              const linkCode = linkError?.code;
              console.error("Account linking error:", linkCode, linkError?.message);
            }
          }
          this.clearPendingLink();
        }

        await this.profileService.ensureUserProfile(user, "password");

        this.ui.showMessage(`Sign in successful!${linkNotice} Redirecting...`, "signInMessage", "success");
        localStorage.setItem("loggedInUserId", user.uid);
        await this.redirectAfterLogin(user);
      } catch (error) {
        this.ui.setButtonLoading(signIn, false);

        const errorCode = error.code;
        console.error("Sign in error:", errorCode, error.message);

        if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(errorCode)) {
          try {
            const methods = await fetchSignInMethodsForEmail(this.auth, email);
            if (methods.includes("google.com") && !methods.includes("password")) {
              this.ui.showMessage(
                "This email is linked to Google sign-in. Use the Google button to continue and complete account setup.",
                "signInMessage",
                "error"
              );
              return;
            }
          } catch {}
        }

        switch (errorCode) {
          case "auth/invalid-credential":
          case "auth/wrong-password":
            this.ui.showMessage("Incorrect email or password", "signInMessage", "error");
            break;
          case "auth/user-not-found":
            this.ui.showMessage("No account found with this email. Please sign up first.", "signInMessage", "error");
            break;
          case "auth/user-disabled":
            this.ui.showMessage("This account has been disabled. Please contact support.", "signInMessage", "error");
            break;
          case "auth/too-many-requests":
            this.ui.showMessage(
              "Too many failed attempts. Please try again later or reset your password.",
              "signInMessage",
              "error"
            );
            break;
          case "auth/network-request-failed":
            this.ui.showMessage("Network error. Please check your internet connection.", "signInMessage", "error");
            break;
          case "auth/invalid-email":
            this.ui.showMessage("Invalid email format", "signInMessage", "error");
            break;
          default:
            this.ui.showMessage("Sign-in failed. Please try again.", "signInMessage", "error");
        }
      }
    });
  }

  bindAccountSetup() {
    const submitCompleteSetup = document.getElementById("submitCompleteSetup");
    if (!submitCompleteSetup) return;

    submitCompleteSetup.addEventListener("click", async (event) => {
      event.preventDefault();

      const user = this.auth.currentUser;
      const setupPasswordInput = document.getElementById("setupPassword");
      const setupPasswordConfirmInput = document.getElementById("setupPasswordConfirm");

      if (!user || !user.email) {
        this.ui.showMessage("Please sign in with Google again to complete account setup.", "completeSetupMessage", "error");
        this.ui.toggleAuthForm(false);
        return;
      }

      if (!setupPasswordInput || !setupPasswordConfirmInput) {
        this.ui.showMessage("Setup form is missing fields. Please refresh the page.", "completeSetupMessage", "error");
        return;
      }

      if (this.hasPasswordProvider(user)) {
        await this.profileService.ensureUserProfile(user, "password");
        this.ui.showMessage("Account setup already complete. Redirecting...", "completeSetupMessage", "success");
        await this.redirectAfterLogin(user);
        return;
      }

      const password = setupPasswordInput.value;
      const confirmPassword = setupPasswordConfirmInput.value;

      if (!password || !confirmPassword) {
        this.ui.showMessage("Please enter and confirm your password.", "completeSetupMessage", "error");
        return;
      }

      const passwordValidation = this.validation.validatePassword(password);
      if (!passwordValidation.valid) {
        this.ui.showMessage(passwordValidation.message, "completeSetupMessage", "error");
        setupPasswordInput.focus();
        return;
      }

      if (password !== confirmPassword) {
        this.ui.showMessage("Passwords do not match.", "completeSetupMessage", "error");
        setupPasswordConfirmInput.focus();
        return;
      }

      this.ui.setButtonLoading(submitCompleteSetup, true);

      let success = false;
      try {
        const credential = EmailAuthProvider.credential(user.email, password);
        await linkWithCredential(user, credential);
        await this.profileService.ensureUserProfile(user, "password");
        localStorage.setItem("loggedInUserId", user.uid);
        this.ui.showMessage("Account setup complete! Redirecting...", "completeSetupMessage", "success");
        success = true;
        await this.redirectAfterLogin(user);
      } catch (error) {
        const errorCode = error?.code;
        console.error("Complete account setup error:", errorCode, error?.message);

        if (errorCode === "auth/requires-recent-login") {
          this.ui.showMessage(
            "For security, please sign in with Google again to complete account setup.",
            "completeSetupMessage",
            "error"
          );
        } else if (errorCode === "auth/provider-already-linked") {
          await this.profileService.ensureUserProfile(user, "password");
          this.ui.showMessage("Account setup already complete. Redirecting...", "completeSetupMessage", "success");
          success = true;
          await this.redirectAfterLogin(user);
        } else {
          this.ui.showMessage("Unable to complete account setup. Please try again.", "completeSetupMessage", "error");
        }
      } finally {
        if (!success) {
          this.ui.setButtonLoading(submitCompleteSetup, false);
        }
      }
    });
  }

  bindPasswordToggles() {
    document.querySelectorAll(".password-toggle").forEach((toggleButton) => {
      const targetId = toggleButton.dataset.target;
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input) return;

      this.ui.setPasswordToggleState(toggleButton, input, false);
      toggleButton.addEventListener("click", () => {
        const isCurrentlyHidden = input.type === "password";
        this.ui.setPasswordToggleState(toggleButton, input, isCurrentlyHidden);
      });
    });
  }

  bindRealtimeValidation() {
    const validation = this.validation;
    const emailInputs = [document.getElementById("email"), document.getElementById("rEmail")];
    emailInputs.forEach((input) => {
      if (!input) return;
      input.addEventListener("blur", function onBlur() {
        if (this.value && !validation.validateEmail(validation.normalizeEmail(this.value))) {
          this.style.borderColor = "#ef4444";
        } else {
          this.style.borderColor = "";
        }
      });
      input.addEventListener("input", function onInput() {
        this.style.borderColor = "";
      });
    });

    const passwordInput = document.getElementById("rPassword");
    if (passwordInput) {
      passwordInput.addEventListener("input", () => {
        if (passwordInput.value.length > 0) {
          const validation = this.validation.validatePassword(passwordInput.value);
          passwordInput.style.borderColor = validation.valid ? "#10b981" : "#ef4444";
        } else {
          passwordInput.style.borderColor = "";
        }
      });
    }

    const confirmPasswordInput = document.getElementById("rPasswordConfirm");
    if (confirmPasswordInput && passwordInput) {
      confirmPasswordInput.addEventListener("input", () => {
        if (confirmPasswordInput.value.length > 0) {
          confirmPasswordInput.style.borderColor =
            confirmPasswordInput.value === passwordInput.value ? "#10b981" : "#ef4444";
        } else {
          confirmPasswordInput.style.borderColor = "";
        }
      });
    }
  }

  bindFormSubmitPrevention() {
    document.querySelectorAll("form").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
      });
    });
  }

  bindEnterKeySubmit() {
    document.querySelectorAll("#signup input").forEach((input) => {
      input.addEventListener("keypress", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const signUpBtn = document.getElementById("submitSignUp");
        if (signUpBtn && !signUpBtn.disabled) signUpBtn.click();
      });
    });

    document.querySelectorAll("#signIn input").forEach((input) => {
      input.addEventListener("keypress", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const signInBtn = document.getElementById("submitSignIn");
        if (signInBtn && !signInBtn.disabled) signInBtn.click();
      });
    });

    document.querySelectorAll("#completeAccountSetup input").forEach((input) => {
      input.addEventListener("keypress", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const setupBtn = document.getElementById("submitCompleteSetup");
        if (setupBtn && !setupBtn.disabled) setupBtn.click();
      });
    });
  }

  bindAutoFocus() {
    window.addEventListener("load", () => {
      const signInForm = document.getElementById("signIn");
      const signUpForm = document.getElementById("signup");
      const setupForm = document.getElementById("completeAccountSetup");

      if (signInForm && signInForm.style.display !== "none") {
        const emailInput = document.getElementById("email");
        if (emailInput) emailInput.focus();
      } else if (signUpForm && signUpForm.style.display !== "none") {
        const firstNameInput = document.getElementById("fName");
        if (firstNameInput) firstNameInput.focus();
      } else if (setupForm && setupForm.style.display !== "none") {
        const setupPasswordInput = document.getElementById("setupPassword");
        if (setupPasswordInput) setupPasswordInput.focus();
      }
    });
  }

  bindClearErrorOnInput() {
    document.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        const container = input.closest(".container");
        if (!container) return;
        const messageDiv = container.querySelector(".messageDiv");
        if (messageDiv && messageDiv.classList.contains("error")) {
          messageDiv.style.opacity = "0";
          setTimeout(() => {
            messageDiv.style.display = "none";
          }, 300);
        }
      });
    });
  }

  bindSocialButtons() {
    document.querySelectorAll(".social-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const providerKey = button.dataset.provider;
        const providerConfig = this.socialProviderMap[providerKey];
        if (!providerConfig) {
          const messageDivId = this.ui.getActiveMessageDivId();
          this.ui.showMessage("Unsupported sign-in provider.", messageDivId, "error");
          return;
        }
        this.handleSocialSignIn(providerConfig.provider, providerConfig.label);
      });
    });
  }

  bindFormToggleButtons() {
    const signUpButton = document.getElementById("signUpButton");
    const signInButton = document.getElementById("signInButton");

    if (signUpButton) {
      signUpButton.addEventListener("click", () => this.ui.toggleAuthForm(true));
    }
    if (signInButton) {
      signInButton.addEventListener("click", () => this.ui.toggleAuthForm(false));
    }
  }

  init() {
    this.bindSignUp();
    this.bindSignIn();
    this.bindAccountSetup();
    this.bindPasswordToggles();
    this.bindRealtimeValidation();
    this.bindFormSubmitPrevention();
    this.bindEnterKeySubmit();
    this.bindAutoFocus();
    this.bindClearErrorOnInput();
    this.bindSocialButtons();
    this.bindFormToggleButtons();
  }
}

const validationService = new AuthValidationService();
const uiService = new AuthUiService(validationService);
const profileService = new UserProfileService({ dbInstance: db });

const authPageController = new AuthPageController({
  authInstance: auth,
  uiService,
  validationService,
  profileService
});

authPageController.init();
