import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { auth } from "./profile/firebase.js";
import { initProfileCore, loadUserProfile, updatePasswordSettingsVisibility } from "./profile/core.js";
import { initBookings, startBookingListener, ensureBookingAccess, handleSignedOut } from "./profile/bookings.js";

class ProfilePageController {
  constructor({ authInstance }) {
    this.auth = authInstance;
  }

  init() {
    initProfileCore();
    initBookings();
    onAuthStateChanged(this.auth, (user) => this.handleAuthState(user));
  }

  handleAuthState(user) {
    if (!user) {
      handleSignedOut();
      return;
    }

    loadUserProfile(user);
    startBookingListener(user);
    updatePasswordSettingsVisibility(user);
    ensureBookingAccess(user);
  }
}

const profilePageController = new ProfilePageController({ authInstance: auth });
profilePageController.init();
