const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const crypto = require("crypto");

initializeApp();

const db = getFirestore();
const bucket = getStorage().bucket();

const TIPOS_COMPROBANTE = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const LIMITE_COMPROBANTE = 10 * 1024 * 1024;

function generarDocId(cedula, correo) {
  const ced = String(cedula || "").trim();
  const mail = String(correo || "").trim().toLowerCase();
  if (ced) return `c_${ced.replace(/[^a-zA-Z0-9]/g, "_")}`;
  if (mail) return `e_${mail.replace(/[^a-zA-Z0-9]/g, "_")}`;
  return null;
}

function generarToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function generarCodigo() {
  const counterRef = db.doc("contadores/inscripciones2026");
  const seq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? (snap.data().valor || 0) : 0;
    const next = current + 1;
    tx.set(counterRef, {
      valor: next,
      actualizadoEn: FieldValue.serverTimestamp(),
    }, { merge: true });
    return next;
  });
  return `CTCS-2026-${String(seq).padStart(5, "0")}`;
}

function validarCorreo(correo) {
  return typeof correo === "string" && correo.includes("@") && correo.length <= 254;
}

function validarTexto(valor, campo, { requerido = false, max = 200 } = {}) {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (requerido && !texto) {
    throw new HttpsError("invalid-argument", `El campo ${campo} es obligatorio.`);
  }
  if (texto.length > max) {
    throw new HttpsError("invalid-argument", `El campo ${campo} es demasiado largo.`);
  }
  return texto;
}

async function subirComprobante({ docId, base64, contentType, nombre }) {
  if (!base64) return null;

  if (!TIPOS_COMPROBANTE.has(contentType)) {
    throw new HttpsError(
      "invalid-argument",
      "El comprobante debe ser PDF o imagen (JPEG, PNG, GIF, WebP)."
    );
  }

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > LIMITE_COMPROBANTE) {
    throw new HttpsError("invalid-argument", "El comprobante no puede superar 10 MB.");
  }

  const extMap = {
    "application/pdf": "pdf",
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  const ext = extMap[contentType] || "bin";
  const ruta = `comprobantes/${docId}.${ext}`;

  await bucket.file(ruta).save(buffer, {
    metadata: {
      contentType,
      metadata: {
        nombreOriginal: String(nombre || "comprobante").slice(0, 200),
        subidoEn: new Date().toISOString(),
      },
    },
  });

  return ruta;
}

function sanitizarParticipante(data) {
  return {
    nombre: data.nombre,
    apellido: data.apellido,
    nombreCompleto: data.nombreCompleto,
    cedula: data.cedula || "",
    correo: data.correo,
    telefono: data.telefono || "",
    categoria: data.categoria,
    categoriaNombre: data.categoriaNombre,
    institucion: data.institucion || null,
    colegio: data.colegio || null,
    codigo: data.codigo,
    token: data.token,
    pago: {
      metodo: data.pago?.metodo || null,
      estado: data.pago?.estado || "pendiente_efectivo",
      monto: data.pago?.monto ?? null,
    },
    esColegio: !!data.esColegio,
    camposExtra: data.camposExtra || {},
  };
}

exports.registrarParticipante = onCall(
  { region: "us-central1", maxInstances: 20 },
  async (request) => {
    const data = request.data || {};

    const nombre = validarTexto(data.nombre, "nombre", { requerido: true, max: 100 });
    const apellido = validarTexto(data.apellido, "apellido", { requerido: true, max: 100 });
    const correo = validarTexto(data.correo, "correo", { requerido: true, max: 254 }).toLowerCase();
    const telefono = validarTexto(data.telefono, "telefono", { requerido: true, max: 30 });
    const cedula = validarTexto(data.cedula, "cedula", { max: 30 });
    const metodoPago = data.metodoPago;

    if (!validarCorreo(correo)) {
      throw new HttpsError("invalid-argument", "Ingresa un correo válido.");
    }
    if (!["transferencia", "efectivo"].includes(metodoPago)) {
      throw new HttpsError("invalid-argument", "Selecciona un método de pago válido.");
    }
    if (metodoPago === "transferencia" && !data.comprobanteBase64) {
      throw new HttpsError("invalid-argument", "Adjunta el comprobante de transferencia.");
    }

    const docId = generarDocId(cedula, correo);
    if (!docId) {
      throw new HttpsError("invalid-argument", "Se requiere cédula o correo para identificar la inscripción.");
    }

    const docRef = db.collection("participantes").doc(docId);
    const existe = await docRef.get();
    if (existe.exists) {
      throw new HttpsError(
        "already-exists",
        "Ya existe una inscripción con esta cédula o correo. Si crees que es un error, contacta al staff en congresofisc@utp.ac.pa"
      );
    }

    const codigo = await generarCodigo();
    const token = generarToken();

    let comprobanteRuta = null;
    if (metodoPago === "transferencia" && data.comprobanteBase64) {
      comprobanteRuta = await subirComprobante({
        docId,
        base64: data.comprobanteBase64,
        contentType: data.comprobanteContentType,
        nombre: data.comprobanteNombre,
      });
    }

    const esColegio = !!data.esColegio;
    const camposExtra = typeof data.camposExtra === "object" && data.camposExtra ? data.camposExtra : {};
    const estudiantesData = Array.isArray(data.estudiantes) ? data.estudiantes : [];
    const tutorData = data.tutor && typeof data.tutor === "object" ? data.tutor : null;

    const participante = {
      codigo,
      token,
      nombre,
      apellido,
      nombreCompleto: `${nombre} ${apellido}`,
      cedula,
      correo,
      telefono,
      categoria: esColegio ? "colegio" : (data.categoria || "otros"),
      categoriaNombre: esColegio ? "Colegio" : (data.categoriaNombre || "Participante"),
      camposExtra,
      pago: {
        metodo: metodoPago,
        estado: metodoPago === "transferencia" ? "comprobante_enviado" : "pendiente_efectivo",
        comprobanteRuta,
        monto: esColegio ? null : (data.monto ?? null),
        aprobadoPor: null,
        aprobadoEn: null,
        notas: null,
      },
      esColegio,
      tutor: tutorData,
      colegio: esColegio ? (tutorData?.colegio || null) : null,
      estudiantes: estudiantesData,
      estadoRegistro: "activo",
      asistencias: {},
      fechaRegistro: FieldValue.serverTimestamp(),
      actualizadoEn: FieldValue.serverTimestamp(),
    };

    await docRef.set(participante);

    if (esColegio && estudiantesData.length > 0) {
      const batch = db.batch();
      let operacionesBatch = 0;
      for (const est of estudiantesData) {
        const estCedula = String(est.cedula || "").trim();
        const estCorreo = String(est.correo || "").trim().toLowerCase();
        const estId = generarDocId(estCedula, estCorreo);
        if (!estId) continue;

        const estRef = db.collection("participantes").doc(estId);
        const estExiste = await estRef.get();
        if (estExiste.exists) continue;

        const estCodigo = await generarCodigo();
        const estToken = generarToken();

        batch.set(estRef, {
          codigo: estCodigo,
          token: estToken,
          nombre: String(est.nombre || "").trim(),
          apellido: String(est.apellido || "").trim(),
          nombreCompleto: `${String(est.nombre || "").trim()} ${String(est.apellido || "").trim()}`,
          cedula: estCedula,
          correo: estCorreo,
          telefono: "",
          categoria: "colegio_estudiante",
          categoriaNombre: "Colegio",
          camposExtra: {
            grado: est.grado || "",
            bachiller: est.bachiller || "",
          },
          pago: {
            metodo: metodoPago,
            estado: metodoPago === "transferencia" ? "comprobante_enviado" : "pendiente_efectivo",
            comprobanteRuta,
            monto: null,
            aprobadoPor: null,
            aprobadoEn: null,
            notas: null,
          },
          esColegio: true,
          tutorCodigo: codigo,
          tutor: tutorData,
          colegio: tutorData?.colegio || null,
          estudiantes: [],
          estadoRegistro: "activo",
          asistencias: {},
          fechaRegistro: FieldValue.serverTimestamp(),
          actualizadoEn: FieldValue.serverTimestamp(),
        });
        operacionesBatch++;
      }
      if (operacionesBatch > 0) await batch.commit();
    }

    return { codigo, correo };
  }
);

exports.accederParticipante = onCall(
  { region: "us-central1", maxInstances: 30 },
  async (request) => {
    const codigo = String(request.data?.codigo || "").trim().toUpperCase();
    const token = String(request.data?.token || "").trim();

    if (!codigo || !token) {
      throw new HttpsError("invalid-argument", "Ingresa tu código de participante y tu clave de acceso.");
    }
    if (codigo.length > 30 || token.length > 64) {
      throw new HttpsError("invalid-argument", "Credenciales inválidas.");
    }

    const snap = await db.collection("participantes")
      .where("codigo", "==", codigo)
      .where("token", "==", token)
      .limit(1)
      .get();

    if (snap.empty) {
      throw new HttpsError(
        "not-found",
        "Código o clave incorrectos. Revisa el correo que recibiste al inscribirte."
      );
    }

    return sanitizarParticipante(snap.docs[0].data());
  }
);
