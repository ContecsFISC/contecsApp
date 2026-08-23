const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentUpdated} = require("firebase-functions/v2/firestore");
const {defineSecret} = require("firebase-functions/params");
const {initializeApp} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getStorage} = require("firebase-admin/storage");
const crypto = require("crypto");
const https = require("https");
const {linkPerfilParticipante, linkGiraParticipante} = require("./qr-participante");
const {cargarCorreoPagoAprobado, cargarCorreoNotificacionGira} = require("./plantillas");

initializeApp();

const db = getFirestore();
const bucket = getStorage().bucket();
const {
  ejecutarOperacionFinanciera,
} = require("./operaciones-financieras");
const {ejecutarOperacionQr, marcarCheckpointGira} = require("./operaciones-qr");

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
// La API key de Brevo YA NO vive en el código fuente (así nunca vuelve a
// filtrarse a GitHub). Se guarda en Secret Manager de Google Cloud con:
//   firebase functions:secrets:set BREVO_API_KEY
// y se referencia aquí solo por nombre; el valor real nunca toca git.
const BREVO_API_KEY = defineSecret("BREVO_API_KEY");
const CORREO_REMITENTE = {name: "CONTECS 2026", email: "contecs.logistica@utp.ac.pa"};
const MAX_REENVIOS_CORREO_QR = 4;
const MAX_REGISTROS_POR_HORA_IP = 25;
const MAX_ESTUDIANTES_COLEGIO = 60;

const CATEGORIAS_REGISTRO = Object.freeze({
  estudiante_utp: {nombre: "Estudiante UTP", precio: 10},
  estudiante_externo: {nombre: "Estudiante Externo", precio: 20},
  academico_utp: {nombre: "Académico UTP", precio: 20},
  academico_externo: {nombre: "Académico Externo", precio: 30},
  profesional: {nombre: "Profesional", precio: 30},
  autor: {nombre: "Autor de Resumen", precio: 35},
  otros: {nombre: "Otros", precio: 20},
  colegio: {nombre: "Colegio", precio: 6},
});

const TIPOS_COMPROBANTE = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"]);
const LIMITE_COMPROBANTE = 10 * 1024 * 1024;

const ROLES_ENVIAR_CORREO_QR = new Set([
  "ceo", "junta_principal", "junta", "coordinador",
  "actividades", "finanzas", "secretario", "comunicaciones", "staff_contecs",
]);

// Quiénes pueden pedir la lista mínima de participantes para armar giras.
// Mismo set que el permiso "gestionar_giras" en js/core/permisos.js — no
// canGestionarParticipantes() completo a propósito: este set más chico solo
// habilita la lectura acotada de listarParticipantesParaGiras, nunca lectura
// directa de /participantes desde el cliente.
const ROLES_LISTAR_PARTICIPANTES_GIRAS = new Set(["ceo", "junta_principal", "giras"]);

// Toda modificación contable se ejecuta con Admin SDK después de validar la
// sesión y el rol. El navegador ya no puede escribir saldos o ventas directo.
exports.ejecutarOperacionFinanciera = onCall(
    {region: "us-central1", maxInstances: 20},
    async (request) => {
      try {
        return await ejecutarOperacionFinanciera(request);
      } catch (error) {
        if (error instanceof HttpsError) throw error;
        console.error("ejecutarOperacionFinanciera:", error);
        throw new HttpsError(
            "internal",
            "No se pudo completar la operación financiera.",
        );
      }
    },
);

exports.ejecutarOperacionQr = onCall(
    {region: "us-central1", maxInstances: 10},
    async (request) => {
      try {
        return await ejecutarOperacionQr(request);
      } catch (error) {
        if (error instanceof HttpsError) throw error;
        console.error("ejecutarOperacionQr:", error);
        throw new HttpsError("internal", "No se pudo registrar el escaneo.");
      }
    },
);

// Check-in/check-out de gira: función nueva y separada de ejecutarOperacionQr
// a propósito (ver PLAN_GIRAS_Y_CSV.md, punto 5) — no valida pago.estado.
exports.marcarCheckpointGira = onCall(
    {region: "us-central1", maxInstances: 10},
    async (request) => {
      try {
        return await marcarCheckpointGira(request);
      } catch (error) {
        if (error instanceof HttpsError) throw error;
        console.error("marcarCheckpointGira:", error);
        throw new HttpsError("internal", "No se pudo registrar el checkpoint de gira.");
      }
    },
);

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

function idBloqueoParticipante(tipo, valor) {
  const hash = crypto.createHash("sha256")
      .update(String(valor || "").trim().toLowerCase())
      .digest("hex");
  return `${tipo}_${hash}`;
}

async function crearParticipantesUnicos(registros) {
  const entradas = registros.map((registro) => ({
    ...registro,
    correoRef: db.collection("identificadores_participantes")
        .doc(idBloqueoParticipante("correo", registro.correo)),
    cedulaRef: registro.cedula ?
      db.collection("identificadores_participantes")
          .doc(idBloqueoParticipante("cedula", registro.cedula)) : null,
  }));
  const refs = entradas.flatMap((entrada) => [
    entrada.docRef,
    entrada.correoRef,
    ...(entrada.cedulaRef ? [entrada.cedulaRef] : []),
  ]);
  const rutas = refs.map((ref) => ref.path);
  if (new Set(rutas).size !== rutas.length) {
    throw new HttpsError(
        "already-exists",
        "El grupo contiene cédulas o correos repetidos.",
    );
  }

  await db.runTransaction(async (tx) => {
    const existentes = await tx.getAll(...refs);
    if (existentes.some((snap) => snap.exists)) {
      throw new HttpsError(
          "already-exists",
          "Ya existe una inscripción con una de estas cédulas o correos.",
      );
    }
    entradas.forEach((entrada) => {
      const bloqueo = {
        participanteId: entrada.docRef.id,
        creadoEn: FieldValue.serverTimestamp(),
      };
      tx.set(entrada.docRef, entrada.participante);
      tx.set(entrada.correoRef, bloqueo);
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
  const contieneControl = [...texto].some((caracter) => {
    const codigo = caracter.charCodeAt(0);
    return codigo === 127 || (codigo < 32 && codigo !== 9 && codigo !== 10 && codigo !== 13);
  });
  if (texto.includes("<") || texto.includes(">") || contieneControl) {
    throw new HttpsError("invalid-argument", `El campo ${campo} contiene caracteres no permitidos.`);
  }
  return texto;
}

function normalizarCamposExtra(valor) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const entradas = Object.entries(valor);
  if (entradas.length > 30) {
    throw new HttpsError("invalid-argument", "Hay demasiados campos adicionales.");
  }
  return Object.fromEntries(entradas.map(([clave, contenido]) => {
    const claveLimpia = validarTexto(clave, "nombre de campo adicional", {requerido: true, max: 60});
    if (!/^[\p{L}\p{N}_ -]+$/u.test(claveLimpia)) {
      throw new HttpsError("invalid-argument", "Un campo adicional tiene un nombre inválido.");
    }
    return [claveLimpia, validarTexto(String(contenido ?? ""), claveLimpia, {max: 500})];
  }));
}

function normalizarTutor(valor) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    throw new HttpsError("invalid-argument", "Los datos del tutor son obligatorios.");
  }
  return {
    nombre: validarTexto(valor.nombre, "nombre del tutor", {requerido: true, max: 100}),
    apellido: validarTexto(valor.apellido, "apellido del tutor", {requerido: true, max: 100}),
    correo: validarTexto(valor.correo, "correo del tutor", {requerido: true, max: 254}).toLowerCase(),
    telefono: validarTexto(valor.telefono, "teléfono del tutor", {requerido: true, max: 30}),
    colegio: validarTexto(valor.colegio, "colegio", {requerido: true, max: 200}),
  };
}

function normalizarEstudiantes(valor) {
  if (!Array.isArray(valor)) return [];
  if (valor.length > MAX_ESTUDIANTES_COLEGIO) {
    throw new HttpsError("invalid-argument", `Un grupo no puede superar ${MAX_ESTUDIANTES_COLEGIO} estudiantes.`);
  }
  return valor.map((est, indice) => ({
    nombre: validarTexto(est?.nombre, `nombre del estudiante ${indice + 1}`, {requerido: true, max: 100}),
    apellido: validarTexto(est?.apellido, `apellido del estudiante ${indice + 1}`, {requerido: true, max: 100}),
    cedula: validarTexto(est?.cedula, `cédula del estudiante ${indice + 1}`, {max: 30}),
    correo: validarTexto(est?.correo, `correo del estudiante ${indice + 1}`, {requerido: true, max: 254}).toLowerCase(),
    grado: validarTexto(est?.grado, `grado del estudiante ${indice + 1}`, {max: 80}),
    bachiller: validarTexto(est?.bachiller, `bachiller del estudiante ${indice + 1}`, {max: 120}),
  }));
}

async function aplicarLimiteRegistro(request) {
  const raw = request.rawRequest;
  const ip = String(raw?.headers?.["x-forwarded-for"] || raw?.ip || "desconocida")
      .split(",")[0].trim();
  const hash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
  const ref = db.collection("limites_registro").doc(hash);
  const ahora = Date.now();
  const ventanaMs = 60 * 60 * 1000;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() || {};
    const inicio = Number(data.ventanaInicio || 0);
    const vigente = ahora - inicio < ventanaMs;
    const cantidad = vigente ? Number(data.cantidad || 0) : 0;
    if (cantidad >= MAX_REGISTROS_POR_HORA_IP) {
      throw new HttpsError("resource-exhausted", "Demasiados registros desde esta conexión. Intenta más tarde.");
    }
    tx.set(ref, {
      ventanaInicio: vigente ? inicio : ahora,
      cantidad: cantidad + 1,
      actualizadoEn: FieldValue.serverTimestamp(),
    });
  });
}

async function subirComprobante({docId, base64, contentType, nombre}) {
  if (!base64) return null;
  if (!TIPOS_COMPROBANTE.has(contentType)) throw new HttpsError("invalid-argument", "El comprobante debe ser PDF o imagen.");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > LIMITE_COMPROBANTE) throw new HttpsError("invalid-argument", "El comprobante no puede superar 10 MB.");
  const extMap = {"application/pdf": "pdf", "image/jpeg": "jpeg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"};
  // Una ruta única evita que dos inscripciones simultáneas con la misma
  // identidad se sobrescriban (y que limpiar la duplicada borre la válida).
  const sufijo = crypto.randomBytes(6).toString("hex");
  const ruta = `comprobantes/${docId}_${sufijo}.${
    extMap[contentType] || "bin"
  }`;
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
        "api-key": BREVO_API_KEY.value(),
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

// Punto único de envío transaccional. `to` es un participante {email, name};
// Brevo recibe el remitente institucional y el contenido ya renderizado.
async function enviarCorreoTransaccional({sender, to, subject, htmlContent, textContent}) {
  const resp = await brevoRequest({sender, to, subject, htmlContent, textContent});
  return {messageId: resp?.messageId || null};
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

  const brevoResp = await enviarCorreoTransaccional({
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
    const reenviosUsados = Math.max(0, Number(participante.pago?.correo_aprobacion_reenvios) || 0);
    const esReenvio = forzarReenvio && !!participante.pago?.correo_aprobacion_enviado;
    if (esReenvio && reenviosUsados >= MAX_REENVIOS_CORREO_QR) {
      return {omitir: true, razon: "limite_reenvios", reenviosUsados};
    }
    if (participante.pago?.correo_aprobacion_enviado && !forzarReenvio) {
      return {omitir: true, razon: "ya_enviado", reenviosUsados};
    }
    const bloqueoInicio = participante.pago?.correo_aprobacion_enviandoEn?.toMillis?.() || 0;
    const bloqueoVigente = participante.pago?.correo_aprobacion_enviando &&
      Date.now() - bloqueoInicio < 5 * 60 * 1000;
    if (bloqueoVigente) {
      return {omitir: true, razon: "en_proceso", reenviosUsados};
    }
    tx.update(docRef, {
      "pago.correo_aprobacion_enviando": true,
      "pago.correo_aprobacion_enviandoEn": FieldValue.serverTimestamp(),
    });
    return {omitir: false, participante, esReenvio, reenviosUsados};
  });

  if (bloqueo.omitir) {
    return {
      enviado: false,
      omitido: true,
      razon: bloqueo.razon,
      reenviosUsados: bloqueo.reenviosUsados ?? 0,
      reenviosRestantes: Math.max(0, MAX_REENVIOS_CORREO_QR - (bloqueo.reenviosUsados ?? 0)),
    };
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

  const estadoCorreo = {
    "pago.correo_aprobacion_error": errorMsg,
    "pago.correo_aprobacion_enviando": false,
    "pago.correo_aprobacion_enviandoEn": null,
  };

  if (bloqueo.esReenvio) {
    estadoCorreo["pago.correo_aprobacion_reenvio_error"] = errorMsg;
    if (enviado) {
      estadoCorreo["pago.correo_aprobacion_reenvios"] = FieldValue.increment(1);
      estadoCorreo["pago.correo_aprobacion_ultimo_reenvioEn"] = FieldValue.serverTimestamp();
      estadoCorreo["pago.correo_aprobacion_ultimo_reenvio_brevo_id"] = brevoMessageId;
    }
  } else {
    estadoCorreo["pago.correo_aprobacion_enviado"] = enviado;
    estadoCorreo["pago.correo_aprobacion_pendiente"] = !enviado && !omitidoPlantilla;
    estadoCorreo["pago.correo_aprobacion_enviadoEn"] = enviado ? FieldValue.serverTimestamp() : null;
    estadoCorreo["pago.correo_aprobacion_brevo_id"] = brevoMessageId;
    if (enviado && bloqueo.participante.pago?.correo_aprobacion_reenvios == null) {
      estadoCorreo["pago.correo_aprobacion_reenvios"] = 0;
    }
  }

  await docRef.update(estadoCorreo)
      .catch((e) => console.error("No se pudo marcar estado correo:", e.message));

  if (errorMsg) throw new Error(errorMsg);
  if (omitidoPlantilla) return {enviado: false, omitido: true, razon: "plantilla_desactivada"};
  const reenviosUsados = bloqueo.reenviosUsados + (bloqueo.esReenvio ? 1 : 0);
  return {
    enviado: true,
    brevoMessageId,
    esReenvio: bloqueo.esReenvio,
    reenviosUsados,
    reenviosRestantes: Math.max(0, MAX_REENVIOS_CORREO_QR - reenviosUsados),
  };
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

        await aplicarLimiteRegistro(request);

        const esColegio = data.esColegio === true;
        const categoriaId = esColegio ? "colegio" : validarTexto(
            data.categoria,
            "categoría",
            {requerido: true, max: 40},
        );
        const categoriaConfig = CATEGORIAS_REGISTRO[categoriaId];
        if (!categoriaConfig) {
          throw new HttpsError("invalid-argument", "La categoría seleccionada no es válida.");
        }

        const camposExtra = normalizarCamposExtra(data.camposExtra);
        const estudiantesData = esColegio ? normalizarEstudiantes(data.estudiantes) : [];
        const tutorData = esColegio ? normalizarTutor(data.tutor) : null;
        if (esColegio && estudiantesData.length === 0) {
          throw new HttpsError("invalid-argument", "Agrega al menos un estudiante al grupo del colegio.");
        }
        if (tutorData && !validarCorreo(tutorData.correo)) {
          throw new HttpsError("invalid-argument", "El correo del tutor no es válido.");
        }
        for (const estudiante of estudiantesData) {
          if (!validarCorreo(estudiante.correo)) {
            throw new HttpsError("invalid-argument", `El correo de ${estudiante.nombre} no es válido.`);
          }
        }

        const montoCalculado = esColegio ?
          categoriaConfig.precio * (1 + estudiantesData.length) :
          categoriaConfig.precio;

        const docId = generarDocId(cedula, correo);
        if (!docId) throw new HttpsError("invalid-argument", "Se requiere cédula o correo.");

        const docRef = db.collection("participantes").doc(docId);
        const identidades = [
          {cedula, correo, docId},
          ...estudiantesData.map((estudiante) => ({
            cedula: estudiante.cedula,
            correo: estudiante.correo,
            docId: generarDocId(estudiante.cedula, estudiante.correo),
          })),
        ];
        const correos = identidades.map((item) => item.correo);
        const cedulas = identidades.map((item) => item.cedula).filter(Boolean);
        if (new Set(correos).size !== correos.length ||
            new Set(cedulas).size !== cedulas.length) {
          throw new HttpsError(
              "already-exists",
              "El grupo contiene cédulas o correos repetidos.",
          );
        }
        // Consulta también la colección histórica: los registros creados antes
        // de los bloqueos de identidad todavía no poseen un documento-lock.
        const comprobacionesHistoricas = await Promise.all(
            identidades.map((item) => db.collection("participantes")
                .where("correo", "==", item.correo).limit(1).get()),
        );
        if (comprobacionesHistoricas.some((snap) => !snap.empty)) {
          throw new HttpsError("already-exists", "Ya existe una inscripción con esta cédula o correo. Si crees que es un error, contacta al staff en congresofisc@utp.ac.pa");
        }

        const codigos = await generarCodigos(identidades.length);
        const codigo = codigos[0];
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

        const participante = {
          codigo, token,
          nombre, apellido, nombreCompleto: `${nombre} ${apellido}`,
          cedula, correo, telefono,
          categoria: categoriaId,
          categoriaNombre: categoriaConfig.nombre,
          camposExtra,
          pago: {
            metodo: metodoPago,
            estado: metodoPago === "transferencia" ? "comprobante_enviado" : "pendiente_efectivo",
            comprobanteRuta,
            monto: montoCalculado,
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

        const registros = [{
          docRef,
          participante,
          correo,
          cedula,
        }];
        estudiantesData.forEach((est, indice) => {
          const estId = generarDocId(est.cedula, est.correo);
          const estRef = db.collection("participantes").doc(estId);
          registros.push({
            docRef: estRef,
            correo: est.correo,
            cedula: est.cedula,
            participante: {
              codigo: codigos[indice + 1],
              token: generarToken(),
              nombre: est.nombre,
              apellido: est.apellido,
              nombreCompleto: `${est.nombre} ${est.apellido}`,
              cedula: est.cedula,
              correo: est.correo,
              telefono: "",
              categoria: "colegio_estudiante",
              categoriaNombre: "Colegio",
              camposExtra: {grado: est.grado, bachiller: est.bachiller},
              pago: {
                metodo: metodoPago,
                estado: metodoPago === "transferencia" ?
                  "comprobante_enviado" : "pendiente_efectivo",
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
              correo_enviado: false,
              correo_pendiente: true,
              fechaRegistro: FieldValue.serverTimestamp(),
              actualizadoEn: FieldValue.serverTimestamp(),
            },
          });
        });

        try {
          // Tutor y estudiantes se crean juntos: o se guarda todo el grupo o
          // no se guarda nada, incluso ante dos solicitudes simultáneas.
          await crearParticipantesUnicos(registros);
        } catch (e) {
          if (comprobanteRuta) {
            await bucket.file(comprobanteRuta)
                .delete({ignoreNotFound: true}).catch(() => {});
          }
          throw e;
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
    {region: "us-central1", maxInstances: 10, secrets: [BREVO_API_KEY]},
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
                resultado.razon === "limite_reenvios" ?
                  `Se alcanzó el máximo de ${MAX_REENVIOS_CORREO_QR} reenvíos para este participante.` :
                "No se pudo enviar en este momento.",
            reenviosUsados: resultado.reenviosUsados,
            reenviosRestantes: resultado.reenviosRestantes,
            // El panel debe tratar esto como éxito si esOk === true
            ok: esOk,
          };
        }

        console.log("enviarCorreoQrParticipante: OK", docId, resultado.brevoMessageId || "");
        return {
          enviado: true,
          brevoMessageId: resultado.brevoMessageId,
          mensaje: resultado.esReenvio ?
            `Correo reenviado correctamente. Quedan ${resultado.reenviosRestantes} de ${MAX_REENVIOS_CORREO_QR} reenvíos.` :
            "Correo con QR enviado correctamente.",
          reenviosUsados: resultado.reenviosUsados,
          reenviosRestantes: resultado.reenviosRestantes,
          ok: true,
        };
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error("enviarCorreoQrParticipante:", e);
        throw new HttpsError("internal", e.message || "Error al enviar el correo.");
      }
    },
);

// ─── GIRAS: lectura mínima de participantes para selección manual ───────────
// El rol "giras" NO tiene permiso de lectura sobre /participantes en
// firestore.rules (a propósito: esa colección trae comprobantes de pago,
// teléfono y cédula). Esta función corre con Admin SDK, verifica el rol
// ella misma, y devuelve solo lo necesario para armar un selector de nombres
// — incluyendo participantes con pago pendiente/rechazado, tal como se pidió.
exports.listarParticipantesParaGiras = onCall(
    {region: "us-central1", maxInstances: 10},
    async (request) => {
      try {
        if (!request.auth?.uid) {
          throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
        }
        const snapUsuario = await db.collection("usuarios").doc(request.auth.uid).get();
        const rol = snapUsuario.data()?.rol;
        if (!ROLES_LISTAR_PARTICIPANTES_GIRAS.has(rol)) {
          throw new HttpsError("permission-denied", "No tienes permiso para ver la lista de participantes.");
        }

        const snap = await db.collection("participantes")
            .select("nombreCompleto", "nombre", "apellido", "cedula", "codigo", "categoria")
            .get();

        const participantes = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            nombre: data.nombreCompleto || `${data.nombre || ""} ${data.apellido || ""}`.trim(),
            cedula: data.cedula || "",
            codigo: data.codigo || "",
            categoria: data.categoria || "",
          };
        });

        return {participantes, total: participantes.length};
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error("listarParticipantesParaGiras:", e);
        throw new HttpsError("internal", "Error al obtener la lista de participantes.");
      }
    },
);

function formatearFechaGira(fecha) {
  try {
    const d = fecha?.toDate ? fecha.toDate() : new Date(fecha);
    if (Number.isNaN(d.getTime())) return "Por confirmar";
    return d.toLocaleDateString("es-PA", {
      weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Panama",
    });
  } catch (e) {
    return "Por confirmar";
  }
}

async function enviarCorreoNotificacionGira({giraId, gira, participante}) {
  const codigo = participante.codigo;
  const token = participante.token;
  const correo = participante.correo;
  const nombre = participante.nombreCompleto ||
    `${participante.nombre || ""} ${participante.apellido || ""}`.trim();
  if (!codigo || !token || !correo) {
    throw new Error("Participante sin codigo, token o correo");
  }

  const vars = {
    nombre,
    gira_nombre: gira.nombre || "Gira CONTECS",
    gira_fecha: formatearFechaGira(gira.fecha),
    gira_lugar: gira.lugar || "Por confirmar",
    link_gira: linkGiraParticipante(codigo, token, giraId),
  };

  const plantilla = cargarCorreoNotificacionGira(vars);
  if (!plantilla.activo) {
    return {enviado: false, omitido: true};
  }

  const brevoResp = await enviarCorreoTransaccional({
    sender: CORREO_REMITENTE,
    to: [{email: correo, name: nombre}],
    subject: plantilla.subject,
    htmlContent: plantilla.htmlContent,
    textContent: plantilla.textContent,
  });

  return {enviado: true, brevoMessageId: brevoResp?.messageId || null};
}

// ─── GIRAS: notificación por correo a los participantes de una gira ────────
// Disparo manual (botón "Notificar participantes"), separado de "Guardar
// gira" a propósito — ver PLAN_GIRAS_Y_CSV.md, punto 3. Solo envía a los
// participantes de la gira que todavía no fueron notificados (se guarda el
// registro en gira.notificados), para no reenviar a todo el mundo cada vez
// que GIRAS ajusta la lista y vuelve a hacer clic.
exports.notificarParticipantesGira = onCall(
    {region: "us-central1", maxInstances: 10, secrets: [BREVO_API_KEY]},
    async (request) => {
      try {
        if (!request.auth?.uid) {
          throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
        }
        const snapUsuario = await db.collection("usuarios").doc(request.auth.uid).get();
        const rol = snapUsuario.data()?.rol;
        if (!ROLES_LISTAR_PARTICIPANTES_GIRAS.has(rol)) {
          throw new HttpsError("permission-denied", "No tienes permiso para notificar esta gira.");
        }

        const giraId = validarTexto(request.data?.giraId, "giraId", {requerido: true, max: 200});
        const giraRef = db.collection("giras_voluntarios").doc(giraId);
        const giraSnap = await giraRef.get();
        if (!giraSnap.exists) {
          throw new HttpsError("not-found", "La gira ya no existe.");
        }
        const gira = giraSnap.data();
        const participantesGira = Array.isArray(gira.participantes) ? gira.participantes : [];
        if (participantesGira.length === 0) {
          return {enviados: 0, omitidos: 0, mensaje: "Esta gira todavía no tiene participantes seleccionados."};
        }

        const yaNotificados = new Set(gira.notificados || []);
        const pendientes = participantesGira.filter((p) => p?.id && !yaNotificados.has(p.id));

        if (pendientes.length === 0) {
          return {
            enviados: 0,
            omitidos: participantesGira.length,
            mensaje: "Todos los participantes de esta gira ya fueron notificados.",
          };
        }

        const resultados = await Promise.allSettled(pendientes.map(async (p) => {
          const participanteSnap = await db.collection("participantes").doc(p.id).get();
          if (!participanteSnap.exists) throw new Error(`Participante ${p.id} ya no existe`);
          const resultado = await enviarCorreoNotificacionGira({
            giraId, gira, participante: participanteSnap.data(),
          });
          if (resultado.omitido) throw new Error("plantilla_desactivada");
          return p.id;
        }));

        const enviadosIds = resultados
            .filter((r) => r.status === "fulfilled")
            .map((r) => r.value);
        const fallidos = resultados.filter((r) => r.status === "rejected").length;

        if (enviadosIds.length > 0) {
          await giraRef.update({
            notificados: FieldValue.arrayUnion(...enviadosIds),
            ultimaNotificacionEn: FieldValue.serverTimestamp(),
          });
        }

        console.log("notificarParticipantesGira:", giraId, "enviados:", enviadosIds.length, "fallidos:", fallidos);

        return {
          enviados: enviadosIds.length,
          fallidos,
          omitidos: participantesGira.length - pendientes.length,
          mensaje: fallidos > 0 ?
            `Se notificó a ${enviadosIds.length} participante(s). ${fallidos} no se pudo(ieron) enviar — intenta de nuevo más tarde.` :
            `Se notificó a ${enviadosIds.length} participante(s) nuevo(s).`,
        };
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error("notificarParticipantesGira:", e);
        throw new HttpsError("internal", "Error al notificar a los participantes de la gira.");
      }
    },
);

// ─── GIRAS: página pública de información de gira ───────────────────────────
// Función pública nueva, separada de accederParticipante (ver
// PLAN_GIRAS_Y_CSV.md, punto 4). Valida codigo+token igual que la credencial
// del congreso, confirma que el participante esté en el array `participantes`
// de la gira solicitada, y devuelve solo lo necesario para la página pública
// de gira — nunca datos de pago ni comprobantes, para no mezclar los dos
// conceptos de aprobación (pago del congreso vs. selección para la gira).
exports.accederGiraParticipante = onCall(
    {region: "us-central1", maxInstances: 30, invoker: "public"},
    async (request) => {
      try {
        const codigo = String(request.data?.codigo || "").trim().toUpperCase();
        const token = String(request.data?.token || "").trim();
        const giraId = String(request.data?.giraId || "").trim();

        if (!codigo || !token || !giraId) {
          throw new HttpsError("invalid-argument", "Faltan datos para acceder a la información de la gira.");
        }
        if (codigo.length > 30 || token.length > 64 || giraId.length > 200) {
          throw new HttpsError("invalid-argument", "Credenciales inválidas.");
        }

        const snap = await db.collection("participantes")
            .where("codigo", "==", codigo)
            .where("token", "==", token)
            .limit(1)
            .get();
        if (snap.empty) {
          throw new HttpsError("not-found", "Código o clave incorrectos. Revisa el correo que recibiste de Giras.");
        }
        const participanteSnap = snap.docs[0];
        const participante = participanteSnap.data();
        const participanteId = participanteSnap.id;

        const giraSnap = await db.collection("giras_voluntarios").doc(giraId).get();
        if (!giraSnap.exists) {
          throw new HttpsError("not-found", "La gira ya no existe.");
        }
        const gira = giraSnap.data();
        const enGira = (gira.participantes || []).some((p) => p.id === participanteId);
        if (!enGira) {
          throw new HttpsError("permission-denied", "No estás en la lista de participantes de esta gira.");
        }

        const [entradaSnap, salidaSnap] = await Promise.all([
          db.collection("asistencias_giras").doc(`${giraId}_${participanteId}_entrada`).get(),
          db.collection("asistencias_giras").doc(`${giraId}_${participanteId}_salida`).get(),
        ]);

        return {
          participante: {
            nombreCompleto: participante.nombreCompleto ||
              `${participante.nombre || ""} ${participante.apellido || ""}`.trim(),
            codigo: participante.codigo,
          },
          gira: {
            nombre: gira.nombre || null,
            descripcion: gira.descripcion || null,
            area: gira.area || null,
            lugar: gira.lugar || null,
            colaboracion: gira.colaboracion || null,
            fechaTexto: formatearFechaGira(gira.fecha),
          },
          checkpoints: {
            entrada: entradaSnap.exists ? {
              marcadoEn: entradaSnap.data().marcadoEn?.toMillis?.() || null,
            } : null,
            salida: salidaSnap.exists ? {
              marcadoEn: salidaSnap.data().marcadoEn?.toMillis?.() || null,
            } : null,
          },
        };
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error("accederGiraParticipante:", e);
        throw new HttpsError("internal", "Error al consultar la información de la gira. Intenta de nuevo.");
      }
    },
);

// ─── TRIGGER: respaldo al aprobar pago ───────────────────────────────────────
exports.notificarPagoAprobado = onDocumentUpdated(
    {document: "participantes/{docId}", region: "us-central1", secrets: [BREVO_API_KEY]},
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
        const ROLES_APROBAR = new Set(["ceo", "junta_principal", "junta", "finanzas", "secretario", "staff_contecs"]);
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
