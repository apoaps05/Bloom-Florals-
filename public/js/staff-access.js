import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

const normalizeRole = (value) => String(value || "").trim().toLowerCase();
const STAFF_ROLES = new Set(["admin", "employee"]);
const STAFF_LOOKUP_RETRY_DELAY_MS = 200;

export async function resolveStaffAccess(db, uid) {
  if (!db || !uid) {
    return { role: null, profile: null };
  }

  let profile = null;
  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    profile = userSnap.exists() ? userSnap.data() || {} : null;
  } catch (error) {
    console.error("Unable to read user profile for staff access:", error);
  }

  const profileRole = normalizeRole(profile?.role);

  if (profileRole === "admin" || profileRole === "employee") {
    return { role: profileRole, profile };
  }

  try {
    const adminSnap = await getDoc(doc(db, "admins", uid));
    if (adminSnap.exists()) {
      return { role: "admin", profile };
    }
  } catch (error) {
    // Non-admin users are not allowed to read /admins under current rules.
    const errorCode = String(error?.code || "");
    if (errorCode && !errorCode.includes("permission-denied")) {
      console.error("Unable to verify admin access:", error);
    }
  }

  if (profileRole === "employee") {
    return { role: "employee", profile };
  }

  return { role: null, profile };
}

export async function resolveStaffAccessWithRetry(db, user, attempts = 2) {
  if (!db || !user?.uid) {
    return { role: null, profile: null };
  }

  let access = { role: null, profile: null };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      try {
        await user.getIdToken(true);
      } catch (error) {
        console.error("Unable to refresh auth token for staff access:", error);
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, STAFF_LOOKUP_RETRY_DELAY_MS);
      });
    }

    access = await resolveStaffAccess(db, user.uid);
    if (STAFF_ROLES.has(access.role)) {
      return access;
    }
  }

  return access;
}

export function isStaffRole(role) {
  return STAFF_ROLES.has(role);
}
