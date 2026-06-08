const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp }     = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const https = require("https");

initializeApp();
const db = getFirestore();

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BREVO_API_KEY    = "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";
const CORREO_REMITENTE = { name: "CONTECS 2026", email: "congresofisc@utp.ac.pa" };
const URL_BASE_PERFIL  = "https://contecsfisc.github.io/contecsApp/perfil.html";

// ─── BREVO HELPER ─────────────────────────────────────────────────────────────
function brevoRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req  = https.request({
      hostname: "api.brevo.com",
      path:     "/v3/smtp/email",
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
        "api-key":        BREVO_API_KEY,
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
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

// ─── HTML DEL CORREO ──────────────────────────────────────────────────────────
function construirHTML({ nombre, codigo, categoriaNombre, metodoPago, linkPerfil }) {
  const estadoMensaje = metodoPago === "transferencia"
    ? "Tu comprobante fue recibido. El staff lo revisará y activará tu acceso pronto."
    : "Debes realizar tu pago en efectivo el día del evento en la mesa de inscripciones.";

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
      Tu inscripción al <strong>II CONTECS 2026</strong> fue registrada exitosamente.
    </p>
    <div style="background:#045223;border-radius:12px;padding:20px;text-align:center;margin-bottom:16px;">
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
      <tr><td style="padding:10px 0;">
        <span style="color:#8a9e8d;font-size:13px;">Estado</span><br/>
        <strong style="color:#d4850a;">${estadoMensaje}</strong>
      </td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${linkPerfil}" style="display:inline-block;background:linear-gradient(135deg,#00722e,#045223);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">
        Ver mi credencial y QR
      </a>
      <p style="font-size:11px;color:#8a9e8d;margin:10px 0 0;">Guarda este link — lo necesitarás el día del evento</p>
    </div>
    <div style="background:#e8f5ec;border-radius:10px;padding:16px 18px;">
      <p style="font-size:13px;font-weight:700;color:#045223;margin:0 0 6px;">Sobre el evento</p>
      <p style="font-size:13px;color:#1a2e1e;margin:0;line-height:1.6;">
        II CONTECS 2026 · FISC · Universidad Tecnológica de Panamá<br/>
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

function construirTexto({ nombre, codigo, categoriaNombre, metodoPago, linkPerfil }) {
  return `Hola ${nombre},

Tu inscripción al II CONTECS 2026 fue registrada exitosamente.

TU CÓDIGO: ${codigo}
Categoría: ${categoriaNombre}
Pago: ${metodoPago === "transferencia" ? "Transferencia bancaria" : "Efectivo"}

Accede a tu credencial aquí:
${linkPerfil}

II CONTECS 2026 · FISC · Universidad Tecnológica de Panamá
congresofisc@utp.ac.pa`;
}

// ─── TRIGGER: se dispara cuando se crea un doc en /participantes ──────────────
exports.enviarCorreoAlRegistrar = onDocumentCreated(
  { document: "participantes/{docId}", region: "us-central1" },
  async (event) => {
    const data  = event.data?.data();
    const docId = event.params.docId;

    if (!data || !data.correo || !data.codigo || !data.token) {
      console.error("Documento incompleto, no se envía correo:", docId);
      return;
    }

    // Si ya se marcó como enviado (reintento por error previo), saltar
    if (data.correo_enviado === true) {
      console.log("Correo ya enviado para:", docId);
      return;
    }

    const linkPerfil = `${URL_BASE_PERFIL}?c=${encodeURIComponent(data.codigo)}&t=${encodeURIComponent(data.token)}`;

    let correoEnviado = false;
    let correoError   = null;

    try {
      await brevoRequest({
        sender:      CORREO_REMITENTE,
        to:          [{ email: data.correo, name: data.nombre || "Participante" }],
        subject:     `CONTECS 2026 — Tu inscripción: ${data.codigo}`,
        htmlContent: construirHTML({
          nombre:          data.nombre || "Participante",
          codigo:          data.codigo,
          categoriaNombre: data.categoriaNombre || "Participante",
          metodoPago:      data.pago?.metodo || "efectivo",
          linkPerfil,
        }),
        textContent: construirTexto({
          nombre:          data.nombre || "Participante",
          codigo:          data.codigo,
          categoriaNombre: data.categoriaNombre || "Participante",
          metodoPago:      data.pago?.metodo || "efectivo",
          linkPerfil,
        }),
      });
      correoEnviado = true;
      console.log("Correo enviado a:", data.correo);
    } catch (e) {
      correoError = e.message;
      console.error("Error Brevo para", data.correo, ":", e.message);
    }

    // Marcar estado en Firestore
    try {
      await db.collection("participantes").doc(docId).update({
        correo_enviado:   correoEnviado,
        correo_pendiente: !correoEnviado,
        correo_error:     correoError || null,
        correo_enviadoEn: correoEnviado ? FieldValue.serverTimestamp() : null,
      });
    } catch (e) {
      console.error("No se pudo marcar estado correo:", e.message);
    }
  }
);
