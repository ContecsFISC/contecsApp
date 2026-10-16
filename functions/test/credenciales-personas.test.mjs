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
const conToken = m.personaVoluntario({ _docId: "d3", nombre: "Leo", id: "8-2-2", token: "abcDEF123_-x" });
assert.equal(conToken.cred.qr, "https://contecs-app.vercel.app/public/perfil-personal.html?id=d3&t=abcDEF123_-x");
assert.equal(conToken.cred.codigo, "8-2-2", "bajo el QR sigue la cédula");
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

// Grupos para la entrega: parejos, sin partir un tomo ni una letra, y sin huecos entre mesas.
assert.deepEqual(m.partesCedula("8 - 0912 - 1234"), { prefijo: "8", orden: 24, tomo: 912, asiento: 1234 });
assert.equal(m.partesCedula("pe-12-345").prefijo, "PE");
assert.equal(m.partesCedula("8-av-12-345").prefijo, "8-AV");
assert.equal(m.partesCedula("A1234567"), null);
const gente = [];
const agregar = (cedula, nombre) => gente.push({ _clave: `k${gente.length}`, _tipo: "participante", nombre, cedula });
for (let i = 0; i < 6; i++) agregar(`1-7${i}-${i}`, "Ana");
for (let i = 0; i < 30; i++) agregar(`8-${900 + Math.floor(i / 3)}-${100 - i}`, i % 2 ? "María" : "José");
for (let i = 0; i < 4; i++) agregar(`E-8-${i}`, "Zoe");
agregar("A1234567", "Ñandú"); agregar("", "Óscar");
const porCed = m.gruposEquilibrados(gente, "cedula", 4);
console.log(porCed.grupos.map(g => `${g.etiqueta}: ${g.personas.length}`).join(" | "));
assert.equal(porCed.grupos.length, 4);
assert.equal(porCed.grupos.reduce((s, g) => s + g.personas.length, 0), gente.length);
assert.ok(Math.max(...porCed.grupos.map(g => g.personas.length)) <= 12, "ningún grupo se dispara");
const tomos = porCed.grupos.map(g => new Set(g.personas.map(p => p.cedula.split("-").slice(0, 2).join("-"))));
tomos.forEach((t, i) => tomos.slice(i + 1).forEach(o => [...t].forEach(x => assert.ok(!o.has(x), `tomo ${x} partido`))));
assert.match(porCed.grupos[0].etiqueta, /^1-70 a /);
assert.match(porCed.grupos.at(-1).etiqueta, /pasaportes y otros \+ sin cédula$/);
const enOrden = [...porCed.posicion.keys()].map(k => gente.find(p => p._clave === k).cedula);
assert.deepEqual(enOrden.slice(0, 3), ["1-70-0", "1-71-1", "1-72-2"], "la pila sale ordenada por cédula");
const porNom = m.gruposEquilibrados(gente, "nombre", 3);
console.log(porNom.grupos.map(g => `${g.etiqueta}: ${g.personas.length}`).join(" | "));
assert.equal(porNom.grupos[0].etiqueta.charAt(0), "A", "la primera mesa arranca en A");
assert.match(porNom.grupos.at(-1).etiqueta, /–Z$/, "la última mesa llega hasta la Z");
assert.equal(m.inicialDe({ nombre: "Óscar" }), "O"); assert.equal(m.inicialDe({ nombre: "Ñandú" }), "Ñ"); assert.equal(m.inicialDe({ nombre: "3D" }), "#");
assert.equal(m.gruposEquilibrados(gente, "nombre", 50).grupos.length, 6, "no hay más grupos que letras");
assert.equal(m.gruposEquilibrados([], "cedula", 4).grupos.length, 0);
console.log("ok grupos");
// Centro regional y facultad para los filtros del módulo Credenciales.
const conUtp = m.personaParticipante({ id: "p9", nombre: "Iris", camposExtra: { centro: " Centro Regional de Azuero ", facultad: "Facultad de Ingeniería Civil" } });
assert.equal(conUtp._centro, "Centro Regional de Azuero"); assert.equal(conUtp._facultad, "Facultad de Ingeniería Civil");
const volUtp = m.personaVoluntario({ _docId: "d9", nombre: "Ro", id: "8-9-9", centro: "Centro Regional de Coclé", facultad: "Facultad de Ingeniería Eléctrica" });
assert.equal(volUtp._centro, "Centro Regional de Coclé"); assert.equal(volUtp._facultad, "Facultad de Ingeniería Eléctrica");
assert.equal(m.personaParticipante(part[0])._centro, "", "sin dato queda vacío");
const expUtp = m.personasExpositores({ participantes: [{ ...part[1], camposExtra: { ponencia: "si", centro: "Centro Regional de Veraguas" } }], checkpoints: [] });
assert.equal(expUtp[0]._centro, "Centro Regional de Veraguas");
console.log("ok centro y facultad");
// Docentes del comité organizador: la lista se pega tal como viene en el documento.
const lineas = [
  "Docentes:",
  "• Dr. Tomás Concepción – Asesor Académico",
  "• Ing. Carlos Rodríguez-Chong – Asesor Académico",
  "Lic. Juan Gómez\tComité de Giras",
  "",
].map(m.leerLineaDocente);
assert.equal(lineas[0], null, "el encabezado se ignora"); assert.equal(lineas[4], null);
assert.deepEqual(lineas[1], { titulo: "Dr.", nombreCompleto: "Tomás Concepción", cargo: "Asesor Académico" });
assert.equal(lineas[2].nombreCompleto, "Carlos Rodríguez-Chong", "el guion del apellido no separa el cargo");
assert.equal(lineas[3].cargo, "Comité de Giras", "dos columnas de Excel");
const doc = m.personaDocente({ id: "d1", titulo: "Dr.", nombre: "Tomás", apellido: "Concepción", cargo: "Asesor Académico" });
assert.equal(doc._tipo, "comite"); assert.equal(doc.nombreCompleto, "Dr. Tomás Concepción");
assert.equal(doc.cred.qr, ""); assert.deepEqual(doc.cred.detalle, ["Asesor Académico"]);
assert.equal(doc.cred.detalleTitulo, "", "el cargo va sin la palabra CARGO"); assert.equal(doc.cred.destacado, true);
assert.equal(m.inicialDe(doc), "T", "va en la letra del nombre, no del título");
console.log("ok docentes del comité");
