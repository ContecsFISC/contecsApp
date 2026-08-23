import { db } from "../core/firebase-config.js";
import {
  collection, getDocs, query, orderBy,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { marcarCheckpointGira } from "../core/participantes-api.js";
import { escaparHtml } from "../core/seguridad.js";

const el = id => document.getElementById(id);
const h  = escaparHtml;

let scanner        = null;
let escaneando      = false;
let procesandoQR    = false;
let giraActiva      = null;   // { id, nombre, ... }
let tipoActivo      = null;   // "entrada" | "salida"
let credencialActual = null;  // { codigo, token } del último QR escaneado
let resultadoActual  = null;  // respuesta de marcarCheckpointGira
let logSesion        = [];

// ─── Alerta ──────────────────────────────────────────────────────────────────
function alerta(tipo, msg) {
  const div = el("alerta");
  div.className = `alerta alerta-${tipo} show`;
  div.textContent = msg;
  setTimeout(() => div.classList.remove("show"), 5000);
}

// ─── Cargar giras activas con participantes ──────────────────────────────────
async function cargarGiras() {
  try {
    const snap = await getDocs(query(collection(db, "giras_voluntarios"), orderBy("creadoEn", "desc")));
    const sel  = el("sel-gira-qr");
    snap.docs.forEach(d => {
      const g = d.data();
      if (!g.activo) return;
      if (!(g.participantes || []).length) return;
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = g.nombre || "(gira sin nombre)";
      sel.appendChild(opt);
    });
  } catch (e) {
    alerta("error", "No se pudieron cargar las giras.");
  }
}

el("sel-gira-qr").addEventListener("change", () => {
  const id = el("sel-gira-qr").value;
  giraActiva = id ? { id, nombre: el("sel-gira-qr").selectedOptions[0]?.textContent || "" } : null;
  actualizarSesionActiva();
});

window.seleccionarTipo = function(tipo) {
  tipoActivo = tipo;
  el("btn-tipo-entrada").classList.toggle("selected", tipo === "entrada");
  el("btn-tipo-salida").classList.toggle("selected", tipo === "salida");
  actualizarSesionActiva();
};

function actualizarSesionActiva() {
  if (giraActiva && tipoActivo) {
    el("sesion-activa").textContent = `Sesión activa: ${giraActiva.nombre} · ${tipoActivo === "entrada" ? "Entrada" : "Salida"}`;
  } else {
    el("sesion-activa").textContent = "";
  }
}

// ─── Scanner ─────────────────────────────────────────────────────────────────
el("btn-iniciar").addEventListener("click", async () => {
  if (!giraActiva) { alerta("error", "Selecciona una gira primero."); return; }
  if (!tipoActivo)  { alerta("error", "Selecciona el tipo de checkpoint (entrada o salida)."); return; }

  if (!scanner) scanner = new Html5Qrcode("reader");

  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      onScanExito,
      () => {}
    );
    escaneando = true;
    el("btn-iniciar").style.display = "none";
    el("btn-detener").style.display = "inline-flex";
    el("reader").closest(".scanner-overlay").classList.add("activo");
  } catch (e) {
    alerta("error", "No se pudo acceder a la cámara: " + e.message);
  }
});

el("btn-detener").addEventListener("click", async () => {
  if (scanner && escaneando) { await scanner.stop(); escaneando = false; }
  el("btn-iniciar").style.display = "inline-flex";
  el("btn-detener").style.display = "none";
  el("reader").closest(".scanner-overlay").classList.remove("activo");
});

// ─── Extraer código+clave del QR del participante ────────────────────────────
// El QR de la credencial codifica la URL de perfil.html (?c=CODIGO&t=TOKEN).
// GIRAS no tiene lectura directa de /participantes, así que el código+clave
// se valida en el servidor dentro de marcarCheckpointGira.
function extraerCredencialQr(rawQR) {
  const texto = String(rawQR || "").trim();
  if (!texto) throw new Error("El QR está vacío.");

  try {
    const url = new URL(texto);
    const codigo = url.searchParams.get("c")?.trim().toUpperCase();
    const token  = url.searchParams.get("t")?.trim();
    if (codigo && token) return { codigo, token };
  } catch (_) { /* seguir con el siguiente formato */ }

  try {
    const datos  = JSON.parse(texto);
    const codigo = String(datos.codigo || "").trim().toUpperCase();
    const token  = String(datos.token || "").trim();
    if (codigo && token) return { codigo, token };
  } catch (_) { /* no es JSON */ }

  throw new Error("El contenido no corresponde a una credencial CONTECS válida.");
}

// ─── Escaneo exitoso ─────────────────────────────────────────────────────────
async function onScanExito(valorQR) {
  if (!escaneando || procesandoQR) return;
  procesandoQR = true;
  await scanner.pause(true);

  try {
    credencialActual = extraerCredencialQr(valorQR);
  } catch (e) {
    alerta("error", e.message);
    procesandoQR = false;
    await scanner.resume();
    return;
  }

  mostrarResultadoPendiente();
  procesandoQR = false;
}

function mostrarResultadoPendiente() {
  el("res-nombre").textContent  = "Validando credencial...";
  el("res-codigo").textContent  = credencialActual.codigo;
  el("res-estado-badge").className   = `estado-badge estado-${tipoActivo}`;
  el("res-estado-badge").textContent = tipoActivo === "entrada" ? "ENTRADA" : "SALIDA";
  el("aviso-pago").style.display = "none";
  el("btn-confirmar").disabled    = false;
  el("btn-confirmar").textContent = tipoActivo === "entrada" ? "Registrar entrada" : "Registrar salida";
  el("resultado-box").style.display = "block";
  el("resultado-box").scrollIntoView({ behavior: "smooth" });
}

// ─── Confirmar ────────────────────────────────────────────────────────────────
el("btn-confirmar").addEventListener("click", async () => {
  if (!credencialActual || !giraActiva || !tipoActivo) return;
  el("btn-confirmar").disabled    = true;
  el("btn-confirmar").textContent = "Guardando...";

  try {
    const respuesta = await marcarCheckpointGira({
      giraId: giraActiva.id,
      codigo: credencialActual.codigo,
      token:  credencialActual.token,
      tipo:   tipoActivo,
    });

    el("res-nombre").textContent = respuesta.participanteNombre || "(sin nombre)";
    el("res-codigo").textContent = respuesta.participanteCodigo || credencialActual.codigo;

    if (respuesta.pagoAprobado === false) {
      el("aviso-pago").style.display = "flex";
    }

    agregarLog(tipoActivo, respuesta.participanteNombre || respuesta.participanteCodigo || "—");
    alerta("success", `${tipoActivo === "entrada" ? "Entrada" : "Salida"} registrada: ${respuesta.participanteNombre || respuesta.participanteCodigo}`);

    resultadoActual = respuesta;
    // Dejar el resultado visible unos segundos (con el aviso amarillo si aplica)
    // antes de volver a escanear.
    setTimeout(cerrarResultado, respuesta.pagoAprobado === false ? 3500 : 1500);
  } catch (e) {
    alerta("error", "Error al guardar: " + e.message);
    el("btn-confirmar").disabled    = false;
    el("btn-confirmar").textContent = tipoActivo === "entrada" ? "Registrar entrada" : "Registrar salida";
  }
});

el("btn-cancelar-scan").addEventListener("click", cerrarResultado);

async function cerrarResultado() {
  credencialActual = null;
  resultadoActual   = null;
  el("resultado-box").style.display = "none";
  el("aviso-pago").style.display    = "none";
  el("btn-confirmar").textContent   = "Confirmar";
  el("btn-confirmar").disabled      = false;
  if (scanner && escaneando) await scanner.resume();
}

// ─── Log ─────────────────────────────────────────────────────────────────────
function agregarLog(tipo, nombre) {
  logSesion.unshift({
    tipo, nombre,
    hora: new Date().toLocaleTimeString("es-PA"),
  });
  renderLog();
}

function renderLog() {
  const tb = el("log-recientes");
  if (!logSesion.length) {
    tb.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--gris-medio)">Sin registros aún</td></tr>`;
    return;
  }
  tb.innerHTML = logSesion.slice(0, 20).map(entry => `
    <tr>
      <td>${h(entry.nombre)}</td>
      <td class="log-${entry.tipo}">${entry.tipo === "entrada" ? "Entrada" : "Salida"}</td>
      <td>${h(entry.hora)}</td>
    </tr>`).join("");
}

// ─── Init ─────────────────────────────────────────────────────────────────────
cargarGiras();
