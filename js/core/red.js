// =============================================
// CONTECS — Red inestable en el congreso
// =============================================
// Los lectores trabajan horas con el wifi del edificio. Un corte breve no
// debe perder un escaneo: se reintenta una vez y, si sigue sin red, se dice
// claro que el problema es la conexión (no la credencial).
//
// Reintentar es seguro: las entradas, inscripciones a talleres y RFID tienen
// ID fijo en el servidor, así que un reintento de algo que sí se guardó
// responde "ya estaba" en vez de duplicarlo.

const CODIGOS_DE_RED = new Set([
  "functions/unavailable", "functions/deadline-exceeded",
  "unavailable", "deadline-exceeded",
]);

// Solo fallas de transporte. Un "internal" con mensaje propio es un error del
// servidor (no se arregla reintentando); el SDK pone "internal" a secas cuando
// el fetch ni siquiera llegó.
export function esErrorDeRed(e) {
  if (CODIGOS_DE_RED.has(e?.code)) return true;
  if (e?.code === "functions/internal" && /^internal$/i.test(String(e?.message || "").trim())) return true;
  return /network|offline|failed to fetch|load failed|timeout de red/i.test(String(e?.message || ""));
}

// ¿Hay internet de verdad? (navigator.onLine sigue en true con wifi sin
// salida a internet). Pide el mapa público, que el servidor responde de su
// memoria sin leer la base.
export async function hayConexion() {
  if (!navigator.onLine) return false;
  try {
    const r = await conTiempo(fetch("https://us-central1-contecs-fa6e6.cloudfunctions.net/mapaPublico", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{\"data\":{}}", cache: "no-store",
    }), 6000);
    return r.ok;
  } catch (_) {
    return false;
  }
}

export const MENSAJE_SIN_RED = "Sin conexión con el servidor. Revisa el wifi del equipo y vuelve a escanear.";

export function mensajeDeError(e, defecto) {
  return !navigator.onLine || esErrorDeRed(e) ? MENSAJE_SIN_RED : (e?.message || defecto);
}

/** Ejecuta `fn`; ante un error de red espera un momento y lo intenta otra vez. */
export async function conReintento(fn, { intentos = 2, espera = 900 } = {}) {
  let ultimo;
  for (let i = 1; i <= intentos; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimo = e;
      if (i === intentos || !esErrorDeRed(e)) throw e;
      await new Promise(r => setTimeout(r, espera * i));
    }
  }
  throw ultimo;
}

/** `promesa` o un error de red si tarda más de `ms` (Firestore sin red puede tardar mucho en fallar). */
export function conTiempo(promesa, ms = 8000) {
  let reloj;
  const limite = new Promise((_, rechazar) => {
    reloj = setTimeout(() => rechazar(Object.assign(new Error("timeout de red"), { code: "deadline-exceeded" })), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(reloj));
}

// Lo que espera un escaneo como máximo antes de darlo por fallido (el SDK
// espera 70 s por defecto y, mientras tanto, las lecturas siguientes se
// acumulan detrás).
export const TIEMPO_MAXIMO_ESCANEO_MS = 20000;
