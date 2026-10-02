// Piezas de la inscripción que comparten registrarParticipante (registro.html)
// e importarParticipantes (listas de profesores, desde el panel): categorías y
// precios, el token de acceso, la secuencia de códigos y la creación atómica
// del participante con sus documentos-lock de identidad. Viven juntas para que
// una persona importada quede exactamente igual que una inscrita en el
// formulario.
//
// Requiere que index.js (o la prueba) haya llamado a initializeApp() antes.

const crypto = require("crypto");
const {HttpsError} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {
  idBloqueoParticipante,
  errorDuplicado,
  locksQueBloquean,
} = require("./identidad");

const db = getFirestore();

const CATEGORIAS_REGISTRO = Object.freeze({
  estudiante_utp: {nombre: "Estudiante UTP", precio: 10},
  estudiante_externo: {nombre: "Estudiante Externo", precio: 20},
  academico_utp: {nombre: "Académico UTP", precio: 20},
  academico_externo: {nombre: "Académico Externo", precio: 30},
  profesional: {nombre: "Profesional", precio: 30},
  otros: {nombre: "Otros", precio: 20},
  colegio: {nombre: "Colegio", precio: 6},
});

function generarToken() {
  return crypto.randomBytes(24).toString("hex");
}

// Un documento-lock de `identificadores_participantes` solo significa "esta
// identidad ya está tomada" mientras el participante al que apunta siga
// existiendo. Si alguien borró al participante (por ejemplo un registro de
// prueba, desde la Consola), el lock quedaba huérfano y bloqueaba esa cédula y
// ese correo PARA SIEMPRE, sin que nadie pudiera averiguar por qué: la
// colección es `read, write: if false`, invisible desde la app y desde el panel.
//
// Por eso el lock ya no se toma como prueba por sí solo — se comprueba que el
// participante referenciado exista de verdad. Si no existe, el lock está muerto
// y se sobrescribe. Esto repara también los huérfanos que ya estuvieran ahí,
// sin tener que limpiarlos a mano.
//
// registro.html siempre pide correo, pero una lista importada puede no traerlo:
// el lock de correo solo se toma si hay correo. Sin esa condición, todos los
// que llegan sin correo chocarían en el mismo lock (el del correo vacío).
async function crearParticipantesUnicos(registros) {
  const entradas = registros.map((registro) => ({
    ...registro,
    correoRef: registro.correo ?
      db.collection("identificadores_participantes")
          .doc(idBloqueoParticipante("correo", registro.correo)) : null,
    cedulaRef: registro.cedula ?
      db.collection("identificadores_participantes")
          .doc(idBloqueoParticipante("cedula", registro.cedula)) : null,
  }));

  // Cada lock recuerda a qué campo y valor corresponde, para poder decir
  // exactamente cuál chocó en vez de un "cédula o correo" ambiguo.
  const locks = entradas.flatMap((entrada) => [
    ...(entrada.correoRef ?
      [{ref: entrada.correoRef, campo: "correo", valor: entrada.correo}] : []),
    ...(entrada.cedulaRef ?
      [{ref: entrada.cedulaRef, campo: "cedula", valor: entrada.cedula}] : []),
  ]);

  const rutas = [
    ...entradas.map((entrada) => entrada.docRef.path),
    ...locks.map((lock) => lock.ref.path),
  ];
  if (new Set(rutas).size !== rutas.length) {
    throw new HttpsError(
        "already-exists",
        "El grupo contiene cédulas o correos repetidos.",
    );
  }

  await db.runTransaction(async (tx) => {
    // ── Lectura 1: los documentos de participante ──────────────────────────
    const docSnaps = await tx.getAll(...entradas.map((e) => e.docRef));
    const ocupado = docSnaps.findIndex((snap) => snap.exists);
    if (ocupado !== -1) {
      const entrada = entradas[ocupado];
      // generarDocId deriva el id de la cédula si la hay, y del correo si no.
      throw entrada.cedula ?
        errorDuplicado("cedula", entrada.cedula) :
        errorDuplicado("correo", entrada.correo);
    }

    // ── Lectura 2: los locks de esas identidades ───────────────────────────
    const lockSnaps = locks.length ? await tx.getAll(...locks.map((l) => l.ref)) : [];
    const ocupados = [];
    lockSnaps.forEach((snap, i) => {
      if (snap.exists) {
        ocupados.push({
          lock: locks[i],
          participanteId: snap.data()?.participanteId || null,
        });
      }
    });

    // ── Lectura 3: ¿siguen vivos los participantes que apuntan esos locks? ──
    // Se indexa por id de documento, no por posición, para que no dependa del
    // orden en que Firestore devuelva los snapshots.
    const idsVivos = new Set();
    const idsReferenciados = [
      ...new Set(ocupados.map((o) => o.participanteId).filter(Boolean)),
    ];
    if (idsReferenciados.length) {
      const objetivoSnaps = await tx.getAll(
          ...idsReferenciados.map((id) => db.collection("participantes").doc(id)),
      );
      objetivoSnaps.forEach((snap) => {
        if (snap.exists) idsVivos.add(snap.id);
      });
    }

    const bloqueantes = locksQueBloquean(ocupados, idsVivos);
    if (bloqueantes.length) {
      const {lock} = bloqueantes[0];
      throw errorDuplicado(lock.campo, lock.valor);
    }

    ocupados.forEach((o) => console.warn(
        "crearParticipantesUnicos: lock huérfano reutilizado —",
        o.lock.ref.path,
        o.participanteId ?
          `apuntaba a participantes/${o.participanteId} (ya borrado)` :
          "sin participanteId",
    ));

    // ── Escrituras ─────────────────────────────────────────────────────────
    entradas.forEach((entrada) => {
      const bloqueo = {
        participanteId: entrada.docRef.id,
        creadoEn: FieldValue.serverTimestamp(),
      };
      tx.set(entrada.docRef, entrada.participante);
      if (entrada.correoRef) tx.set(entrada.correoRef, bloqueo);
      if (entrada.cedulaRef) tx.set(entrada.cedulaRef, bloqueo);
    });
  });
}

async function generarCodigos(cantidad) {
  const counterRef = db.doc("contadores/inscripciones2026");
  const inicio = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const snapData = snap.data();
    const current = snapData ? (snapData.valor || 0) : 0;
    const next = current + cantidad;
    tx.set(counterRef, {
      valor: next,
      actualizadoEn: FieldValue.serverTimestamp(),
    }, {merge: true});
    return current + 1;
  });
  return Array.from({length: cantidad}, (_, indice) =>
    `CTCS-2026-${String(inicio + indice).padStart(5, "0")}`,
  );
}

module.exports = {
  CATEGORIAS_REGISTRO,
  generarToken,
  crearParticipantesUnicos,
  generarCodigos,
};
