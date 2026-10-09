"use strict";

// Entrada a Usuarios con contraseña y guardado de permisos (permisos-admin.js)
// contra el emulador. Usa una contraseña de prueba con su propio hash: la
// real solo está en Secret Manager.
//   npm run test:permisos-admin   (desde functions/)

const assert = require("node:assert/strict");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp({projectId: "contecs-fa6e6"});
const db = getFirestore();
const {desbloquearUsuarios, guardarPermisosUsuario, guardarPermisosRol} = require("../permisos-admin");
const {conAjustesDeRol, olvidarCache} = require("../ajustes-rol");
const {usuarioPuede} = require("../permisos");
const {generarHash, firmarPase} = require("../clave-rol");

const CLAVE = "clave-de-prueba-123";
const hashClave = generarHash(CLAVE, {N: 1024});
const llamar = (fn, uid, data, hash = hashClave) => fn({auth: uid ? {uid} : undefined, data}, {hashClave: hash});
const MANANA = Date.now() + 24 * 3600 * 1000;

let pasadas = 0;
async function prueba(nombre, fn) {
  await fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}
async function rechazaCon(promesa, codigo) {
  await assert.rejects(promesa, (e) => {
    assert.equal(e.code, codigo, e.message);
    return true;
  });
}

async function main() {
  const b = db.batch();
  for (const [uid, rol] of [["ceo", "ceo"], ["jp", "junta_principal"], ["ventas", "ventas"], ["v2", "ventas"]]) {
    b.set(db.doc(`usuarios/${uid}`), {rol, email: `${uid}@example.com`});
  }
  await b.commit();
  console.log("\nUsuarios con contraseña:\n");

  let pase;
  await prueba("sin sesión o sin acceso a Usuarios no hay pase", async () => {
    await rechazaCon(llamar(desbloquearUsuarios, null, {clave: CLAVE}), "unauthenticated");
    await rechazaCon(llamar(desbloquearUsuarios, "ventas", {clave: CLAVE}), "permission-denied");
  });

  await prueba("clave equivocada no da pase y cuenta el intento", async () => {
    await rechazaCon(llamar(desbloquearUsuarios, "ceo", {clave: "mala"}), "permission-denied");
    assert.equal((await db.doc("intentos_cambio_rol/ceo").get()).data().fallos, 1);
  });

  await prueba("clave correcta da un pase de 2 horas y borra los intentos", async () => {
    const r = await llamar(desbloquearUsuarios, "ceo", {clave: CLAVE});
    pase = r.pase;
    assert.ok(pase && r.vence > Date.now() + 110 * 60 * 1000);
    assert.equal((await db.doc("intentos_cambio_rol/ceo").get()).exists, false);
  });

  await prueba("junta principal entra a Usuarios pero no guarda permisos", async () => {
    const r = await llamar(desbloquearUsuarios, "jp", {clave: CLAVE});
    await rechazaCon(llamar(guardarPermisosUsuario, "jp", {pase: r.pase, uid: "ventas", permisosExtra: {}}), "permission-denied");
  });

  await prueba("sin pase, con pase de otro, vencido o de otra clave: no guarda", async () => {
    const datos = {uid: "ventas", permisosExtra: {ver_participantes: {modo: "otorgar", vence: null}}};
    await rechazaCon(llamar(guardarPermisosUsuario, "ceo", datos), "unauthenticated");
    await rechazaCon(llamar(guardarPermisosUsuario, "ceo", {...datos, pase: firmarPase("jp", hashClave, 60000).pase}), "unauthenticated");
    await rechazaCon(llamar(guardarPermisosUsuario, "ceo", {...datos, pase: firmarPase("ceo", hashClave, -1).pase}), "unauthenticated");
    await rechazaCon(llamar(guardarPermisosUsuario, "ceo", {...datos, pase: firmarPase("ceo", generarHash("otra", {N: 1024}), 60000).pase}), "unauthenticated");
    await rechazaCon(llamar(guardarPermisosUsuario, "ceo", {...datos, pase: pase.slice(0, -2) + "xx"}), "unauthenticated");
    assert.equal((await db.doc("usuarios/ventas").get()).data().permisosExtra, undefined);
  });

  await prueba("el CEO con pase guarda permisos individuales y queda registro", async () => {
    await llamar(guardarPermisosUsuario, "ceo", {pase, uid: "ventas", permisosExtra: {
      ver_participantes: {modo: "otorgar", vence: MANANA},
      acceso_venta_rapida: {modo: "quitar"},
    }});
    const u = (await db.doc("usuarios/ventas").get()).data();
    assert.equal(u.permisosExtra.ver_participantes.vence.toMillis(), MANANA);
    assert.deepEqual(u.permisosExtra.acceso_venta_rapida, {modo: "quitar"});
    assert.equal(u.permisosActualizadosPor, "ceo");
    const log = await db.collection("cambios_permisos").where("uid", "==", "ventas").get();
    assert.equal(log.size, 1);
    assert.equal(log.docs[0].data().nuevo.ver_participantes.vence, MANANA);
  });

  await prueba("rechaza ajustes mal formados o con fecha pasada", async () => {
    for (const permisosExtra of [
      null, [], {"Mal-Id": {modo: "quitar"}}, {ver_participantes: {modo: "todo"}},
      {ver_participantes: {modo: "otorgar", vence: Date.now() - 1000}}, {ver_participantes: "otorgar"},
    ]) {
      await rechazaCon(llamar(guardarPermisosUsuario, "ceo", {pase, uid: "ventas", permisosExtra}), "invalid-argument");
    }
  });

  await prueba("permisos por rol: reemplaza el mapa del rol y aplica en el servidor", async () => {
    await rechazaCon(llamar(guardarPermisosRol, "ceo", {pase, rol: "ceo", ajustes: {}}), "invalid-argument");
    await llamar(guardarPermisosRol, "ceo", {pase, rol: "ventas", ajustes: {
      gestionar_inscripciones: {modo: "otorgar"}, ventas_exportar: {modo: "quitar"},
    }});
    await llamar(guardarPermisosRol, "ceo", {pase, rol: "ventas", ajustes: {gestionar_inscripciones: {modo: "otorgar"}}});
    const cfg = (await db.doc("config/permisos_roles").get()).data();
    assert.deepEqual(cfg.roles.ventas, {gestionar_inscripciones: {modo: "otorgar"}});
    olvidarCache();
    const v2 = await conAjustesDeRol((await db.doc("usuarios/v2").get()).data());
    assert.equal(usuarioPuede(v2, "evento_asistencia", new Set(["ceo", "staff_contecs"])), true);
    const log = await db.collection("cambios_permisos").where("rol", "==", "ventas").where("tipo", "==", "rol").get();
    assert.equal(log.size, 2);
  });

  await prueba("permisos por rol: solo el CEO", async () => {
    const r = await llamar(desbloquearUsuarios, "jp", {clave: CLAVE});
    await rechazaCon(llamar(guardarPermisosRol, "jp", {pase: r.pase, rol: "ventas", ajustes: {}}), "permission-denied");
  });

  console.log(`\n${pasadas} pruebas pasaron.\n`);
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
