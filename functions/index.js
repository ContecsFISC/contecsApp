const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getStorage} = require("firebase-admin/storage");
const crypto = require("crypto");
const https = require("https");

initializeApp();

const db = getFirestore();
const bucket = getStorage().bucket();

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const BREVO_API_KEY = "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";
const CORREO_REMITENTE = {name: "CONTECS 2026", email: "congresofisc@utp.ac.pa"};
const URL_BASE_PERFIL = "https://contecsfisc.github.io/contecsApp/perfil.html";

const TIPOS_COMPROBANTE = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"]);
const LIMITE_COMPROBANTE = 10 * 1024 * 1024;

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
    const current = snap.exists() ? (snap.data().valor || 0) : 0;
    const next = current + 1;
    tx.set(counterRef, {valor: next, actualizadoEn: FieldValue.serverTimestamp()}, {merge: true});
    return next;
  });
  return `CTCS-2026-${String(seq).padStart(5, "0")}`;
}

function validarCorreo(correo) {
  return typeof correo === "string" && correo.includes("@") && correo.length <= 254;
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
function brevoRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: "api.brevo.com",
      path: "/v3/smtp/email",
      method: "POST",
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
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
        else reject(new Error(`Brevo ${res.statusCode}: ${data}`));
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function construirHTMLCorreo({nombre, codigo, categoriaNombre, metodoPago, linkPerfil, esEstudianteColegio, tutorNombre}) {
  const estadoMensaje = metodoPago === "transferencia" ?
    "Tu comprobante fue recibido. El staff lo revisará y activará tu acceso pronto." :
    "Debes realizar tu pago en efectivo el día del evento en la mesa de inscripciones.";

  const notaColegio = esEstudianteColegio && tutorNombre ?
    `<tr><td style="padding:10px 0;border-bottom:1px solid #e0e0e0;">
        <span style="color:#8a9e8d;font-size:13px;">Tutor responsable</span><br/>
        <strong style="color:#1a2e1e;">${tutorNombre}</strong>
       </td></tr>` :
    "";

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f4f7f5;font-family:'Segoe UI',system-ui,sans-serif;">
<div style="max-width:580px;margin:0 auto;padding:24px 16px;">
  <div style="background:linear-gradient(135deg,#045223 0%,#00722e 60%,#39b54a 100%);border-radius:16px 16px 0 0;padding:32px 28px;text-align:center;">
    <h1 style="color:#fff;font-size:22px;font-weight:800;margin:0;letter-spacing:1px;">CONTECS 2026</h1>
    <p style="color:rgba(255,255,255,0.75);font-size:13px;margin:6px 0 0;">II Congreso de Tecnologías en Ciencias Computacionales</p>
  </div>
  <div style="background:#fff;padding:28px;border-radius:0 0 16px 16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <p style="font-size:16px;color:#1a2e1e;margin:0 0 20px;">Hola, <strong>${nombre}</strong></p>
    <p style="font-size:14px;color:#8a9e8d;line-height:1.6;margin:0 0 24px;">
      Tu inscripción al <strong>II Congreso de Tecnologías en Ciencias Computacionales — CONTECS 2026</strong> fue registrada exitosamente.
    </p>
    <div style="background:#045223;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="color:rgba(255,255,255,0.6);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Tu código de participante</p>
      <p style="color:#fff;font-size:26px;font-weight:800;letter-spacing:4px;margin:0;font-family:'Courier New',monospace;">${codigo}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #e0e0e0;">
        <span style="color:#8a9e8d;font-size:13px;">Categoría</span><br/>
        <strong style="color:#1a2e1e;">${categoriaNombre}</strong>
      </td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #e0e0e0;">
        <span style="color:#8a9e8d;font-size:13px;">Método de pago</span><br/>
        <strong style="color:#1a2e1e;">${metodoPago === "transferencia" ? "Transferencia bancaria" : "Efectivo"}</strong>
      </td></tr>
      ${notaColegio}
      <tr><td style="padding:10px 0;">
        <span style="color:#8a9e8d;font-size:13px;">Estado</span><br/>
        <strong style="color:#d4850a;">${estadoMensaje}</strong>
      </td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${linkPerfil}" style="display:inline-block;background:linear-gradient(135deg,#00722e,#045223);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">
        Acceder a mi credencial y QR
      </a>
      <p style="font-size:11px;color:#8a9e8d;margin:10px 0 0;">Guarda este link — lo necesitarás el día del evento</p>
    </div>
    <div style="border-top:1px solid #e8f5ec;margin:24px 0;"></div>
    <div style="background:#e8f5ec;border-radius:10px;padding:16px 18px;">
      <p style="font-size:13px;font-weight:700;color:#045223;margin:0 0 8px;">Sobre el evento</p>
      <p style="font-size:13px;color:#1a2e1e;margin:0;line-height:1.6;">
        <strong>II CONTECS 2026</strong><br/>
        Facultad de Ingeniería de Sistemas Computacionales<br/>
        Universidad Tecnológica de Panamá<br/>
        <a href="mailto:congresofisc@utp.ac.pa" style="color:#00722e;">congresofisc@utp.ac.pa</a>
      </p>
    </div>
    <p style="font-size:11px;color:#8a9e8d;text-align:center;margin:24px 0 0;line-height:1.6;">
      Este correo fue generado automáticamente. No respondas a este mensaje.<br/>
      CONTECS 2026 · FISC · Universidad Tecnológica de Panamá
    </p>
  </div>
</div>
</body></html>`;
}

function construirTextoCorreo({nombre, codigo, categoriaNombre, metodoPago, linkPerfil}) {
  return `Hola ${nombre},

Tu inscripción al II CONTECS 2026 fue registrada exitosamente.

TU CÓDIGO DE PARTICIPANTE: ${codigo}

Categoría: ${categoriaNombre}
Método de pago: ${metodoPago === "transferencia" ? "Transferencia bancaria" : "Efectivo"}

Accede a tu credencial y QR aquí:
${linkPerfil}

Guarda ese link — lo necesitarás el día del evento.

II CONTECS 2026 · FISC · Universidad Tecnológica de Panamá
congresofisc@utp.ac.pa

Este correo fue generado automáticamente. No respondas a este mensaje.`;
}

async function enviarCorreoBienvenida({docId, codigo, token, nombre, correo, categoriaNombre, metodoPago, esEstudianteColegio, tutorNombre}) {
  const linkPerfil = `${URL_BASE_PERFIL}?c=${encodeURIComponent(codigo)}&t=${encodeURIComponent(token)}`;
  const htmlContent = construirHTMLCorreo({nombre, codigo, categoriaNombre, metodoPago, linkPerfil, esEstudianteColegio, tutorNombre});
  const textContent = construirTextoCorreo({nombre, codigo, categoriaNombre, metodoPago, linkPerfil});

  let correoEnviado = false;
  let correoError = null;

  try {
    await brevoRequest({
      sender: CORREO_REMITENTE,
      to: [{email: correo, name: nombre}],
      subject: `CONTECS 2026 — Tu inscripción: ${codigo}`,
      htmlContent,
      textContent,
    });
    correoEnviado = true;
  } catch (e) {
    correoError = e.message;
    console.error("Brevo error para", correo, ":", e.message);
  }

  // Marcar en Firestore si el correo falló — staff puede reenviarlo
  try {
    await db.collection("participantes").doc(docId).update({
      correo_enviado: correoEnviado,
      correo_pendiente: !correoEnviado,
      correo_error: correoError || null,
      correo_enviadoEn: correoEnviado ? FieldValue.serverTimestamp() : null,
    });
  } catch (e) {
    console.error("No se pudo actualizar estado correo en Firestore:", e.message);
  }
}

// ─── CLOUD FUNCTION: registrarParticipante ────────────────────────────────────
exports.registrarParticipante = onCall(
    {region: "us-central1", maxInstances: 20},
    async (request) => {
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
      if (existe.exists) throw new HttpsError("already-exists", "Ya existe una inscripción con esta cédula o correo. Si crees que es un error, contacta al staff en congresofisc@utp.ac.pa");

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
          if (estExiste.exists) continue;
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

      // Enviar correos — no bloqueamos la respuesta si falla
      enviarCorreoBienvenida({
        docId, codigo, token, nombre, correo,
        categoriaNombre: esColegio ? "Colegio" : (data.categoriaNombre || "Participante"),
        metodoPago,
        esEstudianteColegio: false,
        tutorNombre: null,
      }).catch((e) => console.error("Correo tutor/principal fallido:", e.message));

      if (estudiantesGuardados.length > 0) {
        const tutorNombreVal = tutorData?.nombre || "";
        for (const est of estudiantesGuardados) {
          enviarCorreoBienvenida({
            docId: est.docId,
            codigo: est.codigo,
            token: est.token,
            nombre: est.nombre,
            correo: est.correo,
            categoriaNombre: "Colegio",
            metodoPago,
            esEstudianteColegio: true,
            tutorNombre: tutorNombreVal,
          }).catch((e) => console.error("Correo estudiante fallido:", est.correo, e.message));
        }
      }

      return {codigo, correo};
    },
);

// ─── CLOUD FUNCTION: accederParticipante ──────────────────────────────────────
exports.accederParticipante = onCall(
    {region: "us-central1", maxInstances: 30},
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
        throw new HttpsError("not-found", "Código o clave incorrectos. Revisa el correo que recibiste al inscribirte.");
      }

      return sanitizarParticipante(snap.docs[0].data());
    },
);
