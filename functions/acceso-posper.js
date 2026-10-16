"use strict";

// Link de POSPER sin iniciar sesión (public/acceso-posper.html, el QR de
// "QR POSPER", qrPosper.html). El link lleva una clave al azar; quien la
// tenga entra como la cuenta UID_LINK (rol posper): lo mismo que el usuario
// POSPER y nada más, así que firestore.rules y operaciones-qr.js no cambian.
//
// La clave vive solo en config/acceso_posper (firestore.rules no deja leer
// config desde el navegador). linkAccesoPosper se la da a POSPER/CEO para
// pintar el QR y la regenera: al regenerar, el link viejo deja de abrir y las
// sesiones abiertas con él se cortan al vencer su token (máximo 1 hora).

const crypto = require("crypto");
const {HttpsError} = require("firebase-functions/v2/https");
const {getAuth} = require("firebase-admin/auth");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {usuarioPuede} = require("./permisos");
const {conAjustesDeRol} = require("./ajustes-rol");

const db = getFirestore();
const UID_LINK = "posper-link";
// Así aparece en Usuarios. El nombre anterior se cambia la próxima vez que
// alguien entra con el link.
const NOMBRE_LINK = "POSPER";
const NOMBRE_LINK_ANTERIOR = "POSPER · acceso por link";
// Mismos roles que "acceso_posper" en js/core/permisos.js.
const ROLES_POSPER = new Set(["ceo", "posper"]);
const CLAVE_VALIDA = /^[A-Za-z0-9_-]{43}$/;

const refClave = () => db.collection("config").doc("acceso_posper");
const nuevaClave = () => crypto.randomBytes(32).toString("base64url");

function mismaClave(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// POSPER o CEO con su propia cuenta. La sesión abierta con el link no ve ni
// regenera la clave: si no, cualquiera con el link podría dejar fuera a los demás.
async function linkAccesoPosper(request) {
  const actorId = request.auth?.uid;
  if (!actorId) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  if (actorId === UID_LINK) {
    throw new HttpsError("permission-denied", "Solo la cuenta de POSPER puede administrar el link.");
  }
  const actorSnap = await db.collection("usuarios").doc(actorId).get();
  const actor = await conAjustesDeRol(actorSnap.exists ? actorSnap.data() : null);
  if (!usuarioPuede(actor, "acceso_posper", ROLES_POSPER)) {
    throw new HttpsError("permission-denied", "No tienes permiso para ver el link de POSPER.");
  }

  const regenerar = request.data?.regenerar === true;
  const resultado = await db.runTransaction(async (tx) => {
    const snap = await tx.get(refClave());
    const actual = snap.exists ? snap.data() : null;
    if (actual?.clave && !regenerar) {
      return {clave: actual.clave, generadoEn: actual.generadoEn?.toMillis?.() || null, reemplazada: false};
    }
    const clave = nuevaClave();
    tx.set(refClave(), {clave, generadoEn: FieldValue.serverTimestamp(), generadoPor: actorId});
    return {clave, generadoEn: Date.now(), reemplazada: !!actual?.clave};
  });

  if (resultado.reemplazada) {
    try {
      await getAuth().revokeRefreshTokens(UID_LINK);
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
    }
  }
  return {clave: resultado.clave, generadoEn: resultado.generadoEn};
}

// Público: cambia la clave del link por un token de Firebase de UID_LINK.
async function entrarConLinkPosper(request) {
  const clave = typeof request.data?.clave === "string" ? request.data.clave.trim() : "";
  if (!CLAVE_VALIDA.test(clave)) {
    throw new HttpsError("invalid-argument", "El link no es válido.");
  }
  const snap = await refClave().get();
  if (!snap.exists || !mismaClave(clave, snap.data().clave)) {
    throw new HttpsError("permission-denied", "Este link ya no es válido. Pide el QR actualizado a POSPER.");
  }

  // La cuenta se crea con rol posper la primera vez. Si después el CEO le
  // cambia el rol desde Usuarios, se respeta: el link entra con ese rol.
  const usuarioRef = db.collection("usuarios").doc(UID_LINK);
  await db.runTransaction(async (tx) => {
    const usuarioSnap = await tx.get(usuarioRef);
    if (!usuarioSnap.exists) {
      tx.set(usuarioRef, {
        nombre: NOMBRE_LINK,
        email: "",
        foto: "",
        rol: "posper",
        creadoEn: FieldValue.serverTimestamp(),
      });
    } else if (usuarioSnap.data().nombre === NOMBRE_LINK_ANTERIOR) {
      tx.update(usuarioRef, {nombre: NOMBRE_LINK});
    }
  });

  return {firebaseToken: await getAuth().createCustomToken(UID_LINK)};
}

module.exports = {linkAccesoPosper, entrarConLinkPosper, UID_LINK};
