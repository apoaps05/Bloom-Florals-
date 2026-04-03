// ===================================================================
// HISTORY MANAGER - Booking History Section (No Firebase Init)
// ===================================================================
import { getBookingReferencePrefix } from "./shared-booking-logic.js";
import { showAlert } from "./dialogs.js";


// ===================================================================
// UTILITY FUNCTIONS (Shared with dashboard)
// ===================================================================
class HistoryUtils {
  static parseDate(value) {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-").map(Number);
      return new Date(year, month - 1, day);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  static parseTimestamp(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value === "object" && typeof value.seconds === "number") {
      return new Date(value.seconds * 1000);
    }
    if (typeof value === "number") return new Date(value);
    if (typeof value === "string") {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  static formatDate(value) {
    const date = HistoryUtils.parseDate(value);
    if (!date) return "";
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  static formatDateTime(value) {
    const date = HistoryUtils.parseTimestamp(value);
    if (!date) return "";
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  static formatCurrency(value) {
    return `PHP ${Number(value || 0).toLocaleString("en-US")}`;
  }

  static getStatusLabel(status) {
    if (!status) return "Unknown";
    const normalizedKey = HistoryUtils.normalizeStatusKey(status);
    if (normalizedKey === "pending_availability") return "Pending";
    if (
      normalizedKey === "approved" ||
      normalizedKey === "accepted" ||
      normalizedKey === "completed" ||
      normalizedKey === "confirmed"
    ) {
      return "Completed";
    }
    const normalized = String(status).replace(/_/g, " ");
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  static getTypeLabel(type) {
    if (type === "event") return "Event";
    if (type === "seminar") return "Workshop";
    return "Popup";
  }

  static normalizeValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  static normalizeStatusKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  }

  static getSearchableText(booking) {
    const location = booking?.location || {};
    const fields = [
      booking.userName,
      booking.userEmail,
      booking.contact,
      booking.bookingRef,
      booking.reference,
      booking.referenceNumber,
      booking.popupTitle,
      booking.eventTitle,
      booking.seminarTitle,
      booking.packageName,
      booking.seminarLocation,
      location.name,
      location.city,
      location.province,
      location.barangay,
      location.street,
      location.unit,
      location.landmark,
      location.postalCode,
      location.notes,
      booking.notes,
    ];

    return fields
      .map((value) => HistoryUtils.normalizeValue(value))
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  static getLocationSummary(booking) {
    if (booking.seminarLocation) return booking.seminarLocation;
    const location = booking?.location || {};
    const locationName = HistoryUtils.normalizeValue(location.name);
    const city = HistoryUtils.normalizeValue(location.city);
    const province = HistoryUtils.normalizeValue(location.province);
    const tail = city || province;
    if (locationName && tail) return `${locationName} - ${tail}`;
    return locationName || tail || "";
  }

  static getBookingReference(booking) {
    const ref = HistoryUtils.normalizeValue(
      booking.bookingRef || booking.reference || booking.referenceNumber
    );
    if (ref) return ref;
    if (booking.id) {
      const prefix = getBookingReferencePrefix(booking.bookingType);
      return `${prefix}-${String(booking.id).slice(0, 8).toUpperCase()}`;
    }
    return "";
  }

  static getSortableDate(booking) {
    return (
      HistoryUtils.parseTimestamp(booking.timestamp) ||
      HistoryUtils.parseTimestamp(booking.createdAt) ||
      HistoryUtils.parseTimestamp(booking.updatedAt) ||
      HistoryUtils.parseDate(booking.date || booking.seminarDate)
    );
  }

  static isDateInRange(date, fromDate, toDate) {
    if (!date) return false;

    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);

    if (fromDate) {
      const from = new Date(fromDate);
      from.setHours(0, 0, 0, 0);
      if (checkDate < from) return false;
    }

    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      if (checkDate > to) return false;
    }

    return true;
  }

    static isCurrentMonth(date) {
        if (!date) return false;
        const now = new Date();
        const checkDate = new Date(date);
        return (
        checkDate.getMonth() === now.getMonth() &&
        checkDate.getFullYear() === now.getFullYear()
        );
    }

    static isHistoryStatus(status) {
  const normalized = HistoryUtils.normalizeStatusKey(status);

    // Show completed (including legacy completed statuses), cancelled, declined, and rejected bookings
    return (
      normalized === "completed" ||
      normalized === "approved" ||
      normalized === "accepted" ||
      normalized === "confirmed" ||
      normalized === "cancelled" ||
      normalized === "declined" ||
      normalized === "rejected"
    );

  // TEMPORARY DEBUG: Show ALL bookings
  // return true;
    }
}


// ===================================================================
// HISTORY MANAGER CLASS
// ===================================================================
class HistoryManager {
  constructor({ bookingManager }) {
    this.bookingManager = bookingManager;
    this.allRecords = [];

    this.filters = {
      search: "",
      type: "all",
      status: "all",
      dateFrom: "",
      dateTo: "",
      sort: "newest"
    };

    this.filterControls = {};
  }

  // Initialize filter controls and event listeners
  initFilters() {
    this.filterControls = {
      search: document.getElementById("historySearch"),
      type: document.getElementById("historyTypeFilter"),
      status: document.getElementById("historyStatusFilter"),
      dateFrom: document.getElementById("historyDateFrom"),
      dateTo: document.getElementById("historyDateTo"),
      sort: document.getElementById("historySortFilter"),
      clearBtn: document.getElementById("historyClearFilters"),
      exportBtn: document.getElementById("historyExport")
    };

    // Search input
    if (this.filterControls.search) {
      this.filterControls.search.addEventListener("input", (e) => {
        this.filters.search = e.target.value;
        this.renderRecords();
      });
    }

    // Type filter
    if (this.filterControls.type) {
      this.filterControls.type.addEventListener("change", (e) => {
        this.filters.type = e.target.value;
        this.renderRecords();
      });
    }

    // Status filter
    if (this.filterControls.status) {
      this.filterControls.status.addEventListener("change", (e) => {
        this.filters.status = e.target.value;
        this.renderRecords();
      });
    }

    // Date from
    if (this.filterControls.dateFrom) {
      this.filterControls.dateFrom.addEventListener("change", (e) => {
        this.filters.dateFrom = e.target.value;
        this.renderRecords();
      });
    }

    // Date to
    if (this.filterControls.dateTo) {
      this.filterControls.dateTo.addEventListener("change", (e) => {
        this.filters.dateTo = e.target.value;
        this.renderRecords();
      });
    }

    // Sort
    if (this.filterControls.sort) {
      this.filterControls.sort.addEventListener("change", (e) => {
        this.filters.sort = e.target.value;
        this.renderRecords();
      });
    }

    // Clear filters button
    if (this.filterControls.clearBtn) {
      this.filterControls.clearBtn.addEventListener("click", () => {
        this.clearFilters();
      });
    }

    // Export button
    if (this.filterControls.exportBtn) {
      this.filterControls.exportBtn.addEventListener("click", () => {
        this.exportToCSV();
      });
    }
  }

  // Clear all filters
  clearFilters() {
    this.filters = {
      search: "",
      type: "all",
      status: "all",
      dateFrom: "",
      dateTo: "",
      sort: "newest"
    };

    if (this.filterControls.search) this.filterControls.search.value = "";
    if (this.filterControls.type) this.filterControls.type.value = "all";
    if (this.filterControls.status) this.filterControls.status.value = "all";
    if (this.filterControls.dateFrom) this.filterControls.dateFrom.value = "";
    if (this.filterControls.dateTo) this.filterControls.dateTo.value = "";
    if (this.filterControls.sort) this.filterControls.sort.value = "newest";

    this.renderRecords();
  }

  // Get filtered records based on current filter state
  getFilteredRecords() {
    let filtered = [...this.allRecords];

    // Search filter
    const searchTerm = (this.filters.search || "").trim().toLowerCase();
    if (searchTerm) {
      filtered = filtered.filter((record) =>
        HistoryUtils.getSearchableText(record).includes(searchTerm)
      );
    }

    // Type filter
    if (this.filters.type && this.filters.type !== "all") {
      filtered = filtered.filter(
        (record) => record.bookingType === this.filters.type
      );
    }

    // Status filter
    if (this.filters.status && this.filters.status !== "all") {
      filtered = filtered.filter((record) => {
        const normalized = HistoryUtils.normalizeStatusKey(record.status);
        const filterNormalized = HistoryUtils.normalizeStatusKey(this.filters.status);
        if (filterNormalized === "completed" || filterNormalized === "approved") {
          return (
            normalized === "completed" ||
            normalized === "approved" ||
            normalized === "accepted" ||
            normalized === "confirmed"
          );
        }
        return normalized === filterNormalized;
      });
    }

    // Date range filter
    if (this.filters.dateFrom || this.filters.dateTo) {
      filtered = filtered.filter((record) => {
        const recordDate = HistoryUtils.getSortableDate(record);
        return HistoryUtils.isDateInRange(
          recordDate,
          this.filters.dateFrom,
          this.filters.dateTo
        );
      });
    }

    // Sorting
    filtered.sort((a, b) => {
      const sortValue = this.filters.sort || "newest";

      if (sortValue === "name-asc" || sortValue === "name-desc") {
        const nameA = (a.userName || a.userEmail || "").toLowerCase();
        const nameB = (b.userName || b.userEmail || "").toLowerCase();
        return sortValue === "name-asc"
          ? nameA.localeCompare(nameB)
          : nameB.localeCompare(nameA);
      }

      // Date sorting
      const dateA = HistoryUtils.getSortableDate(a);
      const dateB = HistoryUtils.getSortableDate(b);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return sortValue === "oldest" ? dateA - dateB : dateB - dateA;
    });

    return filtered;
  }

  // Update summary cards
  updateSummaryCards(records) {
    const totalCount = document.getElementById("historyTotalCount");
    const completedCount = document.getElementById("historyCompletedCount");
    const cancelledCount = document.getElementById("historyCancelledCount");
    const monthCount = document.getElementById("historyMonthCount");

    if (totalCount) totalCount.textContent = records.length;

    if (completedCount) {
      const completed = records.filter(
        (r) => {
          const status = HistoryUtils.normalizeStatusKey(r.status);
          return (
            status === "completed" ||
            status === "approved" ||
            status === "accepted" ||
            status === "confirmed"
          );
        }
      ).length;
      completedCount.textContent = completed;
    }

    if (cancelledCount) {
      const cancelled = records.filter((r) => {
        const status = HistoryUtils.normalizeStatusKey(r.status);
        return status === "cancelled" || status === "declined" || status === "rejected";
      }).length;
      cancelledCount.textContent = cancelled;
    }

    if (monthCount) {
      const thisMonth = records.filter((r) => {
        const date = HistoryUtils.getSortableDate(r);
        return HistoryUtils.isCurrentMonth(date);
      }).length;
      monthCount.textContent = thisMonth;
    }
  }

  // Update count label
  updateCountLabel(count) {
    const countLabel = document.getElementById("historyCountLabel");
    if (countLabel) {
      const label = count === 1 ? "1 record" : `${count} records`;
      countLabel.textContent = label;
    }
  }

  // Render record card
  buildRecordCard(record) {
    const card = document.createElement("div");
    card.className = "request-card history-card";

    const left = document.createElement("div");
    left.className = "request-left";

    // Type badge
    const badge = document.createElement("span");
    badge.className = `type-badge ${record.bookingType || "popup"}`;
    badge.textContent = HistoryUtils.getTypeLabel(record.bookingType).toUpperCase();

    // Status badge
    const statusNormalizedRaw = HistoryUtils.normalizeStatusKey(record.status);
    const statusNormalized =
      statusNormalizedRaw === "approved" ||
      statusNormalizedRaw === "accepted" ||
      statusNormalizedRaw === "confirmed"
        ? "completed"
        : statusNormalizedRaw;
    const status = document.createElement("span");
    status.className = `status ${statusNormalized}`;
    status.textContent = HistoryUtils.getStatusLabel(record.status);

    // Title
    const title = document.createElement("h3");
    if (record.bookingType === "event") {
      title.textContent = record.packageName
        ? `Event: ${record.packageName}`
        : record.eventTitle || "Event Booking";
    } else {
      title.textContent =
        record.seminarTitle ||
        record.popupTitle ||
        `${HistoryUtils.getTypeLabel(record.bookingType)} Booking`;
    }

    // Client info
    const client = document.createElement("p");
    client.textContent = record.userName
      ? `Client: ${record.userName}`
      : record.userEmail
      ? `Client: ${record.userEmail}`
      : "";

    // Reference
    const reference = document.createElement("p");
    reference.textContent = `Reference: ${HistoryUtils.getBookingReference(record)}`;

    // Location
    const location = document.createElement("p");
    location.textContent = `Location: ${HistoryUtils.getLocationSummary(record)}`;

    // Date
    const date = document.createElement("p");
    date.textContent = `Date: ${HistoryUtils.formatDate(record.date || record.seminarDate)}`;

    // Budget/Amount
    const budget = document.createElement("p");
    if (record.amount || record.totalAmount || record.price) {
      const amountValue = record.amount || record.totalAmount || record.price;
      budget.textContent = `Amount: ${HistoryUtils.formatCurrency(amountValue)}`;
    } else if (record.budget) {
      budget.textContent = `Budget: ${record.budget}`;
    } else {
      budget.textContent = "";
    }

    // Completed/Cancelled timestamp
    const note = document.createElement("p");
    note.className = "note";
    const timestamp = HistoryUtils.parseTimestamp(record.updatedAt || record.timestamp);
    note.textContent = timestamp
      ? `Updated: ${HistoryUtils.formatDateTime(timestamp)}`
      : "";

    left.append(badge, status, title, client, reference, location, date, budget, note);

    // Actions
    const actions = document.createElement("div");
    actions.className = "request-actions";

    const viewBtn = document.createElement("button");
    viewBtn.className = "btn view";
    viewBtn.textContent = "View Details";
    viewBtn.addEventListener("click", () => {
      if (window.openDetailsModal) {
        window.openDetailsModal(record.id);
      }
    });

    actions.appendChild(viewBtn);

    card.append(left, actions);
    return card;
  }

  // Render all records
  renderRecords() {
    const filtered = this.getFilteredRecords();
    const listEl = document.getElementById("historyList");
    const emptyEl = document.getElementById("historyEmpty");

    this.updateSummaryCards(this.allRecords);
    this.updateCountLabel(filtered.length);

    if (!listEl) return;

    listEl.innerHTML = "";

    if (!filtered.length) {
      if (listEl) listEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    if (listEl) listEl.hidden = false;
    if (emptyEl) emptyEl.hidden = true;

    filtered.forEach((record) => {
      listEl.appendChild(this.buildRecordCard(record));
    });
  }

  // Export to CSV
  async exportToCSV() {
    const filtered = this.getFilteredRecords();

    if (!filtered.length) {
      await showAlert("No records to export");
      return;
    }

    // CSV headers
    const headers = [
      "Reference",
      "Type",
      "Status",
      "Client Name",
      "Client Email",
      "Contact",
      "Date",
      "Location",
      "Budget/Amount",
      "Notes",
      "Updated At"
    ];

    // CSV rows
    const rows = filtered.map((record) => {
      return [
        HistoryUtils.getBookingReference(record),
        HistoryUtils.getTypeLabel(record.bookingType),
        HistoryUtils.getStatusLabel(record.status),
        record.userName || "",
        record.userEmail || "",
        record.contact || "",
        HistoryUtils.formatDate(record.date || record.seminarDate),
        HistoryUtils.getLocationSummary(record),
        record.amount || record.totalAmount || record.price || record.budget || "",
        (record.notes || "").replace(/,/g, ";"), // Replace commas to avoid CSV issues
        HistoryUtils.formatDateTime(record.updatedAt || record.timestamp)
      ];
    });

    // Create CSV content
    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(","))
    ].join("\n");

    // Create download link
    const blob = new Blob([csvContent], { type: "text/csv;charset-utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const filename = `booking-history-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.csv`;

    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Update records from booking manager
  updateFromBookings(allBookings) {
    // Filter only completed/cancelled/declined bookings
    this.allRecords = allBookings.filter((booking) =>
      HistoryUtils.isHistoryStatus(booking.status)
    );

    this.renderRecords();
  }
}


// Export for use in dashboard
export { HistoryManager };
