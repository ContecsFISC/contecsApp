import { db, auth } from "../core/firebase-config.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getUsuarioActual } from "../core/auth.js";

// ─── DOM helpers ────────────────────────────────────────────────────────────
const el  = id => document.getElementById(id);
const QRCode = window.QRCode;
const Papa   = window.Papa;
const XLSX   = window.XLSX;

// ─── Estado global ──────────────────────────────────────────────────────────
let eventoActivo  = null;   // objeto del evento seleccionado
let inscripciones = [];     // array local de inscripciones cargadas
let checkpointsForm = [];   // checkpoints en el formulario de evento (antes de guardar)
let columnasArchivo  = [];  // headers del CSV/Excel cargado
let filasArchivo     = [];  // filas del CSV/Excel cargado
let editandoEventoId = null;
let qrActualCanvas   = null;

// ─── Alerta ─────────────────────────────────────────────────────────────────
function mostrarAlerta(tipo, msg, duracion = 5000) {
  const div = el("alerta-global");
  div.className = `alerta alerta-${tipo} show`;
  div.textContent = msg;
  if (duracion > 0) setTimeout(() => div.classList.remove("show"), duracion);
}

// ─── Formatear fecha ────────────────────────────────────────────────────────
function fmtFecha(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("es-PA");
}

// ─── TABS ────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    el(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "tab-participantes") renderParticipantes();
    if (btn.dataset.tab === "tab-asistencia")    renderAsistencia();
    if (btn.dataset.tab === "tab-certificados")  renderCertificados();
  });
});

// ═══════════════════════════════════════════════════════════
// EVENTOS
// ═══════════════════════════════════════════════════════════

async function cargarEventos() {
  const snap = await getDocs(query(collection(db, "eventos_eurus"), orderBy("creadoEn", "desc")));
  const eventos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderTablaEventos(eventos);
  renderSelectorEventos(eventos);
}

function renderSelectorEventos(eventos) {
  const sel = el("sel-evento");
  sel.innerHTML = `<option value="">— Selecciona un evento —</option>`;
  eventos.forEach(ev => {
    const opt = document.createElement("option");
    opt.value = ev.id;
    opt.textContent = `${ev.nombre} (${fmtFecha(ev.fechaInicio)})`;
    sel.appendChild(opt);
  });
}

function renderTablaEventos(eventos) {
  const tb = el("tabla-eventos-body");
  if (!eventos.length) { tb.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--gris-medio)">Sin eventos registrados</td></tr>`; return; }
  tb.innerHTML = eventos.map(ev => `
    <tr>
      <td><strong>${ev.nombre}</strong></td>
      <td>${fmtFecha(ev.fechaInicio)}</td>
      <td>${(ev.checkpoints || []).length}</td>
      <td>${ev.checkpointsMinCertificado || 1}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-outline btn-sm" onclick="window._editarEvento('${ev.id}')" style="width:auto;margin-right:4px">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="window._eliminarEvento('${ev.id}')" style="width:auto">🗑</button>
      </td>
    </tr>`).join("");
}

// Checkpoints en el formulario
el("btn-add-checkpoint").addEventListener("click", () => {
  const input = el("cp-nombre-input");
  const nombre = input.value.trim();
  if (!nombre) return;
  const id = nombre.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (checkpointsForm.find(c => c.id === id)) { mostrarAlerta("aviso", "Ya existe ese checkpoint."); return; }
  checkpointsForm.push({ id, nombre, orden: checkpointsForm.length + 1 });
  renderCheckpointsForm();
  input.value = "";
});

el("cp-nombre-input").addEventListener("keydown", e => { if (e.key === "Enter") el("btn-add-checkpoint").click(); });

function renderCheckpointsForm() {
  el("checkpoints-lista").innerHTML = checkpointsForm.map((cp, i) => `
    <span class="checkpoint-tag">
      ${cp.orden}. ${cp.nombre}
      <button onclick="window._removeCP(${i})">✕</button>
    </span>`).join("");
}
window._removeCP = i => { checkpointsForm.splice(i, 1); checkpointsForm.forEach((c, j) => c.orden = j + 1); renderCheckpointsForm(); };

el("btn-guardar-evento").addEventListener("click", async () => {
  const nombre   = el("ev-nombre").value.trim();
  const fechaIni = el("ev-fecha-inicio").value;
  const fechaFin = el("ev-fecha-fin").value;
  const minCert  = parseInt(el("ev-min-cert").value) || 1;
  if (!nombre)   { mostrarAlerta("error", "El nombre del evento es obligatorio."); return; }
  if (!fechaIni) { mostrarAlerta("error", "La fecha de inicio es obligatoria."); return; }
  if (!fechaFin) { mostrarAlerta("error", "La fecha de fin es obligatoria."); return; }
  if (!checkpointsForm.length) { mostrarAlerta("error", "Agrega al menos un checkpoint."); return; }

  const usuario = getUsuarioActual();
  const datos = {
    nombre,
    descripcion: el("ev-descripcion").value.trim(),
    fechaInicio: new Date(fechaIni + "T00:00:00"),
    fechaFin:    new Date(fechaFin + "T23:59:59"),
    checkpoints: checkpointsForm,
    checkpointsMinCertificado: minCert,
    activo: true,
    actualizadoEn: serverTimestamp(),
  };

  try {
    el("btn-guardar-evento").disabled = true;
    if (editandoEventoId) {
      await updateDoc(doc(db, "eventos_eurus", editandoEventoId), datos);
      mostrarAlerta("success", "Evento actualizado.");
      editandoEventoId = null;
    } else {
      datos.creadoEn  = serverTimestamp();
      datos.creadoPor = auth.currentUser?.uid || "";
      await addDoc(collection(db, "eventos_eurus"), datos);
      mostrarAlerta("success", "Evento creado.");
    }
    limpiarFormEvento();
    await cargarEventos();
  } catch (e) {
    mostrarAlerta("error", "Error al guardar evento: " + e.message);
  } finally {
    el("btn-guardar-evento").disabled = false;
  }
});

function limpiarFormEvento() {
  el("ev-nombre").value = "";
  el("ev-descripcion").value = "";
  el("ev-fecha-inicio").value = "";
  el("ev-fecha-fin").value = "";
  el("ev-min-cert").value = "3";
  checkpointsForm = [];
  renderCheckpointsForm();
  el("form-evento-titulo").textContent = "Crear nuevo evento";
  el("btn-cancelar-evento").style.display = "none";
  editandoEventoId = null;
}

window._editarEvento = async id => {
  const snap = await getDoc(doc(db, "eventos_eurus", id));
  if (!snap.exists()) return;
  const ev = snap.data();
  editandoEventoId = id;
  el("ev-nombre").value = ev.nombre || "";
  el("ev-descripcion").value = ev.descripcion || "";
  el("ev-fecha-inicio").value = ev.fechaInicio?.toDate ? ev.fechaInicio.toDate().toISOString().split("T")[0] : "";
  el("ev-fecha-fin").value = ev.fechaFin?.toDate ? ev.fechaFin.toDate().toISOString().split("T")[0] : "";
  el("ev-min-cert").value = ev.checkpointsMinCertificado || 1;
  checkpointsForm = [...(ev.checkpoints || [])];
  renderCheckpointsForm();
  el("form-evento-titulo").textContent = "Editar evento";
  el("btn-cancelar-evento").style.display = "inline-flex";
  document.querySelector('[data-tab="tab-evento"]').click();
  el("ev-nombre").scrollIntoView({ behavior: "smooth" });
};

window._eliminarEvento = async id => {
  if (!confirm("¿Eliminar este evento? No se eliminarán los participantes.")) return;
  await deleteDoc(doc(db, "eventos_eurus", id));
  if (eventoActivo?.id === id) { eventoActivo = null; el("sel-evento").value = ""; }
  await cargarEventos();
};

el("btn-cancelar-evento").addEventListener("click", limpiarFormEvento);
el("btn-nuevo-evento").addEventListener("click", () => { limpiarFormEvento(); document.querySelector('[data-tab="tab-evento"]').click(); });

// Cambio de evento activo
el("sel-evento").addEventListener("change", async () => {
  const id = el("sel-evento").value;
  if (!id) { eventoActivo = null; el("evento-info").textContent = ""; inscripciones = []; return; }
  const snap = await getDoc(doc(db, "eventos_eurus", id));
  if (!snap.exists()) return;
  eventoActivo = { id, ...snap.data() };
  const cps = (eventoActivo.checkpoints || []).map(c => c.nombre).join(" · ") || "Sin checkpoints";
  el("evento-info").innerHTML = `<strong>${eventoActivo.nombre}</strong> · ${fmtFecha(eventoActivo.fechaInicio)} — ${fmtFecha(eventoActivo.fechaFin)} · Checkpoints: ${cps} · Min. certificado: ${eventoActivo.checkpointsMinCertificado}`;
  await cargarInscripciones();
});

// ═══════════════════════════════════════════════════════════
// INSCRIPCIONES (carga)
// ═══════════════════════════════════════════════════════════

async function cargarInscripciones() {
  if (!eventoActivo) { inscripciones = []; return; }
  el("participantes-spinner").style.display = "flex";
  const snap = await getDocs(query(collection(db, "inscripciones_eurus"), where("eventoId", "==", eventoActivo.id)));
  inscripciones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  el("participantes-spinner").style.display = "none";
}

// ═══════════════════════════════════════════════════════════
// IMPORTAR CSV / EXCEL
// ═══════════════════════════════════════════════════════════

const CAMPOS_EURUS = [
  { key: "nombre",              label: "Nombre Completo",                 req: true },
  { key: "correo",              label: "Correo institucional",            req: true },
  { key: "cedula",              label: "Cédula",                         req: true },
  { key: "telefono",            label: "Teléfono",                       req: false },
  { key: "universidad",         label: "Universidad",                     req: true },
  { key: "facultad",            label: "Facultad",                       req: false },
  { key: "carrera",             label: "Carrera",                        req: false },
  { key: "ocupacion",           label: "Ocupación",                      req: false },
  { key: "participacionCodeClash", label: "Participación CodeClashPython", req: false },
  { key: "nivelPython",         label: "Nivel de experiencia en Python", req: false },
  { key: "temasInteres",        label: "Temas de interés",               req: false },
  { key: "tallaSueter",         label: "Talla de suéter",                req: false },
];

const MAPEO_AUTO = {
  nombre:              ["nombre", "name", "nombre completo", "full name"],
  correo:              ["correo", "email", "correo institucional", "correo electrónico", "e-mail"],
  cedula:              ["cedula", "cédula", "número de cédula", "numero de cedula"],
  telefono:            ["telefono", "teléfono", "phone", "celular"],
  universidad:         ["universidad", "university"],
  facultad:            ["facultad", "faculty"],
  carrera:             ["carrera", "program", "programa"],
  ocupacion:           ["ocupacion", "ocupación", "occupation"],
  participacionCodeClash: ["codeclash", "code clash", "codeclashpython", "participación en codeclash", "participacion"],
  nivelPython:         ["python", "nivel python", "experiencia python", "nivel de experiencia"],
  temasInteres:        ["temas", "topics", "temas que te entusiasman", "temas de interés", "intereses"],
  tallaSueter:         ["talla", "suéter", "sueter", "talla sueter", "sweater"],
};

function detectarColumna(campo, headers) {
  const keywords = MAPEO_AUTO[campo] || [];
  return headers.find(h => keywords.some(kw => h.toLowerCase().includes(kw))) || "";
}

function procesarArchivo(archivo) {
  const ext = archivo.name.split(".").pop().toLowerCase();
  if (ext === "csv") {
    Papa.parse(archivo, {
      header: true, skipEmptyLines: true,
      complete: res => procesarFilas(res.meta.fields || [], res.data),
      error: e => mostrarAlerta("error", "Error leyendo CSV: " + e.message),
    });
  } else {
    const reader = new FileReader();
    reader.onload = e => {
      const wb  = XLSX.read(e.target.result, { type: "array" });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (rows.length < 2) { mostrarAlerta("error", "El archivo parece estar vacío."); return; }
      const headers = rows[0].map(String);
      const data    = rows.slice(1).filter(r => r.some(c => c !== "" && c != null))
                         .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
      procesarFilas(headers, data);
    };
    reader.readAsArrayBuffer(archivo);
  }
}

function procesarFilas(headers, filas) {
  columnasArchivo = headers;
  filasArchivo    = filas;
  renderMapeoCols();
  el("mapeo-section").style.display = "block";
  mostrarAlerta("success", `Archivo cargado: ${filas.length} filas detectadas.`);
}

function renderMapeoCols() {
  const tbody = el("mapeo-tbody");
  tbody.innerHTML = CAMPOS_EURUS.map(campo => {
    const detectado = detectarColumna(campo.key, columnasArchivo);
    const ico = detectado ? "✅" : (campo.req ? "⚠️" : "⬜");
    const opts = columnasArchivo.map(c => `<option value="${c}" ${c === detectado ? "selected" : ""}>${c}</option>`).join("");
    return `<tr>
      <td>${ico} <strong>${campo.label}</strong>${campo.req ? " *" : ""}</td>
      <td><select id="map-${campo.key}"><option value="">— Ignorar —</option>${opts}</select></td>
    </tr>`;
  }).join("");
}

function leerMapeo() {
  const m = {};
  CAMPOS_EURUS.forEach(c => { m[c.key] = el(`map-${c.key}`)?.value || ""; });
  return m;
}

function filaAInscripcion(fila, mapeo) {
  const get = key => String(fila[mapeo[key]] ?? "").trim();
  const temas = get("temasInteres").split(/[,;]+/).map(t => t.trim()).filter(Boolean);
  const pcch  = get("participacionCodeClash").toLowerCase();
  return {
    nombre:               get("nombre"),
    correo:               get("correo").toLowerCase(),
    cedula:               get("cedula"),
    telefono:             get("telefono"),
    universidad:          get("universidad"),
    facultad:             get("facultad"),
    carrera:              get("carrera"),
    ocupacion:            get("ocupacion"),
    participacionCodeClash: pcch === "sí" || pcch === "si" || pcch === "yes" || pcch === "true",
    nivelPython:          get("nivelPython"),
    temasInteres:         temas,
    tallaSueter:          get("tallaSueter").toUpperCase().replace("TALLA ", ""),
    asistencias:          {},
    totalAsistencias:     0,
    certificadoEmitido:   false,
    estado:               "pendiente",
  };
}

function validarInscripcion(ins) {
  if (!ins.nombre)  return "Nombre vacío";
  if (!ins.correo)  return "Correo vacío";
  if (!ins.correo.endsWith("@utp.ac.pa") && !ins.correo.endsWith("@ulatina.ac.pa")) return `Correo inválido: ${ins.correo}`;
  if (!ins.cedula)  return "Cédula vacía";
  return null;
}

el("btn-preview-importar").addEventListener("click", () => {
  if (!filasArchivo.length) return;
  const mapeo = leerMapeo();
  const thead = el("preview-thead");
  const tbody = el("preview-tbody");
  const campos = CAMPOS_EURUS.map(c => c.label);
  thead.innerHTML = `<tr>${campos.map(c => `<th>${c}</th>`).join("")}</tr>`;
  tbody.innerHTML = filasArchivo.slice(0, 5).map(fila => {
    const ins = filaAInscripcion(fila, mapeo);
    return `<tr>${CAMPOS_EURUS.map(c => `<td>${Array.isArray(ins[c.key]) ? ins[c.key].join(", ") : (ins[c.key] ?? "")}</td>`).join("")}</tr>`;
  }).join("");
  el("preview-resumen").textContent = `${filasArchivo.length} filas en total. Mostrando las primeras 5.`;
  el("modal-preview").classList.add("open");
});

el("btn-confirmar-importar").addEventListener("click", async () => {
  if (!eventoActivo) { mostrarAlerta("error", "Selecciona un evento activo primero."); return; }
  if (!filasArchivo.length) { mostrarAlerta("error", "Carga un archivo primero."); return; }

  const mapeo = leerMapeo();
  const prg   = el("importar-progreso");
  prg.style.display = "block";
  el("btn-confirmar-importar").disabled = true;

  let ok = 0, err = 0;
  for (let i = 0; i < filasArchivo.length; i++) {
    prg.textContent = `Procesando ${i + 1} / ${filasArchivo.length}...`;
    const ins  = filaAInscripcion(filasArchivo[i], mapeo);
    const fallo = validarInscripcion(ins);
    if (fallo) { err++; continue; }
    try {
      const ref = doc(collection(db, "inscripciones_eurus"));
      await setDoc(ref, {
        ...ins,
        eventoId:    eventoActivo.id,
        eventoNombre: eventoActivo.nombre,
        creadoEn:    serverTimestamp(),
        actualizadoEn: serverTimestamp(),
        importadoDeArchivo: "importacion_manual",
      });
      ok++;
    } catch (e) { err++; }
  }

  prg.textContent = "";
  prg.style.display = "none";
  el("btn-confirmar-importar").disabled = false;
  mostrarAlerta("success", `Importación completa: ${ok} importados, ${err} errores.`);
  await cargarInscripciones();
  renderParticipantes();
});

// Upload zone
const zone = el("upload-zone");
zone.addEventListener("click", () => el("input-archivo").click());
zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("dragover"); });
zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
zone.addEventListener("drop", e => { e.preventDefault(); zone.classList.remove("dragover"); const f = e.dataTransfer.files[0]; if (f) procesarArchivo(f); });
el("input-archivo").addEventListener("change", e => { if (e.target.files[0]) procesarArchivo(e.target.files[0]); });

// ═══════════════════════════════════════════════════════════
// PARTICIPANTES
// ═══════════════════════════════════════════════════════════

function renderParticipantes() {
  if (!eventoActivo) { el("tabla-participantes-body").innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--gris-medio)">Selecciona un evento primero.</td></tr>`; return; }
  el("participantes-spinner").style.display = "none";
  const busqueda = (el("buscar-participante").value || "").toLowerCase();
  const minCert  = eventoActivo.checkpointsMinCertificado || 1;
  let filtrados  = inscripciones.filter(p => !busqueda || p.nombre.toLowerCase().includes(busqueda) || p.correo.includes(busqueda));

  el("stat-total").textContent       = inscripciones.length;
  el("stat-asistentes").textContent  = inscripciones.filter(p => (p.totalAsistencias || 0) > 0).length;
  el("stat-certificados").textContent = inscripciones.filter(p => (p.totalAsistencias || 0) >= minCert).length;

  const tb = el("tabla-participantes-body");
  if (!filtrados.length) { tb.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--gris-medio)">Sin resultados</td></tr>`; return; }

  tb.innerHTML = filtrados.map(p => {
    const total   = p.totalAsistencias || 0;
    const cert    = total >= minCert ? "✅" : "—";
    return `<tr>
      <td><strong>${p.nombre}</strong></td>
      <td style="font-size:12px;">${p.correo}</td>
      <td style="font-size:12px;">${p.universidad || "—"}</td>
      <td style="text-align:center;">${total}</td>
      <td style="text-align:center;">${cert}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-outline btn-sm" onclick="window._verQR('${p.id}')" style="width:auto">🔲 QR</button>
      </td>
    </tr>`;
  }).join("");
}

el("buscar-participante").addEventListener("input", renderParticipantes);

// ═══════════════════════════════════════════════════════════
// GENERACIÓN DE QR
// ═══════════════════════════════════════════════════════════

function generarQREnDiv(texto, divDestino) {
  divDestino.innerHTML = "";
  return new QRCode(divDestino, {
    text: texto,
    width: 220,
    height: 220,
    colorDark: "#1a1a1a",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M,
  });
}

window._verQR = id => {
  const p = inscripciones.find(x => x.id === id);
  if (!p) return;
  el("qr-modal-nombre").textContent = p.nombre;
  el("qr-modal-info").textContent   = `${p.correo}  ·  ${p.cedula}`;
  const wrap = el("qr-canvas-wrap");
  generarQREnDiv(id, wrap);
  qrActualCanvas = null;
  setTimeout(() => { qrActualCanvas = wrap.querySelector("canvas"); }, 120);
  el("modal-qr").classList.add("open");
};

el("btn-descargar-qr").addEventListener("click", () => {
  if (!qrActualCanvas) return;
  const link = document.createElement("a");
  link.download = `QR_${el("qr-modal-nombre").textContent.replace(/\s+/g, "_")}.png`;
  link.href = qrActualCanvas.toDataURL("image/png");
  link.click();
});

el("btn-copiar-qr").addEventListener("click", async () => {
  if (!qrActualCanvas) return;
  qrActualCanvas.toBlob(async blob => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      mostrarAlerta("success", "QR copiado al portapapeles.");
    } catch { mostrarAlerta("aviso", "Tu navegador no permite copiar imágenes. Usa Descargar."); }
  });
});

el("btn-gen-todos-qr").addEventListener("click", async () => {
  if (!inscripciones.length) { mostrarAlerta("aviso", "No hay participantes cargados."); return; }
  mostrarAlerta("aviso", `Descargando ${inscripciones.length} QR códigos. Tu navegador descargará cada archivo individualmente.`);
  for (const p of inscripciones) {
    const div = document.createElement("div");
    div.style.position = "fixed"; div.style.left = "-9999px";
    document.body.appendChild(div);
    generarQREnDiv(p.id, div);
    await new Promise(r => setTimeout(r, 150));
    const canvas = div.querySelector("canvas");
    if (canvas) {
      const a = document.createElement("a");
      a.download = `QR_${p.nombre.replace(/\s+/g, "_")}_${p.id.slice(0, 6)}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    }
    document.body.removeChild(div);
    await new Promise(r => setTimeout(r, 80));
  }
  mostrarAlerta("success", "QR generados y descargados.");
});

// ═══════════════════════════════════════════════════════════
// ASISTENCIA
// ═══════════════════════════════════════════════════════════

function renderAsistencia() {
  if (!eventoActivo) { el("asistencia-tbody").innerHTML = ""; el("asistencia-thead").innerHTML = ""; return; }
  el("asistencia-spinner").style.display = "none";
  const cps = eventoActivo.checkpoints || [];

  // Encabezado
  el("asistencia-thead").innerHTML = `<tr>
    <th>Participante</th>
    ${cps.map(cp => `<th title="${cp.nombre}">${cp.nombre.length > 12 ? cp.nombre.slice(0, 12) + "…" : cp.nombre}</th>`).join("")}
    <th>Total</th>
    <th>Cert.</th>
  </tr>`;

  const minCert = eventoActivo.checkpointsMinCertificado || 1;
  el("asistencia-tbody").innerHTML = inscripciones.map(p => {
    const asis = p.asistencias || {};
    const total = Object.keys(asis).length;
    const celdas = cps.map(cp => asis[cp.id]
      ? `<td class="asistio" title="${fmtFecha(asis[cp.id].marcadoEn)}">✅</td>`
      : `<td class="no-asistio">—</td>`).join("");
    const cert = total >= minCert ? `<td style="color:var(--verde-claro);font-weight:700;">✔</td>` : `<td style="color:var(--gris-medio);">—</td>`;
    return `<tr><td>${p.nombre}</td>${celdas}<td style="text-align:center;font-weight:700;">${total}</td>${cert}</tr>`;
  }).join("");
}

// ═══════════════════════════════════════════════════════════
// CERTIFICADOS
// ═══════════════════════════════════════════════════════════

function renderCertificados() {
  if (!eventoActivo) return;
  const minCert  = eventoActivo.checkpointsMinCertificado || 1;
  const elegibles = inscripciones.filter(p => (p.totalAsistencias || 0) >= minCert);
  const emitidos  = elegibles.filter(p => p.certificadoEmitido);

  el("cert-elegibles").textContent = elegibles.length;
  el("cert-emitidos").textContent  = emitidos.length;

  const tb = el("tabla-cert-body");
  if (!elegibles.length) { tb.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--gris-medio)">Sin participantes elegibles aún.</td></tr>`; return; }

  tb.innerHTML = elegibles.map(p => `
    <tr>
      <td><strong>${p.nombre}</strong></td>
      <td>${p.cedula || "—"}</td>
      <td style="font-size:12px;">${p.universidad || "—"}</td>
      <td style="text-align:center;">${p.totalAsistencias || 0} / ${(eventoActivo.checkpoints || []).length}</td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="window._generarCertificado('${p.id}')" style="width:auto">🏅 Certificado</button>
      </td>
    </tr>`).join("");
}

window._generarCertificado = async id => {
  const p = inscripciones.find(x => x.id === id);
  if (!p || !eventoActivo) return;
  await emitirCertificado(p, eventoActivo);
  // Marcar como emitido en Firestore
  await updateDoc(doc(db, "inscripciones_eurus", id), {
    certificadoEmitido: true,
    certificadoEmitidoEn: serverTimestamp(),
  });
  p.certificadoEmitido = true;
  mostrarAlerta("success", `Certificado generado para ${p.nombre}.`);
};

el("btn-gen-todos-cert").addEventListener("click", async () => {
  if (!eventoActivo) return;
  const minCert   = eventoActivo.checkpointsMinCertificado || 1;
  const elegibles = inscripciones.filter(p => (p.totalAsistencias || 0) >= minCert);
  if (!elegibles.length) { mostrarAlerta("aviso", "No hay participantes elegibles."); return; }
  for (const p of elegibles) {
    await emitirCertificado(p, eventoActivo);
    await new Promise(r => setTimeout(r, 100));
  }
  mostrarAlerta("success", `${elegibles.length} certificados generados.`);
});

async function emitirCertificado(p, evento) {
  const { jsPDF } = window.jspdf;
  const doc2 = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297, H = 210;

  // 594-601  → Color de fondo y bandas superior/inferior
  doc2.setFillColor(10, 35, 20);
  doc2.rect(0, 0, W, H, "F");

  // Banda decorativa superior
  doc2.setFillColor(0, 114, 46);
  doc2.rect(0, 0, W, 12, "F");
  doc2.setFillColor(0, 114, 46);
  doc2.rect(0, H - 12, W, 12, "F");

  // 604-610  → Bordes dorados (exterior e interior)
  doc2.setDrawColor(200, 160, 50);
  doc2.setLineWidth(1.5);
  doc2.rect(16, 16, W - 32, H - 32, "S");

  // Borde interior fino
  doc2.setLineWidth(0.4);
  doc2.rect(20, 20, W - 40, H - 40, "S");

  // CONTECS
  doc2.setTextColor(200, 160, 50);
  doc2.setFontSize(11);
  doc2.text("CONTECS — Universidad Tecnológica de Panamá", W / 2, 34, { align: "center" });

  // Título del evento
  doc2.setTextColor(255, 255, 255);
  doc2.setFontSize(18);
  doc2.text(evento.nombre.toUpperCase(), W / 2, 46, { align: "center" });

  // Línea separadora dorada
  doc2.setDrawColor(200, 160, 50);
  doc2.setLineWidth(0.6);
  doc2.line(60, 52, W - 60, 52);

  // "CERTIFICA QUE"
  doc2.setFontSize(11);
  doc2.setTextColor(180, 180, 180);
  doc2.text("CERTIFICA QUE", W / 2, 65, { align: "center" });

  // Nombre del participante
  doc2.setFontSize(28);
  doc2.setTextColor(200, 160, 50);
  const nombreDisplay = p.nombre.toUpperCase();
  doc2.text(nombreDisplay, W / 2, 84, { align: "center" });

  // Línea bajo el nombre
  doc2.setDrawColor(100, 100, 100);
  doc2.setLineWidth(0.3);
  doc2.line(60, 88, W - 60, 88);

  // Cédula y universidad
  doc2.setFontSize(11);
  doc2.setTextColor(200, 200, 200);
  const detalle = [p.cedula && `Cédula: ${p.cedula}`, p.universidad].filter(Boolean).join("   ·   ");
  doc2.text(detalle, W / 2, 98, { align: "center" });

  // Descripción
  doc2.setFontSize(12);
  doc2.setTextColor(230, 230, 230);
  doc2.text(`Ha participado en el evento "${evento.nombre}"`, W / 2, 113, { align: "center" });

  const fechaEvento = evento.fechaInicio?.toDate
    ? evento.fechaInicio.toDate().toLocaleDateString("es-PA", { year: "numeric", month: "long", day: "numeric" })
    : "";
  if (fechaEvento) {
    doc2.setFontSize(10);
    doc2.setTextColor(160, 160, 160);
    doc2.text(fechaEvento, W / 2, 122, { align: "center" });
  }

  // Asistencias
  const totalCPs = (evento.checkpoints || []).length;
  doc2.setFontSize(10);
  doc2.setTextColor(150, 200, 150);
  doc2.text(`Checkpoints completados: ${p.totalAsistencias || 0} de ${totalCPs}`, W / 2, 134, { align: "center" });

  // Líneas de firma
  doc2.setDrawColor(120, 120, 120);
  doc2.setLineWidth(0.4);
  doc2.line(50, 160, 120, 160);
  doc2.line(W - 120, 160, W - 50, 160);
  doc2.setFontSize(9);
  doc2.setTextColor(160, 160, 160);
  doc2.text("Coordinación EURUS", 85, 166, { align: "center" });
  doc2.text("Junta Directiva CONTECS", W - 85, 166, { align: "center" });

  // Fecha de emisión
  doc2.setFontSize(8);
  doc2.setTextColor(120, 120, 120);
  doc2.text(`Emitido el ${new Date().toLocaleDateString("es-PA")}`, W / 2, 176, { align: "center" });

  doc2.save(`Certificado_${p.nombre.replace(/\s+/g, "_")}.pdf`);
}

// ═══════════════════════════════════════════════════════════
// MODALES
// ═══════════════════════════════════════════════════════════
el("modal-qr-close").addEventListener("click", () => el("modal-qr").classList.remove("open"));
el("modal-preview-close").addEventListener("click", () => el("modal-preview").classList.remove("open"));
[el("modal-qr"), el("modal-preview")].forEach(m => m.addEventListener("click", e => { if (e.target === m) m.classList.remove("open"); }));

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
async function init() {
  // Ajustar link "← Panel" según el rol del usuario
  const usuario = getUsuarioActual();
  const linkPanel = document.querySelector(".topbar-link");
  if (linkPanel && usuario.rol === "eurus") {
    linkPanel.href = "dashboardEurus.html";
  }
  await cargarEventos();
}
init();
