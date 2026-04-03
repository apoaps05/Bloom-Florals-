import {
  collection,
  getDocs,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import { db } from "./firebase-app.js";

class FlowerGuidePage {
  constructor() {
    this.flowers = [];
    this.activeFilter = "all";
    this.searchTerm = "";
    this.dom = {
      totalCount: document.getElementById("flowerGuideCount"),
      mainCount: document.getElementById("flowerGuideMainCount"),
      fillerCount: document.getElementById("flowerGuideFillerCount"),
      visibleCount: document.getElementById("flowerGuideVisibleCount"),
      search: document.getElementById("flowerGuideSearch"),
      filters: Array.from(document.querySelectorAll(".guide-filter")),
      results: document.getElementById("flowerGuideResultsText"),
      grid: document.getElementById("flowerGuideGrid"),
      empty: document.getElementById("flowerGuideEmpty"),
    };
  }

  init() {
    this.bindEvents();
    void this.loadFlowers();
  }

  bindEvents() {
    this.dom.search?.addEventListener("input", (event) => {
      this.searchTerm = String(event.target.value || "").trim().toLowerCase();
      this.render();
    });

    this.dom.filters.forEach((button) => {
      button.addEventListener("click", () => {
        const filter = button.dataset.filter || "all";
        if (filter === this.activeFilter) return;
        this.activeFilter = filter;
        this.updateFilterUi();
        this.render();
      });
    });
  }

  async loadFlowers() {
    try {
      const flowersRef = collection(db, "flowers");
      const flowersQuery = query(flowersRef, orderBy("name", "asc"));
      const snapshot = await getDocs(flowersQuery);

      this.flowers = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((flower) => flower.active !== false);

      this.render();
    } catch (error) {
      console.error("Unable to load flower guide:", error);
      this.flowers = [];
      this.render();
    }
  }

  updateFilterUi() {
    this.dom.filters.forEach((button) => {
      const isActive = (button.dataset.filter || "all") === this.activeFilter;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  getFilteredFlowers() {
    return this.flowers.filter((flower) => {
      const type = flower.type === "filler" ? "filler" : "main";
      const matchesFilter = this.activeFilter === "all" || type === this.activeFilter;
      if (!matchesFilter) return false;

      if (!this.searchTerm) return true;

      const searchableText = [
        flower.name,
        type,
      ]
        .map((value) => String(value || "").trim().toLowerCase())
        .join(" ");

      return searchableText.includes(this.searchTerm);
    });
  }

  render() {
    const mainFlowers = this.flowers.filter((flower) => flower.type !== "filler");
    const fillerFlowers = this.flowers.filter((flower) => flower.type === "filler");
    const visibleFlowers = this.getFilteredFlowers();

    if (this.dom.totalCount) this.dom.totalCount.textContent = String(this.flowers.length);
    if (this.dom.mainCount) this.dom.mainCount.textContent = String(mainFlowers.length);
    if (this.dom.fillerCount) this.dom.fillerCount.textContent = String(fillerFlowers.length);
    if (this.dom.visibleCount) this.dom.visibleCount.textContent = String(visibleFlowers.length);

    if (this.dom.results) {
      if (!this.flowers.length) {
        this.dom.results.textContent = "No active flowers are available in the catalog yet.";
      } else if (!visibleFlowers.length) {
        this.dom.results.textContent = "No flowers matched your current search or filter.";
      } else {
        const filterLabel =
          this.activeFilter === "all"
            ? "flowers"
            : this.activeFilter === "main"
            ? "main flowers"
            : "filler flowers";
        const searchDetail = this.searchTerm ? ` for "${this.searchTerm}"` : "";
        this.dom.results.textContent = `Showing ${visibleFlowers.length} ${filterLabel}${searchDetail}.`;
      }
    }

    this.renderGrid(visibleFlowers);
  }

  renderGrid(flowers) {
    if (!this.dom.grid) return;
    this.dom.grid.innerHTML = "";

    if (!flowers.length) {
      if (this.dom.empty) this.dom.empty.hidden = false;
      return;
    }

    if (this.dom.empty) this.dom.empty.hidden = true;

    flowers.forEach((flower) => {
      const type = flower.type === "filler" ? "filler" : "main";
      const typeLabel = type === "filler" ? "Filler Flower" : "Main Flower";

      const card = document.createElement("article");
      card.className = "guide-card";

      const media = document.createElement("div");
      media.className = "guide-card__media";

      const imageUrl = this.getSafeAssetUrl(flower.image);
      if (imageUrl) {
        const image = document.createElement("img");
        image.className = "guide-card__image";
        image.src = imageUrl;
        image.alt = flower.name || "Flower";
        image.loading = "lazy";
        media.appendChild(image);
      } else {
        const accent = document.createElement("div");
        accent.className = "guide-card__accent";
        accent.textContent = String(flower.name || "?").trim().charAt(0).toUpperCase() || "?";
        media.appendChild(accent);
      }

      const body = document.createElement("div");
      body.className = "guide-card__body";

      const meta = document.createElement("div");
      meta.className = "guide-card__meta";

      const typeBadge = document.createElement("span");
      typeBadge.className = `guide-card__type ${type}`;
      typeBadge.textContent = typeLabel;

      meta.appendChild(typeBadge);

      const title = document.createElement("h3");
      title.className = "guide-card__name";
      title.textContent = flower.name || "Unnamed Flower";

      body.append(meta, title);
      card.append(media, body);
      this.dom.grid.appendChild(card);
    });
  }

  getSafeAssetUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    try {
      const parsed = new URL(raw, window.location.origin);
      if (parsed.protocol === "https:") return parsed.href;
      const isLocalhost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";
      if (isLocalhost && parsed.protocol === "http:") return parsed.href;
      return "";
    } catch {
      return "";
    }
  }
}

const flowerGuidePage = new FlowerGuidePage();
flowerGuidePage.init();
