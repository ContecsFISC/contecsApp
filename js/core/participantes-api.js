import { app } from "./firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";

const functions = getFunctions(app, "us-central1");

function mapError(error) {
  const code = error?.code || "";
  const mensajes = {
    "functions/invalid-argument": error.message,
    "functions/already-exists": error.message,
    "functions/not-found": error.message,
    "functions/resource-exhausted": "Demasiados intentos. Espera un momento e intenta de nuevo.",
    "functions/unavailable": "Servicio temporalmente no disponible. Intenta de nuevo.",
  };
  return new Error(mensajes[code] || error.message || "Ocurrió un error. Intenta de nuevo.");
}

export async function registrarParticipante(datos) {
  try {
    const fn = httpsCallable(functions, "registrarParticipante");
    const result = await fn(datos);
    return result.data;
  } catch (error) {
    throw mapError(error);
  }
}

export async function accederParticipante(codigo, token) {
  try {
    const fn = httpsCallable(functions, "accederParticipante");
    const result = await fn({ codigo, token });
    return result.data;
  } catch (error) {
    throw mapError(error);
  }
}

export function archivoABase64(archivo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result || "").split(",")[1];
      if (!base64) {
        reject(new Error("No se pudo leer el archivo."));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(archivo);
  });
}
