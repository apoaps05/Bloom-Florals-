import { auth as authInstance, db as dbInstance } from "../firebase-app.js";

class ProfileFirebaseContext {
  constructor({ auth, db }) {
    this.auth = auth;
    this.db = db;
  }
}

const profileFirebaseContext = new ProfileFirebaseContext({
  auth: authInstance,
  db: dbInstance,
});

export const auth = profileFirebaseContext.auth;
export const db = profileFirebaseContext.db;
