import { getStorage } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-storage.js";
import { app as appInstance, auth as authInstance, db as dbInstance } from "../firebase-app.js";

class DashboardFirebaseContext {
  constructor({ app, auth, db }) {
    this.app = app;
    this.auth = auth;
    this.db = db;
    this.storage = getStorage(app);
  }
}

const dashboardFirebaseContext = new DashboardFirebaseContext({
  app: appInstance,
  auth: authInstance,
  db: dbInstance,
});

export const auth = dashboardFirebaseContext.auth;
export const db = dashboardFirebaseContext.db;
export const storage = dashboardFirebaseContext.storage;
