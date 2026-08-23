const {HttpsError} = require("firebase-functions/v2/https");
const {
  getFirestore,
  FieldValue,
  Timestamp,
} = require("firebase-admin/firestore");

const db = getFirestore();
const ROLES_CONGRESO = new Set([
  "ceo", "staff_contecs",
]);
const ROLES_VOLUNTARIADO = new Set([
  "ceo", "junta_principal", "voluntariado",
]);
// Mismo set que ROLES_LISTAR_PARTICIPANTES_GIRAS en functions/index.js —
// quienes pueden armar la lista de una gira son los únicos que pueden
// marcar sus checkpoints de entrada/salida.
const ROLES_GIRAS = new Set(["ceo", "junta_principal", "giras"]);

function idValido(valor, campo) {
  const id = typeof valor === "string" ? valor.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
    throw new HttpsError("invalid-argument", `${campo} no es válido.`);
  }
  return id;
}

async function validarActor(request, roles) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const snap = await db.collection("usuarios").doc(request.auth.uid).get();
  if (!snap.exists || !roles.has(snap.data()?.rol)) {
    throw new HttpsError(
        "permission-denied",
        "No tienes permiso para registrar este escaneo.",
    );
  }
  return request.auth.uid;
}

function validarParticipante(participante, coleccion, checkpoint) {
  if (coleccion === "participantes" &&
      participante.pago?.estado !== "aprobado") {
    throw new HttpsError(
        "failed-precondition",
        "El participante todavía no tiene el pago aprobado.",
    );
  }
  if (coleccion === "inscripciones" &&
      participante.eventoId !== checkpoint.eventoId) {
    throw new HttpsError(
        "failed-precondition",
        "La credencial pertenece a otro evento.",
    );
  }
}

function validarContextoEvento(eventoSnap, checkpoint, eventoId) {
  if (!eventoSnap.exists) {
    throw new HttpsError("not-found", "El evento seleccionado ya no existe.");
  }
  if (checkpoint.eventoId !== eventoId) {
    throw new HttpsError(
        "failed-precondition",
        "El checkpoint no pertenece al evento seleccionado.",
    );
  }
}

function nombreParticipante(participante) {
  return participante.nombreCompleto || participante.nombre || null;
}

function datosAsistencia({
  actorId, participanteId, participante, coleccion,
  checkpointId, checkpoint, eventoId, evento,
}) {
  return {
    eventoId,
    eventoNombre: evento.nombre || checkpoint.eventoNombre || null,
    checkpointId,
    checkpointNombre: checkpoint.nombre || "Checkpoint",
    checkpointTipo: checkpoint.tipo || "conferencia",
    checkpointDia: checkpoint.dia || null,
    checkpointHoraInicio: checkpoint.horaInicio || null,
    participanteId,
    participanteColeccion: coleccion,
    participanteCodigo: participante.codigo || null,
    participanteNombre: nombreParticipante(participante),
    participanteCorreo: participante.correo || null,
    participanteCedula: participante.cedula || null,
    marcadoEn: FieldValue.serverTimestamp(),
    marcadoPor: actorId,
  };
}

async function asistenciaParticipante(request) {
  const actorId = await validarActor(request, ROLES_CONGRESO);
  const data = request.data || {};
  const participanteId = idValido(data.participanteId, "participante");
  const checkpointId = idValido(data.checkpointId, "checkpoint");
  const eventoId = idValido(data.eventoId, "evento");
  const coleccion = data.coleccion === "inscripciones" ?
    "inscripciones" : "participantes";
  const participanteRef = db.collection(coleccion).doc(participanteId);
  const checkpointRef = db.collection("checkpoints").doc(checkpointId);
  const eventoRef = db.collection("eventos").doc(eventoId);
  const asistenciaRef = db.collection("asistencias_congreso")
      .doc(`${checkpointId}_${coleccion}_${participanteId}`);

  return db.runTransaction(async (tx) => {
    const [participanteSnap, checkpointSnap, eventoSnap, asistenciaSnap] =
      await tx.getAll(
          participanteRef,
          checkpointRef,
          eventoRef,
          asistenciaRef,
      );
    if (!participanteSnap.exists || !checkpointSnap.exists) {
      throw new HttpsError("not-found", "Participante o checkpoint no encontrado.");
    }
    const participante = participanteSnap.data();
    const checkpoint = checkpointSnap.data();
    validarContextoEvento(eventoSnap, checkpoint, eventoId);
    validarParticipante(participante, coleccion, checkpoint);
    if (asistenciaSnap.exists || participante.asistencias?.[checkpointId]) {
      throw new HttpsError(
          "already-exists",
          `Ya estaba registrado en "${checkpoint.nombre || "checkpoint"}".`,
      );
    }
    const total = Object.keys({
      ...(participante.asistencias || {}),
      [checkpointId]: true,
    }).length;
    tx.update(participanteRef, {
      [`asistencias.${checkpointId}`]: {
        marcadoEn: FieldValue.serverTimestamp(),
        marcadoPor: actorId,
        checkpoint: checkpoint.nombre || "Checkpoint",
        eventoId,
      },
      totalAsistencias: total,
      estado: "presente",
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    tx.create(asistenciaRef, datosAsistencia({
      actorId,
      participanteId,
      participante,
      coleccion,
      checkpointId,
      checkpoint,
      eventoId,
      evento: eventoSnap.data(),
    }));
    return {
      ok: true,
      checkpoint: checkpoint.nombre || "Checkpoint",
      totalAsistencias: total,
    };
  });
}

async function inscripcionTaller(request) {
  const actorId = await validarActor(request, ROLES_CONGRESO);
  const data = request.data || {};
  const participanteId = idValido(data.participanteId, "participante");
  const checkpointId = idValido(data.checkpointId, "checkpoint");
  const eventoId = idValido(data.eventoId, "evento");
  const coleccion = data.coleccion === "inscripciones" ?
    "inscripciones" : "participantes";
  const participanteRef = db.collection(coleccion).doc(participanteId);
  const checkpointRef = db.collection("checkpoints").doc(checkpointId);
  const eventoRef = db.collection("eventos").doc(eventoId);
  const inscripcionRef = db.collection("inscripciones_checkpoint")
      .doc(`${checkpointId}_${coleccion}_${participanteId}`);
  const inscripcionLegacyRef = db.collection("inscripciones_checkpoint")
      .doc(`${checkpointId}_${participanteId}`);
  const asistenciaRef = db.collection("asistencias_congreso")
      .doc(`${checkpointId}_${coleccion}_${participanteId}`);

  return db.runTransaction(async (tx) => {
    const [
      participanteSnap,
      checkpointSnap,
      eventoSnap,
      inscripcionSnap,
      inscripcionLegacySnap,
      asistenciaSnap,
    ] = await tx.getAll(
        participanteRef,
        checkpointRef,
        eventoRef,
        inscripcionRef,
        inscripcionLegacyRef,
        asistenciaRef,
    );
    const inscripcionesPreviasSnap = await tx.get(
        db.collection("inscripciones_checkpoint")
            .where("checkpointId", "==", checkpointId)
            .where("participanteId", "==", participanteId),
    );
    if (!participanteSnap.exists || !checkpointSnap.exists) {
      throw new HttpsError("not-found", "Participante o taller no encontrado.");
    }
    if (inscripcionSnap.exists || inscripcionLegacySnap.exists ||
        asistenciaSnap.exists || !inscripcionesPreviasSnap.empty) {
      throw new HttpsError("already-exists", "El participante ya está inscrito.");
    }
    const participante = participanteSnap.data();
    const checkpoint = checkpointSnap.data();
    validarContextoEvento(eventoSnap, checkpoint, eventoId);
    validarParticipante(participante, coleccion, checkpoint);
    if (participante.asistencias?.[checkpointId]) {
      throw new HttpsError(
          "already-exists",
          `Ya estaba registrado en "${checkpoint.nombre || "checkpoint"}".`,
      );
    }
    const tipo = String(checkpoint.tipo || "").toLowerCase();
    if (!new Set(["taller", "workshop", "gira"]).has(tipo)) {
      throw new HttpsError("failed-precondition", "El checkpoint no admite cupos.");
    }
    const disponibles = Number(
        checkpoint.cuposDisponibles ?? checkpoint.cupos ?? 0,
    );
    if (!Number.isFinite(disponibles) || disponibles <= 0) {
      throw new HttpsError("resource-exhausted", "Ya no hay cupos disponibles.");
    }
    tx.set(inscripcionRef, {
      checkpointId,
      checkpointNombre: checkpoint.nombre || "Taller",
      eventoId: checkpoint.eventoId || null,
      eventoNombre: checkpoint.eventoNombre || null,
      participanteId,
      participanteColeccion: coleccion,
      participanteCodigo: participante.codigo || null,
      participanteNombre: participante.nombreCompleto ||
        participante.nombre || null,
      registradoEn: FieldValue.serverTimestamp(),
      registradoPor: actorId,
    });
    tx.update(checkpointRef, {cuposDisponibles: disponibles - 1});
    const total = Object.keys({
      ...(participante.asistencias || {}),
      [checkpointId]: true,
    }).length;
    tx.update(participanteRef, {
      [`asistencias.${checkpointId}`]: {
        marcadoEn: FieldValue.serverTimestamp(),
        marcadoPor: actorId,
        checkpoint: checkpoint.nombre || "Checkpoint",
        eventoId,
      },
      totalAsistencias: total,
      estado: "presente",
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    tx.create(asistenciaRef, datosAsistencia({
      actorId,
      participanteId,
      participante,
      coleccion,
      checkpointId,
      checkpoint,
      eventoId,
      evento: eventoSnap.data(),
    }));
    return {
      ok: true,
      cuposDisponibles: disponibles - 1,
      totalAsistencias: total,
    };
  });
}

function buscarTurno(actividad, turnoId) {
  const turnos = Array.isArray(actividad.turnos) ? actividad.turnos : [];
  const turno = turnos.find((item) => String(item.id) === turnoId);
  if (!turno) {
    throw new HttpsError("failed-precondition", "El turno ya no existe.");
  }
  return turno;
}

async function asistenciaVoluntario(request) {
  const actorId = await validarActor(request, ROLES_VOLUNTARIADO);
  const data = request.data || {};
  const voluntarioId = idValido(data.voluntarioId, "voluntario");
  const actividadId = idValido(data.actividadId, "actividad");
  const turnoId = idValido(data.turnoId, "turno");
  const accion = data.accion === "salida" ? "salida" : "entrada";
  const asistenciaId = `${voluntarioId}_${actividadId}_${turnoId}`;
  const voluntarioRef = db.collection("voluntarios").doc(voluntarioId);
  const actividadRef = db.collection("actividades_voluntarios").doc(actividadId);
  const asistenciaRef = db.collection("asistencias_voluntarios")
      .doc(asistenciaId);

  return db.runTransaction(async (tx) => {
    const [voluntarioSnap, actividadSnap, asistenciaSnap] = await tx.getAll(
        voluntarioRef,
        actividadRef,
        asistenciaRef,
    );
    if (!voluntarioSnap.exists || !actividadSnap.exists) {
      throw new HttpsError("not-found", "Voluntario o actividad no encontrado.");
    }
    buscarTurno(actividadSnap.data(), turnoId);
    if (accion === "entrada") {
      if (asistenciaSnap.exists) {
        throw new HttpsError("already-exists", "La entrada ya fue registrada.");
      }
      tx.set(asistenciaRef, {
        voluntarioId,
        actividadId,
        turnoId,
        horaEntrada: FieldValue.serverTimestamp(),
        horaSalida: null,
        horasGanadas: null,
        calificacion: null,
        registradoPor: actorId,
        creadoEn: FieldValue.serverTimestamp(),
        actualizadoEn: FieldValue.serverTimestamp(),
      });
      return {ok: true, accion: "entrada"};
    }

    if (!asistenciaSnap.exists) {
      throw new HttpsError("failed-precondition", "La entrada no existe.");
    }
    const asistencia = asistenciaSnap.data();
    if (asistencia.horaSalida) {
      throw new HttpsError("already-exists", "La salida ya fue registrada.");
    }
    const entradaMs = asistencia.horaEntrada?.toMillis?.();
    const ahoraMs = Date.now();
    const horas = Math.round(((ahoraMs - entradaMs) / 3600000) * 100) / 100;
    const calificacion = Math.trunc(Number(data.calificacion));
    if (!Number.isFinite(entradaMs) || !Number.isFinite(horas) ||
        horas < 0 || horas > 24) {
      throw new HttpsError("failed-precondition", "La duración no es válida.");
    }
    if (calificacion < 1 || calificacion > 5) {
      throw new HttpsError("invalid-argument", "Selecciona una calificación.");
    }
    const totalHoras = Math.round((
      Number(voluntarioSnap.data().totalHoras || 0) + horas
    ) * 100) / 100;
    tx.update(asistenciaRef, {
      horaSalida: Timestamp.fromMillis(ahoraMs),
      horasGanadas: horas,
      calificacion,
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    tx.update(voluntarioRef, {
      totalHoras,
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    return {ok: true, accion: "salida", horasGanadas: horas, totalHoras};
  });
}

// ─── GIRAS: check-in / check-out (doble checkpoint) ─────────────────────────
// Función nueva y separada de asistenciaParticipante a propósito (ver
// PLAN_GIRAS_Y_CSV.md, punto 5): esta NO bloquea por pago.estado — si GIRAS
// ya seleccionó al participante para la gira, puede marcar entrada/salida sin
// importar el estado de pago del congreso. El llamador (frontend de
// lecturaQRGiras) usa `pagoAprobado` en la respuesta solo para pintar una
// advertencia informativa, nunca para bloquear.
//
// El QR que trae el participante codifica codigo+token de su credencial
// (mismo formato que perfil.html) — no un ID de Firestore — porque el rol
// "giras" no tiene lectura directa de /participantes (firestore.rules). Por
// eso la validación de identidad ocurre aquí, con Admin SDK.
async function marcarCheckpointGira(request) {
  const actorId = await validarActor(request, ROLES_GIRAS);
  const data = request.data || {};
  const giraId = idValido(data.giraId, "gira");
  const codigo = String(data.codigo || "").trim().toUpperCase();
  const token = String(data.token || "").trim();
  const tipo = data.tipo === "salida" ? "salida" : "entrada";

  if (!codigo || !token) {
    throw new HttpsError("invalid-argument", "El QR no trae un código y clave de participante válidos.");
  }
  if (codigo.length > 30 || token.length > 64) {
    throw new HttpsError("invalid-argument", "Credenciales inválidas.");
  }

  const giraRef = db.collection("giras_voluntarios").doc(giraId);
  const giraSnap = await giraRef.get();
  if (!giraSnap.exists) {
    throw new HttpsError("not-found", "La gira ya no existe.");
  }
  const gira = giraSnap.data();

  const participanteQuery = await db.collection("participantes")
      .where("codigo", "==", codigo)
      .limit(1)
      .get();
  if (participanteQuery.empty) {
    throw new HttpsError("not-found", "QR no reconocido. Participante no encontrado.");
  }
  const participanteSnap = participanteQuery.docs[0];
  const participante = participanteSnap.data();
  if (String(participante.token || "") !== token) {
    throw new HttpsError("permission-denied", "QR inválido: el código de acceso no coincide.");
  }
  const participanteId = participanteSnap.id;

  const enGira = (gira.participantes || []).some((p) => p.id === participanteId);
  if (!enGira) {
    throw new HttpsError(
        "failed-precondition",
        "Este participante no está en la lista de esta gira.",
    );
  }

  const asistenciaRef = db.collection("asistencias_giras")
      .doc(`${giraId}_${participanteId}_${tipo}`);
  const nombreParticipanteVal = nombreParticipante(participante);

  return db.runTransaction(async (tx) => {
    const asistenciaSnap = await tx.get(asistenciaRef);
    if (asistenciaSnap.exists) {
      throw new HttpsError(
          "already-exists",
          tipo === "entrada" ?
            "La entrada ya fue registrada para este participante." :
            "La salida ya fue registrada para este participante.",
      );
    }
    if (tipo === "salida") {
      const entradaRef = db.collection("asistencias_giras")
          .doc(`${giraId}_${participanteId}_entrada`);
      const entradaSnap = await tx.get(entradaRef);
      if (!entradaSnap.exists) {
        throw new HttpsError("failed-precondition", "Registra primero la entrada de este participante.");
      }
    }
    tx.set(asistenciaRef, {
      giraId,
      giraNombre: gira.nombre || null,
      participanteId,
      participanteNombre: nombreParticipanteVal,
      participanteCodigo: participante.codigo || null,
      tipo,
      marcadoEn: FieldValue.serverTimestamp(),
      marcadoPor: actorId,
    });
    return {
      ok: true,
      tipo,
      participanteNombre: nombreParticipanteVal,
      participanteCodigo: participante.codigo || null,
      // Puramente informativo para el frontend — nunca bloquea el check-in.
      pagoAprobado: participante.pago?.estado === "aprobado",
    };
  });
}

async function ejecutarOperacionQr(request) {
  switch (request.data?.tipo) {
    case "asistencia_participante": return asistenciaParticipante(request);
    case "inscripcion_taller": return inscripcionTaller(request);
    case "asistencia_voluntario": return asistenciaVoluntario(request);
    default:
      throw new HttpsError("invalid-argument", "Operación QR no reconocida.");
  }
}

module.exports = {ejecutarOperacionQr, marcarCheckpointGira};
