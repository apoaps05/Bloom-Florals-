import { auth, db } from "./firebase.js";
import {
  setText,
  setHidden,
  normalizeStatus,
  normalizeStatusKey,
  parseDateValue,
  formatDateValue,
  formatStatusLabel,
  sanitizeAssetUrl
} from "./utils.js";
import { showAlert } from "../dialogs.js";
import { getBookingReferencePrefix } from "../shared-booking-logic.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

class BookingDataService {
  constructor({ dbInstance }) {
    this.db = dbInstance;
  }

  async getBookingById(bookingId) {
    const bookingRef = doc(this.db, "bookings", bookingId);
    const snapshot = await getDoc(bookingRef);
    if (!snapshot.exists()) return null;
    return { id: snapshot.id, ...snapshot.data() };
  }

  subscribeToUserBookings(userId, onNext, onError) {
    const bookingsRef = collection(this.db, "bookings");
    const bookingsQuery = query(bookingsRef, where("userId", "==", userId));
    return onSnapshot(bookingsQuery, onNext, onError);
  }

  async cancelBooking(bookingId, payload) {
    await updateDoc(doc(this.db, "bookings", bookingId), payload);
  }
}

class ProfileBookingsController {
  constructor({ authInstance, dataService }) {
    this.auth = authInstance;
    this.dataService = dataService;
    this.dom = {
      detailsModalEl: document.getElementById("detailsModal"),
      closeDetailsModalEl: document.getElementById("closeModal"),
      modalTitleEl: document.getElementById("modalTitle"),
      modalProofSectionEl: document.getElementById("modalProofSection"),
      modalProofImageEl: document.getElementById("modalProofImage"),
      modalProofLinkEl: document.getElementById("modalProofLink"),
      modalProofNameEl: document.getElementById("modalProofName"),
      cancelModalEl: document.getElementById("cancelModal"),
      closeCancelModalEl: document.getElementById("closeCancelModal"),
      backBtnEl: document.getElementById("backBtn"),
      confirmCancelEl: document.getElementById("confirmCancel"),
      openCancelModalEl: document.getElementById("openCancelModal"),
      payNowBtnEl: document.getElementById("payNowBtn"),
      bookingsSectionEl: document.getElementById("bookings"),
      bookingsOngoingEl: document.getElementById("bookingOngoing"),
      bookingsPastEl: document.getElementById("bookingPast"),
      bookingsEmptyEl: document.getElementById("bookingsEmpty"),
      bookingsLoadingEl: document.getElementById("bookingsLoading"),
      ongoingGroupEl: document.getElementById("ongoingGroup"),
      pastGroupEl: document.getElementById("pastGroup"),
      ongoingCountEl: document.getElementById("ongoingCount"),
      pastCountEl: document.getElementById("pastCount"),
      bookingTabOngoingEl: document.getElementById("bookingTabOngoing"),
      bookingTabDoneEl: document.getElementById("bookingTabDone"),
      bookingSearchEl: document.getElementById("bookingSearch"),
      bookingTypeFilterEl: document.getElementById("bookingTypeFilter"),
      bookingStatusFilterEl: document.getElementById("bookingStatusFilter"),
      bookingClearFiltersEl: document.getElementById("bookingClearFilters"),
      markAllReadBtnEl: document.getElementById("markAllReadBtn"),
      notificationListEl: document.getElementById("notificationList"),
      notificationEmptyEl: document.getElementById("notificationEmpty"),
      notifBadgeEl: document.getElementById("notifBadge")
    };
    this.state = {
      activeBookingId: null,
      pendingBookingFocusId: null,
      bookingCache: new Map(),
      bookingUnsub: null,
      currentUserId: null,
      latestBookings: [],
      bookingView: "ongoing",
      currentNotifications: []
    };
  }

  ensureBookingAccess(user) {
    return ensureBookingAccessImpl(user, this.auth, this.dataService);
  }

  clearBookingState() {
    return clearBookingStateImpl();
  }

  startBookingListener(user) {
    return startBookingListenerImpl(user, this.dataService);
  }

  initBookings() {
    return initBookingsImpl(this.auth, this.dataService);
  }

  handleSignedOut() {
    return handleSignedOutImpl();
  }
}

const getControllerState = () => profileBookingsController.state;
const getControllerDom = () => profileBookingsController.dom;

const getBookingIdFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("bookingId") || params.get("id");
};

const getReturnPath = () => {
  const path = window.location.pathname.split("/").pop() || "profile.html";
  const search = window.location.search || "";
  const hash = window.location.hash || "";
  return `${path}${search}${hash}`;
};

const redirectToLogin = (returnTo = "") => {
  const target = returnTo
    ? `login-register.html?redirect=${encodeURIComponent(returnTo)}`
    : "login-register.html";
  window.location.href = target;
};

const ensureBookingAccessImpl = async (user, authInstance, dataService) => {
  const bookingId = getBookingIdFromUrl();
  if (!bookingId) return;

  try {
    const record = await dataService.getBookingById(bookingId);
    if (!record) {
      await showAlert("Booking not found.");
      return;
    }

    if (!record?.userId || record.userId !== user.uid) {
      await showAlert("Please sign in with your account to access this booking.");
      try {
        await signOut(authInstance);
      } catch (error) {
        console.error("Failed to sign out:", error);
      }
      redirectToLogin(getReturnPath());
      return;
    }

    getControllerState().pendingBookingFocusId = bookingId;
  } catch (error) {
    console.error("Failed to verify booking access:", error);
  }
};

const getTimestampMs = (booking) => {
  const ts = booking?.timestamp;
  if (!ts) return 0;
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return 0;
};

const getEventDateMs = (booking) => {
  const date = parseDateValue(booking?.date || booking?.seminarDate);
  return date ? date.getTime() : 0;
};

const getSortKey = (booking) => getEventDateMs(booking) || getTimestampMs(booking);

const isCancelledStatus = (status) =>
  status.includes("cancel") || status.includes("declined") || status.includes("rejected");

const isCompletedStatus = (status) => {
  const key = normalizeStatusKey(status);
  return (
    key === "approved" ||
    key === "accepted" ||
    key === "completed" ||
    key === "confirmed"
  );
};

const isAwaitingPaymentExpired = (booking) => {
  const statusKey = normalizeStatusKey(booking?.status);
  if (statusKey !== "awaiting_payment") return false;

  const paymentDueAt = parseDateValue(booking?.paymentDueAt);
  if (!paymentDueAt) return false;

  return paymentDueAt.getTime() <= Date.now();
};

const isPastBooking = (booking) => {
  const status = normalizeStatus(booking?.status);
  if (isCancelledStatus(status)) return true;
  if (isCompletedStatus(status)) return true;
  if (isAwaitingPaymentExpired(booking)) return true;
  const eventDate = parseDateValue(booking?.date || booking?.seminarDate);
  if (!eventDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const normalizedDate = new Date(eventDate);
  normalizedDate.setHours(0, 0, 0, 0);
  return normalizedDate < today;
};

const getStatusPresentation = (booking) => {
  const status = normalizeStatus(booking?.status);
  if (isAwaitingPaymentExpired(booking)) {
    return { label: "Expired", className: "cancelled" };
  }
  if (status.includes("declined") || status.includes("rejected")) {
    return { label: "Declined", className: "cancelled" };
  }
  if (status.includes("cancel")) {
    return { label: "Cancelled", className: "cancelled" };
  }
  if (isCompletedStatus(status)) {
    return { label: "Completed", className: "completed" };
  }
  if (isPastBooking(booking)) {
    return { label: "Completed", className: "completed" };
  }
  if (status) {
    return { label: formatStatusLabel(status), className: "upcoming" };
  }
  return { label: "Upcoming", className: "upcoming" };
};

const getBookingTitle = (booking) => {
  if (booking?.bookingType === "seminar") return booking.seminarTitle || "Workshop Booking";
  if (booking?.bookingType === "event") {
    if (booking.packageName) return `Event: ${booking.packageName}`;
    return booking.eventTitle || "Event Booking";
  }
  if (booking?.bookingType === "popup") return booking.popupTitle || "Pop-up Booking";
  return booking?.eventTitle || booking?.popupTitle || "Booking";
};

const getBookingReference = (booking) => {
  const ref = String(
    booking?.bookingRef || booking?.reference || booking?.referenceNumber || ""
  ).trim();
  if (ref) return ref;
  if (booking?.id) {
    const prefix = getBookingReferencePrefix(booking?.bookingType);
    return `${prefix}-${String(booking.id).slice(0, 8).toUpperCase()}`;
  }
  return "";
};

const getBookingDateTime = (booking) => {
  const dateLabel = formatDateValue(booking?.date || booking?.seminarDate);
  const timeLabel = booking?.timeRange || booking?.seminarTime || booking?.time || "";
  return timeLabel ? `${dateLabel} - ${timeLabel}` : dateLabel;
};

const getLocationSummary = (booking) => {
  if (booking?.seminarLocation) return booking.seminarLocation;
  const location = booking?.location || {};
  const locationName = (location.name || "").trim();
  const city = (location.city || "").trim();
  const province = (location.province || "").trim();
  const tail = [city, province].filter(Boolean).join(", ");
  if (locationName && tail) return `${locationName} - ${tail}`;
  return locationName || tail || "";
};

const getBookingDescription = (booking) => {
  const notes = (booking?.notes || booking?.location?.notes || "").trim();
  if (booking?.bookingType === "seminar") {
    const payment = booking?.paymentStatus
      ? `Payment: ${formatStatusLabel(booking.paymentStatus)}.`
      : "";
    const title = booking?.seminarTitle ? `Workshop: ${booking.seminarTitle}.` : "";
    return [title, payment, notes ? `Notes: ${notes}` : ""].filter(Boolean).join(" ");
  }
  if (booking?.bookingType === "event") {
    const packageName = booking?.packageName ? `Package: ${booking.packageName}.` : "Event booking.";
    const pax = booking?.packagePax ? `Pax: ${booking.packagePax}.` : "";
    const flowers =
      Array.isArray(booking?.selectedFlowerNames) && booking.selectedFlowerNames.length
        ? `Flowers: ${booking.selectedFlowerNames.join(", ")}.`
        : "";
    const inclusions = booking?.packageInclusions ? `${booking.packageInclusions}.` : "";
    return [packageName, pax, inclusions, flowers, notes ? `Notes: ${notes}` : ""]
      .filter(Boolean)
      .join(" ");
  }
  return notes ? `Notes: ${notes}` : "Pop-up booking request.";
};

const getCurrentBookingFilters = () => ({
  search: (getControllerDom().bookingSearchEl?.value || "").trim().toLowerCase(),
  type: getControllerDom().bookingTypeFilterEl?.value || "all",
  status: getControllerDom().bookingStatusFilterEl?.value || "all"
});

const hasActiveBookingFilters = (filters) =>
  Boolean(filters.search) || filters.type !== "all" || filters.status !== "all";

const bookingStatusOptions = {
  ongoing: [
    { value: "all", label: "All Status" },
    { value: "pending", label: "Pending" },
    { value: "awaiting_payment", label: "Awaiting Payment" },
    { value: "payment_submitted", label: "Payment Submitted" }
  ],
  done: [
    { value: "all", label: "All Status" },
    { value: "completed", label: "Completed" },
    { value: "expired", label: "Expired" },
    { value: "declined", label: "Declined" },
    { value: "cancelled", label: "Cancelled" }
  ]
};

const updateStatusFilterOptions = (view) => {
  if (!getControllerDom().bookingStatusFilterEl) return;

  const options = bookingStatusOptions[view] || bookingStatusOptions.ongoing;
  const current = getControllerDom().bookingStatusFilterEl.value;

  getControllerDom().bookingStatusFilterEl.innerHTML = "";
  options.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    getControllerDom().bookingStatusFilterEl.appendChild(opt);
  });

  const isValidSelection = options.some((option) => option.value === current);
  getControllerDom().bookingStatusFilterEl.value = isValidSelection ? current : "all";
};

const matchesBookingStatusFilter = (booking, filterValue) => {
  const filterKey = normalizeStatusKey(filterValue);
  if (!filterKey || filterKey === "all") return true;

  const statusKey = normalizeStatusKey(booking?.status);

  if (filterKey === "completed") {
    return getStatusPresentation(booking).label === "Completed";
  }
  if (filterKey === "declined") {
    return statusKey === "declined" || statusKey === "rejected";
  }
  if (filterKey === "cancelled") {
    return statusKey.includes("cancel") || isAwaitingPaymentExpired(booking);
  }
  if (filterKey === "expired") {
    return isAwaitingPaymentExpired(booking);
  }
  if (filterKey === "pending") {
    return !statusKey || statusKey.startsWith("pending");
  }
  if (filterKey === "awaiting_payment") {
    return statusKey === "awaiting_payment" && !isAwaitingPaymentExpired(booking);
  }
  if (filterKey === "payment_submitted") {
    return statusKey === "payment_submitted";
  }
  return statusKey === filterKey;
};

const getBookingSearchText = (booking) => {
  const searchValues = [
    getBookingTitle(booking),
    getBookingReference(booking),
    getBookingDateTime(booking),
    getLocationSummary(booking),
    booking?.packageName,
    booking?.seminarTitle,
    booking?.bookingType
  ]
    .filter(Boolean)
    .join(" ");
  return searchValues.toLowerCase();
};

const matchesBookingFilters = (booking, filters) => {
  if (!booking) return false;

  if (filters.type && filters.type !== "all") {
    const typeKey = normalizeStatusKey(booking?.bookingType);
    if (typeKey !== normalizeStatusKey(filters.type)) return false;
  }

  if (!matchesBookingStatusFilter(booking, filters.status)) return false;

  if (filters.search) {
    const haystack = getBookingSearchText(booking);
    if (!haystack.includes(filters.search)) return false;
  }

  return true;
};

const getBookingEmptyMessage = (filters, view, viewCount, totalCount) => {
  if (totalCount === 0) return "No bookings yet.";
  const label = view === "ongoing" ? "ongoing" : "completed";
  if (viewCount === 0 && hasActiveBookingFilters(filters)) {
    return `No ${label} bookings match your filters.`;
  }
  if (viewCount === 0) {
    return `No ${label} bookings yet.`;
  }
  return "";
};

const canCancelBooking = (booking) => {
  const status = normalizeStatus(booking?.status);
  const statusKey = normalizeStatusKey(booking?.status);
  const paymentStatusKey = normalizeStatusKey(booking?.paymentStatus);

  if (isAwaitingPaymentExpired(booking)) return false;
  if (isCancelledStatus(status)) return false;
  if (isCompletedStatus(status)) return false;
  if (statusKey === "payment_submitted") return false;
  if (paymentStatusKey === "submitted" || paymentStatusKey === "approved") return false;

  const eventDate = parseDateValue(booking?.date || booking?.seminarDate);
  if (eventDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const normalizedDate = new Date(eventDate);
    normalizedDate.setHours(0, 0, 0, 0);
    if (normalizedDate < today) return false;
  }
  return true;
};

const sentenceCase = (label) =>
  label ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;

const getNotificationStorageKey = (userId) =>
  userId ? `bloom.notifications.read.${userId}` : "bloom.notifications.read";

const getNotificationReadState = (userId) => {
  if (!userId || typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(getNotificationStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("Failed to load notification state:", error);
    return {};
  }
};

const setNotificationReadState = (userId, state) => {
  if (!userId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(getNotificationStorageKey(userId), JSON.stringify(state));
  } catch (error) {
    console.error("Failed to save notification state:", error);
  }
};

const getNotificationTimestamp = (booking) => {
  const status = normalizeStatus(booking?.status);
  if (isCancelledStatus(status)) {
    const cancelledAt = parseDateValue(booking?.cancelledAt);
    if (cancelledAt) return cancelledAt;
  }

  const createdAt = parseDateValue(booking?.timestamp);
  if (createdAt) return createdAt;

  return parseDateValue(booking?.date || booking?.seminarDate);
};

const formatRelativeTime = (date) => {
  if (!date) return "";
  const diffMs = Date.now() - date.getTime();

  if (diffMs < 0) {
    const days = Math.ceil(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
    if (days < 7) return `In ${days} day${days === 1 ? "" : "s"}`;
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return "Just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
};

const getNotificationIcon = (status) => {
  if (isCancelledStatus(status)) return "X";
  if (isCompletedStatus(status)) return "OK";
  if (status.includes("awaiting") || status.includes("payment")) return "!";
  if (!status || status.includes("pending")) return "N";
  return "I";
};

const buildNotificationMessage = (booking) => {
  const title = getBookingTitle(booking);
  const reference = getBookingReference(booking);
  const referenceLabel = reference || "";
  const status = normalizeStatus(booking?.status);
  const statusPresentation = getStatusPresentation(booking);
  const statusLabel = statusPresentation.label;
  const sentenceLabel = sentenceCase(statusLabel);
  const baseMessage = { title, reference: referenceLabel };

  if (!status || status.includes("pending")) {
    return { ...baseMessage, prefix: "We received your booking request for ", suffix: "." };
  }

  if (isCancelledStatus(status)) {
    return { ...baseMessage, prefix: "Your booking for ", suffix: ` was ${sentenceLabel}.` };
  }

  if (statusPresentation.label === "Completed") {
    return { ...baseMessage, prefix: "Good news! Your booking for ", suffix: ` is ${sentenceLabel}.` };
  }

  if (status.includes("awaiting") || status.includes("payment")) {
    return { ...baseMessage, prefix: "Payment update for ", suffix: `: ${statusLabel}.` };
  }

  return { ...baseMessage, prefix: "Update for ", suffix: `: ${statusLabel}.` };
};

const buildNotificationItem = (notification) => {
  const item = document.createElement("div");
  item.className = "notification-item";
  if (notification.unread) item.classList.add("unread");
  item.dataset.notificationId = notification.id;

  const icon = document.createElement("div");
  icon.className = "notification-icon";
  icon.textContent = notification.icon || "I";

  const content = document.createElement("div");
  content.className = "notification-content";

  const text = document.createElement("p");
  text.className = "notification-text";

  if (notification.message) {
    text.append(document.createTextNode(notification.message.prefix || ""));
    if (notification.message.title) {
      const strong = document.createElement("strong");
      strong.textContent = notification.message.title;
      text.appendChild(strong);
    }
    if (notification.message.reference) {
      text.append(document.createTextNode(` (Ref: ${notification.message.reference})`));
    }
    text.append(document.createTextNode(notification.message.suffix || ""));
  } else {
    text.textContent = "You have a new update.";
  }

  const time = document.createElement("span");
  time.className = "notification-time";
  time.textContent = notification.timeLabel || "";

  content.append(text, time);
  item.append(icon, content);

  return item;
};

const buildNotifications = (bookings = []) =>
  bookings
    .filter((booking) => booking && booking.id)
    .map((booking) => {
      const status = normalizeStatus(booking?.status);
      const statusKey = status || "pending";
      const paymentKey = normalizeStatus(booking?.paymentStatus);
      const id = `${booking.id}:${statusKey}${paymentKey ? `:${paymentKey}` : ""}`;
      const timestamp = getNotificationTimestamp(booking);
      return {
        id,
        status,
        icon: getNotificationIcon(status),
        timestamp,
        timeLabel: formatRelativeTime(timestamp),
        message: buildNotificationMessage(booking)
      };
    })
    .sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0))
    .slice(0, 20);

const clearNotifications = () => {
  getControllerState().currentNotifications = [];
  if (getControllerDom().notificationListEl) getControllerDom().notificationListEl.innerHTML = "";
  if (getControllerDom().notificationEmptyEl) getControllerDom().notificationEmptyEl.hidden = true;
  if (getControllerDom().notifBadgeEl) getControllerDom().notifBadgeEl.hidden = true;
  if (getControllerDom().markAllReadBtnEl) getControllerDom().markAllReadBtnEl.disabled = true;
};

const renderNotifications = (bookings = []) => {
  if (!getControllerDom().notificationListEl) return;

  const notifications = buildNotifications(bookings);
  getControllerState().currentNotifications = notifications;

  getControllerDom().notificationListEl.innerHTML = "";

  if (!notifications.length) {
    if (getControllerDom().notificationEmptyEl) getControllerDom().notificationEmptyEl.hidden = false;
    if (getControllerDom().notifBadgeEl) getControllerDom().notifBadgeEl.hidden = true;
    if (getControllerDom().markAllReadBtnEl) getControllerDom().markAllReadBtnEl.disabled = true;
    return;
  }

  if (getControllerDom().notificationEmptyEl) getControllerDom().notificationEmptyEl.hidden = true;

  const readState = getNotificationReadState(getControllerState().currentUserId);
  let unreadCount = 0;

  notifications.forEach((notification) => {
    const unread = !readState[notification.id];
    if (unread) unreadCount += 1;
    getControllerDom().notificationListEl.appendChild(buildNotificationItem({ ...notification, unread }));
  });

  if (getControllerDom().notifBadgeEl) {
    if (unreadCount > 0) {
      getControllerDom().notifBadgeEl.hidden = false;
      getControllerDom().notifBadgeEl.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    } else {
      getControllerDom().notifBadgeEl.hidden = true;
    }
  }

  if (getControllerDom().markAllReadBtnEl) getControllerDom().markAllReadBtnEl.disabled = unreadCount === 0;
};

const markNotificationRead = (notificationId) => {
  if (!getControllerState().currentUserId || !notificationId) return;
  const state = getNotificationReadState(getControllerState().currentUserId);
  if (state[notificationId]) return;
  state[notificationId] = true;
  setNotificationReadState(getControllerState().currentUserId, state);
  renderNotifications(getControllerState().latestBookings);
};

const markAllNotificationsRead = () => {
  if (!getControllerState().currentUserId || !getControllerState().currentNotifications.length) return;
  const state = getNotificationReadState(getControllerState().currentUserId);
  getControllerState().currentNotifications.forEach((notification) => {
    state[notification.id] = true;
  });
  setNotificationReadState(getControllerState().currentUserId, state);
  renderNotifications(getControllerState().latestBookings);
};

const updateBookingCounts = (ongoingCountValue, pastCountValue) => {
  if (getControllerDom().ongoingCountEl) {
    getControllerDom().ongoingCountEl.textContent =
      ongoingCountValue > 0
        ? `${ongoingCountValue} booking${ongoingCountValue > 1 ? "s" : ""}`
        : "";
  }
  if (getControllerDom().pastCountEl) {
    getControllerDom().pastCountEl.textContent =
      pastCountValue > 0
        ? `${pastCountValue} booking${pastCountValue > 1 ? "s" : ""}`
        : "";
  }
};

const buildBookingRow = (booking) => {
  const row = document.createElement("div");
  row.className = "booking-row";
  row.dataset.bookingId = booking.id;

  const left = document.createElement("div");
  left.className = "booking-left";

  const title = document.createElement("p");
  title.className = "booking-title";
  title.textContent = getBookingTitle(booking);

  const date = document.createElement("span");
  date.className = "booking-date";
  date.textContent = getBookingDateTime(booking);

  const reference = document.createElement("span");
  reference.className = "booking-ref";
  reference.textContent = `Ref: ${getBookingReference(booking)}`;

  left.appendChild(title);
  left.appendChild(reference);
  left.appendChild(date);

  const right = document.createElement("div");
  right.className = "booking-right";

  const status = getStatusPresentation(booking);
  const statusChip = document.createElement("span");
  statusChip.className = `status-chip ${status.className}`;
  statusChip.textContent = status.label;

  const actions = document.createElement("div");
  actions.className = "booking-actions";

  const viewBtn = document.createElement("button");
  viewBtn.className = "btn ghost";
  viewBtn.type = "button";
  viewBtn.textContent = "View";
  viewBtn.dataset.action = "view";
  viewBtn.dataset.id = booking.id;
  actions.appendChild(viewBtn);

  if (canCancelBooking(booking)) {
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn danger cancel-booking";
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.dataset.action = "cancel";
    cancelBtn.dataset.id = booking.id;
    actions.appendChild(cancelBtn);
  }

  right.appendChild(statusChip);
  right.appendChild(actions);

  row.appendChild(left);
  row.appendChild(right);
  return row;
};

const renderBookings = (bookings) => {
  if (!getControllerDom().bookingsOngoingEl || !getControllerDom().bookingsPastEl) return;

  getControllerState().latestBookings = bookings;

  getControllerState().bookingCache = new Map();
  bookings.forEach((booking) => {
    getControllerState().bookingCache.set(booking.id, booking);
  });

  const filters = getCurrentBookingFilters();
  const filtered = bookings.filter((booking) => matchesBookingFilters(booking, filters));

  const ongoing = [];
  const past = [];

  filtered.forEach((booking) => {
    if (isPastBooking(booking)) {
      past.push(booking);
    } else {
      ongoing.push(booking);
    }
  });

  const sortAsc = (a, b) => getSortKey(a) - getSortKey(b);
  const sortDesc = (a, b) => getSortKey(b) - getSortKey(a);

  ongoing.sort(sortAsc);
  past.sort(sortDesc);

  getControllerDom().bookingsOngoingEl.innerHTML = "";
  getControllerDom().bookingsPastEl.innerHTML = "";

  ongoing.forEach((booking) => getControllerDom().bookingsOngoingEl.appendChild(buildBookingRow(booking)));
  past.forEach((booking) => getControllerDom().bookingsPastEl.appendChild(buildBookingRow(booking)));

  const showOngoing = getControllerState().bookingView === "ongoing";
  const viewCount = showOngoing ? ongoing.length : past.length;

  setHidden(getControllerDom().ongoingGroupEl, !showOngoing || ongoing.length === 0);
  setHidden(getControllerDom().pastGroupEl, showOngoing || past.length === 0);
  updateBookingCounts(ongoing.length, past.length);

  setHidden(getControllerDom().bookingsLoadingEl, true);
  if (getControllerDom().bookingsEmptyEl) {
    getControllerDom().bookingsEmptyEl.textContent = getBookingEmptyMessage(
      filters,
      getControllerState().bookingView,
      viewCount,
      bookings.length
    );
  }
  setHidden(getControllerDom().bookingsEmptyEl, viewCount !== 0);

  if (
    getControllerState().pendingBookingFocusId &&
    getControllerState().bookingCache.has(getControllerState().pendingBookingFocusId)
  ) {
    const focusId = getControllerState().pendingBookingFocusId;
    getControllerState().pendingBookingFocusId = null;
    openBookingDetails(focusId);
  }
};

const clearBookingStateImpl = () => {
  if (getControllerState().bookingUnsub) {
    getControllerState().bookingUnsub();
    getControllerState().bookingUnsub = null;
  }
  getControllerState().pendingBookingFocusId = null;
  getControllerState().bookingCache = new Map();
  getControllerState().latestBookings = [];
  if (getControllerDom().bookingsOngoingEl) getControllerDom().bookingsOngoingEl.innerHTML = "";
  if (getControllerDom().bookingsPastEl) getControllerDom().bookingsPastEl.innerHTML = "";
  setHidden(getControllerDom().ongoingGroupEl, true);
  setHidden(getControllerDom().pastGroupEl, true);
  updateBookingCounts(0, 0);
  setHidden(getControllerDom().bookingsLoadingEl, true);
  setHidden(getControllerDom().bookingsEmptyEl, true);
};

const startBookingListenerImpl = (user, dataService) => {
  if (!getControllerDom().bookingsOngoingEl || !getControllerDom().bookingsPastEl) return;

  getControllerState().currentUserId = user.uid;
  clearBookingStateImpl();
  setHidden(getControllerDom().bookingsLoadingEl, false);
  setHidden(getControllerDom().bookingsEmptyEl, true);

  getControllerState().bookingUnsub = dataService.subscribeToUserBookings(
    user.uid,
    (snapshot) => {
      const records = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      renderBookings(records);
    },
    (error) => {
      console.error("Failed to load bookings:", error);
      setHidden(getControllerDom().bookingsLoadingEl, true);
      setHidden(getControllerDom().bookingsEmptyEl, false);
    }
  );
};

const setBookingView = (view) => {
  getControllerState().bookingView = view;
  if (getControllerDom().bookingTabOngoingEl) {
    getControllerDom().bookingTabOngoingEl.classList.toggle("active", view === "ongoing");
  }
  if (getControllerDom().bookingTabDoneEl) {
    getControllerDom().bookingTabDoneEl.classList.toggle("active", view === "done");
  }
  updateStatusFilterOptions(view);
};

const refreshBookingFilters = () => {
  if (!getControllerState().latestBookings) return;
  renderBookings(getControllerState().latestBookings);
};

const openBookingDetails = (bookingId) => {
  const booking = getControllerState().bookingCache.get(bookingId);
  if (!booking) return;

  getControllerState().activeBookingId = bookingId;

  // Set title
  if (getControllerDom().modalTitleEl) getControllerDom().modalTitleEl.textContent = getBookingTitle(booking);

  // === DATE & TIME ===
  const modalDate = document.getElementById("modalDate");
  if (modalDate) {
    const dateStr = formatDateValue(booking?.date || booking?.seminarDate);
    const timeStr = booking?.timeRange || booking?.seminarTime || booking?.time || "";
    const dateText = timeStr ? `${dateStr} | ${timeStr}` : dateStr;
    modalDate.textContent = dateText;
    modalDate.style.display = dateText ? "block" : "none";
  }

  // === LOCATION ===
  const modalLocationType = document.getElementById("modalLocationType");
  const modalAddress = document.getElementById("modalAddress");
  const modalLandmark = document.getElementById("modalLandmark");
  const location = booking?.location || {};

  if (modalLocationType) {
    const locationType = location.type;
    const locationName = location.name;
    let locationTypeText = "";
    if (locationType === "venue") {
      locationTypeText = locationName || "Event Venue";
    } else if (locationType === "house") {
      locationTypeText = "Private Residence";
    } else {
      locationTypeText = locationName || "";
    }
    modalLocationType.textContent = locationTypeText;
    modalLocationType.style.display = locationTypeText ? "block" : "none";
  }

  if (modalAddress) {
    const addressParts = [];
    if (location.unit) addressParts.push(`Unit ${location.unit}`);
    if (location.street) addressParts.push(location.street);
    if (location.barangay) addressParts.push(`Brgy. ${location.barangay}`);
    if (location.city) addressParts.push(location.city);
    if (location.province) addressParts.push(location.province);
    if (location.postalCode) addressParts.push(location.postalCode);
    const addressText = addressParts.join(", ");
    modalAddress.textContent = addressText;
    modalAddress.style.display = addressText ? "block" : "none";
  }

  if (modalLandmark) {
    const landmarkText = location.landmark ? `Landmark: ${location.landmark}` : "";
    const notesText = location.notes || "";
    const combined = [landmarkText, notesText].filter(Boolean).join(" | ");
    modalLandmark.textContent = combined;
    modalLandmark.style.display = combined ? "block" : "none";
  }

  // === BOOKING DETAILS ===
  const modalDetailsGrid = document.getElementById("modalDetailsGrid");
  if (modalDetailsGrid) {
    modalDetailsGrid.innerHTML = "";

    appendDetailItem(modalDetailsGrid, "Reference", getBookingReference(booking));

    // Booking Type
    const bookingTypeValue = booking?.bookingType ? booking.bookingType.toUpperCase() : "";
    appendDetailItem(modalDetailsGrid, "Booking Type", bookingTypeValue);

    // Event-specific details
    if (booking?.bookingType === "event") {
      if (booking?.packageName) {
        appendDetailItem(modalDetailsGrid, "Package", booking.packageName);
      }
      if (booking?.packagePrice) {
        appendDetailItem(modalDetailsGrid, "Price", `\u20B1${booking.packagePrice.toLocaleString()}`);
      }
      if (booking?.packagePax) {
        appendDetailItem(modalDetailsGrid, "Guests", `${booking.packagePax} pax`);
      }
      if (booking?.packageFlowers) {
        appendDetailItem(modalDetailsGrid, "Flowers", `${booking.packageFlowers} total`);
      }

      // Selected flowers
      if (booking?.selectedMainFlowers && booking.selectedMainFlowers.length > 0) {
        appendDetailItem(modalDetailsGrid, "Main Flowers", booking.selectedMainFlowers.join(", "));
      }
      if (booking?.selectedFillerFlowers && booking.selectedFillerFlowers.length > 0) {
        appendDetailItem(modalDetailsGrid, "Filler Flowers", booking.selectedFillerFlowers.join(", "));
      }
    }

    // Seminar-specific details
    if (booking?.bookingType === "seminar") {
      if (booking?.seminarTitle) {
        appendDetailItem(modalDetailsGrid, "Workshop", booking.seminarTitle);
      }
      if (booking?.paymentStatus) {
        appendDetailItem(modalDetailsGrid, "Payment Status", formatStatusLabel(booking.paymentStatus));
      }
    }
  }

  // === CLIENT INFORMATION ===
  const modalClientName = document.getElementById("modalClientName");
  const modalClientEmail = document.getElementById("modalClientEmail");

  if (modalClientName) {
    const userName = String(booking?.userName || "").trim();
    modalClientName.textContent = userName ? `Name: ${userName}` : "";
    modalClientName.style.display = userName ? "block" : "none";
  }
  if (modalClientEmail) {
    const userEmail = String(booking?.userEmail || "").trim();
    modalClientEmail.textContent = userEmail ? `Email: ${userEmail}` : "";
    modalClientEmail.style.display = userEmail ? "block" : "none";
  }

  // === SPECIAL REQUESTS ===
  const modalNotesSection = document.getElementById("modalNotesSection");
  const modalNotes = document.getElementById("modalNotes");

  if (booking?.notes && booking.notes.trim()) {
    if (modalNotes) modalNotes.textContent = booking.notes;
    if (modalNotesSection) modalNotesSection.style.display = "block";
  } else {
    if (modalNotesSection) modalNotesSection.style.display = "none";
  }

  // === STATUS ===
  const modalStatus = document.getElementById("modalStatus");
  const modalSubmitted = document.getElementById("modalSubmitted");

  const status = normalizeStatus(booking?.status);
  const statusPresentation = getStatusPresentation(booking);

  if (modalStatus) {
    modalStatus.textContent = `Status: ${statusPresentation.label}`;
  }
  if (modalSubmitted) {
    const submittedDate = formatDateValue(booking?.timestamp);
    modalSubmitted.textContent = submittedDate ? `Submitted: ${submittedDate}` : "";
    modalSubmitted.style.display = submittedDate ? "block" : "none";
  }

  // === PAYMENT PROOF ===
  const proofUrl = sanitizeAssetUrl(booking?.paymentProofUrl);
  const proofName = booking?.paymentProofName || "";
  const hasProof = Boolean(proofUrl || proofName);
  const isPdf = /\.pdf$/i.test(proofName);

  if (getControllerDom().modalProofSectionEl) {
    getControllerDom().modalProofSectionEl.style.display = hasProof ? "block" : "none";
  }
  if (getControllerDom().modalProofImageEl) {
    if (proofUrl && !isPdf) {
      getControllerDom().modalProofImageEl.src = proofUrl;
      getControllerDom().modalProofImageEl.hidden = false;
    } else {
      getControllerDom().modalProofImageEl.hidden = true;
      getControllerDom().modalProofImageEl.removeAttribute("src");
    }
  }
  if (getControllerDom().modalProofLinkEl) {
    if (proofUrl) {
      getControllerDom().modalProofLinkEl.href = proofUrl;
      getControllerDom().modalProofLinkEl.hidden = false;
    } else {
      getControllerDom().modalProofLinkEl.hidden = true;
      getControllerDom().modalProofLinkEl.removeAttribute("href");
    }
  }
  if (getControllerDom().modalProofNameEl) {
    if (proofName) {
      getControllerDom().modalProofNameEl.textContent = `File: ${proofName}`;
      getControllerDom().modalProofNameEl.hidden = false;
    } else {
      getControllerDom().modalProofNameEl.hidden = true;
      getControllerDom().modalProofNameEl.textContent = "";
    }
  }

  // === CANCELLATION DETAILS ===
  const modalCancelSection = document.getElementById("modalCancelSection");
  const modalCancelReason = document.getElementById("modalCancelReason");
  const modalCancelMessage = document.getElementById("modalCancelMessage");
  const modalCancelDate = document.getElementById("modalCancelDate");

  if (isCancelledStatus(status)) {
    const isDeclined = status.includes("declined") || status.includes("rejected");
    const actionLabel = isDeclined ? "Declined" : "Cancelled";
    const sectionTitle = isDeclined ? "Decline Details" : "Cancellation Details";
    const sectionTitleEl = modalCancelSection?.querySelector("h4");

    if (sectionTitleEl) sectionTitleEl.textContent = sectionTitle;

    const reasonValue = booking?.cancelReason || booking?.declineReason;
    if (modalCancelReason && reasonValue) {
      modalCancelReason.textContent = `Reason: ${reasonValue}`;
    }

    const messageValue = booking?.cancelMessage || booking?.declineMessage;
    if (modalCancelMessage && messageValue) {
      modalCancelMessage.textContent = `Message: ${messageValue}`;
      modalCancelMessage.style.display = "block";
    } else if (modalCancelMessage) {
      modalCancelMessage.style.display = "none";
    }

    const dateValue = booking?.cancelledAt || booking?.declinedAt || booking?.updatedAt;
    if (modalCancelDate && dateValue) {
      modalCancelDate.textContent = `${actionLabel} on: ${formatDateValue(dateValue)}`;
    }
    if (modalCancelSection) modalCancelSection.style.display = "block";
  } else {
    if (modalCancelSection) modalCancelSection.style.display = "none";
  }

  // Show/hide cancel button
  if (getControllerDom().openCancelModalEl) getControllerDom().openCancelModalEl.hidden = !canCancelBooking(booking);

  // Show/hide pay now button
  if (getControllerDom().payNowBtnEl) {
    const shouldPay =
      (booking?.bookingType === "event" || booking?.bookingType === "seminar") &&
      normalizeStatus(booking?.status) === "awaiting_payment" &&
      !isAwaitingPaymentExpired(booking);
    getControllerDom().payNowBtnEl.hidden = !shouldPay;
    if (shouldPay && booking?.id) {
      getControllerDom().payNowBtnEl.onclick = () => {
        window.location.href = `payment.html?bookingId=${booking.id}`;
      };
    } else {
      getControllerDom().payNowBtnEl.onclick = null;
    }
  }

  getControllerDom().detailsModalEl?.classList.add("active");
};

const appendDetailItem = (container, label, value) => {
  const item = createDetailItem(label, value);
  if (item && container) {
    container.appendChild(item);
  }
};

// Helper function to create detail items
function createDetailItem(label, value) {
  const normalizedValue =
    value === null || value === undefined ? "" : String(value).trim();
  if (!normalizedValue) return null;

  const item = document.createElement("div");
  item.className = "detail-item";

  const labelEl = document.createElement("span");
  labelEl.className = "detail-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "detail-value";
  valueEl.textContent = normalizedValue;

  item.appendChild(labelEl);
  item.appendChild(valueEl);

  return item;
}

const resetCancelForm = () => {
  document
    .querySelectorAll("input[name=\"cancelReason\"]")
    .forEach((radio) => {
      radio.checked = false;
    });
  const cancelMessage = document.querySelector(".cancel-message");
  if (cancelMessage) cancelMessage.value = "";

  if (getControllerDom().confirmCancelEl) getControllerDom().confirmCancelEl.disabled = true;
};

const closeDetails = () => {
  getControllerDom().detailsModalEl?.classList.remove("active");
  if (!getControllerDom().cancelModalEl?.classList.contains("active")) {
    getControllerState().activeBookingId = null;
  }
};

const closeCancel = () => {
  getControllerDom().cancelModalEl?.classList.remove("active");
  resetCancelForm();
  getControllerState().activeBookingId = null;
};

const initBookingsImpl = (authInstance, dataService) => {
  if (getControllerDom().openCancelModalEl) getControllerDom().openCancelModalEl.hidden = true;

  setBookingView(getControllerState().bookingView);

  if (getControllerDom().bookingTabOngoingEl) {
    getControllerDom().bookingTabOngoingEl.addEventListener("click", () => {
      if (getControllerState().bookingView === "ongoing") return;
      setBookingView("ongoing");
      refreshBookingFilters();
    });
  }

  if (getControllerDom().bookingTabDoneEl) {
    getControllerDom().bookingTabDoneEl.addEventListener("click", () => {
      if (getControllerState().bookingView === "done") return;
      setBookingView("done");
      refreshBookingFilters();
    });
  }

  if (getControllerDom().bookingSearchEl) {
    getControllerDom().bookingSearchEl.addEventListener("input", refreshBookingFilters);
  }

  if (getControllerDom().bookingTypeFilterEl) {
    getControllerDom().bookingTypeFilterEl.addEventListener("change", refreshBookingFilters);
  }

  if (getControllerDom().bookingStatusFilterEl) {
    getControllerDom().bookingStatusFilterEl.addEventListener("change", refreshBookingFilters);
  }

  if (getControllerDom().bookingClearFiltersEl) {
    getControllerDom().bookingClearFiltersEl.addEventListener("click", () => {
      if (getControllerDom().bookingSearchEl) getControllerDom().bookingSearchEl.value = "";
      if (getControllerDom().bookingTypeFilterEl) getControllerDom().bookingTypeFilterEl.value = "all";
      if (getControllerDom().bookingStatusFilterEl) getControllerDom().bookingStatusFilterEl.value = "all";
      refreshBookingFilters();
    });
  }

  if (getControllerDom().bookingsSectionEl) {
    getControllerDom().bookingsSectionEl.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const bookingId = button.dataset.id;
      if (!bookingId) return;

      if (button.dataset.action === "view") {
        openBookingDetails(bookingId);
        return;
      }

      if (button.dataset.action === "cancel") {
        getControllerState().activeBookingId = bookingId;
        getControllerDom().cancelModalEl?.classList.add("active");
      }
    });
  }

  if (getControllerDom().closeDetailsModalEl) {
    getControllerDom().closeDetailsModalEl.addEventListener("click", closeDetails);
  }

  if (getControllerDom().detailsModalEl) {
    getControllerDom().detailsModalEl.addEventListener("click", (event) => {
      if (event.target === getControllerDom().detailsModalEl) {
        closeDetails();
      }
    });
  }

  if (getControllerDom().openCancelModalEl) {
    getControllerDom().openCancelModalEl.addEventListener("click", () => {
      if (!getControllerState().activeBookingId) return;
      getControllerDom().detailsModalEl?.classList.remove("active");
      getControllerDom().cancelModalEl?.classList.add("active");
    });
  }

  if (getControllerDom().closeCancelModalEl) {
    getControllerDom().closeCancelModalEl.addEventListener("click", closeCancel);
  }

  if (getControllerDom().backBtnEl) {
    getControllerDom().backBtnEl.addEventListener("click", closeCancel);
  }

  if (getControllerDom().cancelModalEl) {
    getControllerDom().cancelModalEl.addEventListener("click", (event) => {
      if (event.target === getControllerDom().cancelModalEl) {
        closeCancel();
      }
    });
  }

  if (getControllerDom().confirmCancelEl) getControllerDom().confirmCancelEl.disabled = true;

  document.querySelectorAll("input[name=\"cancelReason\"]").forEach((input) => {
    input.addEventListener("change", () => {
      if (getControllerDom().confirmCancelEl) getControllerDom().confirmCancelEl.disabled = false;
    });
  });

  if (getControllerDom().confirmCancelEl) {
    getControllerDom().confirmCancelEl.addEventListener("click", async () => {
      const selectedReason = document.querySelector(
        "input[name=\"cancelReason\"]:checked"
      );

      if (!selectedReason) {
        await showAlert("Please select a reason before cancelling.");
        return;
      }

      if (!getControllerState().activeBookingId) {
        await showAlert("Please select a booking to cancel.");
        return;
      }

      const user = authInstance.currentUser;
      if (!user) {
        await showAlert("Please log in again.");
        window.location.href = "login-register.html";
        return;
      }

      const latestBooking = await dataService.getBookingById(getControllerState().activeBookingId);
      if (!latestBooking) {
        closeCancel();
        await showAlert("Booking not found.");
        return;
      }

      if (latestBooking.userId !== user.uid) {
        closeCancel();
        await showAlert("You do not have access to this booking.");
        return;
      }

      if (!canCancelBooking(latestBooking)) {
        closeCancel();
        await showAlert("This booking can no longer be cancelled from your profile.");
        return;
      }

      const cancelMessage = document.querySelector(".cancel-message");
      const messageValue = cancelMessage ? cancelMessage.value.trim() : "";

      getControllerDom().confirmCancelEl.disabled = true;
      try {
        await dataService.cancelBooking(getControllerState().activeBookingId, {
          status: "cancelled",
          cancelReason: selectedReason.value,
          cancelMessage: messageValue,
          cancelledAt: serverTimestamp(),
          cancelledBy: user.uid
        });
        closeCancel();
        getControllerDom().detailsModalEl?.classList.remove("active");
        await showAlert("Your booking has been cancelled.");
      } catch (error) {
        console.error("Failed to cancel booking:", error);
        await showAlert("Unable to cancel booking. Please try again.");
      } finally {
        getControllerDom().confirmCancelEl.disabled = false;
      }
    });
  }

  if (getControllerDom().markAllReadBtnEl) {
    getControllerDom().markAllReadBtnEl.addEventListener("click", () => {
      markAllNotificationsRead();
    });
  }

  if (getControllerDom().notificationListEl) {
    getControllerDom().notificationListEl.addEventListener("click", (event) => {
      const item = event.target.closest(".notification-item");
      if (!item) return;
      markNotificationRead(item.dataset.notificationId);
    });
  }
};

const handleSignedOutImpl = () => {
  getControllerState().currentUserId = null;
  clearBookingStateImpl();
  clearNotifications();
  const returnPath = getBookingIdFromUrl() ? getReturnPath() : "";
  if (returnPath) {
    redirectToLogin(returnPath);
  } else {
    window.location.href = "login-register.html";
  }
};

const profileBookingsController = new ProfileBookingsController({
  authInstance: auth,
  dataService: new BookingDataService({ dbInstance: db })
});

export const ensureBookingAccess = (user) => profileBookingsController.ensureBookingAccess(user);
export const clearBookingState = () => profileBookingsController.clearBookingState();
export const startBookingListener = (user) => profileBookingsController.startBookingListener(user);
export const initBookings = () => profileBookingsController.initBookings();
export const handleSignedOut = () => profileBookingsController.handleSignedOut();

