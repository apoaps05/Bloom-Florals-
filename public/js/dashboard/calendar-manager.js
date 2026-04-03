import { AppUtils } from "./utils.js";

export class CalendarManager {
  constructor() {
    this.bookings = [];
    this.currentMonth = this.getMonthStart(new Date());
    this.selectedDate = null;
    this.openDropdown = null;

    this.dom = {
      monthDropdown: document.querySelector('[data-calendar-dropdown="month"]'),
      yearDropdown: document.querySelector('[data-calendar-dropdown="year"]'),
      monthTrigger: document.getElementById("calendarMonthTrigger"),
      yearTrigger: document.getElementById("calendarYearTrigger"),
      monthValue: document.getElementById("calendarMonthValue"),
      yearValue: document.getElementById("calendarYearValue"),
      monthMenu: document.getElementById("calendarMonthMenu"),
      yearMenu: document.getElementById("calendarYearMenu"),
      prevMonthBtn: document.getElementById("calendarPrevMonth"),
      nextMonthBtn: document.getElementById("calendarNextMonth"),
      todayBtn: document.getElementById("calendarTodayBtn"),
      clearFiltersBtn: document.getElementById("calendarClearFiltersBtn"),
      searchFilter: document.getElementById("calendarSearch"),
      typeFilter: document.getElementById("calendarTypeFilter"),
      statusFilter: document.getElementById("calendarStatusFilter"),
      resultsNote: document.getElementById("calendarResultsNote"),
      monthBookingCount: document.getElementById("calendarMonthBookingCount"),
      todayCount: document.getElementById("calendarTodayCount"),
      upcomingCount: document.getElementById("calendarUpcomingCount"),
      selectedDateLabel: document.getElementById("calendarSelectedDateLabel"),
      dayTitle: document.getElementById("calendarDayTitle"),
      dayCount: document.getElementById("calendarDayCount"),
      grid: document.getElementById("bookingCalendarGrid"),
      dayList: document.getElementById("calendarDayList"),
    };

    this.handleDocumentClick = this.handleDocumentClick.bind(this);
    this.handleDocumentKeydown = this.handleDocumentKeydown.bind(this);
  }

  initUI() {
    this.initializeMonthControls();
    this.dom.prevMonthBtn?.addEventListener("click", () => this.changeMonth(-1));
    this.dom.nextMonthBtn?.addEventListener("click", () => this.changeMonth(1));
    this.dom.todayBtn?.addEventListener("click", () => this.jumpToToday());
    this.dom.clearFiltersBtn?.addEventListener("click", () => this.resetFilters());
    this.dom.searchFilter?.addEventListener("input", () => this.render());
    this.dom.typeFilter?.addEventListener("change", () => this.render());
    this.dom.statusFilter?.addEventListener("change", () => this.render());
    document.addEventListener("click", this.handleDocumentClick);
    document.addEventListener("keydown", this.handleDocumentKeydown);
  }

  setBookings(bookings) {
    this.bookings = Array.isArray(bookings) ? bookings : [];
    this.populateYearOptions();
    this.render();
  }

  initializeMonthControls() {
    this.populateMonthOptions();
    this.populateYearOptions();
    this.bindDropdownControls();
    this.syncMonthControls();
  }

  populateMonthOptions() {
    if (!this.dom.monthMenu || this.dom.monthMenu.childElementCount) return;

    const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long" });
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const option = this.createDropdownOption({
        value: monthIndex,
        label: monthFormatter.format(new Date(2026, monthIndex, 1)),
        onSelect: () => this.selectMonth(monthIndex),
      });
      this.dom.monthMenu.appendChild(option);
    }
  }

  populateYearOptions() {
    if (!this.dom.yearMenu) return;

    const bookingYears = this.bookings
      .map((booking) => this.getBookingDate(booking))
      .filter(Boolean)
      .map((date) => date.getFullYear());

    const currentYear = this.currentMonth.getFullYear();
    const fallbackYear = new Date().getFullYear();
    const minYear = Math.min(currentYear, fallbackYear, ...bookingYears, fallbackYear - 1);
    const maxYear = Math.max(currentYear, fallbackYear, ...bookingYears, fallbackYear + 2);

    this.dom.yearMenu.innerHTML = "";
    for (let year = minYear; year <= maxYear; year += 1) {
      const option = this.createDropdownOption({
        value: year,
        label: String(year),
        onSelect: () => this.selectYear(year),
      });
      this.dom.yearMenu.appendChild(option);
    }

    this.syncMonthControls();
  }

  bindDropdownControls() {
    this.dom.monthTrigger?.addEventListener("click", () => this.toggleDropdown("month"));
    this.dom.yearTrigger?.addEventListener("click", () => this.toggleDropdown("year"));
  }

  createDropdownOption({ value, label, onSelect }) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "calendar-dropdown__option";
    option.dataset.value = String(value);
    option.setAttribute("role", "option");
    option.textContent = label;
    option.addEventListener("click", onSelect);
    return option;
  }

  changeMonth(offset) {
    this.currentMonth = new Date(
      this.currentMonth.getFullYear(),
      this.currentMonth.getMonth() + offset,
      1
    );
    this.selectedDate = null;
    this.closeDropdowns();
    this.render();
  }

  selectMonth(monthIndex) {
    if (!Number.isInteger(monthIndex)) return;
    this.currentMonth = new Date(this.currentMonth.getFullYear(), monthIndex, 1);
    this.selectedDate = null;
    this.closeDropdowns();
    this.render();
  }

  selectYear(year) {
    if (!Number.isInteger(year)) return;
    this.currentMonth = new Date(year, this.currentMonth.getMonth(), 1);
    this.selectedDate = null;
    this.closeDropdowns();
    this.render();
  }

  jumpToToday() {
    const today = new Date();
    this.currentMonth = this.getMonthStart(today);
    this.selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    this.closeDropdowns();
    this.render();
  }

  resetFilters() {
    if (this.dom.searchFilter) this.dom.searchFilter.value = "";
    if (this.dom.typeFilter) this.dom.typeFilter.value = "all";
    if (this.dom.statusFilter) this.dom.statusFilter.value = "all";
    this.render();
  }

  render() {
    if (!this.dom.grid || !this.dom.dayList) return;

    const filteredBookings = this.getFilteredBookings();
    this.ensureSelectedDate(filteredBookings);
    this.renderMonthHeader();
    this.renderGrid(filteredBookings);
    this.renderSummary(filteredBookings);
    this.renderDayList(filteredBookings);
  }

  getMonthStart(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  getBookingDate(booking) {
    return (
      AppUtils.parseDate(booking?.date || booking?.seminarDate) ||
      AppUtils.parseTimestamp(booking?.timestamp) ||
      AppUtils.parseTimestamp(booking?.createdAt)
    );
  }

  normalizeStatus(status) {
    return AppUtils.normalizeStatusKey(status);
  }

  getFilteredBookings() {
    const searchTerm = String(this.dom.searchFilter?.value || "")
      .trim()
      .toLowerCase();
    const typeFilter = this.dom.typeFilter?.value || "all";
    const statusFilter = this.dom.statusFilter?.value || "all";

    return this.bookings.filter((booking) => {
      if (searchTerm && !AppUtils.getSearchableText(booking).includes(searchTerm)) {
        return false;
      }

      const type = String(booking?.bookingType || "popup").toLowerCase();
      if (typeFilter !== "all" && type !== typeFilter) return false;

      if (statusFilter === "all") return true;

      const normalizedStatus = this.normalizeStatus(booking?.status);
      if (statusFilter === "completed") return AppUtils.isCompletedStatus(normalizedStatus);
      if (statusFilter === "pending") return normalizedStatus.startsWith("pending");
      if (statusFilter === "declined") {
        return normalizedStatus === "declined" || normalizedStatus === "rejected";
      }
      if (statusFilter === "cancelled") return normalizedStatus.includes("cancel");
      return normalizedStatus === statusFilter;
    });
  }

  ensureSelectedDate(bookings) {
    if (
      this.selectedDate &&
      this.selectedDate.getFullYear() === this.currentMonth.getFullYear() &&
      this.selectedDate.getMonth() === this.currentMonth.getMonth()
    ) {
      return;
    }

    const monthBookings = bookings
      .filter((booking) => {
        const date = this.getBookingDate(booking);
        return (
          date &&
          date.getFullYear() === this.currentMonth.getFullYear() &&
          date.getMonth() === this.currentMonth.getMonth()
        );
      })
      .sort((a, b) => this.getBookingDate(a) - this.getBookingDate(b));

    const today = new Date();
    const todayInCurrentMonth =
      today.getFullYear() === this.currentMonth.getFullYear() &&
      today.getMonth() === this.currentMonth.getMonth();

    const todayBookings = todayInCurrentMonth
      ? monthBookings.filter((booking) => AppUtils.isSameDay(this.getBookingDate(booking), today))
      : [];

    if (todayBookings.length) {
      this.selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      return;
    }

    if (
      todayInCurrentMonth &&
      !monthBookings.length
    ) {
      this.selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      return;
    }

    const firstBookingDate = monthBookings.length ? this.getBookingDate(monthBookings[0]) : null;
    if (firstBookingDate) {
      this.selectedDate = new Date(
        firstBookingDate.getFullYear(),
        firstBookingDate.getMonth(),
        firstBookingDate.getDate()
      );
      return;
    }

    this.selectedDate = new Date(
      this.currentMonth.getFullYear(),
      this.currentMonth.getMonth(),
      1
    );
  }

  renderMonthHeader() {
    this.syncMonthControls();
  }

  syncMonthControls() {
    const currentMonthValue = String(this.currentMonth.getMonth());
    const currentYearValue = String(this.currentMonth.getFullYear());

    if (this.dom.monthValue) {
      this.dom.monthValue.textContent = this.currentMonth.toLocaleDateString("en-US", {
        month: "long",
      });
    }

    if (this.dom.yearValue) {
      this.dom.yearValue.textContent = currentYearValue;
    }

    const hasYear = Array.from(this.dom.yearMenu?.children || []).some(
      (option) => option.dataset.value === currentYearValue
    );
    if (!hasYear) {
      this.populateYearOptions();
      return;
    }

    this.updateDropdownSelection(this.dom.monthMenu, currentMonthValue);
    this.updateDropdownSelection(this.dom.yearMenu, currentYearValue);
  }

  updateDropdownSelection(menu, selectedValue) {
    if (!menu) return;

    Array.from(menu.children).forEach((option) => {
      const isSelected = option.dataset.value === selectedValue;
      option.classList.toggle("is-selected", isSelected);
      option.setAttribute("aria-selected", isSelected ? "true" : "false");
    });
  }

  toggleDropdown(type) {
    if (this.openDropdown === type) {
      this.closeDropdown(type);
      return;
    }

    this.openDropdownMenu(type);
  }

  openDropdownMenu(type) {
    const config = this.getDropdownConfig(type);
    if (!config?.container || !config?.trigger || !config?.menu) return;

    this.closeDropdowns();
    this.openDropdown = type;
    config.container.classList.add("is-open");
    config.trigger.setAttribute("aria-expanded", "true");
    config.menu.hidden = false;
  }

  closeDropdown(type) {
    const config = this.getDropdownConfig(type);
    if (!config?.container || !config?.trigger || !config?.menu) return;

    config.container.classList.remove("is-open");
    config.trigger.setAttribute("aria-expanded", "false");
    config.menu.hidden = true;
    if (this.openDropdown === type) {
      this.openDropdown = null;
    }
  }

  closeDropdowns() {
    this.closeDropdown("month");
    this.closeDropdown("year");
  }

  getDropdownConfig(type) {
    if (type === "month") {
      return {
        container: this.dom.monthDropdown,
        trigger: this.dom.monthTrigger,
        menu: this.dom.monthMenu,
      };
    }

    if (type === "year") {
      return {
        container: this.dom.yearDropdown,
        trigger: this.dom.yearTrigger,
        menu: this.dom.yearMenu,
      };
    }

    return null;
  }

  handleDocumentClick(event) {
    const target = event.target;
    if (
      this.dom.monthDropdown?.contains(target) ||
      this.dom.yearDropdown?.contains(target)
    ) {
      return;
    }

    this.closeDropdowns();
  }

  handleDocumentKeydown(event) {
    if (event.key === "Escape") {
      this.closeDropdowns();
    }
  }

  getDayBookings(targetDate, bookings) {
    return bookings.filter((booking) => {
      const bookingDate = this.getBookingDate(booking);
      return AppUtils.isSameDay(bookingDate, targetDate);
    });
  }

  getTypeShortLabel(type) {
    if (type === "event") return "EVT";
    if (type === "seminar") return "WKS";
    return "POP";
  }

  buildDayCell(date, bookings) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";

    const isToday = AppUtils.isSameDay(date, new Date());
    const isSelected = AppUtils.isSameDay(date, this.selectedDate);
    if (isToday) button.classList.add("is-today");
    if (isSelected) button.classList.add("is-selected");
    if (bookings.length) button.classList.add("has-bookings");

    const dayNumber = document.createElement("span");
    dayNumber.className = "calendar-day__number";
    dayNumber.textContent = String(date.getDate());

    const details = document.createElement("div");
    details.className = "calendar-day__details";

    if (bookings.length) {
      const total = document.createElement("span");
      total.className = "calendar-day__count";
      total.textContent = `${bookings.length} booking${bookings.length === 1 ? "" : "s"}`;
      details.appendChild(total);

      const chipRow = document.createElement("div");
      chipRow.className = "calendar-day__chips";

      const uniqueTypes = [...new Set(bookings.map((booking) => booking.bookingType || "popup"))];
      uniqueTypes.slice(0, 2).forEach((type) => {
        const chip = document.createElement("span");
        chip.className = `calendar-day__chip ${type}`;
        chip.textContent = this.getTypeShortLabel(type);
        chipRow.appendChild(chip);
      });

      if (uniqueTypes.length > 2) {
        const overflow = document.createElement("span");
        overflow.className = "calendar-day__chip more";
        overflow.textContent = `+${uniqueTypes.length - 2}`;
        chipRow.appendChild(overflow);
      }

      details.appendChild(chipRow);
    }

    button.append(dayNumber, details);
    button.addEventListener("click", () => {
      this.selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      this.render();
    });

    return button;
  }

  renderGrid(bookings) {
    this.dom.grid.innerHTML = "";

    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const leadingDays = firstDayOfMonth.getDay();

    for (let index = 0; index < leadingDays; index += 1) {
      const spacer = document.createElement("div");
      spacer.className = "calendar-day calendar-day--spacer";
      spacer.setAttribute("aria-hidden", "true");
      this.dom.grid.appendChild(spacer);
    }

    for (let day = 1; day <= lastDayOfMonth.getDate(); day += 1) {
      const date = new Date(year, month, day);
      const dayBookings = this.getDayBookings(date, bookings);
      this.dom.grid.appendChild(this.buildDayCell(date, dayBookings));
    }
  }

  renderSummary(bookings) {
    const monthBookings = bookings.filter((booking) => {
      const date = this.getBookingDate(booking);
      return (
        date &&
        date.getFullYear() === this.currentMonth.getFullYear() &&
        date.getMonth() === this.currentMonth.getMonth()
      );
    });

    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const nextWeekEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);

    const todayBookings = bookings.filter((booking) =>
      AppUtils.isSameDay(this.getBookingDate(booking), todayStart)
    );

    const upcomingBookings = bookings.filter((booking) => {
      const date = this.getBookingDate(booking);
      return date && date >= todayStart && date < nextWeekEnd;
    });

    if (this.dom.monthBookingCount) {
      this.dom.monthBookingCount.textContent = String(monthBookings.length);
    }
    if (this.dom.todayCount) {
      this.dom.todayCount.textContent = String(todayBookings.length);
    }
    if (this.dom.upcomingCount) {
      this.dom.upcomingCount.textContent = String(upcomingBookings.length);
    }
    if (this.dom.selectedDateLabel) {
      this.dom.selectedDateLabel.textContent = this.selectedDate
        ? this.selectedDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "No date selected";
    }

    if (this.dom.resultsNote) {
      const searchTerm = String(this.dom.searchFilter?.value || "").trim();
      const typeLabel = this.dom.typeFilter?.value || "all";
      const statusLabel = this.dom.statusFilter?.value || "all";

      const filters = [];
      if (typeLabel !== "all") {
        filters.push(AppUtils.getTypeLabel(typeLabel));
      }
      if (statusLabel !== "all") {
        filters.push(AppUtils.getStatusLabel(statusLabel));
      }
      if (searchTerm) {
        filters.push(`matching "${searchTerm}"`);
      }

      const monthLabel = this.currentMonth.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });

      const suffix = filters.length ? ` for ${filters.join(", ")}` : "";
      this.dom.resultsNote.textContent = `Showing ${monthBookings.length} booking${
        monthBookings.length === 1 ? "" : "s"
      } in ${monthLabel}${suffix}.`;
    }

    if (this.dom.clearFiltersBtn) {
      const hasActiveFilters =
        Boolean(String(this.dom.searchFilter?.value || "").trim()) ||
        (this.dom.typeFilter?.value || "all") !== "all" ||
        (this.dom.statusFilter?.value || "all") !== "all";
      this.dom.clearFiltersBtn.disabled = !hasActiveFilters;
    }
  }

  getBookingTitle(booking) {
    const type = booking?.bookingType || "popup";
    if (type === "event") {
      if (booking?.packageName) return `Event: ${booking.packageName}`;
      return booking?.eventTitle || "Event Booking";
    }
    if (type === "seminar") {
      return booking?.seminarTitle || "Workshop Booking";
    }
    return booking?.popupTitle || "Popup Invitation";
  }

  renderDayList(bookings) {
    const selectedDate = this.selectedDate;
    const dayBookings = selectedDate ? this.getDayBookings(selectedDate, bookings) : [];

    if (this.dom.dayTitle) {
      this.dom.dayTitle.textContent = selectedDate
        ? selectedDate.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })
        : "Select a day";
    }

    if (this.dom.dayCount) {
      this.dom.dayCount.textContent = `${dayBookings.length} booking${dayBookings.length === 1 ? "" : "s"}`;
    }

    this.dom.dayList.innerHTML = "";

    if (!dayBookings.length) {
      const empty = document.createElement("div");
      empty.className = "calendar-empty";
      empty.textContent = "No bookings scheduled for the selected day.";
      this.dom.dayList.appendChild(empty);
      return;
    }

    dayBookings
      .sort((first, second) => {
        const timeA = this.getBookingTimeSortValue(first);
        const timeB = this.getBookingTimeSortValue(second);
        if (timeA !== timeB) return timeA - timeB;

        const dateA = this.getBookingDate(first);
        const dateB = this.getBookingDate(second);
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateA - dateB;
      })
      .forEach((booking) => {
        const card = document.createElement("article");
        card.className = "calendar-booking-card";

        const header = document.createElement("div");
        header.className = "calendar-booking-card__header";

        const headerMeta = document.createElement("div");
        headerMeta.className = "calendar-booking-card__badges";

        const bookingTime = booking.timeRange || booking.seminarTime || booking.time || "No time set";
        const timeBadge = document.createElement("span");
        timeBadge.className = "calendar-booking-card__time";
        timeBadge.textContent = bookingTime;

        const typeBadge = document.createElement("span");
        typeBadge.className = `type-badge ${booking.bookingType || "popup"}`;
        typeBadge.textContent = AppUtils.getTypeLabel(booking.bookingType || "popup").toUpperCase();

        const status = document.createElement("span");
        const normalizedStatus = this.normalizeStatus(booking.status);
        let statusClass = normalizedStatus || "pending";
        if (statusClass.startsWith("pending")) statusClass = "pending";
        if (AppUtils.isCompletedStatus(statusClass)) statusClass = "completed";
        if (statusClass === "rejected") statusClass = "declined";
        if (statusClass.includes("cancel")) statusClass = "cancelled";
        status.className = `status ${statusClass}`;
        status.textContent = AppUtils.getStatusLabel(booking.status);

        headerMeta.append(timeBadge, typeBadge);
        header.append(headerMeta, status);

        const title = document.createElement("h4");
        title.textContent = this.getBookingTitle(booking);

        const metaList = document.createElement("div");
        metaList.className = "calendar-booking-card__meta-list";

        const client = document.createElement("p");
        client.textContent = `Client: ${booking.userName || booking.userEmail || "Unknown"}`;

        const reference = document.createElement("p");
        reference.textContent = `Ref: ${AppUtils.getBookingReference(booking)}`;

        const location = document.createElement("p");
        location.textContent = `Location: ${AppUtils.getLocationSummary(booking) || "Not specified"}`;

        const actions = document.createElement("div");
        actions.className = "calendar-booking-card__actions";

        const viewButton = document.createElement("button");
        viewButton.type = "button";
        viewButton.className = "btn view";
        viewButton.textContent = "Open Details";
        viewButton.addEventListener("click", () => {
          window.dashboardApp?.bookingManager?.openDetails?.(booking.id);
        });

        metaList.append(client, reference, location);
        actions.appendChild(viewButton);
        card.append(header, title, metaList, actions);
        this.dom.dayList.appendChild(card);
      });
  }

  getBookingTimeSortValue(booking) {
    const rawTime = String(booking?.timeRange || booking?.seminarTime || booking?.time || "").trim();
    if (!rawTime) return Number.POSITIVE_INFINITY;

    const match = rawTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return Number.POSITIVE_INFINITY;

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const meridiem = String(match[3] || "").toUpperCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return Number.POSITIVE_INFINITY;
    }

    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;

    return (hours * 60) + minutes;
  }
}
