class HomePageController {
  constructor({ doc = document, win = window } = {}) {
    this.doc = doc;
    this.win = win;

    this.menu = this.doc.querySelector("#mobile-menu");
    this.menuLinks = this.doc.querySelector(".navbar__menu");
    this.profileToggle = this.doc.getElementById("profile-toggle");
    this.profileDropdown = this.doc.getElementById("profile-dropdown");
  }

  init() {
    this.initMobileMenu();
    this.bindLoadedState();
    this.initFadeUpObserver();
    this.initSmoothScroll();
    this.initProfileToggle();
  }

  initMobileMenu() {
    if (!this.menu || !this.menuLinks) return;
    if (!this.menuLinks.id) this.menuLinks.id = "primary-navigation";

    this.menu.setAttribute("aria-controls", this.menuLinks.id);
    this.menu.setAttribute("aria-expanded", "false");
    this.menu.addEventListener("click", () => this.toggleMobileMenu());
  }

  toggleMobileMenu() {
    if (!this.menu || !this.menuLinks) return;
    const isActive = this.menu.classList.toggle("is-active");
    this.menuLinks.classList.toggle("active");
    this.menu.setAttribute("aria-expanded", String(isActive));
  }

  bindLoadedState() {
    this.win.addEventListener("load", () => {
      this.doc.body.classList.add("loaded");
    });
  }

  initFadeUpObserver() {
    const observer = new IntersectionObserver(
      (entries, currentObserver) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("show");
          currentObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.2 }
    );

    this.doc.querySelectorAll(".fade-up").forEach((element) => {
      observer.observe(element);
    });
  }

  initSmoothScroll() {
    this.doc.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener("click", (event) => {
        const href = anchor.getAttribute("href");
        if (!href || href === "#") return;

        const target = this.doc.querySelector(href);
        if (!target) return;

        event.preventDefault();
        target.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
  }

  initProfileToggle() {
    if (!this.profileToggle) return;

    this.profileToggle.setAttribute("aria-expanded", "false");
    if (this.profileDropdown) {
      this.profileToggle.setAttribute("aria-controls", this.profileDropdown.id);
    }

    this.profileToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const isActive = this.profileToggle.classList.toggle("active");
      this.profileToggle.setAttribute("aria-expanded", String(isActive));
    });

    this.doc.addEventListener("click", () => {
      this.profileToggle.classList.remove("active");
      this.profileToggle.setAttribute("aria-expanded", "false");
    });
  }
}

const homePageController = new HomePageController();
homePageController.init();
