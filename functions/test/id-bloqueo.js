// Calcula el ID del documento-lock de identidad que usa registrarParticipante.
//
// La colección `identificadores_participantes` es `read, write: if false` en
// firestore.rules: no se puede consultar desde la app ni desde el panel, solo
// desde la Consola de Firebase. Como el ID es determinista, este script lo
// deriva sin tocar la base de datos, para poder ir directo al documento.
//
//   node functions/test/id-bloqueo.js <cedula> <correo>
//   node functions/test/id-bloqueo.js 8-1234-56789
//   node functions/test/id-bloqueo.js "" alguien@utp.ac.pa
//
// Usa las mismas funciones que producción (functions/identidad.js), para que
// no se pueda desincronizar con lo que realmente hace registrarParticipante.

const {idBloqueoParticipante, generarDocId} = require("../identidad");

const PROYECTO = "contecs-fa6e6";

function consola(coleccion, docId) {
  return `https://console.firebase.google.com/project/${PROYECTO}` +
    `/firestore/databases/-default-/data/~2F${coleccion}~2F${docId}`;
}

const [cedula = "", correo = ""] = process.argv.slice(2);

if (!cedula && !correo) {
  console.error("Uso: node functions/test/id-bloqueo.js <cedula> <correo>");
  process.exit(1);
}

console.log("\nRevisa si alguno de estos documentos EXISTE. Si existe alguno,");
console.log("ese es el que está bloqueando el registro.\n");

if (cedula) {
  const id = idBloqueoParticipante("cedula", cedula);
  console.log(`  cédula  ${cedula}`);
  console.log(`  -> identificadores_participantes/${id}`);
  console.log(`     ${consola("identificadores_participantes", id)}\n`);
}

if (correo) {
  const id = idBloqueoParticipante("correo", correo);
  console.log(`  correo  ${correo}`);
  console.log(`  -> identificadores_participantes/${id}`);
  console.log(`     ${consola("identificadores_participantes", id)}\n`);
}

const docId = generarDocId(cedula, correo);
if (docId) {
  console.log(`  documento del participante`);
  console.log(`  -> participantes/${docId}`);
  console.log(`     ${consola("participantes", docId)}\n`);
}

console.log("Además, en la Consola busca en `participantes` un documento cuyo");
console.log("campo `correo` sea exactamente el de arriba: la comprobación");
console.log("histórica de registrarParticipante consulta SOLO por correo.\n");
