const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentUpdated} = require("firebase-functions/v2/firestore");
const {initializeApp} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getStorage} = require("firebase-admin/storage");
const crypto = require("crypto");
const https = require("https");
const {linkPerfilParticipante} = require("./qr-participante");
const {cargarCorreoPagoAprobado} = require("./plantillas");

initializeApp();

const db = getFirestore();
const bucket = getStorage().bucket();

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const BREVO_API_KEY = "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";
const CORREO_REMITENTE = {name: "CONTECS 2026", email: "contecs.logistica@utp.ac.pa"};

const TIPOS_COMPROBANTE = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"]);
const LIMITE_COMPROBANTE = 10 * 1024 * 1024;

const ROLES_ENVIAR_CORREO_QR = new Set([
  "ceo", "junta_principal", "junta", "coordinador",
  "actividades", "finanzas", "secretario", "comunicaciones",
]);

const SSO_USER_URL = "https://sso.utp.ac.pa/ms/user";
const ORIGENES_SSO_PERMITIDOS = new Set([
  "https://contecsfisc.github.io",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
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
    const snapData = snap.data();
    const current = snapData ? (snapData.valor || 0) : 0;
    const next = current + 1;
    tx.set(counterRef, {valor: next, actualizadoEn: FieldValue.serverTimestamp()}, {merge: true});
    return next;
  });
  return `CTCS-2026-${String(seq).padStart(5, "0")}`;
}

function validarCorreo(correo) {
  return typeof correo === "string" && correo.includes("@") && correo.length <= 254;
}

function esTokenSSOValido(tokenSSO) {
  return tokenSSO && typeof tokenSSO === "object" && Object.keys(tokenSSO).length > 0;
}

function extraerEmailSSO(datosUsuario) {
  if (!datosUsuario || typeof datosUsuario !== "object") return null;
  const candidatos = [
    datosUsuario.email,
    datosUsuario.correo,
    datosUsuario.mail,
    datosUsuario.userPrincipalName,
  ];
  for (const valor of candidatos) {
    if (typeof valor === "string" && valor.includes("@")) {
      return valor.trim().toLowerCase();
    }
  }
  return null;
}

function extraerNombreSSO(datosUsuario) {
  if (!datosUsuario || typeof datosUsuario !== "object") return null;
  return datosUsuario.nombre ||
    datosUsuario.name ||
    datosUsuario.displayName ||
    datosUsuario.nombreCompleto ||
    null;
}

async function consultarUsuarioSSO(tokenSSO) {
  const resp = await fetch(SSO_USER_URL, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(tokenSSO),
  });
  if (!resp.ok) {
    const detalle = await resp.text().catch(() => "");
    throw new Error(`SSO rechazó el token (${resp.status})${detalle ? `: ${detalle.slice(0, 200)}` : ""}`);
  }
  return resp.json();
}

function origenPermitidoParaSSO(req) {
  const origin = req.get("Origin");
  if (!origin) return true;
  return ORIGENES_SSO_PERMITIDOS.has(origin);
}

function validarTexto(valor, campo, {requerido = false, max = 200} = {}) {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (requerido && !texto) throw new HttpsError("invalid-argument", `El campo ${campo} es obligatorio.`);
  if (texto.length > max) throw new HttpsError("invalid-argument", `El campo ${campo} es demasiado largo.`);
  return texto;
}

async function subirComprobante({docId, base64, contentType, nombre}) {
  if (!base64) return null;
  if (!TIPOS_COMPROBANTE.has(contentType)) throw new HttpsError("invalid-argument", "El comprobante debe ser PDF o imagen.");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > LIMITE_COMPROBANTE) throw new HttpsError("invalid-argument", "El comprobante no puede superar 10 MB.");
  const extMap = {"application/pdf": "pdf", "image/jpeg": "jpeg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"};
  const ruta = `comprobantes/${docId}.${extMap[contentType] || "bin"}`;
  await bucket.file(ruta).save(buffer, {
    metadata: {contentType, metadata: {nombreOriginal: String(nombre || "comprobante").slice(0, 200), subidoEn: new Date().toISOString()}},
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

// ─── BREVO: ENVÍO DE CORREO ───────────────────────────────────────────────────
function brevoRequestOnce(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: "api.brevo.com",
      path: "/v3/smtp/email",
      method: "POST",
      timeout: 25000,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "api-key": BREVO_API_KEY,
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data || "{}"));
          } catch (e) {
            resolve({});
          }
          return;
        }
        reject(new Error(`Brevo ${res.statusCode}: ${data}`));
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Brevo timeout: sin respuesta en 25s"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function brevoRequest(payload) {
  try {
    return await brevoRequestOnce(payload);
  } catch (e) {
    if (/Brevo 5\d\d/.test(e.message)) {
      await new Promise((r) => setTimeout(r, 2000));
      return brevoRequestOnce(payload);
    }
    throw e;
  }
}

async function verificarStaffCorreo(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión para enviar correos.");
  }
  const snap = await db.collection("usuarios").doc(request.auth.uid).get();
  const rol = snap.data()?.rol;
  if (!ROLES_ENVIAR_CORREO_QR.has(rol)) {
    throw new HttpsError("permission-denied", "No tienes permiso para enviar este correo.");
  }
  return rol;
}

async function enviarCorreoPagoAprobado({docId, participante}) {
  const codigo = participante.codigo;
  const token = participante.token;
  const correo = participante.correo;
  const nombre = participante.nombreCompleto ||
    `${participante.nombre || ""} ${participante.apellido || ""}`.trim();
  if (!codigo || !token || !correo) {
    throw new Error("Participante sin codigo, token o correo");
  }

  const linkPerfil = linkPerfilParticipante(codigo, token);
  const vars = {
    nombre,
    codigo,
    categoria: participante.categoriaNombre || participante.categoria || "Participante",
    link_perfil: linkPerfil,
    metodo_pago: participante.pago?.metodo === "transferencia" ? "Transferencia bancaria" : "Efectivo",
  };

  const plantilla = cargarCorreoPagoAprobado(vars);
  if (!plantilla.activo) {
    console.log("Correo pago aprobado desactivado en plantilla — omitido para", docId);
    return {enviado: false, omitido: true};
  }

  const brevoResp = await brevoRequest({
    sender: CORREO_REMITENTE,
    to: [{email: correo, name: nombre}],
    subject: plantilla.subject,
    htmlContent: plantilla.htmlContent,
    textContent: plantilla.textContent,
  });

  return {enviado: true, brevoMessageId: brevoResp?.messageId || null};
}

async function procesarCorreoQrAprobado({docId, forzarReenvio = false}) {
  const docRef = db.collection("participantes").doc(docId);
  const bloqueo = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const participante = snap.data();
    if (!participante) return {omitir: true, razon: "no_existe"};
    if (participante.pago?.estado !== "aprobado") {
      return {omitir: true, razon: "no_aprobado"};
    }
    if (participante.pago?.correo_aprobacion_enviado && !forzarReenvio) {
      return {omitir: true, razon: "ya_enviado"};
    }
    if (participante.pago?.correo_aprobacion_enviando) {
      return {omitir: true, razon: "en_proceso"};
    }
    tx.update(docRef, {"pago.correo_aprobacion_enviando": true});
    return {omitir: false, participante};
  });

  if (bloqueo.omitir) {
    return {enviado: false, omitido: true, razon: bloqueo.razon};
  }

  let enviado = false;
  let errorMsg = null;
  let brevoMessageId = null;
  let omitidoPlantilla = false;

  try {
    const resultado = await enviarCorreoPagoAprobado({
      docId,
      participante: bloqueo.participante,
    });
    if (resultado?.omitido) {
      omitidoPlantilla = true;
    } else {
      enviado = true;
      brevoMessageId = resultado.brevoMessageId;
    }
  } catch (e) {
    errorMsg = e.message;
  }

  await docRef.update({
    "pago.correo_aprobacion_enviado": enviado,
    "pago.correo_aprobacion_pendiente": !enviado && !omitidoPlantilla,
    "pago.correo_aprobacion_error": errorMsg,
    "pago.correo_aprobacion_enviando": false,
    "pago.correo_aprobacion_enviadoEn": enviado ? FieldValue.serverTimestamp() : null,
    "pago.correo_aprobacion_brevo_id": brevoMessageId,
  }).catch((e) => console.error("No se pudo marcar estado correo:", e.message));

  if (errorMsg) throw new Error(errorMsg);
  if (omitidoPlantilla) return {enviado: false, omitido: true, razon: "plantilla_desactivada"};
  return {enviado: true, brevoMessageId};
}

// ─── HTTP: validar token SSO UTP y emitir Firebase Custom Token ────────────────
exports.validarTokenSSO = onRequest(
    {
      region: "us-central1",
      maxInstances: 20,
      cors: [
        "https://contecsfisc.github.io",
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ],
    },
    async (req, res) => {
      if (req.method !== "POST") {
        res.status(405).json({error: "Método no permitido"});
        return;
      }

      if (!origenPermitidoParaSSO(req)) {
        res.status(403).json({error: "Origen no permitido"});
        return;
      }

      const {tokenSSO} = req.body || {};
      if (!esTokenSSOValido(tokenSSO)) {
        res.status(400).json({error: "Token SSO requerido"});
        return;
      }

      try {
        const datosUsuario = await consultarUsuarioSSO(tokenSSO);
        const email = extraerEmailSSO(datosUsuario);
        if (!email) {
          res.status(400).json({error: "No se pudo obtener el email del usuario"});
          return;
        }

        const auth = getAuth();
        let uid;
        try {
          const userRecord = await auth.getUserByEmail(email);
          uid = userRecord.uid;
        } catch (e) {
          if (e.code === "auth/user-not-found") {
            const nombre = extraerNombreSSO(datosUsuario) || email;
            const nuevoUsuario = await auth.createUser({
              email,
              displayName: nombre,
            });
            uid = nuevoUsuario.uid;
          } else {
            throw e;
          }
        }

        const firebaseToken = await auth.createCustomToken(uid);
        res.json({firebaseToken});
      } catch (e) {
        console.error("validarTokenSSO:", e);
        res.status(401).json({error: "No se pudo validar el token SSO"});
      }
    },
);

// ─── CLOUD FUNCTION: registrarParticipante ────────────────────────────────────
exports.registrarParticipante = onCall(
    {region: "us-central1", maxInstances: 20, invoker: "public"},
    async (request) => {
      try {
        const data = request.data || {};

        const nombre = validarTexto(data.nombre, "nombre", {requerido: true, max: 100});
        const apellido = validarTexto(data.apellido, "apellido", {requerido: true, max: 100});
        const correo = validarTexto(data.correo, "correo", {requerido: true, max: 254}).toLowerCase();
        const telefono = validarTexto(data.telefono, "telefono", {requerido: true, max: 30});
        const cedula = validarTexto(data.cedula, "cedula", {max: 30});
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
        if (!docId) throw new HttpsError("invalid-argument", "Se requiere cédula o correo.");

        const docRef = db.collection("participantes").doc(docId);
        const existe = await docRef.get();
        if (existe.data()) throw new HttpsError("already-exists", "Ya existe una inscripción con esta cédula o correo. Si crees que es un error, contacta al staff en congresofisc@utp.ac.pa");

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
          codigo, token,
          nombre, apellido, nombreCompleto: `${nombre} ${apellido}`,
          cedula, correo, telefono,
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
          correo_enviado: false,
          correo_pendiente: true,
          fechaRegistro: FieldValue.serverTimestamp(),
          actualizadoEn: FieldValue.serverTimestamp(),
        };

        await docRef.set(participante);

        // Guardar estudiantes si es colegio
        const estudiantesGuardados = [];
        if (esColegio && estudiantesData.length > 0) {
          const batch = db.batch();
          let ops = 0;
          for (const est of estudiantesData) {
            const estCedula = String(est.cedula || "").trim();
            const estCorreo = String(est.correo || "").trim().toLowerCase();
            const estId = generarDocId(estCedula, estCorreo);
            if (!estId) continue;
            const estRef = db.collection("participantes").doc(estId);
            const estExiste = await estRef.get();
            if (estExiste.data()) continue;
            const estCodigo = await generarCodigo();
            const estToken = generarToken();
            estudiantesGuardados.push({
              docId: estId,
              codigo: estCodigo,
              token: estToken,
              nombre: `${String(est.nombre || "").trim()} ${String(est.apellido || "").trim()}`,
              correo: estCorreo,
            });
            batch.set(estRef, {
              codigo: estCodigo, token: estToken,
              nombre: String(est.nombre || "").trim(),
              apellido: String(est.apellido || "").trim(),
              nombreCompleto: `${String(est.nombre||"").trim()} ${String(est.apellido||"").trim()}`,
              cedula: estCedula, correo: estCorreo, telefono: "",
              categoria: "colegio_estudiante", categoriaNombre: "Colegio",
              camposExtra: {grado: est.grado || "", bachiller: est.bachiller || ""},
              pago: {
                metodo: metodoPago,
                estado: metodoPago === "transferencia" ? "comprobante_enviado" : "pendiente_efectivo",
                comprobanteRuta, monto: null,
                aprobadoPor: null, aprobadoEn: null, notas: null,
              },
              esColegio: true, tutorCodigo: codigo,
              tutor: tutorData, colegio: tutorData?.colegio || null,
              estudiantes: [], estadoRegistro: "activo", asistencias: {},
              correo_enviado: false, correo_pendiente: true,
              fechaRegistro: FieldValue.serverTimestamp(),
              actualizadoEn: FieldValue.serverTimestamp(),
            });
            ops++;
          }
          if (ops > 0) await batch.commit();
        }

        return {codigo, correo};
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error("registrarParticipante:", e);
        throw new HttpsError("internal", "Error al registrar. Intenta de nuevo en unos segundos.");
      }
    },
);

// ─── CLOUD FUNCTION: accederParticipante ──────────────────────────────────────
exports.accederParticipante = onCall(
    {region: "us-central1", maxInstances: 30, invoker: "public"},
    async (request) => {
      try {
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
          throw new HttpsError("not-found", "Código o clave incorrectos. Revisa el correo que recibiste al inscribirte.");
        }

        return sanitizarParticipante(snap.docs[0].data());
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error("accederParticipante:", e);
        throw new HttpsError("internal", "Error al consultar credencial. Intenta de nuevo.");
      }
    },
);

// ─── CALLABLE: enviar correo QR (panel staff) ─────────────────────────────────
exports.enviarCorreoQrParticipante = onCall(
    {region: "us-central1", maxInstances: 10},
    async (request) => {
      try {
        await verificarStaffCorreo(request);
        const docId = validarTexto(request.data?.docId, "docId", {requerido: true, max: 200});
        const forzarReenvio = !!request.data?.forzarReenvio;

        console.log("enviarCorreoQrParticipante:", docId, forzarReenvio ? "(reenvío)" : "(envío)");

        const resultado = await procesarCorreoQrAprobado({docId, forzarReenvio});
        if (resultado.omitido) {
          // "en_proceso" significa que el trigger de Firestore ya está enviando el correo
          // en paralelo — no es un error, el correo llegará igual.
          // "ya_enviado" tampoco es un error.
          const razonesOk = new Set(["en_proceso", "ya_enviado", "plantilla_desactivada"]);
          const esOk = razonesOk.has(resultado.razon);
          return {
            enviado: false,
            omitido: true,
            razon: resultado.razon,
            mensaje: resultado.razon === "ya_enviado" ?
              "El correo ya fue enviado anteriormente." :
              resultado.razon === "en_proceso" ?
                "El correo está siendo enviado (procesado por el sistema)." :
                "No se pudo enviar en este momento.",
            // El panel debe tratar esto como éxito si esOk === true
            ok: esOk,
          };
        }

        console.log("enviarCorreoQrParticipante: OK", docId, resultado.brevoMessageId || "");
        return {
          enviado: true,
          brevoMessageId: resultado.brevoMessageId,
          mensaje: "Correo con QR enviado correctamente.",
          ok: true,
        };
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error("enviarCorreoQrParticipante:", e);
        throw new HttpsError("internal", e.message || "Error al enviar el correo.");
      }
    },
);

// ─── TRIGGER: respaldo al aprobar pago ───────────────────────────────────────
exports.notificarPagoAprobado = onDocumentUpdated(
    {document: "participantes/{docId}", region: "us-central1"},
    async (event) => {
      const before = event.data.before.data();
      const after = event.data.after.data();
      if (!before || !after) return;

      const docId = event.params.docId;
      const estadoAntes = before.pago?.estado;
      const estadoDespues = after.pago?.estado;

      if (estadoDespues !== "aprobado") return;

      const reenvioSolicitado = after.pago?.reenviar_correo_qr_at &&
        before.pago?.reenviar_correo_qr_at !== after.pago?.reenviar_correo_qr_at;

      if (after.pago?.correo_aprobacion_enviado && !reenvioSolicitado) return;

      const transicionAAprobado = estadoAntes !== "aprobado";
      if (!transicionAAprobado && !reenvioSolicitado) return;

      console.log("notificarPagoAprobado: procesando", docId,
          reenvioSolicitado ? "(reenvío)" : "(aprobación)");

      try {
        const resultado = await procesarCorreoQrAprobado({
          docId,
          forzarReenvio: reenvioSolicitado,
        });
        if (resultado.omitido) {
          console.log("notificarPagoAprobado: omitido", docId, resultado.razon);
          return;
        }
        console.log("notificarPagoAprobado: correo enviado —", docId);
      } catch (e) {
        console.error("Error correo pago aprobado para", docId, ":", e.message);
      }

      // ── Aprobación en lote para colegios ──────────────────────────────────
      // Si el aprobado es el tutor (categoria "colegio"), aprobar y enviar
      // correo QR a todos sus estudiantes vinculados via tutorCodigo
      if (after.esColegio === true && after.categoria === "colegio" && transicionAAprobado) {
        console.log("notificarPagoAprobado: aprobando estudiantes del tutor", after.codigo);
        try {
          const estudiantesSnap = await db.collection("participantes")
              .where("tutorCodigo", "==", after.codigo)
              .get();

          if (!estudiantesSnap.empty) {
            const tareas = estudiantesSnap.docs.map(async (estDoc) => {
              const estData = estDoc.data();
              if (estData.pago?.estado === "aprobado") return; // ya aprobado
              try {
                await estDoc.ref.update({
                  "pago.estado": "aprobado",
                  "pago.aprobadoPor": after.pago?.aprobadoPor || null,
                  "pago.aprobadoEn": FieldValue.serverTimestamp(),
                  "actualizadoEn": FieldValue.serverTimestamp(),
                });
                await procesarCorreoQrAprobado({docId: estDoc.id});
                console.log("notificarPagoAprobado: estudiante aprobado —", estDoc.id);
              } catch (e) {
                console.error("Error aprobando estudiante", estDoc.id, ":", e.message);
              }
            });
            await Promise.allSettled(tareas);
            console.log("notificarPagoAprobado: lote colegio finalizado —", estudiantesSnap.size, "estudiantes");
          }
        } catch (e) {
          console.error("Error en aprobación en lote colegio:", e.message);
        }
      }
    },
);

// ─── CLOUD FUNCTION: subirFotoEfectivo ───────────────────────────────────────
// El staff sube una foto del participante pagando en efectivo a Finanzas.
// Solo roles con permiso de aprobar_pagos pueden invocarla.
exports.subirFotoEfectivo = onCall(
    {region: "us-central1", maxInstances: 10},
    async (request) => {
      try {
        // Verificar que el caller es staff con permiso de aprobar pagos
        if (!request.auth?.uid) {
          throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
        }
        const snapUsuario = await db.collection("usuarios").doc(request.auth.uid).get();
        const rolUsuario = snapUsuario.data()?.rol;
        const ROLES_APROBAR = new Set(["ceo", "junta_principal", "junta", "finanzas"]);
        if (!ROLES_APROBAR.has(rolUsuario)) {
          throw new HttpsError("permission-denied", "No tienes permiso para registrar pagos en efectivo.");
        }

        const docId = String(request.data?.docId || "").trim();
        const base64 = request.data?.base64;
        const contentType = String(request.data?.contentType || "").trim();
        const nombre = String(request.data?.nombre || "foto-efectivo").trim();

        if (!docId) throw new HttpsError("invalid-argument", "docId requerido.");
        if (!base64) throw new HttpsError("invalid-argument", "Foto requerida.");

        // Solo imágenes (no PDF) para fotos de efectivo
        const TIPOS_FOTO = new Set(["image/jpeg", "image/png", "image/webp"]);
        if (!TIPOS_FOTO.has(contentType)) {
          throw new HttpsError("invalid-argument", "La foto debe ser JPEG, PNG o WEBP.");
        }

        const buffer = Buffer.from(base64, "base64");
        if (!buffer.length || buffer.length > LIMITE_COMPROBANTE) {
          throw new HttpsError("invalid-argument", "La foto no puede superar 10 MB.");
        }

        const extMap = {"image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp"};
        const ruta = `comprobantes/${docId}_efectivo.${extMap[contentType]}`;

        await bucket.file(ruta).save(buffer, {
          metadata: {
            contentType,
            metadata: {
              nombreOriginal: nombre.slice(0, 200),
              subidoEn: new Date().toISOString(),
              tipo: "foto_efectivo_staff",
            },
          },
        });

        // Guardar la ruta en Firestore
        await db.collection("participantes").doc(docId).update({
          "pago.comprobanteRuta": ruta,
          "actualizadoEn": FieldValue.serverTimestamp(),
        });

        return {ok: true, ruta};
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error("subirFotoEfectivo:", e);
        throw new HttpsError("internal", "Error al subir la foto. Intenta de nuevo.");
      }
    },
);
