"use strict";

// Ajustes de permisos por rol (config/permisos_roles), los que el CEO cambia
// desde Usuarios → "Permisos por rol". Se leen con una caché corta para no
// sumar una lectura a cada llamada: un cambio tarda hasta CACHE_MS en llegar
// a las funciones (las reglas y el panel lo ven al instante).
//
// Documento: { roles: { ventas: { ver_participantes: { modo: "otorgar" } } } }

const {getFirestore} = require("firebase-admin/firestore");

const CACHE_MS = 30 * 1000;
let cache = {en: 0, roles: {}};

async function ajustesDeRoles() {
  if (Date.now() - cache.en < CACHE_MS) return cache.roles;
  const snap = await getFirestore().doc("config/permisos_roles").get();
  cache = {en: Date.now(), roles: (snap.exists && snap.data().roles) || {}};
  return cache.roles;
}

// El usuario con los ajustes de su rol, listo para usuarioPuede().
async function conAjustesDeRol(usuario) {
  if (!usuario) return null;
  const roles = await ajustesDeRoles();
  return {...usuario, _ajustesRol: roles[usuario.rol] || {}};
}

function olvidarCache() {
  cache = {en: 0, roles: {}};
}

module.exports = {conAjustesDeRol, ajustesDeRoles, olvidarCache};
