"use strict";

// cambiarRolUsuario contra el emulador: contraseña, bloqueo por intentos,
// límites (propio rol, rol de CEO) y registro en cambios_rol. Usa una
// contraseña de prueba con su propio hash: la real solo está en Secret Manager.
//   npm run test:rol   (desde functions/)

const assert = require("node:assert/strict");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp({projectId: "contecs-fa6e6"});
const db = getFirestore();
const {cambiarRolUsuario, MAX_FALLOS} = require("../cambio-rol");
const {generarHash} = require("../clave-rol");

const CLAVE = "clave-de-prueba-123";
const hashClave = generarHash(CLAVE, {N: 1024});
const como = (uid, data, hash = hashClave) => cambiarRolUsuario({auth: {uid}, data}, {hashClave: hash});
const rolDe = async (uid) => (await db.doc(`usuarios/${uid}`).get()).data().rol;

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
  for (const [uid, rol] of [["ceo", "ceo"], ["jp", "junta_principal"], ["ventas", "ventas"], ["obj", "miembro"], ["otroceo", "ceo"], ["jp2", "junta_principal"]]) {
    b.set(db.doc(`usuarios/${uid}`), {rol, email: `${uid}@example.com`});
  }
  await b.commit();
  console.log("\ncambiarRolUsuario:\n");

  await prueba("sin permiso de gestionar usuarios no puede, aunque sepa la clave", async () => {
    await rechazaCon(como("ventas", {uid: "obj", rol: "ventas", clave: CLAVE}), "permission-denied");
    assert.equal(await rolDe("obj"), "miembro");
  });

  await prueba("con la clave correcta cambia el rol y queda registrado", async () => {
    const r = await como("jp", {uid: "obj", rol: "ventas", clave: CLAVE});
    assert.equal(r.anterior, "miembro");
    assert.equal(await rolDe("obj"), "ventas");
    const log = await db.collection("cambios_rol").where("uid", "==", "obj").get();
    assert.equal(log.size, 1);
    assert.equal(log.docs[0].data().por, "jp");
    assert.equal(log.docs[0].data().nuevo, "ventas");
  });

  await prueba("clave equivocada no cambia nada y cuenta los intentos", async () => {
    await rechazaCon(como("jp", {uid: "obj", rol: "junta", clave: "mala"}), "permission-denied");
    assert.equal(await rolDe("obj"), "ventas");
    assert.equal((await db.doc("intentos_cambio_rol/jp").get()).data().fallos, 1);
  });

  await prueba(`tras ${MAX_FALLOS} fallos queda bloqueado, incluso con la clave correcta`, async () => {
    for (let i = 1; i < MAX_FALLOS; i++) {
      await rechazaCon(como("jp", {uid: "obj", rol: "junta", clave: "mala"}), "permission-denied");
    }
    await rechazaCon(como("jp", {uid: "obj", rol: "junta", clave: CLAVE}), "resource-exhausted");
    assert.equal(await rolDe("obj"), "ventas");
  });

  await prueba("un acierto borra los intentos fallidos", async () => {
    await rechazaCon(como("jp2", {uid: "obj", rol: "junta", clave: "mala"}), "permission-denied");
    await como("jp2", {uid: "obj", rol: "junta", clave: CLAVE});
    assert.equal((await db.doc("intentos_cambio_rol/jp2").get()).exists, false);
  });

  await prueba("nadie cambia su propio rol", async () => {
    await rechazaCon(como("ceo", {uid: "ceo", rol: "miembro", clave: CLAVE}), "failed-precondition");
  });

  await prueba("solo el CEO da o quita el rol de CEO", async () => {
    await rechazaCon(como("jp2", {uid: "obj", rol: "ceo", clave: CLAVE}), "permission-denied");
    await rechazaCon(como("jp2", {uid: "otroceo", rol: "miembro", clave: CLAVE}), "permission-denied");
    await como("ceo", {uid: "obj", rol: "ceo", clave: CLAVE});
    assert.equal(await rolDe("obj"), "ceo");
  });

  await prueba("rol inexistente o sin contraseña configurada", async () => {
    await rechazaCon(como("ceo", {uid: "jp2", rol: "inventado", clave: CLAVE}), "invalid-argument");
    await rechazaCon(como("ceo", {uid: "jp2", rol: "miembro", clave: CLAVE}, ""), "failed-precondition");
  });

  console.log(`\n${pasadas} pruebas pasaron.\n`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
