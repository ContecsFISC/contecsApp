// =============================================
// CONTECS — Invitaciones a reservar charlas (solo CEO)
// =============================================
// Manda por lotes el correo "Elige tus charlas y talleres" a los inscritos
// con pago aprobado (functions/index.js, enviarInvitacionCharlas). El servidor
// lleva la cuenta del día (máximo 250) y no repite a nadie.

import { app } from "../core/firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";

const el = id => document.getElementById(id);
const invitar = httpsCallable(getFunctions(app, "us-central1"), "enviarInvitacionCharlas", { timeout: 540000 });

function alerta(tipo, msg) {
  const div = el("alerta");
  div.className = `alerta alerta-${tipo} show`;
  div.textContent = msg;
}

function pintar(estado) {
  el("c-pendientes").textContent = estado.pendientes;
  el("c-hoy").textContent = estado.enviadosHoy;
  el("c-disponibles").textContent = estado.disponiblesHoy;
  el("inp-limite").max = String(Math.max(1, Math.min(estado.disponiblesHoy, estado.pendientes)));
  if (Number(el("inp-limite").value) > Number(el("inp-limite").max)) el("inp-limite").value = el("inp-limite").max;
  el("btn-enviar").disabled = !estado.disponiblesHoy || !estado.pendientes;
  el("btn-prueba").disabled = !estado.disponiblesHoy;
}

async function contar() {
  const { data } = await invitar({ modo: "contar" });
  pintar(data);
}

function ocupado(si) {
  el("btn-enviar").disabled = si;
  el("btn-prueba").disabled = si;
}

el("btn-prueba").addEventListener("click", async () => {
  ocupado(true);
  el("resultado").textContent = "Enviando la prueba…";
  try {
    const { data } = await invitar({ modo: "prueba" });
    el("resultado").textContent = `Prueba enviada a ${data.prueba}. Revisa tu bandeja (y spam).`;
    pintar(data);
  } catch (e) {
    el("resultado").textContent = "";
    alerta("error", e.message || "No se pudo enviar la prueba.");
    await contar().catch(() => {});
  }
});

el("btn-enviar").addEventListener("click", async () => {
  const limite = Number(el("inp-limite").value) || 0;
  if (limite < 1) return;
  // Sin confirm(): un segundo clic no manda doble porque el servidor bloquea
  // el lote mientras se envía.
  ocupado(true);
  el("resultado").textContent = `Enviando hasta ${limite} correos… puede tardar unos minutos. No cierres esta página.`;
  try {
    const { data } = await invitar({ modo: "enviar", limite });
    const errores = (data.errores || []).map(e => `• ${e.destinatario}: ${e.motivo}`).join("\n");
    el("resultado").textContent = `Listo: ${data.enviados} enviados.${data.errores?.length ? `\nCon error (${data.errores.length}):\n${errores}` : ""}`;
    alerta(data.errores?.length ? "aviso" : "success", `${data.enviados} invitaciones enviadas.`);
    pintar(data);
  } catch (e) {
    el("resultado").textContent = "";
    alerta("error", e.message || "No se pudo enviar el lote.");
    await contar().catch(() => {});
  }
});

contar().catch(e => alerta("error", "No se pudo leer el estado: " + (e.message || e)));
