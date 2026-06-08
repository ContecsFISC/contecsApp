// js/core/participantes-api.js
// USA el SDK de Firebase (httpsCallable) — NO fetch directo a cloudfunctions.net
// El SDK maneja CORS automáticamente.

import { app } from "./firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";

// CRÍTICO: especificar "us-central1" — es donde está desplegada la función
const functions = getFunctions(app, "us-central1");

export async function accederParticipante(codigo, token) {
  try {
    const fn = httpsCallable(functions, "accederParticipante");
    const result = await fn({ codigo, token });
    return result.data;
  } catch (error) {
    const mensajes = {
      "not-found":        "Código o clave incorrectos. Revisa el correo que recibiste al inscribirte.",
      "invalid-argument": "Ingresa tu código de participante y tu código de acceso.",
      "internal":         "Error del servidor. Intenta de nuevo en unos segundos.",
      "unavailable":      "Sin conexión. Verifica tu internet e intenta de nuevo.",
    };
    const msg = mensajes[error.code] || error.message || "Error inesperado. Intenta de nuevo.";
    throw new Error(msg);
  }
}
