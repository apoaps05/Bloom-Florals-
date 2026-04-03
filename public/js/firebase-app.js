import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyChzNIbDfPcLfU6sAftpeGWQwIr1hgGsZ0",
  authDomain: "login-form-15572.firebaseapp.com",
  projectId: "login-form-15572",
  storageBucket: "login-form-15572.firebasestorage.app",
  messagingSenderId: "448567504514",
  appId: "1:448567504514:web:8d10554ea46aa091874e9b",
  measurementId: "G-7589NPXMWL"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

export { app, auth, db, functions };
