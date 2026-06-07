import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCEvOv9YcuAtWKEj4yRgnoesw4leZS4Yew",
  authDomain: "contecs-fa6e6.firebaseapp.com",
  projectId: "contecs-fa6e6",
  storageBucket: "contecs-fa6e6.firebasestorage.app",
  messagingSenderId: "559368296197",
  appId: "1:559368296197:web:7b93a49a16f6a3d8d0496c"
};

const app = initializeApp(firebaseConfig);
export { app };
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
