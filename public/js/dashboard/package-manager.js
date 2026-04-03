import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import { AppUtils } from "./utils.js";
import { showAlert, showConfirm } from "../dialogs.js";
export class PackageManager {
  constructor({ db, flowerManager }) {
    this.db = db;
    this.flowerManager = flowerManager;
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
    this.priceInput = null;
    this.paxInput = null;
    this.mainFlowersInput = null;
    this.fillersInput = null;
    this.activeInput = null;
    this.activeRow = null;
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

  ensureAdminAccess(message = "Only admins can create or edit event packages.") {
    if (this.isAdminRole()) return true;
    void showAlert(message);
    return false;
  }

  initUI() {
    this.form = document.getElementById("packageForm");
    this.submitBtn = document.getElementById("packageSubmitBtn");
    this.cancelBtn = document.getElementById("packageCancelBtn");
    this.openFormBtn = document.getElementById("openPackageFormBtn");
    this.closeFormBtn = document.getElementById("closePackageFormModal");
    this.nameInput = document.getElementById("packageNameInput");
    this.priceInput = document.getElementById("packagePriceInput");
    this.paxInput = document.getElementById("packagePaxInput");
    this.mainFlowersInput = document.getElementById("packageMainFlowersInput");
    this.fillersInput = document.getElementById("packageFillersInput");
    this.activeInput = document.getElementById("packageActiveInput");
    this.activeRow = document.getElementById("packageActiveRow");

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
    if (!this.ensureAdminAccess("Only admins can create or edit event packages.")) return;
    if (this.formModal) this.formModal.open();
  }

  closeForm() {
    if (this.formModal) this.formModal.close();
  }

  resetForm() {
    this.editingId = null;
    if (this.form) this.form.reset();
    if (this.activeInput) this.activeInput.checked = true;
    if (this.submitBtn) this.submitBtn.textContent = "Create Package";
    if (this.cancelBtn) this.cancelBtn.hidden = true;
    if (this.activeRow) this.activeRow.hidden = true;
    this.flowerManager.renderOptions([]);
  }

  async handleSubmit(event) {
    event.preventDefault();

    if (!this.ensureAdminAccess("Only admins can create or edit event packages.")) return;

    const name = this.nameInput?.value?.trim();
    const priceValue = this.priceInput?.value;
    const paxValue = this.paxInput?.value;
    const price = Number(priceValue);
    const pax = Number(paxValue);
    const mainFlowersValue = this.mainFlowersInput?.value;
    const fillersValue = this.fillersInput?.value;
    const mainFlowers = Number(mainFlowersValue);
    const fillers = Number(fillersValue);

    if (!name || !priceValue || !paxValue || price <= 0 || pax <= 0) {
      await showAlert("Please fill in the package name, price, and pax.");
      return;
    }

    const payload = {
      name,
      price,
      pax,
      mainFlowers: Number.isFinite(mainFlowers) ? mainFlowers : 0,
      fillers: Number.isFinite(fillers) ? fillers : 0,
      allowedFlowerIds: this.flowerManager.getSelectedIds(),
      active: this.activeInput?.checked ?? true,
      updatedAt: serverTimestamp(),
    };

    try {
      if (this.editingId) {
        await updateDoc(doc(this.db, "packages", this.editingId), payload);
      } else {
        await addDoc(collection(this.db, "packages"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      this.resetForm();
      this.closeForm();
    } catch (error) {
      console.error("Failed to save package:", error);
      await showAlert("Unable to save package. Please try again.");
    }
  }

  startEdit(packageId) {
    if (!this.ensureAdminAccess("Only admins can edit event packages.")) return;

    const pkg = this.cache.get(packageId);
    if (!pkg) return;

    this.editingId = packageId;
    if (this.nameInput) this.nameInput.value = pkg.name || "";
    if (this.priceInput) this.priceInput.value = pkg.price ?? "";
    if (this.paxInput) this.paxInput.value = pkg.pax ?? "";
    if (this.mainFlowersInput) this.mainFlowersInput.value = pkg.mainFlowers ?? "";
    if (this.fillersInput) this.fillersInput.value = pkg.fillers ?? "";
    if (this.activeInput) this.activeInput.checked = pkg.active !== false;
    this.flowerManager.renderOptions(pkg.allowedFlowerIds || []);

    if (this.submitBtn) this.submitBtn.textContent = "Update Package";
    if (this.cancelBtn) this.cancelBtn.hidden = false;
    if (this.activeRow) this.activeRow.hidden = false;
    this.openForm();
  }

  async delete(packageId) {
    if (!this.ensureAdminAccess("Only admins can delete event packages.")) return;

    const confirmed = await showConfirm({
      title: "Delete Package",
      message: "Delete this package? This cannot be undone.",
      confirmText: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteDoc(doc(this.db, "packages", packageId));
      if (this.editingId === packageId) this.resetForm();
    } catch (error) {
      console.error("Failed to delete package:", error);
      await showAlert("Unable to delete package. Please try again.");
    }
  }

  renderList(packages) {
    const list = document.getElementById("packageList");
    const countLabel = document.getElementById("packageCountLabel");

    if (countLabel) countLabel.textContent = `${packages.length} packages`;
    if (!list) return;

    list.innerHTML = "";

    if (!packages.length) {
      const empty = document.createElement("div");
      empty.className = "package-item";
      empty.innerHTML =
        "<div class=\"package-info\"><h4>No packages yet</h4><p class=\"package-meta\">Create your first package to show on the customer side.</p></div>";
      list.appendChild(empty);
      return;
    }

    packages.forEach((pkg) => {
      const item = document.createElement("div");
      item.className = "package-item";

      const info = document.createElement("div");
      info.className = "package-info";

      const status = document.createElement("span");
      status.className = `package-status ${pkg.active === false ? "inactive" : "active"}`;
      status.textContent = pkg.active === false ? "Inactive" : "Active";

      const title = document.createElement("h4");
      title.textContent = pkg.name || "Untitled package";

      const meta = document.createElement("p");
      meta.className = "package-meta";
      const priceLabel = AppUtils.formatCurrency(pkg.price);
      const paxLabel = pkg.pax ? ` - ${pkg.pax} pax` : "";
      meta.textContent = `${priceLabel}${paxLabel}`;

      const inclusions = document.createElement("p");
      inclusions.className = "package-meta";
      const mainFlowers = Number(pkg.mainFlowers || 0);
      const fillers = Number(pkg.fillers || 0);
      const inclusionsText =
        mainFlowers || fillers
          ? `Inclusions: ${mainFlowers} main flowers + ${fillers} fillers`
          : "";
      inclusions.textContent = inclusionsText;

      info.append(status, title, meta, inclusions);

      if (this.isAdminRole()) {
        const actions = document.createElement("div");
        actions.className = "package-actions";

        const editBtn = document.createElement("button");
        editBtn.className = "btn view";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", () => window.startPackageEdit(pkg.id));

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn decline";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => window.deletePackage(pkg.id));

        actions.append(editBtn, deleteBtn);
        item.append(info, actions);
      } else {
        item.append(info);
      }

      list.appendChild(item);
    });
  }

  startListener() {
    if (this.unsub) return;

    const packagesRef = collection(this.db, "packages");
    const packagesQuery = query(packagesRef, orderBy("price", "asc"));

    this.unsub = onSnapshot(packagesQuery, (snapshot) => {
      this.cache.clear();
      const packages = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        const record = { id: docSnap.id, ...data };
        this.cache.set(docSnap.id, record);
        return record;
      });
      this.renderList(packages);
    });
  }
}

// App-level coordinator for UI wiring, auth gating, and listeners.
