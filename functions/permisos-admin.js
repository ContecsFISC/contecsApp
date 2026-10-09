"use strict";

// Usuarios pide la contraseña (la misma de cambiar roles) al entrar. Con ella
// desbloquearUsuarios entrega un pase firmado que dura PASE_MS; con ese pase
// el CEO guarda permisos individuales (usuarios/{uid}.permisosExtra) y
// permisos por rol (config/permisos_roles) sin volver a escribirla. Cambiar
// un rol sigue pidiendo la contraseña cada vez (cambio-rol.js).
// firestore.rules no deja escribir nada de esto desde el navegador.

const {HttpsError} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue, FieldPath, Timestamp} = require("firebase-admin/firestore");
const {usuarioPuede, ROLES_CON_AJUSTES} = require("./permisos");
const {conAjustesDeRol, olvidarCache} = require("./ajustes-rol");
const {comprobarClave, ROLES_GESTIONAR_USUARIOS} = require("./cambio-rol");
const {firmarPase, paseValido} = require("./clave-rol");

const db = getFirestore();
const PASE_MS = 2 * 60 * 60 * 1000;
const MAX_AJUSTES = 150;
const ID_PERMISO = /^[a-z][a-z0-9_]{1,59}$/;
const ID_USUARIO = /^[A-Za-z0-9_-]{1,128}$/;

function exigirClaveConfigurada(hashClave) {
  if (!hashClave) {
    throw new HttpsError("failed-precondition", "La contraseña de Usuarios no está configurada.");
  }
}

async function actorDe(request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const snap = await db.collection("usuarios").doc(request.auth.uid).get();
  return await conAjustesDeRol(snap.exists ? snap.data() : null);
}

// Guardar permisos: solo el CEO y con un pase vigente.
async function exigirCeoConPase(request, hashClave) {
  exigirClaveConfigurada(hashClave);
  const actor = await actorDe(request);
  if (actor?.rol !== "ceo") throw new HttpsError("permission-denied", "Solo el CEO cambia permisos.");
  if (!paseValido(request.data?.pase, request.auth.uid, hashClave)) {
    throw new HttpsError("unauthenticated", "La sesión de Usuarios venció. Vuelve a escribir la contraseña.");
  }
  return actor;
}

function esObjetoPlano(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

// { permiso: {modo: "otorgar", vence: ms|null} | {modo: "quitar"} } -> lo que
// se guarda (vence como Timestamp). conVence=false para los de rol.
function limpiarAjustes(entrada, {conVence}) {
  if (!esObjetoPlano(entrada)) throw new HttpsError("invalid-argument", "Ajustes inválidos.");
  const ids = Object.keys(entrada);
  if (ids.length > MAX_AJUSTES) throw new HttpsError("invalid-argument", "Demasiados ajustes.");
  const ahora = Date.now();
  const salida = {};
  for (const id of ids) {
    const a = entrada[id];
    if (!ID_PERMISO.test(id) || !esObjetoPlano(a)) {
      throw new HttpsError("invalid-argument", `Ajuste inválido: ${id.slice(0, 60)}`);
    }
    if (a.modo === "quitar") {
      salida[id] = {modo: "quitar"};
    } else if (a.modo === "otorgar") {
      if (!conVence || a.vence == null) {
        salida[id] = conVence ? {modo: "otorgar", vence: null} : {modo: "otorgar"};
      } else if (Number.isFinite(a.vence) && a.vence > ahora) {
        salida[id] = {modo: "otorgar", vence: Timestamp.fromMillis(a.vence)};
      } else {
        throw new HttpsError("invalid-argument", "Una fecha de vencimiento ya pasó.");
      }
    } else {
      throw new HttpsError("invalid-argument", `Ajuste inválido: ${id}`);
    }
  }
  return salida;
}

// Para la bitácora: vence en ms, comparable y legible.
function paraBitacora(ajustes) {
  const salida = {};
  Object.entries(ajustes || {}).forEach(([id, a]) => {
    salida[id] = a?.vence?.toMillis ? {modo: a.modo, vence: a.vence.toMillis()} : {...a};
  });
  return salida;
}

async function desbloquearUsuarios(request, {hashClave}) {
  exigirClaveConfigurada(hashClave);
  const actor = await actorDe(request);
  if (!usuarioPuede(actor, "gestionar_usuarios", ROLES_GESTIONAR_USUARIOS)) {
    throw new HttpsError("permission-denied", "No tienes acceso a Usuarios.");
  }
  await comprobarClave(request.auth.uid, request.data?.clave, hashClave, "desbloquearUsuarios");
  return firmarPase(request.auth.uid, hashClave, PASE_MS);
}

async function guardarPermisosUsuario(request, {hashClave}) {
  const actor = await exigirCeoConPase(request, hashClave);
  const uid = typeof request.data?.uid === "string" ? request.data.uid.trim() : "";
  if (!ID_USUARIO.test(uid)) throw new HttpsError("invalid-argument", "El usuario no es válido.");
  const permisosExtra = limpiarAjustes(request.data?.permisosExtra, {conVence: true});

  const ref = db.collection("usuarios").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "El usuario ya no existe.");
  const batch = db.batch();
  batch.update(ref, {
    permisosExtra,
    permisosActualizadosPor: request.auth.uid,
    permisosActualizadosEn: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection("cambios_permisos").doc(), {
    tipo: "usuario", uid, email: snap.data().email || null, rol: snap.data().rol || null,
    anterior: paraBitacora(snap.data().permisosExtra), nuevo: paraBitacora(permisosExtra),
    por: request.auth.uid, porEmail: actor.email || null, en: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  console.log("guardarPermisosUsuario:", uid, Object.keys(permisosExtra).length, "ajustes, por", request.auth.uid);
  return {ok: true};
}

async function guardarPermisosRol(request, {hashClave}) {
  const actor = await exigirCeoConPase(request, hashClave);
  const rol = typeof request.data?.rol === "string" ? request.data.rol.trim() : "";
  if (!ROLES_CON_AJUSTES.has(rol)) throw new HttpsError("invalid-argument", "Ese rol no admite ajustes.");
  const ajustes = limpiarAjustes(request.data?.ajustes, {conVence: false});

  const ref = db.collection("config").doc("permisos_roles");
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const anterior = (snap.exists && snap.data().roles?.[rol]) || {};
    // update con la ruta reemplaza el mapa del rol entero (set con merge
    // dejaría los permisos que se quitaron).
    if (snap.exists) {
      tx.update(ref, new FieldPath("roles", rol), ajustes,
          "actualizadoPor", request.auth.uid, "actualizadoEn", FieldValue.serverTimestamp());
    } else {
      tx.set(ref, {roles: {[rol]: ajustes}, actualizadoPor: request.auth.uid, actualizadoEn: FieldValue.serverTimestamp()});
    }
    tx.set(db.collection("cambios_permisos").doc(), {
      tipo: "rol", rol, anterior, nuevo: ajustes,
      por: request.auth.uid, porEmail: actor.email || null, en: FieldValue.serverTimestamp(),
    });
  });
  olvidarCache();
  console.log("guardarPermisosRol:", rol, Object.keys(ajustes).length, "ajustes, por", request.auth.uid);
  return {ok: true};
}

module.exports = {desbloquearUsuarios, guardarPermisosUsuario, guardarPermisosRol, limpiarAjustes, PASE_MS};
