// =============================================
// CONTECS — Padrón de participantes en el lector
// =============================================
// Cada equipo que escanea (Lectura QR, POSPER) mantiene en memoria la lista
// de inscritos, sincronizada en vivo con Firestore (onSnapshot: la primera
// vez baja todo y después solo los cambios). Así:
//   - cada escaneo se valida al instante, sin una consulta por credencial;
//   - sin internet se sigue validando el token y el pago (no pasa cualquiera);
//   - no se cae en la trampa de getDocs sin red, que responde vacío desde la
//     caché y hacía decir "QR no reconocido" a una credencial válida.
// Si el padrón no tiene a alguien (se inscribió hace segundos), el lector lo
// busca en el servidor (getDocsFromServer, que sí falla sin red).

import { db } from "./firebase-config.js";
import {
  collection, getDocsFromServer, limit, onSnapshot, query, where,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { conTiempo } from "./red.js?v=20261017.2";

const porCodigo = new Map();   // CÓDIGO -> {id, ...datos}
let listo = false;             // ya llegó una foto completa del servidor
let cancelar = null;

function suscribir() {
  cancelar = onSnapshot(collection(db, "participantes"), snap => {
    snap.docChanges().forEach(cambio => {
      const datos = cambio.doc.data();
      const codigo = String(datos.codigo || "").trim().toUpperCase();
      if (!codigo) return;
      if (cambio.type === "removed") porCodigo.delete(codigo);
      else porCodigo.set(codigo, { id: cambio.doc.id, ...datos });
    });
    if (!snap.metadata.fromCache) listo = true;
  }, error => {
    // Permisos o red: se reintenta; mientras, se sigue con lo que hay.
    console.warn("Padrón: se reintenta la sincronización.", error);
    cancelar = null;
    setTimeout(() => { if (!cancelar) suscribir(); }, 15000);
  });
}

export function iniciarPadron() {
  if (!cancelar) suscribir();
}

export const padronListo = () => listo;
export const tamanoPadron = () => porCodigo.size;

/** Solo lo que el equipo ya tiene en memoria (para validar sin internet). */
export const participanteLocal = codigo => porCodigo.get(String(codigo || "").trim().toUpperCase()) || null;

/** El participante del padrón; si no está, se busca en el servidor (lanza error de red sin internet). */
export async function participantePorCodigo(codigo) {
  const clave = String(codigo || "").trim().toUpperCase();
  const local = porCodigo.get(clave);
  if (local) return local;
  const snap = await conTiempo(getDocsFromServer(query(collection(db, "participantes"), where("codigo", "==", clave), limit(1))));
  if (snap.empty) return null;
  const d = snap.docs[0];
  const participante = { id: d.id, ...d.data() };
  porCodigo.set(clave, participante);
  return participante;
}
