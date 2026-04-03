export class Modal {
  constructor(element, { lockScroll = false, hideOnClose = false, hideClass = "hidden" } = {}) {
    this.element = element;
    this.lockScroll = lockScroll;
    this.hideOnClose = hideOnClose;
    this.hideClass = hideClass;
  }

  open() {
    if (!this.element) return;
    this.element.classList.add("show");
    if (this.hideOnClose) this.element.classList.remove(this.hideClass);
    if (this.lockScroll) document.body.style.overflow = "hidden";
  }

  close() {
    if (!this.element) return;
    this.element.classList.remove("show");
    if (this.hideOnClose) this.element.classList.add(this.hideClass);
    if (this.lockScroll) document.body.style.overflow = "";
  }

  bindBackdropClose() {
    if (!this.element) return;
    this.element.addEventListener("click", (event) => {
      if (event.target === this.element) this.close();
    });
  }
}

// Tracks multiple modals so ESC/backdrop can close consistently.
export class ModalManager {
  constructor() {
    this.modals = [];
  }

  register(modal) {
    if (!modal) return;
    this.modals.push(modal);
    modal.bindBackdropClose();
  }

  closeAll() {
    this.modals.forEach((modal) => modal.close());
  }
}

// Bookings domain: list rendering, details modal, and status updates.
