import {
  getDoc,
  getDocs,
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
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-storage.js";
import { AppUtils } from "./utils.js";
import { showAlert, showConfirm, showPrompt } from "../dialogs.js";

const PAYMENT_DEADLINE_HOURS = 72;

const getPaymentDueAt = (hours = PAYMENT_DEADLINE_HOURS) => {
  const parsed = Number(hours);
  const safeHours = Number.isFinite(parsed) && parsed > 0 ? parsed : PAYMENT_DEADLINE_HOURS;
  return new Date(Date.now() + safeHours * 60 * 60 * 1000);
};

export class SeminarManager {
  constructor({ db, storage }) {
    this.db = db;
    this.storage = storage;
    this.currentRole = "admin";
    this.cache = new Map();
    this.unsub = null;
    this.editingId = null;
    this.seminars = [];
    this.filters = { search: "", status: "upcoming", sort: "newest", date: "" };
    this.filterControls = {};

    this.form = null;
    this.submitBtn = null;
    this.cancelBtn = null;
    this.openFormBtn = null;
    this.closeFormBtn = null;
    this.formModal = null;
    this.titleInput = null;
    this.dateInput = null;
    this.timeInput = null;
    this.priceInput = null;
    this.maxSlotsInput = null;
    this.bookingOpenInput = null;
    this.locationInput = null;
    this.imageInput = null;
    this.imagePreview = null;
    this.descInput = null;

    this.activeListEl = null;
    this.activeCountLabel = null;
    this.modalTitle = null;
    this.modalMeta = null;
    this.applicantCount = null;
    this.applicantGrid = null;
    this.applicantEmpty = null;
    this.applicantLoading = null;
    this.attendeeTableBody = null;
    this.attendeeEmpty = null;
    this.viewApplicantsBtn = null;
    this.viewAttendeesBtn = null;
    this.applicantsSection = null;
    this.attendeesSection = null;
    this.bookedSlotsSyncInFlight = false;
    this.pendingBookedSlotsSync = null;
  }

  setRole(role = "admin") {
    this.currentRole = role === "employee" ? "employee" : "admin";
    this.updateRoleUi();

    if (this.currentRole !== "admin") {
      this.resetForm();
      this.closeForm();
      this.renderCatalog(this.seminars);
      this.renderActiveList();
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

  ensureAdminAccess(message = "Only admins can create or edit workshops.") {
    if (this.isAdminRole()) return true;
    void showAlert(message);
    return false;
  }

  async requestDeclineReason(actionLabel = "decline this booking") {
    while (true) {
      const input = await showPrompt({
        title: "Decline Request",
        message: `Please provide a reason to ${actionLabel}. This will be shared with the customer.`,
        confirmText: "Send Decline",
        cancelText: "Cancel",
        tone: "danger",
        inputLabel: "Reason",
        inputPlaceholder: "e.g. Date unavailable, fully booked, outside service area"
      });
      if (input === null) return null;
      const reason = String(input).trim();
      if (reason) return reason;
      await showAlert("A reason is required to decline.");
    }
  }

  initUI() {
    this.form = document.getElementById("seminarForm");
    this.submitBtn = document.getElementById("seminarSubmitBtn");
    this.cancelBtn = document.getElementById("seminarCancelBtn");
    this.openFormBtn = document.getElementById("openSeminarFormBtn");
    this.closeFormBtn = document.getElementById("closeSeminarFormModal");
    this.titleInput = document.getElementById("seminarTitleInput");
    this.dateInput = document.getElementById("seminarDateInput");
    this.timeInput = document.getElementById("seminarTimeInput");
    this.priceInput = document.getElementById("seminarPriceInput");
    this.maxSlotsInput = document.getElementById("seminarMaxSlotsInput");
    this.bookingOpenInput = document.getElementById("seminarBookingOpenInput");
    this.locationInput = document.getElementById("seminarLocationInput");
    this.imageInput = document.getElementById("seminarImageInput");
    this.imagePreview = document.getElementById("seminarImagePreview");
    this.descInput = document.getElementById("seminarDescInput");
    this.activeListEl = document.getElementById("seminarRequestList");
    this.activeCountLabel = document.getElementById("seminarCountLabel");
    this.modalTitle = document.getElementById("seminarModalTitle");
    this.modalMeta = document.getElementById("seminarModalMeta");
    this.applicantCount = document.getElementById("seminarApplicantCount");
    this.applicantGrid = document.getElementById("seminarApplicantGrid");
    this.applicantEmpty = document.getElementById("seminarApplicantEmpty");
    this.applicantLoading = document.getElementById("seminarApplicantLoading");
    this.attendeeTableBody = document.getElementById("seminarAttendeeTableBody");
    this.attendeeEmpty = document.getElementById("seminarAttendeeEmpty");
    this.viewApplicantsBtn = document.getElementById("seminarViewApplicantsBtn");
    this.viewAttendeesBtn = document.getElementById("seminarViewAttendeesBtn");
    this.applicantsSection = document.getElementById("seminarApplicantsSection");
    this.attendeesSection = document.getElementById("seminarAttendeesSection");

    if (this.viewApplicantsBtn) {
      this.viewApplicantsBtn.addEventListener("click", () => this.setSeminarView("applicants"));
    }
    if (this.viewAttendeesBtn) {
      this.viewAttendeesBtn.addEventListener("click", () => this.setSeminarView("attendees"));
    }

    if (this.imageInput && this.imagePreview) {
      this.imageInput.addEventListener("change", () => {
        const file = this.imageInput.files?.[0];
        if (file) {
          this.imagePreview.src = URL.createObjectURL(file);
          this.imagePreview.hidden = false;
        } else {
          this.imagePreview.removeAttribute("src");
          this.imagePreview.hidden = true;
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
    if (!this.ensureAdminAccess("Only admins can create or edit workshops.")) return;
    if (this.formModal) this.formModal.open();
  }

  closeForm() {
    if (this.formModal) this.formModal.close();
  }

  initFilters() {
    this.filterControls = {
      search: document.getElementById("seminarSearch"),
      status: document.getElementById("seminarStatusFilter"),
      sort: document.getElementById("seminarSortFilter"),
      date: document.getElementById("seminarDateFilter"),
    };

    if (this.filterControls.search) {
      this.filterControls.search.addEventListener("input", (event) => {
        this.filters.search = event.target.value;
        this.renderActiveList();
      });
    }
    if (this.filterControls.status) {
      this.filterControls.status.addEventListener("change", (event) => {
        this.filters.status = event.target.value;
        this.renderActiveList();
      });
      this.filters.status = this.filterControls.status.value || "upcoming";
    }
    if (this.filterControls.sort) {
      this.filterControls.sort.addEventListener("change", (event) => {
        this.filters.sort = event.target.value;
        this.renderActiveList();
      });
      this.filters.sort = this.filterControls.sort.value || "newest";
    }
    if (this.filterControls.date) {
      this.filterControls.date.addEventListener("change", (event) => {
        this.filters.date = event.target.value;
        this.renderActiveList();
      });
      this.filters.date = this.filterControls.date.value || "";
    }
  }

  resetForm() {
    this.editingId = null;
    if (this.form) this.form.reset();
    if (this.submitBtn) this.submitBtn.textContent = "Create Workshop";
    if (this.cancelBtn) this.cancelBtn.hidden = true;
    if (this.imagePreview) {
      this.imagePreview.removeAttribute("src");
      this.imagePreview.hidden = true;
    }
    if (this.bookingOpenInput) this.bookingOpenInput.checked = true;
  }

  async handleSubmit(event) {
    event.preventDefault();

    if (!this.ensureAdminAccess("Only admins can create or edit workshops.")) return;

    const title = this.titleInput?.value?.trim();
    const date = this.dateInput?.value;
    const priceValue = this.priceInput?.value;
    const price = Number(priceValue);
    const maxSlotsValue = this.maxSlotsInput?.value;
    const maxSlots = maxSlotsValue === "" || maxSlotsValue === undefined ? null : Number(maxSlotsValue);

    if (!title || !date || !priceValue || !Number.isFinite(price) || price <= 0) {
      await showAlert("Please fill in the workshop title, date, and price.");
      return;
    }

    if (maxSlotsValue && (!Number.isFinite(maxSlots) || maxSlots <= 0)) {
      await showAlert("Max attendees must be a positive number.");
      return;
    }

    const payload = {
      title,
      date,
      time: this.timeInput?.value?.trim() || "",
      price,
      maxSlots,
      bookingOpen: Boolean(this.bookingOpenInput?.checked),
      location: this.locationInput?.value?.trim() || "",
      description: this.descInput?.value?.trim() || "",
      image: "",
      updatedAt: serverTimestamp(),
    };

    try {
      const imageFile = this.imageInput?.files?.[0];
      const existingImage = this.editingId ? this.cache.get(this.editingId)?.image : "";

      if (this.editingId) {
        let imageUrl = existingImage || "";
        if (imageFile) {
          const path = `seminars/${this.editingId}/${imageFile.name}`;
          const fileRef = storageRef(this.storage, path);
          await uploadBytes(fileRef, imageFile);
          imageUrl = await getDownloadURL(fileRef);
        }
        await updateDoc(doc(this.db, "seminars", this.editingId), {
          ...payload,
          image: imageUrl,
        });
      } else {
        const docRef = await addDoc(collection(this.db, "seminars"), {
          ...payload,
          bookedSlots: 0,
          createdAt: serverTimestamp(),
        });
        if (imageFile) {
          const path = `seminars/${docRef.id}/${imageFile.name}`;
          const fileRef = storageRef(this.storage, path);
          await uploadBytes(fileRef, imageFile);
          const imageUrl = await getDownloadURL(fileRef);
          await updateDoc(doc(this.db, "seminars", docRef.id), { image: imageUrl });
        }
      }
      this.resetForm();
      this.closeForm();
    } catch (error) {
      console.error("Failed to save seminar:", error);
      await showAlert("Unable to save workshop. Please try again.");
    }
  }

  async syncBookedSlots(bookings) {
    if (!Array.isArray(bookings)) return;
    if (!this.seminars.length) {
      this.pendingBookedSlotsSync = bookings;
      return;
    }
    if (this.bookedSlotsSyncInFlight) {
      this.pendingBookedSlotsSync = bookings;
      return;
    }

    this.bookedSlotsSyncInFlight = true;
    this.pendingBookedSlotsSync = null;
    try {
      const totals = new Map();
      bookings.forEach((booking) => {
        if (booking.bookingType !== "seminar") return;
        const statusKey = AppUtils.normalizeStatusKey(booking.status);
        const isConfirmed = AppUtils.isCompletedStatus(statusKey);
        if (!isConfirmed) return;
        const slots = Number(booking.slotCount);
        const slotCount = Number.isFinite(slots) && slots > 0 ? Math.floor(slots) : 1;
        const prev = totals.get(booking.seminarId) || 0;
        totals.set(booking.seminarId, prev + slotCount);
      });

      const updates = [];
      this.seminars.forEach((seminar) => {
        if (!seminar?.id) return;
        const next = totals.get(seminar.id) || 0;
        const current = Number(seminar.bookedSlots || 0);
        if (Number.isFinite(current) && current === next) return;
        updates.push(updateDoc(doc(this.db, "seminars", seminar.id), { bookedSlots: next }));
      });

      if (updates.length) {
        await Promise.all(updates);
      }
    } catch (error) {
      console.error("Failed to sync seminar booked slots:", error);
    } finally {
      this.bookedSlotsSyncInFlight = false;
      const queuedBookings = this.pendingBookedSlotsSync;
      this.pendingBookedSlotsSync = null;
      if (Array.isArray(queuedBookings)) {
        this.syncBookedSlots(queuedBookings);
      }
    }
  }

  startEdit(seminarId) {
    if (!this.ensureAdminAccess("Only admins can edit workshops.")) return;

    const seminar = this.cache.get(seminarId);
    if (!seminar) return;

    this.editingId = seminarId;
    if (this.titleInput) this.titleInput.value = seminar.title || "";
    if (this.dateInput) this.dateInput.value = seminar.date || "";
    if (this.timeInput) this.timeInput.value = seminar.time || "";
    if (this.priceInput) this.priceInput.value = seminar.price ?? "";
    if (this.maxSlotsInput) this.maxSlotsInput.value = seminar.maxSlots ?? "";
    if (this.bookingOpenInput) this.bookingOpenInput.checked = seminar.bookingOpen !== false;
    if (this.locationInput) this.locationInput.value = seminar.location || "";
    if (this.imageInput) this.imageInput.value = "";
    if (this.imagePreview) {
      const imageUrl = AppUtils.getSafeAssetUrl(seminar.image);
      if (imageUrl) {
        this.imagePreview.src = imageUrl;
        this.imagePreview.hidden = false;
      } else {
        this.imagePreview.removeAttribute("src");
        this.imagePreview.hidden = true;
      }
    }
    if (this.descInput) this.descInput.value = seminar.description || "";

    if (this.submitBtn) this.submitBtn.textContent = "Update Workshop";
    if (this.cancelBtn) this.cancelBtn.hidden = false;
    this.openForm();
  }

  async delete(seminarId) {
    if (!this.ensureAdminAccess("Only admins can delete workshops.")) return;

    const confirmed = await showConfirm({
      title: "Delete Workshop",
      message: "Delete this workshop? This cannot be undone.",
      confirmText: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteDoc(doc(this.db, "seminars", seminarId));
      if (this.editingId === seminarId) this.resetForm();
    } catch (error) {
      console.error("Failed to delete seminar:", error);
      await showAlert("Unable to delete workshop. Please try again.");
    }
  }

  renderCatalog(seminars) {
    const list = document.getElementById("seminarCatalogList");
    const countLabel = document.getElementById("seminarCatalogCount");

    if (countLabel) countLabel.textContent = `${seminars.length} workshops`;
    if (!list) return;

    list.innerHTML = "";

    if (!seminars.length) {
      const empty = document.createElement("div");
      empty.className = "seminar-catalog-item";
      empty.innerHTML =
        "<div class=\"seminar-catalog-info\"><h4>No workshops yet</h4><p class=\"seminar-catalog-meta\">Create your first workshop to show on the customer side.</p></div>";
      list.appendChild(empty);
      return;
    }

    seminars.forEach((seminar) => {
      const item = document.createElement("div");
      item.className = "seminar-catalog-item";

      const info = document.createElement("div");
      info.className = "seminar-catalog-info";

      const status = document.createElement("span");
      const isPast = AppUtils.isPastSeminar(seminar);
      const isClosed = seminar.bookingOpen === false && !isPast;
      status.className = `seminar-status ${isPast ? "past" : isClosed ? "closed" : "upcoming"}`;
      status.textContent = isPast ? "Past" : isClosed ? "Closed" : "Upcoming";

      const title = document.createElement("h4");
      title.textContent = seminar.title || "Untitled workshop";

      const meta = document.createElement("p");
      meta.className = "seminar-catalog-meta";
      const dateLabel = AppUtils.formatDate(seminar.date);
      const timeLabel = seminar.time ? ` - ${seminar.time}` : "";
      const locationLabel = seminar.location ? ` - ${seminar.location}` : "";
      meta.textContent = `${dateLabel}${timeLabel}${locationLabel}`;

      const price = document.createElement("p");
      price.className = "seminar-catalog-meta";
      const priceValue = Number(seminar.price);
      price.textContent =
        Number.isFinite(priceValue) && priceValue > 0
          ? `Price: ${AppUtils.formatCurrency(priceValue)}`
          : "";

      info.append(status, title, meta, price);

      if (this.isAdminRole()) {
        const actions = document.createElement("div");
        actions.className = "seminar-catalog-actions";

        const editBtn = document.createElement("button");
        editBtn.className = "btn view";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", () => window.startSeminarEdit(seminar.id));

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn decline";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => window.deleteSeminar(seminar.id));

        actions.append(editBtn, deleteBtn);
        item.append(info, actions);
      } else {
        item.append(info);
      }

      list.appendChild(item);
    });
  }

  getFilteredSeminars(seminars) {
    let output = Array.isArray(seminars) ? [...seminars] : [];

    const searchTerm = (this.filters.search || "").trim().toLowerCase();
    if (searchTerm) {
      output = output.filter((seminar) => {
        const fields = [seminar.title, seminar.location, seminar.description]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return fields.includes(searchTerm);
      });
    }

    const statusFilter = this.filters.status || "upcoming";
    if (statusFilter === "upcoming") {
      output = output.filter((seminar) => !AppUtils.isPastSeminar(seminar));
    } else if (statusFilter === "past") {
      output = output.filter((seminar) => AppUtils.isPastSeminar(seminar));
    }

    if (this.filters.date) {
      const selectedDate = AppUtils.parseDate(this.filters.date);
      if (selectedDate) {
        output = output.filter((seminar) => {
          const seminarDate = AppUtils.parseDate(seminar.date);
          return AppUtils.isSameDay(seminarDate, selectedDate);
        });
      }
    }

    const sortValue = this.filters.sort || "newest";
    output.sort((a, b) => {
      const dateA = AppUtils.parseDate(a.date);
      const dateB = AppUtils.parseDate(b.date);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return sortValue === "oldest" ? dateA - dateB : dateB - dateA;
    });

    return output;
  }

  renderActiveList() {
    if (!this.activeListEl) return;

    const seminars = this.getFilteredSeminars(this.seminars);

    if (this.activeCountLabel) {
      const countLabel = seminars.length === 1 ? "1 workshop" : `${seminars.length} workshops`;
      this.activeCountLabel.textContent = countLabel;
    }

    this.activeListEl.innerHTML = "";

    if (!seminars.length) {
      const empty = document.createElement("div");
      empty.className = "seminar-card";
      empty.innerHTML =
        "<h3>No workshops available</h3><p class=\"seminar-catalog-meta\">Create a workshop or adjust your filters.</p>";
      this.activeListEl.appendChild(empty);
      return;
    }

    seminars.forEach((seminar) => {
      this.activeListEl.appendChild(this.buildSeminarCard(seminar));
    });
  }

  buildSeminarCard(seminar) {
    const card = document.createElement("div");
    card.className = "seminar-card";

    const badge = document.createElement("span");
    badge.className = "type-badge seminar";
    badge.textContent = "WORKSHOP";

    const status = document.createElement("span");
    const isPast = AppUtils.isPastSeminar(seminar);
    const isClosed = seminar.bookingOpen === false && !isPast;
    status.className = `seminar-status ${isPast ? "past" : isClosed ? "closed" : "upcoming"}`;
    status.textContent = isPast ? "Past" : isClosed ? "Closed" : "Upcoming";

    const title = document.createElement("h3");
    title.textContent = seminar.title || "Untitled workshop";

    const meta = document.createElement("p");
    meta.className = "seminar-catalog-meta";
    const dateLabel = AppUtils.formatDate(seminar.date);
    const metaParts = [];
    if (dateLabel) metaParts.push(dateLabel);
    if (seminar.time) metaParts.push(seminar.time);
    if (seminar.location) metaParts.push(seminar.location);
    meta.textContent = metaParts.length ? metaParts.join(" | ") : "";

    const viewBtn = document.createElement("button");
    viewBtn.className = "btn view";
    viewBtn.textContent = "View Registrants";
    viewBtn.addEventListener("click", () => this.openApplicants(seminar));

    card.append(badge, status, title, meta, viewBtn);
    return card;
  }

  setApplicantLoading(isLoading) {
    if (this.applicantLoading) this.applicantLoading.hidden = !isLoading;
    if (this.applicantGrid) this.applicantGrid.hidden = isLoading;
  }

  async openApplicants(seminar) {
    if (!seminar) return;

    if (this.modalTitle) {
      this.modalTitle.textContent = seminar.title || "Workshop Applicants";
    }
    if (this.modalMeta) {
      const dateLabel = AppUtils.formatDate(seminar.date);
      const metaParts = [];
      if (dateLabel) metaParts.push(dateLabel);
      if (seminar.time) metaParts.push(seminar.time);
      if (seminar.location) metaParts.push(seminar.location);
      this.modalMeta.textContent = metaParts.length ? metaParts.join(" | ") : "";
    }

    if (this.applicantCount) this.applicantCount.textContent = "";
    if (this.applicantGrid) this.applicantGrid.innerHTML = "";
    if (this.applicantEmpty) this.applicantEmpty.hidden = true;
    if (this.attendeeTableBody) {
      this.attendeeTableBody.innerHTML =
        '<tr><td colspan="4" class="table-loading"></td></tr>';
    }
    if (this.attendeeEmpty) this.attendeeEmpty.hidden = true;
    this.setApplicantLoading(true);
    this.setSeminarView("applicants");

    if (typeof window.openSeminarModal === "function") {
      window.openSeminarModal();
    }

    try {
      const applicants = await this.fetchApplicants(seminar.id);
      this.renderApplicants(applicants);
    } catch (error) {
      console.error("Failed to load applicants:", error);
      await showAlert("Unable to load applicants. Please try again.");
      this.renderApplicants([]);
    } finally {
      this.setApplicantLoading(false);
    }
  }

  async fetchApplicants(seminarId) {
    if (!seminarId) return [];
    const bookingsRef = collection(this.db, "bookings");
    const applicantsQuery = query(
      bookingsRef,
      where("seminarId", "==", seminarId)
    );
    const snapshot = await getDocs(applicantsQuery);
    const applicants = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    applicants.sort((a, b) => {
      const dateA = AppUtils.getSortableDate(a);
      const dateB = AppUtils.getSortableDate(b);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateB - dateA;
    });
    return applicants;
  }

  renderApplicants(applicants) {
    if (!this.applicantGrid || !this.applicantCount) return;

    const totalSlots = applicants.reduce((sum, booking) => {
      const value = Number(booking.slotCount);
      if (Number.isFinite(value) && value > 0) return sum + Math.floor(value);
      return sum + 1;
    }, 0);
    let countLabel = applicants.length === 1 ? "1 applicant" : `${applicants.length} applicants`;
    if (totalSlots !== applicants.length) {
      countLabel += ` | ${totalSlots} slots`;
    }
    this.applicantCount.textContent = countLabel;

    this.applicantGrid.innerHTML = "";

    if (!applicants.length) {
      if (this.applicantEmpty) this.applicantEmpty.hidden = false;
      this.renderAttendeeTable([]);
      return;
    }

    if (this.applicantEmpty) this.applicantEmpty.hidden = true;

    applicants.forEach((booking) => {
      this.applicantGrid.appendChild(this.buildApplicantCard(booking));
    });

    this.renderAttendeeTable(applicants);
  }

  setSeminarView(view) {
    const showApplicants = view === "applicants";
    if (this.applicantsSection) this.applicantsSection.hidden = !showApplicants;
    if (this.attendeesSection) this.attendeesSection.hidden = showApplicants;
    if (this.viewApplicantsBtn) {
      this.viewApplicantsBtn.classList.toggle("active", showApplicants);
    }
    if (this.viewAttendeesBtn) {
      this.viewAttendeesBtn.classList.toggle("active", !showApplicants);
    }
  }

  renderAttendeeTable(applicants) {
    if (!this.attendeeTableBody) return;
    this.attendeeTableBody.innerHTML = "";

    let rowCount = 0;

    applicants.forEach((booking) => {
      const ref = AppUtils.getBookingReference(booking);
      const addRow = (nameValue, emailValue, typeValue) => {
        const row = document.createElement("tr");
        const nameCell = document.createElement("td");
        const emailCell = document.createElement("td");
        const typeCell = document.createElement("td");
        const refCell = document.createElement("td");

        nameCell.textContent = nameValue || emailValue || "";
        emailCell.textContent = emailValue || "";
        typeCell.textContent = typeValue;
        refCell.textContent = ref;

        row.append(nameCell, emailCell, typeCell, refCell);
        this.attendeeTableBody.appendChild(row);
        rowCount += 1;
      };

      const statusKey = AppUtils.normalizeStatusKey(booking.status);
      const isCompleted = AppUtils.isCompletedStatus(statusKey);
      if (!isCompleted) return;

      addRow(booking.userName || booking.userEmail, booking.userEmail, "Primary");

      const additional = Array.isArray(booking.additionalAttendees)
        ? booking.additionalAttendees
        : [];
      additional.forEach((attendee) => {
        addRow(attendee?.name, attendee?.email, "Additional");
      });
    });

    if (this.attendeeEmpty) {
      this.attendeeEmpty.hidden = true;
    }
    if (!rowCount) {
      this.attendeeTableBody.innerHTML =
        '<tr><td colspan="4" class="table-loading">No attendees yet.</td></tr>';
    }
  }

  buildApplicantCard(booking) {
    const card = document.createElement("div");
    card.className = "applicant-card";

    const info = document.createElement("div");
    info.className = "applicant-info";

    const header = document.createElement("div");
    header.className = "applicant-header";

    const name = document.createElement("h4");
    name.textContent = booking.userName || booking.userEmail || "";

    const statusBadge = document.createElement("span");
    statusBadge.className = `status-badge ${this.getStatusBadgeClass(booking.status)}`;
    statusBadge.textContent = AppUtils.getStatusLabel(booking.status);

    header.append(name, statusBadge);

    const email = document.createElement("p");
    email.className = "email";
    email.textContent = booking.userEmail || "";

    const userId = document.createElement("p");
    userId.className = "userid";
    userId.textContent = booking.userId
      ? `User ID: #${String(booking.userId).slice(0, 6).toUpperCase()}`
      : "";

    const reference = document.createElement("p");
    reference.className = "userid";
    reference.textContent = `Ref: ${AppUtils.getBookingReference(booking)}`;

    const slotLine = document.createElement("p");
    slotLine.className = "userid";
    const slotValue = Number(booking.slotCount);
    slotLine.textContent = `Slots: ${
      Number.isFinite(slotValue) && slotValue > 0 ? Math.floor(slotValue) : 1
    }`;

    const paymentLine = document.createElement("p");
    paymentLine.className = "userid";
    const paymentParts = [];
    if (booking.paymentMethod) paymentParts.push(`Method: ${booking.paymentMethod}`);
    if (booking.paymentStatus) {
      paymentParts.push(`Status: ${AppUtils.getStatusLabel(booking.paymentStatus)}`);
    }
    paymentLine.textContent = paymentParts.length ? paymentParts.join(" | ") : "";

    const amountValue = AppUtils.getAmountValue(booking);
    const amountLine = document.createElement("p");
    amountLine.className = "userid";
    const formattedAmount = AppUtils.formatAmount(amountValue);
    amountLine.textContent = formattedAmount ? `Amount: ${formattedAmount}` : "";

    info.append(header, email, userId, reference, slotLine, paymentLine, amountLine);

    const proofUrl = AppUtils.getSafeAssetUrl(booking.paymentProofUrl);
    if (proofUrl) {
      const proofImage = document.createElement("img");
      proofImage.src = proofUrl;
      proofImage.alt = "Payment proof";
      proofImage.className = "proof-image";
      info.appendChild(proofImage);

      const proofLink = document.createElement("a");
      proofLink.href = proofUrl;
      proofLink.className = "proof-link";
      proofLink.target = "_blank";
      proofLink.rel = "noopener";
      proofLink.textContent = "View GCash Proof";
      info.appendChild(proofLink);
    } else if (booking.paymentProofName) {
      const proofName = document.createElement("p");
      proofName.className = "userid";
      proofName.textContent = `Proof: ${booking.paymentProofName}`;
      info.appendChild(proofName);
    } else {
      const proofEmpty = document.createElement("p");
      proofEmpty.className = "userid";
      proofEmpty.textContent = "";
      info.appendChild(proofEmpty);
    }

    const actions = document.createElement("div");
    actions.className = "applicant-actions";
    this.populateApplicantActions(booking, statusBadge, actions);

    card.append(info, actions);
    return card;
  }

  getStatusBadgeClass(status) {
    const normalized = AppUtils.normalizeStatusKey(status);
    if (AppUtils.isCompletedStatus(normalized)) return "completed";
    if (normalized === "declined" || normalized === "rejected" || normalized === "cancelled") {
      return "declined";
    }
    if (normalized === "awaiting_payment" || normalized === "payment_submitted") {
      return "pending";
    }
    if (normalized.startsWith("pending")) return "pending";
    if (normalized === "waiting") return "waiting";
    return "unknown";
  }

  populateApplicantActions(booking, statusBadge, actions) {
    actions.innerHTML = "";

    const normalized = AppUtils.normalizeStatusKey(booking.status);

    if (normalized.startsWith("pending")) {
      const confirmBtn = document.createElement("button");
      confirmBtn.className = "btn accept";
      confirmBtn.textContent = "Confirm Availability";
      confirmBtn.addEventListener("click", () =>
        this.updateApplicantStatus(booking, "awaiting_payment", statusBadge, actions)
      );
      actions.appendChild(confirmBtn);

      const declineBtn = document.createElement("button");
      declineBtn.className = "btn decline";
      declineBtn.textContent = "Decline";
      declineBtn.addEventListener("click", () =>
        this.updateApplicantStatus(booking, "declined", statusBadge, actions)
      );
      actions.appendChild(declineBtn);
      return;
    }

    if (normalized === "awaiting_payment") {
      const waiting = document.createElement("p");
      waiting.className = "note";
      waiting.textContent = "Awaiting customer payment.";
      actions.appendChild(waiting);

      const declineBtn = document.createElement("button");
      declineBtn.className = "btn decline";
      declineBtn.textContent = "Decline";
      declineBtn.addEventListener("click", () =>
        this.updateApplicantStatus(booking, "declined", statusBadge, actions)
      );
      actions.appendChild(declineBtn);
      return;
    }

    if (normalized === "payment_submitted") {
      const approveBtn = document.createElement("button");
      approveBtn.className = "btn accept";
      approveBtn.textContent = "Approve Payment";
      approveBtn.addEventListener("click", () =>
        this.updateApplicantStatus(booking, "completed", statusBadge, actions)
      );
      actions.appendChild(approveBtn);

      const declineBtn = document.createElement("button");
      declineBtn.className = "btn decline";
      declineBtn.textContent = "Decline Payment";
      declineBtn.addEventListener("click", () =>
        this.updateApplicantStatus(booking, "declined", statusBadge, actions)
      );
      actions.appendChild(declineBtn);
      return;
    }

    const canDecline =
      normalized !== "declined" &&
      normalized !== "rejected" &&
      normalized !== "cancelled" &&
      !AppUtils.isCompletedStatus(normalized);
    if (canDecline) {
      const declineBtn = document.createElement("button");
      declineBtn.className = "btn decline";
      declineBtn.textContent = "Decline";
      declineBtn.addEventListener("click", () =>
        this.updateApplicantStatus(booking, "declined", statusBadge, actions)
      );
      actions.appendChild(declineBtn);
    }
  }

  async updateApplicantStatus(booking, nextStatus, statusBadge, actions) {
    if (!booking?.id) return;

    let normalized = AppUtils.normalizeStatusKey(nextStatus);
    let resolvedStatus = nextStatus;
    if (AppUtils.isCompletedStatus(normalized)) {
      normalized = "completed";
      resolvedStatus = "completed";
    }
    let payload = { status: resolvedStatus };

    if (normalized === "awaiting_payment") {
      const name = booking.userName || booking.userEmail || "this applicant";
      const confirmed = await showConfirm({
        title: "Confirm Availability",
        message: `Confirm availability for ${name} and request payment?`,
        confirmText: "Confirm",
        tone: "primary",
      });
      if (!confirmed) return;
      payload = {
        status: "awaiting_payment",
        paymentStatus: "awaiting_payment",
        confirmedAt: serverTimestamp(),
        paymentDueAt: getPaymentDueAt(),
      };
    }

    if (normalized === "completed") {
      const name = booking.userName || booking.userEmail || "this applicant";
      const isPaymentApproval = AppUtils.normalizeStatusKey(booking.status) === "payment_submitted";
      const title = isPaymentApproval ? "Approve Payment" : "Confirm Booking";
      const message =
        isPaymentApproval ? `Approve payment for ${name}?` : `Confirm booking for ${name}?`;
      const confirmed = await showConfirm({
        title,
        message,
        confirmText: isPaymentApproval ? "Approve" : "Confirm",
        tone: "primary",
      });
      if (!confirmed) return;
      if (isPaymentApproval) {
        payload = { status: "completed", paymentStatus: "approved" };
      } else {
        payload = { status: "completed" };
      }
    }

    if (normalized === "declined" || normalized === "rejected") {
      const reason = await this.requestDeclineReason("decline this booking");
      if (!reason) return;
      payload = {
        status: "declined",
        cancelReason: reason,
        cancelledAt: serverTimestamp(),
      };
    }

    const buttons = actions ? Array.from(actions.querySelectorAll("button")) : [];
    buttons.forEach((btn) => {
      btn.disabled = true;
    });

    try {
      await updateDoc(doc(this.db, "bookings", booking.id), payload);
      booking.status = payload.status;
      if (statusBadge) {
        statusBadge.textContent = AppUtils.getStatusLabel(payload.status);
        statusBadge.className = `status-badge ${this.getStatusBadgeClass(payload.status)}`;
      }
      if (actions) this.populateApplicantActions(booking, statusBadge, actions);
    } catch (error) {
      console.error("Failed to update booking status:", error);
      await showAlert("Unable to update status. Please try again.");
      buttons.forEach((btn) => {
        btn.disabled = false;
      });
    }
  }

  startListener() {
    if (this.unsub) return;

    const seminarsRef = collection(this.db, "seminars");
    const seminarsQuery = query(seminarsRef, orderBy("date", "desc"));

    this.unsub = onSnapshot(seminarsQuery, (snapshot) => {
      this.cache.clear();
      const seminars = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        const record = { id: docSnap.id, ...data };
        this.cache.set(docSnap.id, record);
        return record;
      });
      this.seminars = seminars;
      this.renderCatalog(seminars);
      this.renderActiveList();

      const currentBookings = window.dashboardApp?.bookingManager?.allBookings;
      if (Array.isArray(currentBookings) && currentBookings.length) {
        this.syncBookedSlots(currentBookings);
      }
    });
  }
}

// Flower catalog + render options for packages.
