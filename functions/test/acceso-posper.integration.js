"use strict";

// Link de POSPER sin iniciar sesión contra los emuladores (Firestore y Auth):
// quién ve y regenera la clave, y que solo la clave vigente abre sesión.
//   npm run test:posper   (desde functions/)

const assert = require("node:assert/strict");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp({projectId: "contecs-fa6e6"});
const db = getFirestore();
const {linkAccesoPosper, entrarConLinkPosper, UID_LINK} = require("../acceso-posper");

const pedir = (uid, data = {}) => linkAccesoPosper({auth: uid ? {uid} : undefined, data});
const entrar = (clave) => entrarConLinkPosper({data: {clave}});

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
  for (const [uid, rol] of [["posper", "posper"], ["ceo", "ceo"], ["ventas", "ventas"]]) {
    b.set(db.doc(`usuarios/${uid}`), {rol, email: `${uid}@example.com`});
  }
  await b.commit();
  console.log("\nAcceso de POSPER por link:\n");

  await prueba("sin sesión o sin acceso_posper no se ve la clave", async () => {
    await rechazaCon(pedir(null), "unauthenticated");
    await rechazaCon(pedir("ventas"), "permission-denied");
    assert.equal((await db.doc("config/acceso_posper").get()).exists, false);
  });

  let clave;
  await prueba("POSPER recibe una clave y la misma en cada consulta", async () => {
    clave = (await pedir("posper")).clave;
    assert.match(clave, /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await pedir("ceo")).clave, clave);
    assert.equal((await pedir("posper")).clave, clave);
  });

  await prueba("la clave abre sesión y crea la cuenta del link con rol posper", async () => {
    const {firebaseToken} = await entrar(clave);
    assert.ok(firebaseToken);
    const cuenta = (await db.doc(`usuarios/${UID_LINK}`).get()).data();
    assert.equal(cuenta.rol, "posper");
  });

  await prueba("claves mal formadas o equivocadas no entran", async () => {
    await rechazaCon(entrar(""), "invalid-argument");
    await rechazaCon(entrar("x".repeat(200)), "invalid-argument");
    await rechazaCon(entrar(`${clave.slice(0, -1)}${clave.endsWith("A") ? "B" : "A"}`), "permission-denied");
  });

  await prueba("la sesión del link no puede ver ni regenerar la clave", async () => {
    await rechazaCon(pedir(UID_LINK), "permission-denied");
    await rechazaCon(pedir(UID_LINK, {regenerar: true}), "permission-denied");
    assert.equal((await pedir("posper")).clave, clave);
  });

  await prueba("al regenerar, la clave vieja deja de abrir y la nueva sí", async () => {
    const nueva = (await pedir("posper", {regenerar: true})).clave;
    assert.notEqual(nueva, clave);
    await rechazaCon(entrar(clave), "permission-denied");
    assert.ok((await entrar(nueva)).firebaseToken);
    assert.equal((await db.doc("config/acceso_posper").get()).data().generadoPor, "posper");
  });

  await prueba("si el CEO le cambia el rol a la cuenta del link, se respeta", async () => {
    await db.doc(`usuarios/${UID_LINK}`).update({rol: "sin_rol"});
    await entrar((await pedir("ceo")).clave);
    assert.equal((await db.doc(`usuarios/${UID_LINK}`).get()).data().rol, "sin_rol");
  });

  console.log(`\n${pasadas} pruebas pasaron.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
