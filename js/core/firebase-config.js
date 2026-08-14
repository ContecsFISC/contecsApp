import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js";

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

// Analytics solo se inicializa si el entorno lo soporta (evita errores en local/SSR).
// Envuelto en try/catch porque este proyecto (contecs-fa6e6) no tiene Analytics
// vinculado en la consola de Firebase; si falla, no debe afectar el resto de la app.
export let analytics = null;
isSupported()
  .then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  })
  .catch(() => {
    // Analytics no disponible en este proyecto; se ignora silenciosamente.
  });
