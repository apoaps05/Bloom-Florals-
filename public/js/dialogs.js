class DialogManager {
  constructor() {
    this.state = {
      overlay: null,
      dialog: null,
      titleEl: null,
      messageEl: null,
      inputWrap: null,
      inputLabel: null,
      inputEl: null,
      confirmBtn: null,
      cancelBtn: null,
      closeBtn: null,
      pendingResolve: null,
      lastFocus: null,
      mode: "confirm"
    };

    this.readyPromise = null;
    this.readyResolve = null;
    this.handleKeydownBound = (event) => this.handleKeydown(event);
  }

  async ensureDialog() {
    if (this.state.overlay) return;

    if (!this.readyPromise) {
      this.readyPromise = new Promise((resolve) => {
        this.readyResolve = resolve;
      });
    }

    const build = () => this.buildDialog();
    if (document.body) {
      build();
    } else {
      document.addEventListener("DOMContentLoaded", build, { once: true });
    }

    await this.readyPromise;
  }

  buildDialog() {
    if (this.state.overlay) {
      if (this.readyResolve) this.readyResolve();
      return;
    }

    let overlay = document.getElementById("appDialogOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "app-dialog-overlay";
      overlay.id = "appDialogOverlay";
      overlay.innerHTML = `
        <div class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle" aria-describedby="appDialogMessage">
          <div class="app-dialog-header">
            <h3 class="app-dialog-title" id="appDialogTitle">Please Confirm</h3>
            <button type="button" class="app-dialog-close" aria-label="Close">&times;</button>
          </div>
          <div class="app-dialog-body">
            <p class="app-dialog-message" id="appDialogMessage"></p>
            <div class="app-dialog-input" id="appDialogInputWrap" hidden>
              <label class="app-dialog-label" for="appDialogInput" id="appDialogInputLabel">Reason</label>
              <textarea id="appDialogInput" rows="3"></textarea>
            </div>
          </div>
          <div class="app-dialog-footer">
            <button type="button" class="app-dialog-btn app-dialog-cancel">Cancel</button>
            <button type="button" class="app-dialog-btn app-dialog-confirm tone-danger">Confirm</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    this.state.overlay = overlay;
    this.state.dialog = overlay.querySelector(".app-dialog");
    this.state.titleEl = overlay.querySelector("#appDialogTitle");
    this.state.messageEl = overlay.querySelector("#appDialogMessage");
    this.state.inputWrap = overlay.querySelector("#appDialogInputWrap");
    this.state.inputLabel = overlay.querySelector("#appDialogInputLabel");
    this.state.inputEl = overlay.querySelector("#appDialogInput");
    this.state.confirmBtn = overlay.querySelector(".app-dialog-confirm");
    this.state.cancelBtn = overlay.querySelector(".app-dialog-cancel");
    this.state.closeBtn = overlay.querySelector(".app-dialog-close");

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        this.handleCancel();
      }
    });

    this.state.confirmBtn?.addEventListener("click", () => this.handleConfirm());
    this.state.cancelBtn?.addEventListener("click", () => this.handleCancel());
    this.state.closeBtn?.addEventListener("click", () => this.handleCancel());

    if (this.readyResolve) this.readyResolve();
  }

  setTone(tone) {
    if (!this.state.confirmBtn) return;
    this.state.confirmBtn.classList.remove("tone-primary", "tone-danger", "tone-neutral");

    if (tone === "neutral") {
      this.state.confirmBtn.classList.add("tone-neutral");
      return;
    }

    if (tone === "danger") {
      this.state.confirmBtn.classList.add("tone-danger");
      return;
    }

    this.state.confirmBtn.classList.add("tone-primary");
  }

  closeDialog(result) {
    if (!this.state.overlay) return;

    this.state.overlay.classList.remove("show");
    document.body.style.overflow = "";
    document.removeEventListener("keydown", this.handleKeydownBound);

    if (this.state.lastFocus && typeof this.state.lastFocus.focus === "function") {
      this.state.lastFocus.focus();
    }

    if (this.state.pendingResolve) {
      const resolver = this.state.pendingResolve;
      this.state.pendingResolve = null;
      resolver(result);
    }
  }

  handleConfirm() {
    if (this.state.mode === "prompt") {
      this.closeDialog(this.state.inputEl?.value ?? "");
      return;
    }
    this.closeDialog(true);
  }

  handleCancel() {
    if (this.state.mode === "alert") {
      this.closeDialog(true);
      return;
    }
    if (this.state.mode === "prompt") {
      this.closeDialog(null);
      return;
    }
    this.closeDialog(false);
  }

  handleKeydown(event) {
    if (event.key === "Escape") {
      this.handleCancel();
    }
  }

  async openDialog({
    title,
    message,
    confirmText,
    cancelText,
    tone = "primary",
    mode = "confirm",
    inputLabel,
    inputPlaceholder,
    inputValue
  } = {}) {
    await this.ensureDialog();
    if (!this.state.overlay) return false;

    if (this.state.pendingResolve) {
      this.closeDialog(false);
    }

    this.state.mode = mode;
    this.state.lastFocus = document.activeElement;

    if (this.state.titleEl) {
      this.state.titleEl.textContent = title || (mode === "alert" ? "Notice" : "Please Confirm");
    }
    if (this.state.messageEl) {
      this.state.messageEl.textContent = message || "";
    }
    if (this.state.inputWrap) {
      this.state.inputWrap.hidden = mode !== "prompt";
    }
    if (this.state.inputLabel) {
      this.state.inputLabel.textContent = inputLabel || "Reason";
    }
    if (this.state.inputEl) {
      this.state.inputEl.value = inputValue || "";
      this.state.inputEl.placeholder = inputPlaceholder || "";
      this.state.inputEl.disabled = mode !== "prompt";
    }
    if (this.state.confirmBtn) {
      this.state.confirmBtn.textContent =
        confirmText || (mode === "alert" ? "OK" : mode === "prompt" ? "Submit" : "Confirm");
    }
    if (this.state.cancelBtn) {
      this.state.cancelBtn.textContent = cancelText || "Cancel";
      this.state.cancelBtn.hidden = mode === "alert";
    }

    this.setTone(tone);

    this.state.overlay.classList.add("show");
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", this.handleKeydownBound);

    if (mode === "prompt" && this.state.inputEl && typeof this.state.inputEl.focus === "function") {
      this.state.inputEl.focus();
    } else if (this.state.confirmBtn && typeof this.state.confirmBtn.focus === "function") {
      this.state.confirmBtn.focus();
    }

    return new Promise((resolve) => {
      this.state.pendingResolve = resolve;
    });
  }

  showConfirm(options = {}) {
    if (typeof options === "string") {
      return this.openDialog({ message: options, mode: "confirm", tone: "danger" });
    }
    return this.openDialog({ ...options, mode: "confirm", tone: options?.tone || "danger" });
  }

  showAlert(options = {}) {
    if (typeof options === "string") {
      return this.openDialog({ message: options, mode: "alert", tone: "primary" });
    }
    return this.openDialog({ ...options, mode: "alert", tone: options?.tone || "primary" });
  }

  showPrompt(options = {}) {
    if (typeof options === "string") {
      return this.openDialog({ message: options, mode: "prompt", tone: "primary" });
    }
    return this.openDialog({ ...options, mode: "prompt", tone: options?.tone || "primary" });
  }
}

const dialogManager = new DialogManager();

export const showConfirm = (options = {}) => dialogManager.showConfirm(options);
export const showAlert = (options = {}) => dialogManager.showAlert(options);
export const showPrompt = (options = {}) => dialogManager.showPrompt(options);

window.showConfirm = showConfirm;
window.showAlert = showAlert;
window.showPrompt = showPrompt;
