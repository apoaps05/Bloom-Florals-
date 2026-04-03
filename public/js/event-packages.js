import {
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import { db } from "./firebase-app.js";

class EventPackageRepository {
  constructor({ dbInstance }) {
    this.db = dbInstance;
  }

  async getActivePackages() {
    const snapshot = await getDocs(collection(this.db, "packages"));
    const packages = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));

    return packages
      .filter((pkg) => pkg.active !== false)
      .sort((a, b) => {
        const priceA = Number(a.price ?? 0);
        const priceB = Number(b.price ?? 0);
        if (priceA !== priceB) return priceA - priceB;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
  }
}

class EventPackageView {
  constructor({
    packageGridEl = document.getElementById("packageGrid"),
    emptyStateEl = document.getElementById("packageEmpty"),
  } = {}) {
    this.packageGridEl = packageGridEl;
    this.emptyStateEl = emptyStateEl;
  }

  static formatCurrency(value) {
    return `PHP ${Number(value || 0).toLocaleString("en-US")}`;
  }

  reveal() {
    const container = document.querySelector(".fade-up");
    if (container) container.classList.add("show");
  }

  showEmpty(message = "No packages available yet.") {
    if (this.packageGridEl) this.packageGridEl.innerHTML = "";
    if (!this.emptyStateEl) return;
    this.emptyStateEl.hidden = false;
    this.emptyStateEl.textContent = message;
  }

  renderPackages(packages) {
    if (!this.packageGridEl) return;
    this.packageGridEl.innerHTML = "";

    if (!packages.length) {
      this.showEmpty();
      return;
    }

    if (this.emptyStateEl) this.emptyStateEl.hidden = true;

    packages.forEach((pkg) => {
      const card = document.createElement("article");
      card.className = "package-card";

      const header = document.createElement("div");
      header.className = "package-header";

      const title = document.createElement("h2");
      title.textContent = pkg.name || "Untitled Package";

      const tier = document.createElement("span");
      tier.className = "package-tier";
      tier.textContent = pkg.pax ? `${pkg.pax} pax` : "Custom";
      header.append(title, tier);

      const price = document.createElement("p");
      price.className = "package-price";
      price.textContent = EventPackageView.formatCurrency(pkg.price);

      const detail = document.createElement("p");
      detail.className = "package-detail";
      const mainFlowers = Number(pkg.mainFlowers || 0);
      const fillers = Number(pkg.fillers || 0);
      detail.textContent =
        mainFlowers || fillers
          ? `${mainFlowers} main flowers + ${fillers} fillers`
          : "Inclusions available on request";

      const link = document.createElement("a");
      link.className = "package-btn";
      link.href = `event-booking.html?package=${pkg.id}`;
      link.textContent = "Select Package";

      card.append(header, price, detail, link);
      this.packageGridEl.appendChild(card);
    });
  }
}

class EventPackagesController {
  constructor({ repository, view }) {
    this.repository = repository;
    this.view = view;
  }

  async init() {
    this.view.reveal();

    try {
      const packages = await this.repository.getActivePackages();
      this.view.renderPackages(packages);
    } catch (error) {
      console.error("Failed to load packages:", error);
      this.view.showEmpty("Unable to load packages right now.");
    }
  }
}

const eventPackagesController = new EventPackagesController({
  repository: new EventPackageRepository({ dbInstance: db }),
  view: new EventPackageView(),
});

eventPackagesController.init();
