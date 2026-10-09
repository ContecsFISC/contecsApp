"use strict";

// Cambiar el rol de un usuario del panel exige una contraseña. La contraseña
// no está en el código ni en el repo: en Secret Manager vive solo su hash
// (secreto ROL_CLAVE_HASH, formato scrypt$N$r$p$sal$hash). firestore.rules
// no deja cambiar `rol` desde el navegador, así que este es el único camino.
//
// Para cambiar la contraseña:
//   node functions/herramientas/hash-clave-rol.js > %TEMP%\h.txt   (pide la clave)
//   firebase functions:secrets:set ROL_CLAVE_HASH --data-file %TEMP%\h.txt
//   (borrar h.txt) y volver a desplegar cambiarRolUsuario.

const {HttpsError} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue, Timestamp} = require("firebase-admin/firestore");
const {usuarioPuede} = require("./permisos");
const {conAjustesDeRol} = require("./ajustes-rol");
const {verificarClave} = require("./clave-rol");

const db = getFirestore();

// Mismos roles que "gestionar_usuarios" en js/core/permisos.js.
const ROLES_GESTIONAR_USUARIOS = new Set(["ceo", "junta_principal"]);
const ROLES_VALIDOS = new Set([
  "sin_rol", "ceo", "junta_principal", "junta", "coordinador", "finanzas",
  "logistica", "ventas", "secretario", "actividades", "patrocinios",
  "investigacion", "voluntariado", "giras", "comunicaciones", "staff_contecs",
  "miembro", "posper",
]);
// Tras 5 contraseñas equivocadas seguidas, 15 minutos sin poder intentar.
const MAX_FALLOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

// Revisa la contraseña con el límite de intentos (intentos_cambio_rol/{uid},
// compartido por todo lo que la pide). Si falla, lanza el HttpsError.
async function comprobarClave(actorId, clave, hashClave, origen) {
  const intentosRef = db.collection("intentos_cambio_rol").doc(actorId);
  const intentosSnap = await intentosRef.get();
  const intentos = intentosSnap.exists ? intentosSnap.data() : {};
  const bloqueadoHasta = intentos.bloqueadoHasta?.toMillis?.() || 0;
  if (bloqueadoHasta > Date.now()) {
    const minutos = Math.ceil((bloqueadoHasta - Date.now()) / 60000);
    throw new HttpsError("resource-exhausted", `Demasiados intentos. Vuelve a intentar en ${minutos} min.`);
  }

  if (!verificarClave(clave, hashClave)) {
    const fallos = (intentos.bloqueadoHasta && bloqueadoHasta <= Date.now() ? 0 : intentos.fallos || 0) + 1;
    await intentosRef.set({
      fallos,
      ultimoFallo: FieldValue.serverTimestamp(),
      bloqueadoHasta: fallos >= MAX_FALLOS ? Timestamp.fromMillis(Date.now() + BLOQUEO_MS) : null,
    });
    console.warn(`${origen}: contraseña incorrecta de`, actorId, `(${fallos})`);
    throw new HttpsError("permission-denied", fallos >= MAX_FALLOS ?
      "Contraseña incorrecta. Demasiados intentos: espera 15 minutos." :
      `Contraseña incorrecta. Te quedan ${MAX_FALLOS - fallos} intento${MAX_FALLOS - fallos !== 1 ? "s" : ""}.`);
  }
  if (intentosSnap.exists) await intentosRef.delete();
}

async function cambiarRolUsuario(request, {hashClave}) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const actorId = request.auth.uid;
  const uid = typeof request.data?.uid === "string" ? request.data.uid.trim() : "";
  const rol = typeof request.data?.rol === "string" ? request.data.rol.trim() : "";
  const clave = request.data?.clave;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new HttpsError("invalid-argument", "El usuario no es válido.");
  if (!ROLES_VALIDOS.has(rol)) throw new HttpsError("invalid-argument", "Ese rol no existe.");
  if (!hashClave) {
    throw new HttpsError("failed-precondition", "La contraseña para cambiar roles no está configurada.");
  }

  const actorRef = db.collection("usuarios").doc(actorId);
  const objetivoRef = db.collection("usuarios").doc(uid);
  const [actorSnap, objetivoSnap] = await db.getAll(actorRef, objetivoRef);
  const actor = await conAjustesDeRol(actorSnap.exists ? actorSnap.data() : null);
  if (!usuarioPuede(actor, "gestionar_usuarios", ROLES_GESTIONAR_USUARIOS)) {
    throw new HttpsError("permission-denied", "No tienes permiso para cambiar roles.");
  }

  await comprobarClave(actorId, clave, hashClave, "cambiarRolUsuario");

  if (!objetivoSnap.exists) throw new HttpsError("not-found", "El usuario ya no existe.");
  const anterior = objetivoSnap.data().rol || "sin_rol";
  if (uid === actorId) throw new HttpsError("failed-precondition", "No puedes cambiar tu propio rol.");
  if (actor.rol !== "ceo" && (rol === "ceo" || anterior === "ceo")) {
    throw new HttpsError("permission-denied", "Solo el CEO da o quita el rol de CEO.");
  }

  const batch = db.batch();
  if (anterior !== rol) {
    batch.update(objetivoRef, {
      rol, rolCambiadoPor: actorId, rolCambiadoEn: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection("cambios_rol").doc(), {
      uid, email: objetivoSnap.data().email || null, anterior, nuevo: rol,
      por: actorId, porEmail: actor.email || null, en: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log("cambiarRolUsuario:", uid, anterior, "->", rol, "por", actorId);
  return {ok: true, anterior, rol};
}

module.exports = {cambiarRolUsuario, comprobarClave, ROLES_GESTIONAR_USUARIOS, MAX_FALLOS};
