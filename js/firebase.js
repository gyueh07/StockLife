import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDhYBeAxJ6zigN7EPiFdS7v4msK1blg20E",
  authDomain: "stocklife-f5ff9.firebaseapp.com",
  projectId: "stocklife-f5ff9",
  storageBucket: "stocklife-f5ff9.firebasestorage.app",
  messagingSenderId: "986321622081",
  appId: "1:986321622081:web:e86f9f3dca1965ef2862c0"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
