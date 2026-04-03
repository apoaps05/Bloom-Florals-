import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-storage.js";
import { AppUtils } from "./utils.js";
import { showAlert, showConfirm } from "../dialogs.js";
export class FlowerManager {
  constructor({ db, storage }) {
    this.db = db;
    this.storage = storage;
    this.currentRole = "admin";
    this.cache = new Map();
    this.unsub = null;
    this.editingId = null;

    this.form = null;
    this.submitBtn = null;
    this.cancelBtn = null;
    this.openFormBtn = null;
    this.closeFormBtn = null;
    this.formModal = null;
    this.nameInput = null;
    this.typeInput = null;
    this.imageInput = null;
    this.imagePreview = null;
    this.activeInput = null;
    this.activeRow = null;
    this.mainListEl = null;
    this.fillerListEl = null;
    this.countLabel = null;
    this.mainCountLabel = null;
    this.fillerCountLabel = null;
    this.optionsEl = null;
    this.optionsMainEl = null;
    this.optionsFillerEl = null;
  }

  setRole(role = "admin") {
    this.currentRole = role === "employee" ? "employee" : "admin";
    this.updateRoleUi();

    if (this.currentRole !== "admin") {
      this.resetForm();
      this.closeForm();
      this.renderList(Array.from(this.cache.values()));
    }
  }

  isAdminRole() {
    return this.currentRole === "admin";
  }

  updateRoleUi() {
    if (this.openFormBtn) {
      this.openFormBtn.hidden = !this.isAdminRole();
    }
  }

  ensureAdminAccess(message = "Only admins can create or edit flowers.") {
    if (this.isAdminRole()) return true;
    void showAlert(message);
    return false;
  }

  initUI() {
    this.form = document.getElementById("flowerForm");
    this.submitBtn = document.getElementById("flowerSubmitBtn");
    this.cancelBtn = document.getElementById("flowerCancelBtn");
    this.openFormBtn = document.getElementById("openFlowerFormBtn");
    this.closeFormBtn = document.getElementById("closeFlowerFormModal");
    this.nameInput = document.getElementById("flowerNameInput");
    this.typeInput = document.getElementById("flowerTypeInput");
    this.imageInput = document.getElementById("flowerImageInput");
    this.imagePreview = document.getElementById("flowerImagePreview");
    this.activeInput = document.getElementById("flowerActiveInput");
    this.activeRow = document.getElementById("flowerActiveRow");
    this.mainListEl = document.getElementById("flowerMainList");
    this.fillerListEl = document.getElementById("flowerFillerList");
    this.countLabel = document.getElementById("flowerCountLabel");
    this.mainCountLabel = document.getElementById("flowerMainCount");
    this.fillerCountLabel = document.getElementById("flowerFillerCount");
    this.optionsMainEl = document.getElementById("packageFlowerOptionsMain");
    this.optionsFillerEl = document.getElementById("packageFlowerOptionsFiller");
    this.optionsEl = document.getElementById("packageFlowerOptions");

    if (this.imageInput && this.imagePreview) {
      this.imageInput.addEventListener("change", () => {
        const file = this.imageInput.files?.[0];
        if (file) {
          this.imagePreview.src = URL.createObjectURL(file);
          this.imagePreview.hidden = false;
        } else {
          this.clearPreview();
        }
      });
    }

    if (this.cancelBtn) {
      this.cancelBtn.addEventListener("click", () => {
        this.resetForm();
        this.closeForm();
      });
    }

    if (this.openFormBtn) {
      this.openFormBtn.addEventListener("click", () => {
        this.resetForm();
        this.openForm();
      });
    }

    if (this.closeFormBtn) {
      this.closeFormBtn.addEventListener("click", () => {
        this.resetForm();
        this.closeForm();
      });
    }

    if (this.form) {
      this.form.addEventListener("submit", (event) => this.handleSubmit(event));
    }

    this.updateRoleUi();
  }

  setFormModal(modal) {
    this.formModal = modal;
  }

  openForm() {
    if (!this.ensureAdminAccess("Only admins can create or edit flowers.")) return;
    if (this.formModal) this.formModal.open();
  }

  closeForm() {
    if (this.formModal) this.formModal.close();
  }

  resetForm() {
    this.editingId = null;
    if (this.form) this.form.reset();
    if (this.activeInput) this.activeInput.checked = true;
    if (this.submitBtn) this.submitBtn.textContent = "Add Flower";
    if (this.cancelBtn) this.cancelBtn.hidden = true;
    if (this.activeRow) this.activeRow.hidden = true;
    this.clearPreview();
  }

  clearPreview() {
    if (this.imageInput) this.imageInput.value = "";
    if (this.imagePreview) {
      this.imagePreview.hidden = true;
      this.imagePreview.removeAttribute("src");
    }
  }

  getSelectedIds() {
    const containers = [this.optionsMainEl, this.optionsFillerEl, this.optionsEl].filter(Boolean);
    if (!containers.length) return [];
    const checked = containers.flatMap((container) =>
      Array.from(container.querySelectorAll("input[type=\"checkbox\"]:checked"))
    );
    return checked.map((input) => input.value);
  }

  renderOptions(selectedIds = []) {
    const hasSplit = Boolean(this.optionsMainEl || this.optionsFillerEl);
    const mainTarget = this.optionsMainEl || this.optionsEl;
    const fillerTarget = this.optionsFillerEl || this.optionsEl;
    if (!mainTarget && !fillerTarget) return;

    if (this.optionsMainEl) this.optionsMainEl.innerHTML = "";
    if (this.optionsFillerEl) this.optionsFillerEl.innerHTML = "";
    if (this.optionsEl && !hasSplit) this.optionsEl.innerHTML = "";

    const flowers = Array.from(this.cache.values()).sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );

    if (!flowers.length) {
      const empty = document.createElement("div");
      empty.className = "package-meta";
      empty.textContent = "No flowers available yet. Add flowers in the catalog.";
      if (mainTarget) mainTarget.appendChild(empty.cloneNode(true));
      if (fillerTarget && fillerTarget !== mainTarget) fillerTarget.appendChild(empty);
      return;
    }

    const renderList = (target, list, emptyText) => {
      if (!target) return;
      target.innerHTML = "";
      if (!list.length) {
        const empty = document.createElement("div");
        empty.className = "package-meta";
        empty.textContent = emptyText;
        target.appendChild(empty);
        return;
      }
      list.forEach((flower) => {
        const option = document.createElement("label");
        option.className = "flower-option";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = flower.id;
        checkbox.checked = selectedIds.includes(flower.id);

        const body = document.createElement("span");
        body.className = "flower-option__body";

        const media = document.createElement("span");
        media.className = "flower-option__media";
        const imageUrl = AppUtils.getSafeAssetUrl(flower.image);
        if (imageUrl) {
          const image = document.createElement("img");
          image.className = "flower-option__image";
          image.src = imageUrl;
          image.alt = `${flower.name || "Flower"} preview`;
          media.appendChild(image);
        } else {
          media.classList.add("flower-option__media--fallback");
          media.textContent = String(flower.name || "?").trim().charAt(0).toUpperCase() || "?";
        }

        const content = document.createElement("span");
        content.className = "flower-option__content";

        const name = document.createElement("span");
        name.className = "flower-option__name";
        const typeLabel = flower.type === "filler" ? "Filler" : "Main";
        name.textContent = `${flower.name || "Unnamed flower"} (${typeLabel})`;

        const meta = document.createElement("span");
        meta.className = "flower-option__meta";
        meta.textContent = flower.active === false ? "Out of stock" : `${typeLabel} flower`;

        content.append(name, meta);
        body.append(media, content);

        option.append(checkbox, body);
        target.appendChild(option);
      });
    };

    if (!hasSplit && this.optionsEl) {
      renderList(this.optionsEl, flowers, "No flowers available yet. Add flowers in the catalog.");
      return;
    }

    const mainFlowers = flowers.filter((flower) => flower.type !== "filler");
    const fillerFlowers = flowers.filter((flower) => flower.type === "filler");
    renderList(mainTarget, mainFlowers, "No main flowers yet.");
    renderList(fillerTarget, fillerFlowers, "No filler flowers yet.");
  }

  renderList(flowers) {
    if (this.countLabel) this.countLabel.textContent = `${flowers.length} flowers`;

    const mainFlowers = flowers.filter((flower) => flower.type !== "filler");
    const fillerFlowers = flowers.filter((flower) => flower.type === "filler");

    if (this.mainCountLabel) this.mainCountLabel.textContent = `${mainFlowers.length}`;
    if (this.fillerCountLabel) this.fillerCountLabel.textContent = `${fillerFlowers.length}`;

    const renderColumn = (listEl, list, emptyTitle) => {
      if (!listEl) return;
      listEl.innerHTML = "";

      if (!list.length) {
        const empty = document.createElement("div");
        empty.className = "package-item";
        empty.innerHTML = `<div class="package-info"><h4>${emptyTitle}</h4><p class="package-meta">Add flowers so admins can assign them to packages.</p></div>`;
        listEl.appendChild(empty);
        return;
      }

      list.forEach((flower) => {
        const item = document.createElement("div");
        item.className = "package-item flower-item";

        const main = document.createElement("div");
        main.className = "flower-item__main";

        const info = document.createElement("div");
        info.className = "package-info";

        const imageUrl = AppUtils.getSafeAssetUrl(flower.image);
        if (imageUrl) {
          const preview = document.createElement("img");
          preview.className = "flower-list-image";
          preview.src = imageUrl;
          preview.alt = `${flower.name || "Flower"} preview`;
          main.appendChild(preview);
        }

        const status = document.createElement("span");
        status.className = `package-status ${flower.active === false ? "inactive" : "active"}`;
        status.textContent = flower.active === false ? "Out of stock" : "In stock";

        const title = document.createElement("h4");
        title.textContent = flower.name || "Unnamed flower";

        info.append(status, title);
        main.appendChild(info);

        if (this.isAdminRole()) {
          const actions = document.createElement("div");
          actions.className = "package-actions";

          const editBtn = document.createElement("button");
          editBtn.className = "btn view";
          editBtn.textContent = "Edit";
          editBtn.addEventListener("click", () => window.startFlowerEdit(flower.id));

          const deleteBtn = document.createElement("button");
          deleteBtn.className = "btn decline";
          deleteBtn.textContent = "Delete";
          deleteBtn.addEventListener("click", () => window.deleteFlower(flower.id));

          actions.append(editBtn, deleteBtn);
          item.append(main, actions);
        } else {
          item.append(main);
        }

        listEl.appendChild(item);
      });
    };

    renderColumn(this.mainListEl, mainFlowers, "No main flowers yet");
    renderColumn(this.fillerListEl, fillerFlowers, "No filler flowers yet");
  }

  async handleSubmit(event) {
    event.preventDefault();

    if (!this.ensureAdminAccess("Only admins can create or edit flowers.")) return;

    const name = this.nameInput?.value?.trim();
    const type = this.typeInput?.value || "main";

    if (!name) {
      await showAlert("Please enter a flower name.");
      return;
    }

    const payload = {
      name,
      type,
      image: "",
      active: this.activeInput?.checked ?? true,
      updatedAt: serverTimestamp(),
    };

    try {
      const imageFile = this.imageInput?.files?.[0];
      const existingImage = this.editingId ? this.cache.get(this.editingId)?.image : "";

      if (this.editingId) {
        let imageUrl = existingImage || "";
        if (imageFile) {
          const path = `flowers/${this.editingId}/${imageFile.name}`;
          const fileRef = storageRef(this.storage, path);
          await uploadBytes(fileRef, imageFile);
          imageUrl = await getDownloadURL(fileRef);
        }
        await updateDoc(doc(this.db, "flowers", this.editingId), {
          ...payload,
          image: imageUrl,
        });
      } else {
        const docRef = await addDoc(collection(this.db, "flowers"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        if (imageFile) {
          const path = `flowers/${docRef.id}/${imageFile.name}`;
          const fileRef = storageRef(this.storage, path);
          await uploadBytes(fileRef, imageFile);
          const imageUrl = await getDownloadURL(fileRef);
          await updateDoc(doc(this.db, "flowers", docRef.id), { image: imageUrl });
        }
      }
      this.resetForm();
      this.closeForm();
    } catch (error) {
      console.error("Failed to add flower:", error);
      await showAlert("Unable to add flower. Please try again.");
    }
  }

  startEdit(flowerId) {
    if (!this.ensureAdminAccess("Only admins can edit flowers.")) return;

    const flower = this.cache.get(flowerId);
    if (!flower) return;

    this.editingId = flowerId;
    if (this.nameInput) this.nameInput.value = flower.name || "";
    if (this.typeInput) this.typeInput.value = flower.type || "main";
    if (this.activeInput) this.activeInput.checked = flower.active !== false;
    if (this.imageInput) this.imageInput.value = "";
    if (this.imagePreview) {
      const imageUrl = AppUtils.getSafeAssetUrl(flower.image);
      if (imageUrl) {
        this.imagePreview.src = imageUrl;
        this.imagePreview.hidden = false;
      } else {
        this.clearPreview();
      }
    }

    if (this.submitBtn) this.submitBtn.textContent = "Update Flower";
    if (this.cancelBtn) this.cancelBtn.hidden = false;
    if (this.activeRow) this.activeRow.hidden = false;
    this.openForm();
  }

  async delete(flowerId) {
    if (!this.ensureAdminAccess("Only admins can delete flowers.")) return;

    const confirmed = await showConfirm({
      title: "Delete Flower",
      message: "Delete this flower? This cannot be undone.",
      confirmText: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteDoc(doc(this.db, "flowers", flowerId));
      if (this.editingId === flowerId) this.resetForm();
    } catch (error) {
      console.error("Failed to delete flower:", error);
      await showAlert("Unable to delete flower. Please try again.");
    }
  }

  startListener() {
    if (this.unsub) return;

    const flowersRef = collection(this.db, "flowers");
    const flowersQuery = query(flowersRef, orderBy("name", "asc"));

    this.unsub = onSnapshot(flowersQuery, (snapshot) => {
      this.cache.clear();
      const flowers = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        const record = { id: docSnap.id, ...data };
        this.cache.set(docSnap.id, record);
        return record;
      });
      this.renderList(flowers);
      this.renderOptions(this.getSelectedIds());
    });
  }
}

// Package catalog + form workflow; depends on FlowerManager for options.
