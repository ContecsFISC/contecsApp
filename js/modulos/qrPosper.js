// =============================================
// CONTECS — QR POSPER (solo CEO)
// =============================================
// QR del link de POSPER sin iniciar sesión (public/acceso-posper.html), la
// micropestaña del CEO en el menú POSPER. El usuario POSPER ve el mismo QR en
// su inicio (panel/dashboard.html). La clave la da y la regenera
// linkAccesoPosper (functions/acceso-posper.js).

import { app } from "../core/firebase-config.js";
import { URL_ACCESO_POSPER } from "../core/sso-config.js";
import { esperarSesionLista, usuarioTienePermiso } from "../core/auth.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";

const caja = document.getElementById("posper-link");
const qr = document.getElementById("posper-link-qr");
const estado = document.getElementById("posper-link-estado");
const btnCopiar = document.getElementById("posper-link-copiar");
const btnRegenerar = document.getElementById("posper-link-regenerar");
const pedirLink = httpsCallable(getFunctions(app, "us-central1"), "linkAccesoPosper");
let url = "";

async function pintar(regenerar) {
  const { data } = await pedirLink({ regenerar });
  url = `${URL_ACCESO_POSPER}#k=${data.clave}`;
  qr.replaceChildren();
  new window.QRCode(qr, {
    text: url, width: 180, height: 180,
    colorDark: "#061b2a", colorLight: "#ffffff",
    correctLevel: window.QRCode.CorrectLevel.M,
  });
  caja.hidden = false;
}

btnCopiar.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(url);
    estado.textContent = "Link copiado.";
  } catch {
    estado.textContent = url;
  }
});

btnRegenerar.addEventListener("click", async () => {
  if (!confirm("¿Generar un link nuevo? El QR actual deja de funcionar y quienes entraron con él pierden el acceso en menos de una hora.")) return;
  btnRegenerar.disabled = true;
  estado.textContent = "Generando link nuevo…";
  try {
    await pintar(true);
    btnCopiar.disabled = false;
    estado.textContent = "Listo: este es el QR nuevo. El anterior ya no abre.";
  } catch (error) {
    console.error("[QR POSPER] Regenerar link:", error);
    estado.textContent = "No se pudo generar el link nuevo. Intenta de nuevo.";
    // La clave pudo cambiar aunque la respuesta fallara: se vuelve a pintar la
    // vigente para que el QR en pantalla no quede viejo.
    await pintar(false).catch(e => console.error("[QR POSPER] Releer link:", e));
  } finally {
    btnRegenerar.disabled = false;
  }
});

esperarSesionLista().then(() => {
  if (!usuarioTienePermiso("qr_posper")) return;
  return pintar(false);
}).catch(error => {
  console.error("[QR POSPER] Link:", error);
  caja.hidden = false;
  btnCopiar.disabled = true;
  estado.textContent = "No se pudo cargar el QR. Recarga la página para intentarlo de nuevo.";
});
