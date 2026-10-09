// =============================================
// CONTECS — Salones en Firestore
// =============================================
// Lectura y guardado de la colección `salones` (un doc por espacio del
// plano). Lo comparten la pestaña Salones de Gestión de Eventos y el Mapa del
// evento, para que ambos validen igual que firestore.rules.

import { auth, db } from "./firebase-config.js";
import {
  collection, deleteDoc, doc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, where,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { RE_ESPACIO, ROTULO_MAX } from "./agenda-salones.js";

const aMapa = snap => Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));

export async function leerSalones() {
  return aMapa(await getDocs(collection(db, "salones")));
}

export function escucharSalones(alCambiar, alFallar) {
  return onSnapshot(collection(db, "salones"), snap => alCambiar(aMapa(snap)), alFallar);
}

// Devuelve el mensaje de error o null.
export function validarSalon({ espacioId, nombre, rotulo, capacidad }) {
  if (!RE_ESPACIO.test(String(espacioId || ""))) return "Elige el espacio del plano.";
  if (!String(nombre || "").trim()) return "Escribe el nombre que verán los asistentes.";
  if (String(nombre).trim().length > 100) return "El nombre no puede pasar de 100 caracteres.";
  if (String(rotulo || "").trim().length > ROTULO_MAX) return `El rótulo no puede pasar de ${ROTULO_MAX} caracteres.`;
  const cap = Number(capacidad);
  if (!Number.isInteger(cap) || cap < 1 || cap > 100000) return "La capacidad debe ser un número entero mayor que 0.";
  return null;
}

export async function guardarSalon({ espacioId, nombre, rotulo, capacidad }) {
  const error = validarSalon({ espacioId, nombre, rotulo, capacidad });
  if (error) throw new Error(error);
  await setDoc(doc(db, "salones", espacioId), {
    espacioId,
    piso: espacioId.split("-")[0],
    nombre: String(nombre).trim(),
    rotulo: String(rotulo || "").trim(),
    capacidad: Number(capacidad),
    actualizadoEn: serverTimestamp(),
    actualizadoPor: auth.currentUser?.uid || "",
  });
}

// No se borra un salón que todavía usa algún checkpoint.
export async function eliminarSalon(espacioId) {
  const uso = await getDocs(query(collection(db, "checkpoints"), where("salonId", "==", espacioId), limit(1)));
  if (!uso.empty) {
    const cp = uso.docs[0].data();
    throw new Error(`Lo usa el checkpoint "${cp.nombre || "sin nombre"}"${cp.eventoNombre ? ` (${cp.eventoNombre})` : ""}. Cámbialo de salón primero.`);
  }
  await deleteDoc(doc(db, "salones", espacioId));
}
