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

const ERRORES_LISTAR_PARTICIPANTES_GIRAS = {
  "unauthenticated":   "Debes iniciar sesión para ver los participantes.",
  "permission-denied": "No tienes permiso para ver la lista de participantes.",
  "internal":          "Error al obtener la lista de participantes.",
  "unavailable":       "Sin conexión. Verifica tu internet e intenta de nuevo.",
};

// Lista mínima (id, nombre, cédula, código, categoría) para el selector de
// GIRAS. Incluye `pagoAprobado` (booleano) solo como aviso visual — no trae
// comprobantes ni otros datos de pago. Ver listarParticipantesParaGiras
// en functions/index.js.
export async function listarParticipantesParaGiras() {
  try {
    const fn = httpsCallable(functions, "listarParticipantesParaGiras");
    const result = await fn();
    return result.data?.participantes || [];
  } catch (error) {
    const msg = ERRORES_LISTAR_PARTICIPANTES_GIRAS[error.code] || error.message || "Error inesperado.";
    throw new Error(msg);
  }
}

const ERRORES_NOTIFICAR_GIRA = {
  "unauthenticated":   "Debes iniciar sesión para notificar a la gira.",
  "permission-denied": "No tienes permiso para notificar esta gira.",
  "not-found":         "La gira ya no existe.",
  "internal":          "Error al notificar a los participantes de la gira.",
  "unavailable":       "Sin conexión. Verifica tu internet e intenta de nuevo.",
};

// Envía el correo de notificación (punto 3 del plan de GIRAS) solo a los
// participantes de la gira que todavía no fueron notificados.
export async function notificarParticipantesGira(giraId) {
  try {
    const fn = httpsCallable(functions, "notificarParticipantesGira");
    const result = await fn({giraId});
    return result.data;
  } catch (error) {
    const msg = ERRORES_NOTIFICAR_GIRA[error.code] || error.message || "Error inesperado al notificar la gira.";
    throw new Error(msg);
  }
}

const ERRORES_ACCESO_GIRA = {
  "not-found":         "Código o clave incorrectos. Revisa el correo que recibiste de Giras.",
  "permission-denied": "No estás en la lista de participantes de esta gira.",
  "invalid-argument":  "Faltan datos para acceder a la información de la gira.",
  "internal":          "Error del servidor. Intenta de nuevo en unos segundos.",
  "unavailable":       "Sin conexión. Verifica tu internet e intenta de nuevo.",
};

// Página pública public/gira.html — punto 4 del plan de GIRAS.
export async function accederGiraParticipante(codigo, token, giraId) {
  try {
    const fn = httpsCallable(functions, "accederGiraParticipante");
    const result = await fn({codigo, token, giraId});
    return result.data;
  } catch (error) {
    const msg = ERRORES_ACCESO_GIRA[error.code] || error.message || "Error inesperado. Intenta de nuevo.";
    throw new Error(msg);
  }
}

const ERRORES_CHECKPOINT_GIRA = {
  "unauthenticated":      "Debes iniciar sesión.",
  "permission-denied":    "No tienes permiso para escanear en esta gira, o el QR no es válido.",
  "not-found":            "QR no reconocido o la gira ya no existe.",
  "failed-precondition":  "Este participante no está en la lista de esta gira.",
  "already-exists":       "Este checkpoint ya fue registrado.",
  "invalid-argument":     "El QR no trae datos de participante válidos.",
  "internal":             "Error al registrar el checkpoint.",
  "unavailable":          "Sin conexión. Verifica tu internet e intenta de nuevo.",
};

// Check-in ("entrada") / check-out ("salida") de gira — punto 5 del plan.
// NO valida pago.estado: si GIRAS ya seleccionó al participante, puede
// abordar sin importar el estado de pago del congreso.
export async function marcarCheckpointGira({giraId, codigo, token, tipo}) {
  try {
    const fn = httpsCallable(functions, "marcarCheckpointGira");
    const result = await fn({giraId, codigo, token, tipo});
    return result.data;
  } catch (error) {
    const msg = ERRORES_CHECKPOINT_GIRA[error.code] || error.message || "Error al registrar el checkpoint.";
    throw new Error(msg);
  }
}
