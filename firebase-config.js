import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBtsUrI43af9_IGVIRWQ7YfEpbtx8omEaE",
  authDomain: "aps-radar-vagas.firebaseapp.com",
  projectId: "aps-radar-vagas",
  storageBucket: "aps-radar-vagas.firebasestorage.app",
  messagingSenderId: "4855027207",
  appId: "1:4855027207:web:98bd199b5dbeffef177ca2",
  measurementId: "G-S367QH2J7F"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
