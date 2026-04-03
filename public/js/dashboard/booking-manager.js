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
import { AppUtils, Dom } from "./utils.js";
import { showAlert, showConfirm, showPrompt } from "../dialogs.js";

const PAYMENT_DEADLINE_HOURS = 72;

const getPaymentDueAt = (hours = PAYMENT_DEADLINE_HOURS) => {
  const parsed = Number(hours);
  const safeHours = Number.isFinite(parsed) && parsed > 0 ? parsed : PAYMENT_DEADLINE_HOURS;
  return new Date(Date.now() + safeHours * 60 * 60 * 1000);
};

export class BookingManager {
  constructor({ db }) {
    this.db = db;
    this.cache = new Map();
    this.unsub = null;
    this.detailsModal = null;
    this.allBookings = [];
    this.normalizedLegacyIds = new Set();
    this.legacyNormalizationInFlight = false;
    this.filters = {
      popup: { search: "", status: "all", sort: "newest", date: "" },
      event: { search: "", status: "all", sort: "newest", date: "" },
      seminar: { search: "", status: "all", sort: "newest", date: "" },
    };
    this.filterControls = {};
  }

  isTerminalStatus(status, bookingType) {
    const normalized = AppUtils.normalizeStatusKey(status);
    if (!normalized) return false;
    if (normalized.includes("cancel")) return true;
    if (normalized.includes("declined") || normalized.includes("rejected")) return true;
    if (normalized === "completed" || normalized === "complete") return true;
    if (AppUtils.isCompletedStatus(normalized)) return true;
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

  async confirmStatusChange({
    title = "Confirm Action",
    message = "Are you sure you want to continue?",
    confirmText = "Confirm",
    tone = "primary",
  } = {}) {
    const confirmed = await showConfirm({ title, message, confirmText, tone });
    return Boolean(confirmed);
  }

  setDetailsModal(modal) {
    this.detailsModal = modal;
  }

  initFilters() {
    this.filterControls = {
      popup: {
        search: document.getElementById("popupSearch"),
        status: document.getElementById("popupStatusFilter"),
        sort: document.getElementById("popupSortFilter"),
        date: document.getElementById("popupDateFilter"),
        clear: document.getElementById("popupClearFilters"),
      },
      event: {
        search: document.getElementById("eventSearch"),
        status: document.getElementById("eventStatusFilter"),
        sort: document.getElementById("eventSortFilter"),
        date: document.getElementById("eventDateFilter"),
        clear: document.getElementById("eventClearFilters"),
      },
    };

    Object.entries(this.filterControls).forEach(([type, controls]) => {
      if (!controls) return;
      if (controls.search) {
        controls.search.addEventListener("input", (event) => {
          this.setFilterValue(type, "search", event.target.value);
        });
      }
      if (controls.status) {
        controls.status.addEventListener("change", (event) => {
          this.setFilterValue(type, "status", event.target.value);
        });
      }
      if (controls.sort) {
        controls.sort.addEventListener("change", (event) => {
          this.setFilterValue(type, "sort", event.target.value);
        });
      }
      if (controls.date) {
        controls.date.addEventListener("change", (event) => {
          this.setFilterValue(type, "date", event.target.value);
        });
      }
      if (controls.clear) {
        controls.clear.addEventListener("click", () => {
          this.resetFilters(type);
        });
      }
    });
  }

  resetFilters(type) {
    if (!this.filters[type]) return;
    this.filters[type] = { search: "", status: "all", sort: "newest", date: "" };

    const controls = this.filterControls[type];
    if (!controls) return;
    if (controls.search) controls.search.value = "";
    if (controls.status) controls.status.value = "all";
    if (controls.sort) controls.sort.value = "newest";
    if (controls.date) controls.date.value = "";

    this.renderBookings(this.allBookings);
  }

  setFilterValue(type, key, value) {
    if (!this.filters[type]) return;
    this.filters[type][key] = value;
    this.renderBookings(this.allBookings);
  }

  hasActiveFilters(type) {
    const filter = this.filters[type];
    if (!filter) return false;
    return (
      Boolean(filter.search && filter.search.trim()) ||
      (filter.status && filter.status !== "all") ||
      Boolean(filter.date)
    );
  }

  matchesStatus(filterValue, status) {
    const target = AppUtils.normalizeStatusKey(filterValue);
    const normalized = AppUtils.normalizeStatusKey(status);

    if (target === "approved" || target === "completed") {
      return AppUtils.isCompletedStatus(normalized);
    }
    if (target === "declined") {
      return normalized === "declined" || normalized === "rejected";
    }
    if (target === "pending") {
      return normalized.startsWith("pending");
    }

    return normalized === target;
  }

  getFilteredBookings(type, bookings) {
    const filter = this.filters[type] || { search: "", status: "all", sort: "newest", date: "" };
    let output = [...bookings];

    const searchTerm = (filter.search || "").trim().toLowerCase();
    if (searchTerm) {
      output = output.filter((booking) => AppUtils.getSearchableText(booking).includes(searchTerm));
    }

    if (filter.status && filter.status !== "all") {
      output = output.filter((booking) => this.matchesStatus(filter.status, booking.status));
    }

    if (filter.date) {
      const selectedDate = AppUtils.parseDate(filter.date);
      if (selectedDate) {
        output = output.filter((booking) => {
          const bookingDate =
            AppUtils.parseDate(booking.date || booking.seminarDate) ||
            AppUtils.parseTimestamp(booking.date);
          return AppUtils.isSameDay(bookingDate, selectedDate);
        });
      }
    }

    const sortValue = filter.sort || "newest";
    output.sort((a, b) => {
      const dateA = AppUtils.getSortableDate(a);
      const dateB = AppUtils.getSortableDate(b);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return sortValue === "oldest" ? dateA - dateB : dateB - dateA;
    });

    return output;
  }

  updateListCountLabels(grouped, filteredGrouped) {
    const popupCountLabel = document.getElementById("popupCountLabel");
    const eventCountLabel = document.getElementById("eventCountLabel");

    const popupFiltersActive = this.hasActiveFilters("popup");
    const eventFiltersActive = this.hasActiveFilters("event");

    if (popupCountLabel) {
      if (popupFiltersActive) {
        popupCountLabel.textContent = `${filteredGrouped.popup.length} results`;
      } else {
        const pendingPopup = grouped.popup.filter((item) => AppUtils.isPendingStatus(item.status)).length;
        popupCountLabel.textContent = `${pendingPopup} pending`;
      }
    }

    if (eventCountLabel) {
      eventCountLabel.textContent = eventFiltersActive
        ? `${filteredGrouped.event.length} results`
        : `${grouped.event.length} total`;
    }
  }

  openDetails(bookingId) {
    if (bookingId && this.cache.has(bookingId)) {
      this.fillDetailsModal(this.cache.get(bookingId));
    }
    if (this.detailsModal) this.detailsModal.open();
  }

  async updateStatus(bookingId, status, options = {}) {
    let normalized = AppUtils.normalizeStatusKey(status);
    let resolvedStatus = status;
    if (AppUtils.isCompletedStatus(normalized)) {
      normalized = "completed";
      resolvedStatus = "completed";
    }
    let payload = { status: resolvedStatus };

    if (options.confirm) {
      const confirmed = await this.confirmStatusChange({
        title: options.confirmTitle,
        message: options.confirmMessage,
        confirmText: options.confirmText,
        tone: options.confirmTone,
      });
      if (!confirmed) return;
    }

    if (normalized === "declined" || normalized === "rejected") {
      const reason =
        (options.reason && String(options.reason).trim()) ||
        (await this.requestDeclineReason(options.reasonLabel || "decline this booking"));
      if (!reason) return;
      payload = {
        status: "declined",
        cancelReason: reason,
        cancelledAt: serverTimestamp(),
      };
    }

    if (Object.prototype.hasOwnProperty.call(options, "paymentStatus")) {
      payload.paymentStatus = options.paymentStatus;
    }

    if (options.setPaymentDeadline) {
      payload.confirmedAt = serverTimestamp();
      payload.paymentDueAt = getPaymentDueAt(options.paymentDeadlineHours);
    }

    try {
      await updateDoc(doc(this.db, "bookings", bookingId), payload);
      if (this.detailsModal) this.detailsModal.close();
    } catch (error) {
      console.error("Failed to update booking status:", error);
      await showAlert("Unable to update booking status. Please try again.");
    }
  }

  fillDetailsModal(booking) {
    Dom.setText("detailName", booking.userName || "");
    Dom.setText("detailEmail", booking.userEmail || "");
    Dom.setText(
      "detailUserId",
      booking.userId ? `#${booking.userId.slice(0, 6).toUpperCase()}` : ""
    );
    Dom.setText("detailBookingRef", AppUtils.getBookingReference(booking));
    Dom.setText("detailContact", booking.contact || "");
    Dom.setText("detailDate", AppUtils.formatDate(booking.date || booking.seminarDate));
    Dom.setText("detailTime", booking.timeRange || booking.seminarTime || "");

    const locationDetails = AppUtils.getLocationDetails(booking);
    Dom.setText("detailLocation", locationDetails.primary);
    Dom.setText("detailCity", locationDetails.secondary);

    const bookingType = AppUtils.normalizeStatusKey(booking.bookingType);
    const formattedAmount = AppUtils.formatAmount(AppUtils.getAmountValue(booking));
    const budgetFallback = bookingType === "popup" ? "Popup invitation" : "";
    Dom.setText("detailBudget", formattedAmount || budgetFallback);
    Dom.setText("detailNotes", booking.notes || "");

    const paymentSection = document.getElementById("detailPaymentSection");
    const paymentImage = document.getElementById("detailPaymentImage");
    const paymentLink = document.getElementById("detailPaymentLink");
    const paymentName = document.getElementById("detailPaymentName");
    const proofUrl = AppUtils.getSafeAssetUrl(booking.paymentProofUrl);
    const proofName = booking.paymentProofName || "";
    const isPdf = /\.pdf$/i.test(proofName);

    if (paymentSection) {
      paymentSection.style.display = proofUrl || proofName ? "block" : "none";
    }
    if (paymentImage) {
      if (proofUrl && !isPdf) {
        paymentImage.src = proofUrl;
        paymentImage.hidden = false;
      } else {
        paymentImage.hidden = true;
        paymentImage.removeAttribute("src");
      }
    }
    if (paymentLink) {
      if (proofUrl) {
        paymentLink.href = proofUrl;
        paymentLink.hidden = false;
      } else {
        paymentLink.hidden = true;
        paymentLink.removeAttribute("href");
      }
    }
    if (paymentName) {
      if (proofName) {
        paymentName.textContent = `File: ${proofName}`;
        paymentName.hidden = false;
      } else {
        paymentName.textContent = "";
        paymentName.hidden = true;
      }
    }

    const acceptBtn = document.getElementById("detailAccept");
    const declineBtn = document.getElementById("detailDecline");
    const statusKey = AppUtils.normalizeStatusKey(booking.status);

    const setActionButton = (button, { label, action, hidden }) => {
      if (!button) return;
      button.hidden = Boolean(hidden);
      if (label) button.textContent = label;
      button.onclick = action || null;
    };

    let acceptConfig = { hidden: true };
    let declineConfig = { hidden: true };

    if (bookingType === "event" && statusKey.startsWith("pending")) {
      declineConfig = {
        label: "Decline",
        action: () => this.updateStatus(booking.id, "declined", { reasonLabel: "decline this booking" })
      };
      acceptConfig = {
        label: "Confirm Availability",
        action: () =>
          this.updateStatus(booking.id, "awaiting_payment", {
            paymentStatus: "awaiting_payment",
            setPaymentDeadline: true,
            confirm: true,
            confirmTitle: "Confirm Availability",
            confirmMessage: "Confirm availability and request payment from the customer?",
            confirmText: "Confirm",
            confirmTone: "primary",
          })
      };
    } else if (bookingType === "event" && statusKey === "payment_submitted") {
      declineConfig = {
        label: "Decline Payment",
        action: () =>
          this.updateStatus(booking.id, "declined", {
            reasonLabel: "decline this payment",
            paymentStatus: "declined",
          })
      };
      acceptConfig = {
        label: "Approve Payment",
        action: () =>
          this.updateStatus(booking.id, "completed", {
            paymentStatus: "approved",
            confirm: true,
            confirmTitle: "Approve Payment",
            confirmMessage: "Approve this payment and confirm the booking?",
            confirmText: "Approve",
            confirmTone: "primary",
          })
      };
    } else if (AppUtils.isPendingStatus(booking.status)) {
      declineConfig = {
        label: "Decline",
        action: () => this.updateStatus(booking.id, "declined", { reasonLabel: "decline this booking" })
      };
      acceptConfig = {
        label: "Confirm Booking",
        action: () =>
          this.updateStatus(booking.id, "completed", {
            confirm: true,
            confirmTitle: "Confirm Booking",
            confirmMessage: "Confirm this booking request?",
            confirmText: "Confirm",
            confirmTone: "primary",
          })
      };
    }

    setActionButton(declineBtn, declineConfig);
    setActionButton(acceptBtn, acceptConfig);
  }

  renderRequestList(listEl, bookings, type) {
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!bookings.length) {
      const empty = document.createElement("div");
      empty.className = "request-card";
      empty.innerHTML = `<div class="request-left"><h3>No ${AppUtils.getTypeLabel(
        type
      )} requests yet</h3><p class="note">New requests will show up here.</p></div>`;
      listEl.appendChild(empty);
      return;
    }

    bookings.forEach((booking) => {
      const card = document.createElement("div");
      card.className = type === "seminar" ? "request-card seminar-card" : "request-card";

      const left = document.createElement("div");
      left.className = "request-left";

      const badge = document.createElement("span");
      badge.className = `type-badge ${type}`;
      badge.textContent = AppUtils.getTypeLabel(type).toUpperCase();

      const status = document.createElement("span");
      const rawStatusKey = AppUtils.normalizeStatusKey(booking.status);
      let statusClass = rawStatusKey || "pending";
      if (statusClass.startsWith("pending")) statusClass = "pending";
      if (AppUtils.isCompletedStatus(statusClass)) statusClass = "completed";
      if (statusClass === "rejected") statusClass = "declined";
      if (statusClass.includes("cancel")) statusClass = "cancelled";
      status.className = `status ${statusClass}`;
      status.textContent = AppUtils.getStatusLabel(booking.status);

      const title = document.createElement("h3");
      let titleText = `${AppUtils.getTypeLabel(type)} Booking`;
      if (type === "event") {
        titleText = booking.packageName
          ? `Event: ${booking.packageName}`
          : booking.eventTitle || "Event Booking";
      } else if (type === "seminar") {
        titleText = booking.seminarTitle || "Workshop Booking";
      } else if (type === "popup") {
        titleText = booking.popupTitle || "Popup Invitation";
      } else {
        titleText =
          booking.seminarTitle ||
          booking.eventTitle ||
          booking.popupTitle ||
          `${AppUtils.getTypeLabel(type)} Booking`;
      }
      title.textContent = titleText;

      const client = document.createElement("p");
      client.textContent = booking.userName
        ? `Client: ${booking.userName}`
        : booking.userEmail
        ? `Client: ${booking.userEmail}`
        : "";

      const location = document.createElement("p");
      location.textContent = `Location: ${AppUtils.getLocationSummary(booking)}`;

      const date = document.createElement("p");
      date.textContent = `Date: ${AppUtils.formatDate(booking.date || booking.seminarDate)}`;

      const note = document.createElement("p");
      note.className = "note";
      const amountText = AppUtils.getAmountText(booking);
      if (type === "event") {
        const statusKey = AppUtils.normalizeStatusKey(booking.status);
        let statusText = "Status: pending";
        if (statusKey.startsWith("pending")) {
          statusText = "Status: pending";
        } else if (statusKey === "awaiting_payment") {
          statusText = "Payment: awaiting customer payment";
        } else if (statusKey === "payment_submitted") {
          statusText = "Payment: submitted for review";
        } else if (AppUtils.isCompletedStatus(statusKey)) {
          statusText = "Status: completed";
        } else if (statusKey === "declined" || statusKey === "rejected") {
          statusText = "Status: declined";
        } else {
          statusText = `Status: ${AppUtils.getStatusLabel(booking.status)}`;
        }
        const noteParts = [statusText];
        if (amountText) noteParts.push(amountText);
        note.textContent = noteParts.join(" | ");
      } else if (type === "seminar") {
        const statusText = booking.paymentStatus
          ? `Payment: ${AppUtils.getStatusLabel(booking.paymentStatus)}`
          : "Status: awaiting review";
        const noteParts = [statusText];
        if (amountText) noteParts.push(amountText);
        note.textContent = noteParts.join(" | ");
      } else {
        const budgetText = booking.budget ? AppUtils.formatAmount(booking.budget) : "";
        note.textContent = booking.paymentStatus
          ? `Payment: ${AppUtils.getStatusLabel(booking.paymentStatus)}`
          : budgetText
          ? `Budget: ${budgetText}`
          : "Status: awaiting review";
      }

      left.append(badge, status, title, client, location, date, note);

      const actions = document.createElement("div");
      actions.className = "request-actions";

      const viewBtn = document.createElement("button");
      viewBtn.className = "btn view";
      viewBtn.textContent = "View Details";
      viewBtn.addEventListener("click", () => {
        this.fillDetailsModal(booking);
        if (this.detailsModal) this.detailsModal.open();
      });

      actions.appendChild(viewBtn);

      const statusKey = AppUtils.normalizeStatusKey(booking.status);

      if (type === "event" && statusKey.startsWith("pending")) {
        const declineBtn = document.createElement("button");
        declineBtn.className = "btn decline";
        declineBtn.textContent = "Decline";
        declineBtn.addEventListener("click", () =>
          this.updateStatus(booking.id, "declined", { reasonLabel: "decline this booking" })
        );

        const acceptBtn = document.createElement("button");
        acceptBtn.className = "btn accept";
        acceptBtn.textContent = "Confirm Availability";
        acceptBtn.addEventListener("click", () =>
          this.updateStatus(booking.id, "awaiting_payment", {
            paymentStatus: "awaiting_payment",
            setPaymentDeadline: true,
            confirm: true,
            confirmTitle: "Confirm Availability",
            confirmMessage: "Confirm availability and request payment from the customer?",
            confirmText: "Confirm",
            confirmTone: "primary",
          })
        );

        actions.append(declineBtn, acceptBtn);
      } else if (type === "event" && statusKey === "payment_submitted") {
        const declineBtn = document.createElement("button");
        declineBtn.className = "btn decline";
        declineBtn.textContent = "Decline Payment";
        declineBtn.addEventListener("click", () =>
          this.updateStatus(booking.id, "declined", {
            reasonLabel: "decline this payment",
            paymentStatus: "declined",
          })
        );

        const acceptBtn = document.createElement("button");
        acceptBtn.className = "btn accept";
        acceptBtn.textContent = "Approve Payment";
        acceptBtn.addEventListener("click", () =>
          this.updateStatus(booking.id, "completed", {
            paymentStatus: "approved",
            confirm: true,
            confirmTitle: "Approve Payment",
            confirmMessage: "Approve this payment and confirm the booking?",
            confirmText: "Approve",
            confirmTone: "primary",
          })
        );

        actions.append(declineBtn, acceptBtn);
      } else if (AppUtils.isPendingStatus(booking.status)) {
        const declineBtn = document.createElement("button");
        declineBtn.className = "btn decline";
        declineBtn.textContent = "Decline";
        declineBtn.addEventListener("click", () =>
          this.updateStatus(booking.id, "declined", { reasonLabel: "decline this booking" })
        );

        const acceptBtn = document.createElement("button");
        acceptBtn.className = "btn accept";
        acceptBtn.textContent = "Confirm Booking";
        acceptBtn.addEventListener("click", () =>
          this.updateStatus(booking.id, "completed", {
            confirm: true,
            confirmTitle: "Confirm Booking",
            confirmMessage: "Confirm this booking request?",
            confirmText: "Confirm",
            confirmTone: "primary",
          })
        );

        actions.append(declineBtn, acceptBtn);
      }

      card.append(left, actions);
      listEl.appendChild(card);
    });
  }

  updateStats(bookings) {
    const totalEl = document.getElementById("stat-total");
    const upcomingEl = document.getElementById("stat-upcoming");
    const pendingEl = document.getElementById("stat-pending");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = bookings.filter((booking) => {
      const date = AppUtils.parseDate(booking.date || booking.seminarDate);
      return date && date >= today;
    });

    const pending = bookings.filter((booking) => AppUtils.isPendingStatus(booking.status));

    if (totalEl) totalEl.textContent = bookings.length;
    if (upcomingEl) upcomingEl.textContent = upcoming.length;
    if (pendingEl) pendingEl.textContent = pending.length;
  }

  updateRecentActivity(bookings) {
    const list = document.getElementById("recentActivity");
    if (!list) return;

    list.innerHTML = "";
    const recent = bookings.slice(0, 5);

    if (!recent.length) {
      const item = document.createElement("li");
      item.textContent = "No recent activity yet.";
      list.appendChild(item);
      return;
    }

    recent.forEach((booking) => {
      const item = document.createElement("li");
      item.textContent = `${AppUtils.getTypeLabel(booking.bookingType)} booking - ${AppUtils.getStatusLabel(
        booking.status
      )} - ${AppUtils.formatDate(booking.date || booking.seminarDate)}`;
      list.appendChild(item);
    });
  }

  updateSectionCounts(grouped, groupedActive) {
    const popupTotalCount = document.getElementById("popupTotalCount");
    const popupActiveCount = document.getElementById("popupActiveCount");
    const popupPendingCount = document.getElementById("popupPendingCount");
    const popupAcceptedCount = document.getElementById("popupAcceptedCount");
    const popupDeclinedCount = document.getElementById("popupDeclinedCount");

    const badgePopup = document.getElementById("badge-popup");
    const badgeEvent = document.getElementById("badge-event");
    const badgeSeminar = document.getElementById("badge-seminar");

    if (badgePopup) badgePopup.textContent = groupedActive.popup.length;
    if (badgeEvent) badgeEvent.textContent = groupedActive.event.length;
    if (badgeSeminar) badgeSeminar.textContent = groupedActive.seminar.length;

    if (popupTotalCount) popupTotalCount.textContent = grouped.popup.length;
    if (popupActiveCount) popupActiveCount.textContent = groupedActive.popup.length;
    if (popupPendingCount) {
      popupPendingCount.textContent = grouped.popup.filter((item) => AppUtils.isPendingStatus(item.status)).length;
    }
    if (popupAcceptedCount) {
      popupAcceptedCount.textContent = grouped.popup.filter((item) => AppUtils.isAcceptedStatus(item.status)).length;
    }
    if (popupDeclinedCount) {
      popupDeclinedCount.textContent = grouped.popup.filter((item) => {
        const statusKey = AppUtils.normalizeStatusKey(item.status);
        return statusKey === "declined" || statusKey === "rejected";
      }).length;
    }

    const eventTotalCount = document.getElementById("eventTotalCount");
    const eventPendingCount = document.getElementById("eventPendingCount");
    const eventAwaitingCount = document.getElementById("eventAwaitingCount");
    const eventReviewCount = document.getElementById("eventReviewCount");

    if (eventTotalCount) eventTotalCount.textContent = grouped.event.length;
    if (eventPendingCount) {
      eventPendingCount.textContent = grouped.event.filter((item) => AppUtils.isPendingStatus(item.status)).length;
    }
    if (eventAwaitingCount) {
      eventAwaitingCount.textContent = grouped.event.filter((item) => item.status === "awaiting_payment").length;
    }
    if (eventReviewCount) {
      eventReviewCount.textContent = grouped.event.filter((item) => item.status === "payment_submitted").length;
    }
  }

  renderBookings(bookings) {
    const grouped = {
      popup: [],
      event: [],
      seminar: [],
    };

    bookings.forEach((booking) => {
      const type = booking.bookingType || "popup";
      if (grouped[type]) grouped[type].push(booking);
    });

    const groupedActive = {
      popup: grouped.popup.filter(
        (booking) => !this.isTerminalStatus(booking.status, booking.bookingType)
      ),
      event: grouped.event.filter(
        (booking) => !this.isTerminalStatus(booking.status, booking.bookingType)
      ),
      seminar: grouped.seminar,
    };

    const filteredGrouped = {
      popup: this.getFilteredBookings("popup", groupedActive.popup),
      event: this.getFilteredBookings("event", groupedActive.event),
    };

    this.updateStats(bookings);
    this.updateRecentActivity(bookings);
    this.updateSectionCounts(grouped, groupedActive);
    this.updateListCountLabels(groupedActive, filteredGrouped);

    this.renderRequestList(
      document.getElementById("popupRequestList"),
      filteredGrouped.popup,
      "popup"
    );
    this.renderRequestList(
      document.getElementById("eventRequestList"),
      filteredGrouped.event,
      "event"
    );

    if (window.dashboardApp && window.dashboardApp.historyManager) {
      window.dashboardApp.historyManager.updateFromBookings(bookings);
    }

    if (window.dashboardApp && window.dashboardApp.analyticsManager) {
      window.dashboardApp.analyticsManager.updateAllAnalytics();
    }

    if (window.dashboardApp && window.dashboardApp.seminarManager) {
      window.dashboardApp.seminarManager.syncBookedSlots(bookings);
    }

    if (window.dashboardApp && window.dashboardApp.calendarManager) {
      window.dashboardApp.calendarManager.setBookings(bookings);
    }
  }

  async normalizeLegacyStatuses(bookings) {
    if (this.legacyNormalizationInFlight) return;
    const legacy = bookings.filter((booking) => {
      if (!booking?.id || this.normalizedLegacyIds.has(booking.id)) return false;
      const normalized = AppUtils.normalizeStatusKey(booking.status);
      return AppUtils.isCompletedStatus(normalized) && normalized !== "completed";
    });
    if (!legacy.length) return;

    this.legacyNormalizationInFlight = true;
    const updates = legacy.map((booking) => ({
      id: booking.id,
      promise: updateDoc(doc(this.db, "bookings", booking.id), { status: "completed" })
    }));

    const results = await Promise.allSettled(updates.map((item) => item.promise));
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        this.normalizedLegacyIds.add(updates[index].id);
      }
    });

    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length) {
      console.error("Failed to normalize some booking statuses:", failed);
    }
    this.legacyNormalizationInFlight = false;
  }


  startListener() {
    if (this.unsub) return;

    const bookingsRef = collection(this.db, "bookings");
    const bookingsQuery = query(bookingsRef, orderBy("timestamp", "desc"));

    this.unsub = onSnapshot(bookingsQuery, (snapshot) => {
      this.cache.clear();
      const bookings = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        const record = { id: docSnap.id, ...data };
        this.cache.set(docSnap.id, record);
        return record;
      });
      this.allBookings = bookings;
      this.normalizeLegacyStatuses(bookings);
      this.renderBookings(bookings);
    });
  }
}

// Seminar catalog + form workflow (create/edit/delete + image upload).
