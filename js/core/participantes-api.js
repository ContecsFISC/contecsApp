// js/core/participantes-api.js
// SDK de Firebase (httpsCallable) — maneja CORS automáticamente.

import { app } from "./firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";

const functions = getFunctions(app, "us-central1");

const ERRORES_REGISTRO = {
  "already-exists":   "Ya existe una inscripción con esta cédula o correo. Si crees que es un error, contacta al staff en congresofisc@utp.ac.pa",
  "invalid-argument": "Revisa los datos del formulario e intenta de nuevo.",
  "internal":         "Error del servidor. Intenta de nuevo en unos segundos.",
  "unavailable":      "Sin conexión. Verifica tu internet e intenta de nuevo.",
};

const ERRORES_ACCESO = {
  "not-found":        "Código o clave incorrectos. Revisa el correo que recibiste al inscribirte.",
  "invalid-argument": "Ingresa tu código de participante y tu código de acceso.",
  "internal":         "Error del servidor. Intenta de nuevo en unos segundos.",
  "unavailable":      "Sin conexión. Verifica tu internet e intenta de nuevo.",
};

export function archivoABase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function registrarParticipante(data) {
  try {
    const fn = httpsCallable(functions, "registrarParticipante");
    const result = await fn(data);
    return result.data;
  } catch (error) {
    const msg = ERRORES_REGISTRO[error.code] || error.message || "Error inesperado al registrar. Intenta de nuevo.";
    throw new Error(msg);
  }
}

export async function accederParticipante(codigo, token) {
  try {
    const fn = httpsCallable(functions, "accederParticipante");
    const result = await fn({ codigo, token });
    return result.data;
  } catch (error) {
    const msg = ERRORES_ACCESO[error.code] || error.message || "Error inesperado. Intenta de nuevo.";
    throw new Error(msg);
  }
}

const ERRORES_CORREO_QR = {
  "unauthenticated":  "Debes iniciar sesión para enviar correos.",
  "permission-denied": "No tienes permiso para enviar este correo.",
  "invalid-argument": "Participante no válido.",
  "internal":         "Error al enviar el correo. Intenta de nuevo.",
  "unavailable":      "Sin conexión. Verifica tu internet e intenta de nuevo.",
};

export async function enviarCorreoQrParticipante(docId, { forzarReenvio = false } = {}) {
  try {
    const fn = httpsCallable(functions, "enviarCorreoQrParticipante");
    const result = await fn({ docId, forzarReenvio });
    return result.data;
  } catch (error) {
    const msg = ERRORES_CORREO_QR[error.code] || error.message || "Error al enviar el correo.";
    throw new Error(msg);
  }
}
