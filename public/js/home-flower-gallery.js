import {
  collection,
  getDocs,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import { db } from "./firebase-app.js";

class HomeFlowerGallery {
  constructor() {
    this.previewLimit = 4;
    this.dom = {
      mainList: document.getElementById("flowerGalleryMain"),
      fillerList: document.getElementById("flowerGalleryFiller"),
      actions: document.getElementById("flowerGalleryActions"),
      mainMeta: document.getElementById("flowerGalleryMainMeta"),
      fillerMeta: document.getElementById("flowerGalleryFillerMeta"),
      totalCount: document.getElementById("flowerGalleryCount"),
      mainCount: document.getElementById("flowerGalleryMainCount"),
      fillerCount: document.getElementById("flowerGalleryFillerCount"),
      empty: document.getElementById("flowerGalleryEmpty"),
    };
  }

  async init() {
    if (!this.dom.mainList && !this.dom.fillerList) return;

    try {
      const flowersRef = collection(db, "flowers");
      const flowersQuery = query(flowersRef, orderBy("name", "asc"));
      const snapshot = await getDocs(flowersQuery);

      const flowers = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((flower) => flower.active !== false);

      this.render(flowers);
    } catch (error) {
      console.error("Unable to load flower gallery:", error);
      this.render([]);
    }
  }

  render(flowers) {
    const mainFlowers = flowers.filter((flower) => flower.type !== "filler");
    const fillerFlowers = flowers.filter((flower) => flower.type === "filler");

    if (this.dom.totalCount) this.dom.totalCount.textContent = String(flowers.length);
    if (this.dom.mainCount) this.dom.mainCount.textContent = String(mainFlowers.length);
    if (this.dom.fillerCount) this.dom.fillerCount.textContent = String(fillerFlowers.length);

    if (!flowers.length) {
      if (this.dom.mainList) this.dom.mainList.innerHTML = "";
      if (this.dom.fillerList) this.dom.fillerList.innerHTML = "";
      if (this.dom.actions) this.dom.actions.hidden = true;
      if (this.dom.mainMeta) this.dom.mainMeta.textContent = "No flowers yet";
      if (this.dom.fillerMeta) this.dom.fillerMeta.textContent = "No flowers yet";
      if (this.dom.empty) this.dom.empty.hidden = false;
      return;
    }

    if (this.dom.actions) this.dom.actions.hidden = false;
    this.updatePreviewMeta(this.dom.mainMeta, mainFlowers.length);
    this.updatePreviewMeta(this.dom.fillerMeta, fillerFlowers.length);
    this.renderGroup(this.dom.mainList, mainFlowers, "No main flowers available yet.");
    this.renderGroup(this.dom.fillerList, fillerFlowers, "No filler flowers available yet.");

    if (this.dom.empty) {
      this.dom.empty.hidden = true;
    }
  }

  updatePreviewMeta(target, count) {
    if (!target) return;
    if (!count) {
      target.textContent = "No flowers yet";
      return;
    }

    if (count > this.previewLimit) {
      target.textContent = `Showing ${this.previewLimit} of ${count}`;
      return;
    }

    target.textContent = count === 1 ? "1 flower shown" : `All ${count} shown`;
  }

  renderGroup(container, flowers, emptyMessage) {
    if (!container) return;
    container.innerHTML = "";

    if (!flowers.length) {
      const emptyCard = document.createElement("article");
      emptyCard.className = "flower-card flower-card--empty";
      emptyCard.innerHTML = `<p>${emptyMessage}</p>`;
      container.appendChild(emptyCard);
      return;
    }

    flowers.slice(0, this.previewLimit).forEach((flower) => {
      const type = flower.type === "filler" ? "filler" : "main";
      const typeLabel = type === "filler" ? "Filler Flower" : "Main Flower";
      const card = document.createElement("article");
      card.className = "flower-card";
      const media = document.createElement("div");
      media.className = "flower-card__media";
      const imageUrl = this.getSafeAssetUrl(flower.image);

      if (imageUrl) {
        const image = document.createElement("img");
        image.className = "flower-card__image";
        image.src = imageUrl;
        image.alt = flower.name || "Flower";
        image.loading = "lazy";
        media.appendChild(image);
      } else {
        const accent = document.createElement("div");
        accent.className = "flower-card__accent";
        accent.textContent = String(flower.name || "?").trim().charAt(0).toUpperCase() || "?";
        media.appendChild(accent);
      }

      const content = document.createElement("div");
      content.className = "flower-card__content";

      const top = document.createElement("div");
      top.className = "flower-card__top";

      const typeBadge = document.createElement("span");
      typeBadge.className = `flower-card__type ${type}`;
      typeBadge.textContent = typeLabel;

      const title = document.createElement("h3");
      title.className = "flower-card__name";
      title.textContent = flower.name || "Unnamed Flower";

      top.appendChild(typeBadge);
      content.append(top, title);
      card.append(media, content);
      container.appendChild(card);
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

const homeFlowerGallery = new HomeFlowerGallery();
homeFlowerGallery.init();
