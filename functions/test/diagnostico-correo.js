"use strict";

// Diagnóstico del envío de correo, aparte de las Cloud Functions.
//
// Existe porque desde el panel los tres fallos más comunes se ven exactamente
// igual ("no se pudo enviar"), pero se arreglan de formas distintas:
//   1. La API key no es válida o no es la que está en Secret Manager.
//   2. El remitente (contecs.logistica@utp.ac.pa) no está verificado en Brevo.
//   3. Se acabó la cuota diaria de la cuenta.
// Este script pregunta las tres cosas directamente a Brevo y solo después
// intenta un envío real, para que el correo de prueba no gaste cuota si ya se
// sabe que va a rebotar.
//
// Uso:
//   export BREVO_API_KEY="$(firebase functions:secrets:access BREVO_API_KEY)"
//   node functions/test/diagnostico-correo.js                  # solo revisa, no envía
//   node functions/test/diagnostico-correo.js tucorreo@utp.ac.pa   # además envía 1 correo
//
// El correo de prueba usa la MISMA plantilla de gira que la Cloud Function, así
// que también sirve para ver cómo se ve el correo antes de mandárselo a 40
// personas.

const https = require("https");
const {cargarCorreoNotificacionGira} = require("../plantillas");

const API_KEY = process.env.BREVO_API_KEY || "";
const DESTINO = process.argv[2] || "";

// Debe coincidir con CORREO_REMITENTE en index.js. Si algún día cambia allá,
// cámbialo aquí también o este diagnóstico dejará de decir la verdad.
const REMITENTE = {name: "CONTECS 2026", email: "contecs.logistica@utp.ac.pa"};

function brevo(metodo, ruta, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const req = https.request({
      hostname: "api.brevo.com",
      path: ruta,
      method: metodo,
      timeout: 25000,
      headers: {
        "Accept": "application/json",
        "api-key": API_KEY,
        ...(body ? {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        } : {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => {
        data += c;
      });
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(data || "{}");
        } catch (e) {
          json = null;
        }
        resolve({status: res.statusCode, json, texto: data});
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Brevo no respondió en 25s"));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const ok = (m) => console.log(`  ok    ${m}`);
const mal = (m) => console.log(`  FALLA ${m}`);
const info = (m) => console.log(`        ${m}`);

async function revisarCuenta() {
  console.log("\n1. API key y cuota de la cuenta\n");
  const r = await brevo("GET", "/v3/account");

  if (r.status === 401) {
    mal("La API key no es válida (401).");
    info("La key que usa la función vive en Secret Manager, no en el código:");
    info("  firebase functions:secrets:access BREVO_API_KEY");
    info("Si la regeneraste en Brevo, hay que volver a guardarla Y redesplegar:");
    info("  firebase functions:secrets:set BREVO_API_KEY");
    info("  firebase deploy --only functions");
    return false;
  }
  if (r.status !== 200) {
    mal(`Brevo respondió ${r.status}: ${r.texto.slice(0, 300)}`);
    return false;
  }

  ok(`API key válida — cuenta: ${r.json?.email || "(sin email)"}`);

  // El plan gratuito trae un límite diario; los de pago traen créditos. Se
  // imprimen los dos porque la forma cambia según el plan contratado.
  const planes = Array.isArray(r.json?.plan) ? r.json.plan : [];
  planes.forEach((p) => {
    const restante = p.credits ?? p.creditsType ?? "?";
    info(`plan: ${p.type || "?"} · créditos restantes: ${restante}`);
    if (typeof p.credits === "number" && p.credits <= 0) {
      mal("Sin créditos: Brevo va a rechazar TODOS los envíos hasta que se renueve.");
    }
  });
  return true;
}

async function revisarRemitente() {
  console.log("\n2. Remitente verificado\n");
  const r = await brevo("GET", "/v3/senders");

  if (r.status !== 200) {
    mal(`No se pudo consultar la lista de remitentes (${r.status}).`);
    info(r.texto.slice(0, 300));
    return false;
  }

  const senders = r.json?.senders || [];
  const mio = senders.find(
      (s) => String(s.email || "").toLowerCase() === REMITENTE.email.toLowerCase());

  if (!mio) {
    mal(`${REMITENTE.email} NO está dado de alta como remitente en Brevo.`);
    info("Esta es la causa nº1 de que los correos no lleguen: Brevo acepta o");
    info("rechaza con un 400 genérico y desde el panel solo se ve \"no se pudo enviar\".");
    info("Remitentes dados de alta ahora mismo:");
    senders.forEach((s) => info(`  · ${s.email} ${s.active ? "(verificado)" : "(SIN verificar)"}`));
    return false;
  }
  if (!mio.active) {
    mal(`${REMITENTE.email} está dado de alta pero SIN verificar.`);
    info("Hay que abrir el correo de confirmación que Brevo mandó a esa dirección.");
    return false;
  }

  ok(`${REMITENTE.email} está verificado.`);
  return true;
}

async function envioDePrueba() {
  console.log("\n3. Envío de prueba\n");

  // Misma plantilla y mismas variables que enviarCorreoNotificacionGira, con
  // datos inventados. Si la plantilla estuviera desactivada o le faltara una
  // variable, se nota aquí y no con la gira entera de por medio.
  const plantilla = cargarCorreoNotificacionGira({
    nombre: "Prueba de diagnóstico",
    gira_nombre: "GIRA DE PRUEBA — ignora este correo",
    gira_fecha: "lunes, 1 de junio de 2026",
    gira_hora: "8:00 a.m.",
    gira_lugar: "Lugar de prueba",
    gira_lugar_encuentro: "Punto de encuentro de prueba",
    coordinador_info: "Coordinador de prueba (Staff)",
    link_gira: "https://contecsfisc.github.io/contecsApp/public/gira.html?c=0&t=0&g=0",
  });

  if (!plantilla.activo) {
    mal("La plantilla correo-notificacion-gira.html está desactivada (activo: false).");
    info("Con eso puesto, la función cuenta cada persona como fallida y no manda nada.");
    return false;
  }
  ok("La plantilla renderiza y está activa.");

  const sinSustituir = plantilla.htmlContent.match(/{{[^}]+}}/g);
  if (sinSustituir) {
    mal(`Quedaron variables sin sustituir: ${[...new Set(sinSustituir)].join(", ")}`);
  }

  const r = await brevo("POST", "/v3/smtp/email", {
    sender: REMITENTE,
    to: [{email: DESTINO}],
    subject: `[PRUEBA] ${plantilla.subject}`,
    htmlContent: plantilla.htmlContent,
    textContent: plantilla.textContent,
  });

  if (r.status >= 200 && r.status < 300) {
    ok(`Brevo aceptó el correo — messageId: ${r.json?.messageId || "(sin id)"}`);
    info(`Revisa ${DESTINO}, incluida la carpeta de spam.`);
    info("Si Brevo lo aceptó pero no llega, el problema es de entrega, no del");
    info("código: míralo en Brevo → Transactional → Logs (rebote, bloqueo, spam).");
    return true;
  }

  mal(`Brevo rechazó el envío con ${r.status}.`);
  info(r.texto.slice(0, 500));
  if (r.status === 429) {
    info("429 = límite de velocidad. Es justo lo que rompía las notificaciones");
    info("de gira antes del arreglo (se mandaban todas a la vez).");
  }
  return false;
}

async function main() {
  console.log("\n─── Diagnóstico de correo CONTECS ───");

  if (!API_KEY) {
    console.log("\nFalta la API key. Ejecuta primero:\n");
    console.log("  export BREVO_API_KEY=\"$(firebase functions:secrets:access BREVO_API_KEY)\"\n");
    process.exitCode = 1;
    return;
  }

  const cuentaOk = await revisarCuenta();
  const remitenteOk = cuentaOk ? await revisarRemitente() : false;

  if (!DESTINO) {
    console.log("\n(No se envió nada: pasa un correo como argumento para probar el envío.)");
    console.log("  node functions/test/diagnostico-correo.js tucorreo@utp.ac.pa\n");
    return;
  }
  if (!cuentaOk || !remitenteOk) {
    console.log("\nNo se intenta el envío: arregla lo de arriba primero.\n");
    process.exitCode = 1;
    return;
  }

  const enviado = await envioDePrueba();
  console.log("");
  if (!enviado) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\nError inesperado:", e.message, "\n");
  process.exitCode = 1;
});
