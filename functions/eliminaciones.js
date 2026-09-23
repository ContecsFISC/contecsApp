// Borrados definitivos desde el panel: participantes (con todo lo que cuelga
// de ellos) y usuarios del panel.
//
// Vive aparte de index.js por lo mismo que operaciones-qr.js: la lógica es
// larga y así se lee sola. Todo corre con Admin SDK después de validar el rol,
// porque buena parte de lo que hay que limpiar (locks de identidad, Storage,
// asistencias) es de escritura cerrada para el navegador.

const {HttpsError} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getAuth} = require("firebase-admin/auth");
const {getStorage} = require("firebase-admin/storage");
const {idBloqueoParticipante} = require("./identidad");

const db = getFirestore();

// Mismo set que "eliminar_participantes" en js/core/permisos.js.
const ROLES_ELIMINAR_PARTICIPANTES = new Set(["ceo", "junta_principal"]);
// Mismo set que "eliminar_usuarios" en js/core/permisos.js.
const ROLES_ELIMINAR_USUARIOS = new Set(["ceo"]);

// subirFotoEfectivo guarda la foto del staff con una ruta fija por docId y
// extensión; puede quedar ahí aunque pago.comprobanteRuta ya apunte a otra.
const EXTENSIONES_FOTO_EFECTIVO = ["jpeg", "png", "webp"];

const LIMITE_LOTE = 400;

function idValido(valor, campo) {
  const id = typeof valor === "string" ? valor.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
    throw new HttpsError("invalid-argument", `${campo} no es válido.`);
  }
  return id;
}

async function validarRol(request, roles, mensaje) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const snap = await db.collection("usuarios").doc(request.auth.uid).get();
  if (!snap.exists || !roles.has(snap.data()?.rol)) {
    throw new HttpsError("permission-denied", mensaje);
  }
  return request.auth.uid;
}

async function borrarEnLotes(refs) {
  for (let i = 0; i < refs.length; i += LIMITE_LOTE) {
    const batch = db.batch();
    refs.slice(i, i + LIMITE_LOTE).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

// Libera los documentos-lock de cédula y correo del participante, solo si
// siguen apuntando a ESE participante (otro registro pudo reclamarlos ya).
// La usan este módulo y el trigger liberarIdentidadParticipante de index.js.
async function liberarLocksParticipante(docId, data) {
  const candidatos = [
    data?.correo ? idBloqueoParticipante("correo", data.correo) : null,
    data?.cedula ? idBloqueoParticipante("cedula", data.cedula) : null,
  ].filter(Boolean);

  const liberados = [];
  await Promise.allSettled(candidatos.map(async (lockId) => {
    const ref = db.collection("identificadores_participantes").doc(lockId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      if (snap.data()?.participanteId !== docId) return; // ya es de otro
      tx.delete(ref);
      liberados.push(lockId);
    });
  }));
  return liberados;
}

// Registros de asistencia/inscripción que guardan participanteId. Las dos
// colecciones del congreso comparten los ids con /inscripciones, así que se
// descartan las que dicen explícitamente venir de esa otra colección.
async function limpiarRegistrosCongreso(ids) {
  let asistencias = 0;
  let inscripciones = 0;
  const cuposPorCheckpoint = new Map();

  for (const id of ids) {
    const [asisSnap, inscSnap, girasSnap] = await Promise.all([
      db.collection("asistencias_congreso").where("participanteId", "==", id).get(),
      db.collection("inscripciones_checkpoint").where("participanteId", "==", id).get(),
      db.collection("asistencias_giras").where("participanteId", "==", id).get(),
    ]);
    const deParticipantes = (d) => d.data().participanteColeccion !== "inscripciones";

    const asisDocs = asisSnap.docs.filter(deParticipantes);
    const inscDocs = inscSnap.docs.filter(deParticipantes);
    inscDocs.forEach((d) => {
      const checkpointId = d.data().checkpointId;
      if (checkpointId) {
        cuposPorCheckpoint.set(checkpointId, (cuposPorCheckpoint.get(checkpointId) || 0) + 1);
      }
    });

    await borrarEnLotes([
      ...asisDocs.map((d) => d.ref),
      ...inscDocs.map((d) => d.ref),
      ...girasSnap.docs.map((d) => d.ref),
    ]);
    asistencias += asisDocs.length + girasSnap.size;
    inscripciones += inscDocs.length;
  }

  // Un cupo de taller reservado por alguien que ya no existe vuelve a quedar
  // libre. Si el checkpoint ya no existe no hay nada que devolver.
  await Promise.allSettled([...cuposPorCheckpoint].map(async ([checkpointId, n]) => {
    const ref = db.collection("checkpoints").doc(checkpointId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const cp = snap.data();
      if (cp.cuposDisponibles == null) return;
      const tope = Number(cp.cupos);
      const nuevo = Number(cp.cuposDisponibles) + n;
      tx.update(ref, {
        cuposDisponibles: Number.isFinite(tope) && tope > 0 ? Math.min(nuevo, tope) : nuevo,
      });
    });
  }));

  return {asistencias, inscripciones};
}

// Quita a los participantes de las listas de cada gira (seleccionados, no
// seleccionados y los registros de a quién ya se notificó).
async function limpiarGiras(ids) {
  const idsSet = new Set(ids);
  const snap = await db.collection("giras_voluntarios").get();
  let tocadas = 0;

  for (const giraDoc of snap.docs) {
    const g = giraDoc.data();
    const aparece = (Array.isArray(g.participantes) && g.participantes.some((p) => idsSet.has(p?.id))) ||
      (Array.isArray(g.noSeleccionados) && g.noSeleccionados.some((p) => idsSet.has(p?.id))) ||
      (Array.isArray(g.notificados) && g.notificados.some((id) => idsSet.has(id))) ||
      (Array.isArray(g.notificadosNoSeleccionados) && g.notificadosNoSeleccionados.some((id) => idsSet.has(id)));
    if (!aparece) continue;

    await db.runTransaction(async (tx) => {
      const fresco = await tx.get(giraDoc.ref);
      if (!fresco.exists) return;
      const d = fresco.data();
      const cambios = {};
      if (Array.isArray(d.participantes)) {
        cambios.participantes = d.participantes.filter((p) => !idsSet.has(p?.id));
      }
      if (Array.isArray(d.noSeleccionados)) {
        cambios.noSeleccionados = d.noSeleccionados.filter((p) => !idsSet.has(p?.id));
      }
      if (Array.isArray(d.notificados)) {
        cambios.notificados = d.notificados.filter((id) => !idsSet.has(id));
      }
      if (Array.isArray(d.notificadosNoSeleccionados)) {
        cambios.notificadosNoSeleccionados = d.notificadosNoSeleccionados.filter((id) => !idsSet.has(id));
      }
      tx.update(giraDoc.ref, cambios);
    });
    tocadas++;
  }
  return tocadas;
}

// Borra de Storage los comprobantes que ya nadie referencia. Un grupo de
// colegio comparte un único comprobante entre tutor y estudiantes: si se borra
// solo a un estudiante, el archivo sigue siendo del resto del grupo.
async function borrarArchivosHuerfanos(rutas) {
  const bucket = getStorage().bucket();
  const borrados = [];
  for (const ruta of rutas) {
    const enUso = await db.collection("participantes")
        .where("pago.comprobanteRuta", "==", ruta).limit(1).get();
    if (!enUso.empty) continue;
    try {
      const [existe] = await bucket.file(ruta).exists();
      if (!existe) continue;
      await bucket.file(ruta).delete({ignoreNotFound: true});
      borrados.push(ruta);
    } catch (e) {
      console.error("eliminarParticipante: no se pudo borrar", ruta, e.message);
    }
  }
  return borrados;
}

async function eliminarParticipante(request) {
  const actor = await validarRol(request, ROLES_ELIMINAR_PARTICIPANTES,
      "No tienes permiso para eliminar participantes.");
  const docId = idValido(request.data?.docId, "El participante");
  const incluirEstudiantes = request.data?.incluirEstudiantes === true;

  const principalSnap = await db.collection("participantes").doc(docId).get();
  if (!principalSnap.exists) {
    throw new HttpsError("not-found", "El participante ya no existe.");
  }
  const principal = principalSnap.data();

  const snaps = [principalSnap];
  if (incluirEstudiantes && principal.categoria === "colegio" && principal.codigo) {
    const est = await db.collection("participantes")
        .where("tutorCodigo", "==", principal.codigo).get();
    est.docs.forEach((d) => {
      if (d.id !== docId) snaps.push(d);
    });
  }
  const ids = snaps.map((s) => s.id);

  const rutas = new Set();
  snaps.forEach((s) => {
    const ruta = s.data().pago?.comprobanteRuta;
    if (typeof ruta === "string" && ruta.startsWith("comprobantes/")) rutas.add(ruta);
    EXTENSIONES_FOTO_EFECTIVO.forEach((ext) => rutas.add(`comprobantes/${s.id}_efectivo.${ext}`));
  });

  // Primero lo que cuelga del participante y al final el documento: si algo
  // falla a mitad, el participante sigue visible y se puede reintentar.
  const registros = await limpiarRegistrosCongreso(ids);
  const girasTocadas = await limpiarGiras(ids);

  // Un estudiante borrado solo deja de aparecer en la lista de su tutor.
  if (principal.categoria === "colegio_estudiante" && principal.tutorCodigo) {
    const tutorSnap = await db.collection("participantes")
        .where("codigo", "==", principal.tutorCodigo).limit(1).get();
    if (!tutorSnap.empty) {
      const tutorRef = tutorSnap.docs[0].ref;
      await db.runTransaction(async (tx) => {
        const t = await tx.get(tutorRef);
        const lista = Array.isArray(t.data()?.estudiantes) ? t.data().estudiantes : null;
        if (!lista) return;
        const correo = String(principal.correo || "").toLowerCase();
        const filtrada = lista.filter((e) => String(e?.correo || "").toLowerCase() !== correo);
        if (filtrada.length !== lista.length) {
          tx.update(tutorRef, {estudiantes: filtrada, actualizadoEn: FieldValue.serverTimestamp()});
        }
      });
    }
  }

  await borrarEnLotes(snaps.map((s) => s.ref));
  // El trigger liberarIdentidadParticipante hace lo mismo en segundo plano;
  // hacerlo aquí deja la cédula y el correo libres en cuanto responde la
  // llamada. Las dos pasadas son idempotentes.
  await Promise.all(snaps.map((s) => liberarLocksParticipante(s.id, s.data())));
  const archivos = await borrarArchivosHuerfanos([...rutas]);

  console.log("eliminarParticipante:", docId, "por", actor, {
    participantes: ids.length, ...registros, girasTocadas, archivos: archivos.length,
  });

  return {
    ok: true,
    participantesEliminados: ids.length,
    asistenciasEliminadas: registros.asistencias,
    inscripcionesEliminadas: registros.inscripciones,
    girasActualizadas: girasTocadas,
    archivosEliminados: archivos.length,
  };
}

async function eliminarUsuario(request) {
  const actor = await validarRol(request, ROLES_ELIMINAR_USUARIOS,
      "Solo el CEO puede eliminar usuarios.");
  const uid = typeof request.data?.uid === "string" ? request.data.uid.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw new HttpsError("invalid-argument", "El usuario no es válido.");
  }
  if (uid === actor) {
    throw new HttpsError("failed-precondition", "No puedes eliminar tu propia cuenta.");
  }

  const ref = db.collection("usuarios").doc(uid);
  const snap = await ref.get();
  await ref.delete();

  // Borrar la cuenta de Auth corta también sus sesiones abiertas. Si vuelve a
  // iniciar sesión aparecerá como una cuenta nueva con rol "Sin rol".
  let cuentaAuthEliminada = false;
  try {
    await getAuth().deleteUser(uid);
    cuentaAuthEliminada = true;
  } catch (e) {
    if (e.code !== "auth/user-not-found") {
      console.error("eliminarUsuario: no se pudo borrar la cuenta Auth", uid, e.message);
    }
  }

  console.log("eliminarUsuario:", uid, snap.data()?.email || "", "por", actor);
  return {ok: true, cuentaAuthEliminada};
}

module.exports = {eliminarParticipante, eliminarUsuario, liberarLocksParticipante};
