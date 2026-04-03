import { auth, db } from "./firebase.js";
import { setText, setValue } from "./utils.js";
import { showAlert } from "../dialogs.js";
import {
  signOut,
  EmailAuthProvider,
  linkWithCredential
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

class ProfileCoreController {
  constructor({ authInstance, dbInstance, showAlertFn }) {
    this.auth = authInstance;
    this.db = dbInstance;
    this.showAlert = showAlertFn;

    this.defaultSection = "profile";
    this.navbarLabel = "Profile";
    this.originalName = "";
    this.originalContact = "";

    this.dom = {
      editBtn: document.getElementById("editProfileBtn"),
      saveBtn: document.getElementById("saveProfileBtn"),
      cancelBtn: document.getElementById("cancelProfileBtn"),
      actions: document.getElementById("profileActions"),
      nameText: document.getElementById("nameText"),
      nameInput: document.getElementById("nameInput"),
      contactText: document.getElementById("contactText"),
      contactInput: document.getElementById("contactInput"),
      profileCard: document.getElementById("profile"),
      profileDisplayName: document.getElementById("profileDisplayName"),
      profileDisplayEmail: document.getElementById("profileDisplayEmail"),
      emailText: document.getElementById("emailText"),
      navbarName: document.querySelector(".profile-name"),
      navButtons: document.querySelectorAll(".profile-nav button"),
      sections: document.querySelectorAll(".profile-section"),
      passwordSettings: document.getElementById("passwordSettings"),
      newPasswordInput: document.getElementById("newPassword"),
      confirmNewPasswordInput: document.getElementById("confirmNewPassword"),
      setPasswordBtn: document.getElementById("setPasswordBtn"),
      passwordMessage: document.getElementById("passwordMessage"),
    };
  }

  initializeProfileEditState() {
    const { actions, saveBtn, cancelBtn } = this.dom;
    if (actions) actions.hidden = true;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.classList.remove("active");
    }
    if (cancelBtn) cancelBtn.disabled = true;
  }

  setProfileDisplay({ displayName, email, contact }) {
    const {
      profileDisplayName,
      profileDisplayEmail,
      emailText,
      nameText,
      nameInput,
      contactText,
      contactInput,
      navbarName,
    } = this.dom;

    const headerName = displayName || email || "Profile";

    setText(profileDisplayName, headerName);
    setText(profileDisplayEmail, email || "");
    setText(emailText, email || "");
    setText(nameText, displayName || "");
    setValue(nameInput, displayName || "");
    setText(contactText, contact || "");
    setValue(contactInput, contact || "");

    if (navbarName) navbarName.textContent = this.navbarLabel;
  }

  showPasswordMessage(message, type = "info") {
    const { passwordMessage } = this.dom;
    if (!passwordMessage) return;
    passwordMessage.textContent = message;
    passwordMessage.className = `settings-message ${type}`;
    passwordMessage.hidden = false;
  }

  clearPasswordMessage() {
    const { passwordMessage } = this.dom;
    if (passwordMessage) passwordMessage.hidden = true;
  }

  validatePasswordStrength(password) {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);

    if (password.length < minLength) {
      return { valid: false, message: "Password must be at least 8 characters long" };
    }
    if (!hasUpperCase) {
      return { valid: false, message: "Password must contain at least one uppercase letter" };
    }
    if (!hasLowerCase) {
      return { valid: false, message: "Password must contain at least one lowercase letter" };
    }
    if (!hasNumber) {
      return { valid: false, message: "Password must contain at least one number" };
    }

    return { valid: true };
  }

  updatePasswordSettingsVisibility(user) {
    const { passwordSettings, newPasswordInput, confirmNewPasswordInput } = this.dom;
    if (!passwordSettings) return;
    passwordSettings.hidden = true;
    if (newPasswordInput) newPasswordInput.value = "";
    if (confirmNewPasswordInput) confirmNewPasswordInput.value = "";
    this.clearPasswordMessage();
  }

  async loadUserProfile(user) {
    const userRef = doc(this.db, "users", user.uid);

    try {
      const docSnap = await getDoc(userRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        const displayName = data.displayName || `${data.firstName || ""} ${data.lastName || ""}`.trim();
        const email = data.email || user.email || "";

        this.setProfileDisplay({
          displayName: displayName || user.displayName || "",
          email,
          contact: data.contact || ""
        });
        return;
      }
    } catch (error) {
      console.error("Failed to load user profile:", error);
    }

    const email = user.email || "";
    this.setProfileDisplay({
      displayName: user.displayName || "",
      email,
      contact: ""
    });
  }

  async persistProfile(user) {
    const { nameInput, contactInput, nameText, contactText, profileDisplayName, navbarName } = this.dom;
    const userRef = doc(this.db, "users", user.uid);
    const displayName = nameInput ? nameInput.value.trim() : "";
    const contact = contactInput ? contactInput.value.trim() : "";

    try {
      await updateDoc(userRef, { displayName, contact });
    } catch (error) {
      try {
        await setDoc(userRef, { displayName, contact, email: user.email || "" }, { merge: true });
      } catch (innerError) {
        console.error("Profile update failed:", innerError);
        await this.showAlert("Unable to save profile. Please try again.");
        return false;
      }
    }

    setText(nameText, displayName);
    setText(contactText, contact);

    const headerName = displayName || user.email || "Profile";
    setText(profileDisplayName, headerName);
    if (navbarName) navbarName.textContent = this.navbarLabel;

    return true;
  }

  checkForChanges() {
    const { nameInput, contactInput, saveBtn } = this.dom;
    if (!nameInput || !contactInput || !saveBtn) return;

    const hasChanges =
      nameInput.value !== this.originalName ||
      contactInput.value !== this.originalContact;

    if (hasChanges) {
      saveBtn.disabled = false;
      saveBtn.classList.add("active");
    } else {
      saveBtn.disabled = true;
      saveBtn.classList.remove("active");
    }
  }

  exitEditMode() {
    const { profileCard, nameText, contactText, nameInput, contactInput, actions, saveBtn, cancelBtn, editBtn } = this.dom;

    if (profileCard) profileCard.classList.remove("editing");
    if (nameText) nameText.hidden = false;
    if (contactText) contactText.hidden = false;
    if (nameInput) nameInput.hidden = true;
    if (contactInput) contactInput.hidden = true;
    if (actions) actions.hidden = true;

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.classList.remove("active");
    }
    if (cancelBtn) cancelBtn.disabled = true;
    if (editBtn) editBtn.disabled = false;
  }

  setActiveSection(sectionId) {
    const { navButtons, sections } = this.dom;
    const normalizedSectionId = sectionId || this.defaultSection;
    const targetSection = document.getElementById(normalizedSectionId)
      ? normalizedSectionId
      : this.defaultSection;

    navButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.section === targetSection);
    });

    sections.forEach((section) => {
      section.classList.toggle("active", section.id === targetSection);
    });

    return targetSection;
  }

  syncSectionFromHash() {
    const hashSection = window.location.hash.replace("#", "");
    return this.setActiveSection(hashSection || this.defaultSection);
  }

  bindSectionNavigation() {
    const { navButtons, sections } = this.dom;
    if (navButtons.length && sections.length) {
      navButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          const activeSection = this.setActiveSection(btn.dataset.section);
          const targetHash = `#${activeSection}`;
          if (window.location.hash !== targetHash) {
            window.location.hash = activeSection;
            return;
          }
          this.updateProfileMenuActiveState();
        });
      });
    }
    this.syncSectionFromHash();
  }

  updateProfileMenuActiveState() {
    const hash = window.location.hash || `#${this.defaultSection}`;
    const menuItems = document.querySelectorAll(".profile-menu-item:not(.danger)");

    menuItems.forEach((item) => {
      item.classList.remove("active");
      const href = item.getAttribute("href") || "";
      const itemHash = href.includes("#") ? `#${href.split("#").pop()}` : `#${this.defaultSection}`;
      if (itemHash === hash) {
        item.classList.add("active");
      }
    });
  }

  bindProfileEditControls() {
    const { editBtn, profileCard, nameText, contactText, nameInput, contactInput, actions, saveBtn, cancelBtn } = this.dom;

    if (editBtn) {
      editBtn.addEventListener("click", () => {
        if (!profileCard || !nameText || !contactText || !nameInput || !contactInput) return;

        this.originalName = nameText.textContent;
        this.originalContact = contactText.textContent;

        profileCard.classList.add("editing");
        nameText.hidden = true;
        contactText.hidden = true;
        nameInput.hidden = false;
        contactInput.hidden = false;
        nameInput.value = this.originalName;
        contactInput.value = this.originalContact;
        if (actions) actions.hidden = false;

        editBtn.disabled = true;
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.classList.remove("active");
        }
        if (cancelBtn) cancelBtn.disabled = false;
      });
    }

    nameInput?.addEventListener("input", () => this.checkForChanges());
    contactInput?.addEventListener("input", () => this.checkForChanges());

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        if (nameInput) nameInput.value = this.originalName;
        if (contactInput) contactInput.value = this.originalContact;
        this.exitEditMode();
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        if (saveBtn.disabled) return;
        const user = this.auth.currentUser;
        if (!user) return;

        const saved = await this.persistProfile(user);
        if (saved) {
          this.exitEditMode();
          await this.showAlert("Profile updated successfully!");
        }
      });
    }
  }

  bindPasswordControls() {
    const { setPasswordBtn, newPasswordInput, confirmNewPasswordInput } = this.dom;

    if (setPasswordBtn) {
      setPasswordBtn.addEventListener("click", async () => {
        const user = this.auth.currentUser;
        if (!user) {
          this.showPasswordMessage("Please sign in again.", "error");
          return;
        }

        if (!newPasswordInput || !confirmNewPasswordInput) {
          this.showPasswordMessage("Password fields are missing. Please refresh the page.", "error");
          return;
        }

        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmNewPasswordInput.value;
        if (!newPassword || !confirmPassword) {
          this.showPasswordMessage("Please enter and confirm your new password.", "error");
          return;
        }

        const validation = this.validatePasswordStrength(newPassword);
        if (!validation.valid) {
          this.showPasswordMessage(validation.message, "error");
          return;
        }

        if (newPassword !== confirmPassword) {
          this.showPasswordMessage("Passwords do not match.", "error");
          return;
        }

        if (!user.email) {
          this.showPasswordMessage("Unable to set a password for this account.", "error");
          return;
        }

        const originalText = setPasswordBtn.textContent;
        setPasswordBtn.disabled = true;
        setPasswordBtn.textContent = "Saving...";

        let success = false;
        try {
          const credential = EmailAuthProvider.credential(user.email, newPassword);
          await linkWithCredential(user, credential);
          this.showPasswordMessage(
            "Password set successfully. You can now sign in with email and password.",
            "success"
          );
          success = true;
        } catch (error) {
          const errorCode = error.code;
          console.error("Set password error:", errorCode, error.message);

          if (errorCode === "auth/requires-recent-login") {
            this.showPasswordMessage("Please sign out and sign in again, then set your password.", "error");
          } else if (errorCode === "auth/credential-already-in-use" || errorCode === "auth/email-already-in-use") {
            this.showPasswordMessage("That email is already linked to another account.", "error");
          } else {
            this.showPasswordMessage("Unable to set password. Please try again.", "error");
          }
        } finally {
          if (success) {
            setPasswordBtn.textContent = "Password Set";
            if (newPasswordInput) newPasswordInput.disabled = true;
            if (confirmNewPasswordInput) confirmNewPasswordInput.disabled = true;
          } else {
            setPasswordBtn.disabled = false;
            setPasswordBtn.textContent = originalText || "Set Password";
          }
        }
      });
    }

    newPasswordInput?.addEventListener("input", () => this.clearPasswordMessage());
    confirmNewPasswordInput?.addEventListener("input", () => this.clearPasswordMessage());
  }

  bindSignOutButtons() {
    document.querySelectorAll(".btn.danger.full").forEach((btn) => {
      btn.addEventListener("click", () => {
        signOut(this.auth).then(() => {
          localStorage.removeItem("loggedInUserId");
          window.location.href = "login-register.html";
        });
      });
    });
  }

  init() {
    this.initializeProfileEditState();
    this.setProfileDisplay({ displayName: "", email: "", contact: "" });
    this.bindProfileEditControls();
    this.bindPasswordControls();
    this.bindSignOutButtons();
    this.bindSectionNavigation();
    this.updateProfileMenuActiveState();

    window.addEventListener("hashchange", () => {
      this.syncSectionFromHash();
      this.updateProfileMenuActiveState();
    });
  }
}

const profileCoreController = new ProfileCoreController({
  authInstance: auth,
  dbInstance: db,
  showAlertFn: showAlert,
});

export const updatePasswordSettingsVisibility = (user) =>
  profileCoreController.updatePasswordSettingsVisibility(user);

export const loadUserProfile = async (user) =>
  profileCoreController.loadUserProfile(user);

export const initProfileCore = () =>
  profileCoreController.init();
