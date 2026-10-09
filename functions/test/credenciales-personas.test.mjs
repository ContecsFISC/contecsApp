// Quién lleva credencial (js/modulos/personas-credenciales.js): voluntarios y comité con su
// cédula en el QR, expositores inscritos con su QR de acceso, externos y agregados a mano sin QR.
//   node functions/test/credenciales-personas.test.mjs

import assert from "node:assert/strict";
const m = await import("../../js/modulos/personas-credenciales.js");
const part = [
  { id: "p1", nombre: "Ana", apellido: "Pérez", codigo: "UTP-001", token: "t1", categoria: "estudiante_utp", pago: { estado: "aprobado" } },
  { id: "p2", nombre: "Luis", apellido: "Gómez", codigo: "EXT-002", token: "t2", camposExtra: { ponencia: "si" } },
  { id: "p3", nombre: "Sin", apellido: "Token" },
];
const cps = [
  { id: "c1", nombre: "IA aplicada", dia: "2026-10-13", horaInicio: "09:00", ponenteId: "p2" },
  { id: "c2", nombre: "Ciberseguridad", dia: "2026-10-13", horaInicio: "11:00", exponente: "Dra. Marta Ruiz" },
  { id: "c3", nombre: "Redes 5G", dia: "2026-10-14", horaInicio: "10:00", exponente: "dra. marta ruiz" },
  { id: "c4", nombre: "Cancelada", dia: "2026-10-14", horaInicio: "15:00", exponente: "Otro", estado: "cancelado" },
  { id: "c5", nombre: "Panel", dia: "2026-10-14", horaInicio: "16:00", exponente: "Luis Gómez" },
];
const pp = m.personaParticipante(part[0]);
assert.equal(pp._imprimible, true); assert.equal(pp._aprobado, true); assert.equal(pp.cred, undefined);
assert.equal(m.personaParticipante(part[2])._imprimible, false);
const v = m.personaVoluntario({ _docId: "d1", nombre: "Eva", apellido: "Ríos", id: "8-1-1", grupo: "comite", carrera: "ISC" });
assert.equal(v._tipo, "comite"); assert.equal(v.cred.qr, "8-1-1"); assert.equal(v._clave, "voluntario_d1"); assert.equal(v.cred.tema, "comite");
assert.equal(m.personaVoluntario({ _docId: "d2", nombre: "X" })._imprimible, false);
const ex = m.personasExpositores({ participantes: part, checkpoints: cps });
console.log(ex.map(e => `${e.nombreCompleto || e.nombre + " " + e.apellido} | ${e._clave} | qr=${!!e.cred.qr} | ${e.cred.detalle.join(" / ")}`).join("\n"));
assert.equal(ex.length, 2);
const luis = ex.find(e => e._clave === "expositor_p2"); assert.equal(luis.cred.detalle.length, 2, "IA aplicada + Panel");
const marta = ex.find(e => e._origen === "externo");
assert.equal(marta.cred.detalle.length, 2); assert.equal(marta.cred.qr, "");
assert.equal(m.lineaCharla(cps[0]), "IA aplicada — mar 13 oct, 09:00");
console.log("ok");
const ex2 = m.personasExpositores({ participantes: part, checkpoints: cps, manuales: [
  { id: "m1", nombre: "Marta", apellido: "Ruiz", institucion: "UNACHI", tema: "x" },
  { id: "m2", nombre: "Pedro", apellido: "Sol", institucion: "SENACYT", tema: "Ciencia abierta" },
] });
console.log(ex2.map(e => `${e.nombreCompleto || e.nombre} | ${e._origen || "inscrito"} | ${e.cred.detalleTitulo}: ${e.cred.detalle.join(" / ")}`).join("\n"));
const pedro = ex2.find(e => e._clave === "expositor_man_m2"); assert.deepEqual(pedro.cred.detalle, ["Ciencia abierta"]); assert.equal(pedro.cred.institucion, "SENACYT");
assert.equal(ex2.filter(e => e._origen === "externo").length, 1, "Dra. Marta Ruiz sigue como externa (nombre distinto a 'Marta Ruiz')");
console.log("ok manuales");
