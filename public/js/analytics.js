// ===================================================================
// ANALYTICS MANAGER - Dashboard Analytics
// ===================================================================

class AnalyticsManager {
  constructor({ bookingManager }) {
    this.bookingManager = bookingManager;
    this.charts = {
      trend: null,
      status: null,
      type: null,
      revenue: null
    };

    this.filters = {
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear()
    };
  }

  // ===================================================================
  // INITIALIZATION
  // ===================================================================

  init() {
    this.setupFilters();
    this.updateAllAnalytics();
  }

  setupFilters() {
    const monthFilter = document.getElementById("monthFilter");
    const yearFilter = document.getElementById("yearFilter");

    if (monthFilter) {
      monthFilter.addEventListener("change", (e) => {
        this.filters.month = e.target.value;
        this.updateAllAnalytics();
      });

      // Set current month
      monthFilter.value = this.filters.month;
    }

    if (yearFilter) {
      yearFilter.addEventListener("change", (e) => {
        this.filters.year = e.target.value;
        this.updateAllAnalytics();
      });

      // Set current year
      yearFilter.value = this.filters.year;
    }
  }

  // ===================================================================
  // MAIN UPDATE FUNCTION
  // ===================================================================

  updateAllAnalytics() {
    const allBookings = this.bookingManager.allBookings || [];

    this.updateKPIs(allBookings);
    this.updateBookingTrend(allBookings);
    this.updateStatusBreakdown(allBookings);
    this.updateBookingTypeChart(allBookings);
    this.updateRevenueChart(allBookings);
    this.updateTopEvents(allBookings);
    this.updateRecentActivity(allBookings);
  }

  // ===================================================================
  // KPI CARDS
  // ===================================================================

  updateKPIs(bookings) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    // Total bookings
    const totalBookings = bookings.length;

    // Bookings this month
    const thisMonth = bookings.filter(b => {
      const date = this.parseDate(b.timestamp || b.createdAt);
      if (!date) return false;
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    }).length;

    // Bookings last month
    const lastMonthCount = bookings.filter(b => {
      const date = this.parseDate(b.timestamp || b.createdAt);
      if (!date) return false;
      return date.getMonth() === lastMonth && date.getFullYear() === lastMonthYear;
    }).length;

    // Calculate percentage change
    const percentChange = lastMonthCount > 0
      ? (((thisMonth - lastMonthCount) / lastMonthCount) * 100).toFixed(1)
      : 0;

    // Active/upcoming events
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeEvents = bookings.filter(b => {
      const date = this.parseDate(b.date || b.seminarDate);
      if (!date) return false;
      return date >= today && this.isActiveStatus(b.status);
    }).length;

    // Revenue calculations
    const thisMonthRevenue = bookings
      .filter(b => {
        if (this.isCancelledStatus(b.status)) return false;
        const date = this.parseDate(b.timestamp || b.createdAt);
        if (!date) return false;
        return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
      })
      .reduce((sum, b) => {
        return sum + this.getRevenueAmount(b);
      }, 0);

    const lastMonthRevenue = bookings
      .filter(b => {
        if (this.isCancelledStatus(b.status)) return false;
        const date = this.parseDate(b.timestamp || b.createdAt);
        if (!date) return false;
        return date.getMonth() === lastMonth && date.getFullYear() === lastMonthYear;
      })
      .reduce((sum, b) => {
        return sum + this.getRevenueAmount(b);
      }, 0);

    const revenueChange = lastMonthRevenue > 0
      ? (((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100).toFixed(1)
      : 0;

    // Pending requests
    const pendingRequests = bookings.filter(b => {
      const status = this.normalizeStatus(b.status);
      return status.includes("pending");
    }).length;

    // Cancellation rate
    const cancelledCount = bookings.filter(b =>
      this.isCancelledStatus(b.status)
    ).length;
    const cancellationRate = totalBookings > 0
      ? ((cancelledCount / totalBookings) * 100).toFixed(1)
      : 0;

    // Update DOM
    this.setTextById("stat-total", totalBookings.toLocaleString());
    this.setTextById("stat-month", thisMonth);
    this.setTextById("stat-active", activeEvents);
    this.setTextById("stat-cancel", `${cancellationRate}%`);
    this.setTextById("stat-revenue", `\u20B1${thisMonthRevenue.toLocaleString()}`);
    this.setTextById("stat-pending", pendingRequests);

    // Update percentage changes
    const totalChangeEl = document.getElementById("stat-total-change");
    if (totalChangeEl) {
      const symbol = percentChange >= 0 ? "\u25B2" : "\u25BC";
      const className = percentChange >= 0 ? "positive" : "negative";
      totalChangeEl.innerHTML = `
        <span class="trend ${className}">${symbol} ${Math.abs(percentChange)}%</span>
        <span class="period">vs last month</span>
      `;
    }

    const revenueChangeEl = document.getElementById("stat-revenue-change");
    if (revenueChangeEl) {
      const symbol = revenueChange >= 0 ? "\u25B2" : "\u25BC";
      const className = revenueChange >= 0 ? "positive" : "negative";
      revenueChangeEl.innerHTML = `
        <span class="trend ${className}">${symbol} ${Math.abs(revenueChange)}%</span>
        <span class="period">vs last month</span>
      `;
    }
  }

  // ===================================================================
  // BOOKING TREND CHART (Line Chart)
  // ===================================================================

  updateBookingTrend(bookings) {
    const year = parseInt(this.filters.year);
    const month = this.filters.month;

    let labels = [];
    let data = [];

    if (month === "all") {
      const monthlyData = this.getMonthlyData(bookings, year);
      labels = monthlyData.map(d => d.label);
      data = monthlyData.map(d => d.count);
    } else {
      const dailyData = this.getDailyData(bookings, year, parseInt(month));
      labels = dailyData.map(d => d.label);
      data = dailyData.map(d => d.count);
    }

    this.renderTrendChart(labels, data);
  }

  getMonthlyData(bookings, year) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyData = Array(12).fill(0).map((_, i) => ({
      month: i,
      label: monthNames[i],
      count: 0
    }));

    bookings.forEach(booking => {
      const date = this.parseDate(booking.timestamp || booking.createdAt);
      if (!date || date.getFullYear() !== year) return;

      const month = date.getMonth();
      monthlyData[month].count++;
    });

    return monthlyData;
  }

  getDailyData(bookings, year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyData = Array(daysInMonth).fill(0).map((_, i) => ({
      day: i + 1,
      label: `Day ${i + 1}`,
      count: 0
    }));

    bookings.forEach(booking => {
      const date = this.parseDate(booking.timestamp || booking.createdAt);
      if (!date || date.getFullYear() !== year || date.getMonth() + 1 !== month) return;

      const day = date.getDate() - 1;
      if (dailyData[day]) dailyData[day].count++;
    });

    return dailyData;
  }

  renderTrendChart(labels, data) {
    const canvas = document.getElementById("bookingTrendChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    if (this.charts.trend) {
      this.charts.trend.destroy();
    }

    this.charts.trend = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Bookings",
          data,
          borderColor: "#2F80ED",
          backgroundColor: "rgba(47, 128, 237, 0.1)",
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: "#2F80ED",
          pointBorderColor: "#fff",
          pointBorderWidth: 2,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            padding: 12,
            titleFont: { size: 14, weight: "600" },
            bodyFont: { size: 13 }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              font: { size: 12 }
            },
            grid: {
              color: "rgba(0, 0, 0, 0.05)"
            }
          },
          x: {
            grid: {
              display: false
            },
            ticks: {
              font: { size: 12 }
            }
          }
        }
      }
    });
  }

  // ===================================================================
  // STATUS BREAKDOWN (Doughnut Chart)
  // ===================================================================

  updateStatusBreakdown(bookings) {
    const statusCounts = {
      pending: 0,
      completed: 0,
      cancelled: 0
    };

    bookings.forEach(booking => {
      const status = this.normalizeStatus(booking.status);

      if (status.includes("pending")) {
        statusCounts.pending++;
      } else if (
        status === "approved" ||
        status === "accepted" ||
        status === "completed" ||
        status === "confirmed"
      ) {
        statusCounts.completed++;
      } else if (this.isCancelledStatus(booking.status)) {
        statusCounts.cancelled++;
      }
    });

    this.renderStatusChart(statusCounts);
  }

  renderStatusChart(statusCounts) {
    const canvas = document.getElementById("bookingStatusChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    if (this.charts.status) {
      this.charts.status.destroy();
    }

    this.charts.status = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Pending", "Completed", "Cancelled"],
        datasets: [{
          data: [
            statusCounts.pending,
            statusCounts.completed,
            statusCounts.cancelled
          ],
          backgroundColor: [
            "#fbbf24", // Pending (yellow)
            "#10b981", // Completed (green)
            "#ef4444"  // Cancelled (red)
          ],
          borderWidth: 3,
          borderColor: "#fff"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "65%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              padding: 15,
              font: { size: 13 },
              usePointStyle: true,
              pointStyle: "circle"
            }
          },
          tooltip: {
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            padding: 12,
            callbacks: {
              label: function(context) {
                const label = context.label || "";
                const value = context.parsed || 0;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                return `${label}: ${value} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }

  // ===================================================================
  // BOOKING TYPE DISTRIBUTION (Doughnut Chart)
  // ===================================================================

  updateBookingTypeChart(bookings) {
    const typeCounts = {
      popup: 0,
      event: 0,
      seminar: 0
    };

    bookings.forEach(booking => {
      const type = booking.bookingType || "popup";
      if (typeCounts[type] !== undefined) {
        typeCounts[type]++;
      }
    });

    this.renderBookingTypeChart(typeCounts);
  }

  renderBookingTypeChart(typeCounts) {
    const canvas = document.getElementById("bookingTypeChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    if (this.charts.type) {
      this.charts.type.destroy();
    }

    const total = typeCounts.popup + typeCounts.event + typeCounts.seminar;

    this.charts.type = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Popup Bookings", "Event Bookings", "Workshop Registrations"],
        datasets: [{
          data: [
            typeCounts.popup,
            typeCounts.event,
            typeCounts.seminar
          ],
          backgroundColor: [
            "#3b82f6", // Popup (blue)
            "#10b981", // Event (green)
            "#f59e0b"  // Workshop (orange)
          ],
          borderWidth: 3,
          borderColor: "#fff"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "65%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              padding: 15,
              font: { size: 13 },
              usePointStyle: true,
              pointStyle: "circle"
            }
          },
          tooltip: {
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            padding: 12,
            callbacks: {
              label: function(context) {
                const label = context.label || "";
                const value = context.parsed || 0;
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                return `${label}: ${value} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }

  // ===================================================================
  // REVENUE CHART (Bar Chart - Last 6 Months)
  // ===================================================================

  updateRevenueChart(bookings) {
    const revenueData = this.getMonthlyRevenue(bookings, 6);
    this.renderRevenueChart(revenueData);
  }

  getMonthlyRevenue(bookings, monthCount) {
    const now = new Date();
    const monthlyRevenue = [];

    // Generate last N months
    for (let i = monthCount - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthlyRevenue.push({
        month: date.getMonth(),
        year: date.getFullYear(),
        label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        revenue: 0
      });
    }

    // Calculate revenue for each month
    bookings.forEach(booking => {
      // Skip cancelled/declined bookings
      if (this.isCancelledStatus(booking.status)) return;

      const date = this.parseDate(booking.timestamp || booking.createdAt);
      if (!date) return;

      const bookingMonth = date.getMonth();
      const bookingYear = date.getFullYear();

      // Find matching month in our array
      const monthData = monthlyRevenue.find(m =>
        m.month === bookingMonth && m.year === bookingYear
      );

      if (monthData) {
        monthData.revenue += this.getRevenueAmount(booking);
      }
    });

    return monthlyRevenue;
  }

  renderRevenueChart(revenueData) {
    const canvas = document.getElementById("revenueChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    if (this.charts.revenue) {
      this.charts.revenue.destroy();
    }

    const labels = revenueData.map(d => d.label);
    const data = revenueData.map(d => d.revenue);

    this.charts.revenue = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Revenue (PHP)",
          data,
          backgroundColor: "rgba(16, 185, 129, 0.2)",
          borderColor: "#10b981",
          borderWidth: 2,
          borderRadius: 8,
          barThickness: 40
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            padding: 12,
            callbacks: {
              label: function(context) {
                return `Revenue: \u20B1${context.parsed.y.toLocaleString()}`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              font: { size: 12 },
              callback: function(value) {
                return "\u20B1" + value.toLocaleString();
              }
            },
            grid: {
              color: "rgba(0, 0, 0, 0.05)"
            }
          },
          x: {
            grid: {
              display: false
            },
            ticks: {
              font: { size: 11 }
            }
          }
        }
      }
    });
  }

  // ===================================================================
  // TOP EVENTS TABLE
  // ===================================================================

  updateTopEvents(bookings) {
    const eventMap = {};

    // Group by booking type + resolved title so unrelated types don't merge.
    bookings.forEach(booking => {
      const eventName = this.getAnalyticsEventName(booking);
      const type = booking.bookingType || "popup";
      const eventKey = `${type}::${eventName}`;

      if (!eventMap[eventKey]) {
        eventMap[eventKey] = {
          name: eventName,
          type,
          bookings: 0,
          completed: 0,
          pending: 0,
          cancelled: 0
        };
      }

      eventMap[eventKey].bookings++;

      const status = this.normalizeStatus(booking.status);
      if (
        status === "completed" ||
        status === "approved" ||
        status === "accepted" ||
        status === "confirmed"
      ) {
        eventMap[eventKey].completed++;
      }
      else if (status.includes("pending")) eventMap[eventKey].pending++;
      else if (this.isCancelledStatus(booking.status)) eventMap[eventKey].cancelled++;
    });

    // Convert to array and sort by bookings
    const topEvents = Object.values(eventMap)
      .sort((a, b) => b.bookings - a.bookings)
      .slice(0, 5);

    this.renderTopEventsTable(topEvents);
  }

  renderTopEventsTable(events) {
    const tbody = document.getElementById("topEventsTable");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!events.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 2;
      cell.style.textAlign = "center";
      cell.style.padding = "2rem";
      cell.style.color = "#94a3b8";
      cell.textContent = "No events data available";
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    events.forEach((event) => {
      const row = document.createElement("tr");

      const nameCell = document.createElement("td");
      const infoWrap = document.createElement("div");
      infoWrap.style.display = "flex";
      infoWrap.style.flexDirection = "column";
      infoWrap.style.gap = "0.25rem";

      const nameSpan = document.createElement("span");
      nameSpan.style.fontWeight = "600";
      nameSpan.style.color = "#1e293b";
      nameSpan.textContent = String(event.name || "Unknown Event");

      const detailSpan = document.createElement("span");
      detailSpan.style.fontSize = "0.85rem";
      detailSpan.style.color = "#64748b";
      detailSpan.textContent = `${event.completed} completed | ${event.pending} pending | ${event.cancelled} cancelled`;

      infoWrap.append(nameSpan, detailSpan);
      nameCell.appendChild(infoWrap);

      const bookingsCell = document.createElement("td");
      const bookingsStrong = document.createElement("strong");
      bookingsStrong.textContent = String(event.bookings || 0);
      bookingsCell.appendChild(bookingsStrong);

      row.append(nameCell, bookingsCell);

      tbody.appendChild(row);
    });
  }

  // ===================================================================
// RECENT ACTIVITY
// ===================================================================

  updateRecentActivity(bookings) {
    const list = document.getElementById("recentActivityList");
    if (!list) return;

    list.innerHTML = "";

    const recentBookings = [...bookings]
      .sort((a, b) => {
        const dateA = this.parseDate(a.timestamp || a.createdAt);
        const dateB = this.parseDate(b.timestamp || b.createdAt);
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateB - dateA;
      })
      .slice(0, 8);

    if (!recentBookings.length) {
      const empty = document.createElement("div");
      empty.className = "activity-loading";
      empty.textContent = "No recent activity yet.";
      list.appendChild(empty);
      return;
    }

    recentBookings.forEach((booking) => {
      const item = document.createElement("div");
      item.className = "activity-item";

      const type = booking.bookingType || "popup";
      const typeLabel = this.getTypeLabel(type);
      const status = this.getStatusLabel(booking.status);
      const name = booking.userName || booking.userEmail || "Unknown";
      const timestamp = this.parseDate(booking.timestamp || booking.createdAt);
      const timeAgo = this.getTimeAgo(timestamp);
      const reference = this.getBookingReference(booking);
      const eventTitle =
        booking.seminarTitle ||
        booking.packageName ||
        booking.eventTitle ||
        booking.popupTitle ||
        "";

      const icon = document.createElement("div");
      icon.className = `activity-icon ${type}`;
      icon.textContent = typeLabel.charAt(0).toUpperCase();

      const content = document.createElement("div");
      content.className = "activity-content";

      const text = document.createElement("div");
      text.className = "activity-text";

      const nameStrong = document.createElement("strong");
      nameStrong.textContent = String(name);
      text.appendChild(nameStrong);
      text.append(document.createTextNode(` ${type === "popup" ? "requested" : "booked"} a `));

      const typeStrong = document.createElement("strong");
      typeStrong.textContent = String(typeLabel);
      text.appendChild(typeStrong);

      if (eventTitle) {
        const titleSpan = document.createElement("span");
        titleSpan.style.color = "#64748b";
        titleSpan.textContent = ` - ${eventTitle}`;
        text.appendChild(titleSpan);
      }

      const meta = document.createElement("div");
      meta.className = "activity-meta";

      const statusChip = document.createElement("span");
      statusChip.classList.add("status");
      const normalizedStatusClass = this.normalizeStatus(booking.status).replace(/[^a-z0-9_]/g, "");
      if (normalizedStatusClass) statusChip.classList.add(normalizedStatusClass);
      statusChip.style.fontSize = "0.85em";
      statusChip.style.padding = "0.15rem 0.5rem";
      statusChip.textContent = status;
      meta.appendChild(statusChip);

      if (reference) {
        const referenceSpan = document.createElement("span");
        referenceSpan.style.color = "#2F80ED";
        referenceSpan.style.fontWeight = "500";
        referenceSpan.textContent = `Ref: ${reference}`;
        meta.appendChild(referenceSpan);
      }

      const timeSpan = document.createElement("span");
      timeSpan.textContent = timeAgo;
      meta.appendChild(timeSpan);

      content.append(text, meta);
      item.append(icon, content);
      list.appendChild(item);
    });
  }

// Helper method to get booking reference (add this to the utility functions section)
getAnalyticsEventName(booking) {
  const type = booking.bookingType || "popup";
  const seminarTitle = String(booking.seminarTitle || "").trim();
  const packageName = String(booking.packageName || "").trim();
  const eventTitle = String(booking.eventTitle || "").trim();
  const popupTitle = String(booking.popupTitle || "").trim();

  if (type === "seminar") {
    if (seminarTitle) return seminarTitle;
    if (eventTitle) return eventTitle;
    if (booking.seminarId) return `Workshop ${String(booking.seminarId).slice(0, 8).toUpperCase()}`;
    return "Workshop Booking";
  }

  if (type === "event") {
    if (packageName) return packageName;
    if (eventTitle) return eventTitle;
    if (booking.packageId) return `Package ${String(booking.packageId).slice(0, 8).toUpperCase()}`;
    return "Event Booking";
  }

  if (popupTitle) return popupTitle;
  return "Pop-up Booking";
}

// Helper method to get booking reference (add this to the utility functions section)
getBookingReference(booking) {
  const ref = String(booking.bookingRef || booking.reference || booking.referenceNumber || "").trim();
  if (ref) return ref;

  if (booking.id) {
    const prefix = this.getBookingReferencePrefix(booking.bookingType);
    return `${prefix}-${String(booking.id).slice(0, 8).toUpperCase()}`;
  }

  return "";
}

getBookingReferencePrefix(type) {
  if (type === "event") return "EVT";
  if (type === "seminar") return "SEM";
  return "POP";
}


  // ===================================================================
  // UTILITY FUNCTIONS
  // ===================================================================

  parseDate(value) {
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

  normalizeStatus(status) {
    return String(status || "pending")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  }

  isCompletedStatus(status) {
    const normalized = this.normalizeStatus(status);
    return (
      normalized === "completed" ||
      normalized === "approved" ||
      normalized === "accepted" ||
      normalized === "confirmed"
    );
  }

  isActiveStatus(status) {
    return !this.isCancelledStatus(status) && !this.isCompletedStatus(status);
  }

  isCancelledStatus(status) {
    const normalized = this.normalizeStatus(status);
    return normalized === "cancelled" || normalized === "declined" || normalized === "rejected";
  }

  getTypeLabel(type) {
    if (type === "event") return "Event";
    if (type === "seminar") return "Workshop";
    return "Popup";
  }

  getRevenueAmount(booking) {
    if (!booking) return 0;

    const directAmount =
      booking.paymentAmount ??
      booking.totalAmount ??
      booking.amount ??
      booking.packagePrice ??
      booking.price;
    const numericDirect = Number(directAmount);
    if (Number.isFinite(numericDirect) && numericDirect > 0) return numericDirect;

    const seminarPrice = Number(booking.seminarPrice);
    const slotCount = Number(booking.slotCount || 1);
    if (Number.isFinite(seminarPrice) && seminarPrice > 0) {
      if (Number.isFinite(slotCount) && slotCount > 0) {
        return seminarPrice * slotCount;
      }
      return seminarPrice;
    }

    return 0;
  }

  getStatusLabel(status) {
    if (!status) return "Pending";
    const normalizedKey = this.normalizeStatus(status);
    if (normalizedKey === "pending_availability") return "Pending";
    if (
      normalizedKey === "approved" ||
      normalizedKey === "accepted" ||
      normalizedKey === "completed" ||
      normalizedKey === "confirmed"
    ) {
      return "Completed";
    }
    const normalized = normalizedKey.replace(/_/g, " ");
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  getTimeAgo(date) {
    if (!date) return "unknown";

    const seconds = Math.floor((new Date() - date) / 1000);

    let interval = Math.floor(seconds / 31536000);
    if (interval >= 1) return interval === 1 ? "1 year ago" : `${interval} years ago`;

    interval = Math.floor(seconds / 2592000);
    if (interval >= 1) return interval === 1 ? "1 month ago" : `${interval} months ago`;

    interval = Math.floor(seconds / 86400);
    if (interval >= 1) return interval === 1 ? "1 day ago" : `${interval} days ago`;

    interval = Math.floor(seconds / 3600);
    if (interval >= 1) return interval === 1 ? "1 hour ago" : `${interval} hours ago`;

    interval = Math.floor(seconds / 60);
    if (interval >= 1) return interval === 1 ? "1 minute ago" : `${interval} minutes ago`;

    return "just now";
  }

  setTextById(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (value === null || value === undefined) {
      el.textContent = "";
      return;
    }
    el.textContent = String(value);
  }
}

// Export for use in dashboard
export { AnalyticsManager };
