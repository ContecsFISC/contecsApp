import { db, auth } from "../core/firebase-config.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getUsuarioActual } from "../core/auth.js";

const el  = id => document.getElementById(id);
const QRCode = window.QRCode;
const Papa   = window.Papa;
const XLSX   = window.XLSX;

let actividades       = [];
let voluntarios       = [];
let turnosForm        = [];
let columnasArchivo   = [];
let filasArchivo      = [];
let asistenciasCache  = [];
let editandoActividadId = null;

const usuario = getUsuarioActual();
// Solo voluntariado, junta_principal y ceo pueden cambiar la firma
const puedeEditarFirma = ["voluntariado", "ceo", "junta_principal"].includes(usuario.rol);

// ─── Alerta ──────────────────────────────────────────────────────────────────
function mostrarAlerta(tipo, msg, duracion = 5000) {
  const div = el("alerta-global");
  div.className = `alerta alerta-${tipo} show`;
  div.textContent = msg;
  if (duracion > 0) setTimeout(() => div.classList.remove("show"), duracion);
}

function fmtFecha(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("es-PA");
}

function fmtHora(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" });
}

// ─── TABS ────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    el(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "tab-voluntarios") renderVoluntarios();
    if (btn.dataset.tab === "tab-asistencias") cargarAsistencias();
  });
});

// ════════════════════════════════════════════════════════════
// ACTIVIDADES
// ════════════════════════════════════════════════════════════

async function cargarActividades() {
  try {
    const snap = await getDocs(query(collection(db, "actividades_voluntarios"), orderBy("creadoEn", "desc")));
    actividades = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    actividades = [];
  }
  renderTablaActividades();
  renderSelectorActividades();
  renderFiltroActividades();
}

function renderSelectorActividades() {
  const sel = el("sel-actividad");
  sel.innerHTML = `<option value="">— Selecciona una actividad —</option>`;
  actividades.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `${a.nombre} (${fmtFecha(a.fecha)})`;
    sel.appendChild(opt);
  });
}

function renderFiltroActividades() {
  const sel = el("filtro-actividad");
  sel.innerHTML = `<option value="">Todas las actividades</option>`;
  actividades.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.nombre;
    sel.appendChild(opt);
  });
}

function renderTablaActividades() {
  const tb = el("tabla-actividades-body");
  if (!actividades.length) {
    tb.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--gris-medio)">Sin actividades registradas. Crea la primera usando el formulario.</td></tr>`;
    return;
  }
  tb.innerHTML = actividades.map(a => `
    <tr>
      <td><strong>${a.nombre}</strong>${a.descripcion ? `<br/><small style="color:var(--gris-medio)">${a.descripcion}</small>` : ""}</td>
      <td>${fmtFecha(a.fecha)}</td>
      <td>${a.area || "—"}</td>
      <td>
        ${(a.turnos || []).map(t => `<span style="font-size:11px;background:var(--vol-fondo);color:var(--vol);padding:2px 6px;border-radius:8px;display:inline-block;margin:1px;">${t.nombre} ${t.horaInicio}–${t.horaFin}</span>`).join("") || "—"}
      </td>
      <td>
        <span style="font-size:12px;background:${a.activo ? "var(--vol-fondo)" : "#f8f9fa"};color:${a.activo ? "var(--vol)" : "var(--gris-medio)"};padding:2px 8px;border-radius:12px;">
          ${a.activo ? "Activa" : "Inactiva"}
        </span>
      </td>
      <td style="white-space:nowrap;">
        <button class="btn btn-outline btn-sm" onclick="editarActividad('${a.id}')" style="width:auto;margin-right:4px">✏️</button>
        <button onclick="toggleActividad('${a.id}',${!!a.activo})" style="background:${a.activo?"#dc3545":"var(--vol-claro)"};color:#fff;border:none;border-radius:8px;padding:5px 9px;cursor:pointer;font-size:12px;">
          ${a.activo ? "Desactivar" : "Activar"}
        </button>
      </td>
    </tr>`).join("");
}

el("sel-actividad").addEventListener("change", () => {
  const id = el("sel-actividad").value;
  if (!id) { el("actividad-info").textContent = ""; return; }
  const a = actividades.find(x => x.id === id);
  if (a) {
    const turnos = (a.turnos || []).map(t => `${t.nombre}: ${t.horaInicio}–${t.horaFin}`).join(" | ");
    el("actividad-info").textContent = `${a.area} · ${fmtFecha(a.fecha)}${turnos ? " · " + turnos : ""}`;
  }
});

el("btn-nueva-actividad").addEventListener("click", () => {
  limpiarFormActividad();
  activarTab("tab-actividades");
});

// ── TURNOS ────────────────────────────────────────────────────────────────────
function renderTurnos() {
  el("turnos-lista").innerHTML = turnosForm.map((t, i) => `
    <span class="turno-tag">
      🕐 <strong>${t.nombre}</strong> &nbsp;${t.horaInicio} – ${t.horaFin}
      <button onclick="quitarTurno(${i})">×</button>
    </span>`).join("");
}

window.quitarTurno = function(i) { turnosForm.splice(i, 1); renderTurnos(); };

el("btn-add-turno").addEventListener("click", () => {
  const nombre = el("turno-nombre").value.trim();
  const inicio = el("turno-inicio").value;
  const fin    = el("turno-fin").value;
  if (!nombre || !inicio || !fin) { mostrarAlerta("error", "Completa nombre, hora inicio y hora fin del turno."); return; }
  if (turnosForm.some(t => t.nombre.toLowerCase() === nombre.toLowerCase())) {
    mostrarAlerta("error", "Ya existe un turno con ese nombre."); return;
  }
  turnosForm.push({ id: `t_${Date.now()}`, nombre, horaInicio: inicio, horaFin: fin });
  renderTurnos();
  el("turno-nombre").value = el("turno-inicio").value = el("turno-fin").value = "";
});

el("btn-guardar-actividad").addEventListener("click", async () => {
  const nombre = el("act-nombre").value.trim();
  const desc   = el("act-descripcion").value.trim();
  const fecha  = el("act-fecha").value;
  const area   = el("act-area").value;
  if (!nombre || !fecha || !area) { mostrarAlerta("error", "Nombre, fecha y área son obligatorios."); return; }

  const data = {
    nombre, descripcion: desc,
    fecha: new Date(fecha + "T12:00:00"),
    area,
    turnos: turnosForm,
    activo: true,
    actualizadoEn: serverTimestamp(),
  };

  el("btn-guardar-actividad").disabled = true;
  el("btn-guardar-actividad").textContent = "Guardando...";
  try {
    if (editandoActividadId) {
      await updateDoc(doc(db, "actividades_voluntarios", editandoActividadId), data);
      mostrarAlerta("success", "Actividad actualizada.");
    } else {
      data.creadoEn  = serverTimestamp();
      data.creadoPor = auth.currentUser?.uid || "";
      await addDoc(collection(db, "actividades_voluntarios"), data);
      mostrarAlerta("success", "Actividad creada correctamente.");
    }
    limpiarFormActividad();
    await cargarActividades();
  } catch (e) {
    mostrarAlerta("error", "Error al guardar: " + e.message);
  }
  el("btn-guardar-actividad").disabled = false;
  el("btn-guardar-actividad").textContent = "Guardar actividad";
});

function limpiarFormActividad() {
  el("act-nombre").value = el("act-descripcion").value = el("act-fecha").value = "";
  el("act-area").value = "";
  turnosForm = []; renderTurnos();
  editandoActividadId = null;
  el("form-actividad-titulo").textContent = "Crear nueva actividad";
  el("btn-cancelar-actividad").style.display = "none";
}

window.editarActividad = function(id) {
  const a = actividades.find(x => x.id === id);
  if (!a) return;
  editandoActividadId = id;
  el("act-nombre").value       = a.nombre || "";
  el("act-descripcion").value  = a.descripcion || "";
  el("act-area").value         = a.area || "";
  if (a.fecha) {
    const d = a.fecha.toDate ? a.fecha.toDate() : new Date(a.fecha);
    el("act-fecha").value = d.toISOString().split("T")[0];
  }
  turnosForm = [...(a.turnos || [])];
  renderTurnos();
  el("form-actividad-titulo").textContent = "Editar actividad";
  el("btn-cancelar-actividad").style.display = "inline-flex";
  activarTab("tab-actividades");
  el("act-nombre").scrollIntoView({ behavior: "smooth" });
};

window.toggleActividad = async function(id, estadoActual) {
  try {
    await updateDoc(doc(db, "actividades_voluntarios", id), { activo: !estadoActual, actualizadoEn: serverTimestamp() });
    await cargarActividades();
  } catch (e) { mostrarAlerta("error", "Error: " + e.message); }
};

el("btn-cancelar-actividad").addEventListener("click", limpiarFormActividad);

// ════════════════════════════════════════════════════════════
// IMPORTAR CSV / EXCEL
// ════════════════════════════════════════════════════════════

const CAMPOS_VOL = [
  { key: "nombre",      label: "Nombre completo",   requerido: true,  kw: ["nombre","name","participante","voluntario"] },
  { key: "cedula",      label: "Cédula / ID",        requerido: false, kw: ["cedula","cédula","identificacion","id"] },
  { key: "correo",      label: "Correo electrónico", requerido: false, kw: ["correo","email","mail"] },
  { key: "telefono",    label: "Teléfono",           requerido: false, kw: ["telefono","teléfono","phone","celular","movil"] },
  { key: "universidad", label: "Universidad",        requerido: false, kw: ["universidad","university","institucion","institución"] },
  { key: "carrera",     label: "Carrera",            requerido: false, kw: ["carrera","program","facultad","especialidad"] },
  { key: "anio",        label: "Año de carrera",     requerido: false, kw: ["año","anio","year","semestre","curso"] },
  { key: "area",        label: "Área de interés",    requerido: false, kw: ["area","área","departamento","interes"] },
];

const uploadZone = el("upload-zone");
uploadZone.addEventListener("click", () => el("input-archivo").click());
uploadZone.addEventListener("dragover",  e => { e.preventDefault(); uploadZone.classList.add("dragover"); });
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
uploadZone.addEventListener("drop", e => {
  e.preventDefault(); uploadZone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) procesarArchivo(e.dataTransfer.files[0]);
});
el("input-archivo").addEventListener("change", e => { if (e.target.files[0]) procesarArchivo(e.target.files[0]); });

function procesarArchivo(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "csv") {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: r => { columnasArchivo = r.meta.fields || []; filasArchivo = r.data; mostrarMapeo(); },
    });
  } else if (["xlsx","xls"].includes(ext)) {
    const reader = new FileReader();
    reader.onload = e2 => {
      const wb   = XLSX.read(e2.target.result, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (!data.length) return;
      columnasArchivo = data[0].map(String);
      filasArchivo    = data.slice(1).map(row =>
        Object.fromEntries(columnasArchivo.map((h, i) => [h, row[i] ?? ""]))
      );
      mostrarMapeo();
    };
    reader.readAsArrayBuffer(file);
  } else {
    mostrarAlerta("error", "Formato no soportado. Usa CSV o Excel (.xlsx, .xls).");
  }
}

function detectarCol(campo) {
  return columnasArchivo.find(c => campo.kw.some(k => c.toLowerCase().includes(k))) || "";
}

function mostrarMapeo() {
  el("mapeo-tbody").innerHTML = CAMPOS_VOL.map(campo => {
    const det = detectarCol(campo);
    const ind = det ? "✅" : (campo.requerido ? "⚠️" : "—");
    return `<tr>
      <td><strong>${ind} ${campo.label}${campo.requerido ? ' <span style="color:#dc3545">*</span>' : ""}</strong></td>
      <td>
        <select id="map-${campo.key}">
          <option value="">— No incluir —</option>
          ${columnasArchivo.map(c => `<option value="${c}"${c === det ? " selected" : ""}>${c}</option>`).join("")}
        </select>
      </td>
    </tr>`;
  }).join("");
  el("mapeo-section").style.display = "block";
}

el("btn-preview-importar").addEventListener("click", () => {
  const mapeo = CAMPOS_VOL.map(c => ({ key: c.key, label: c.label, col: el(`map-${c.key}`)?.value })).filter(m => m.col);
  el("preview-thead").innerHTML = `<tr>${mapeo.map(m => `<th>${m.label}</th>`).join("")}</tr>`;
  el("preview-tbody").innerHTML = filasArchivo.slice(0, 5).map(row =>
    `<tr>${mapeo.map(m => `<td>${row[m.col] ?? "—"}</td>`).join("")}</tr>`
  ).join("");
  el("preview-resumen").textContent = `${filasArchivo.length} filas encontradas en el archivo.`;
  el("modal-preview").classList.add("open");
});

el("btn-confirmar-importar").addEventListener("click", async () => {
  const nombreCol = el("map-nombre")?.value;
  if (!nombreCol) { mostrarAlerta("error", "El campo 'Nombre' es obligatorio en el mapeo."); return; }

  const mapeo = Object.fromEntries(CAMPOS_VOL.map(c => [c.key, el(`map-${c.key}`)?.value || ""]));
  const filas  = filasArchivo.filter(r => r[mapeo.nombre]?.toString().trim());

  el("importar-progreso").style.display = "block";
  el("btn-confirmar-importar").disabled = true;

  let importados = 0, omitidos = 0;
  for (const fila of filas) {
    const cedula = mapeo.cedula ? fila[mapeo.cedula]?.toString().trim() : "";
    if (cedula) {
      const existe = await getDocs(query(collection(db, "voluntarios"), where("cedula", "==", cedula)));
      if (!existe.empty) { omitidos++; continue; }
    }
    await addDoc(collection(db, "voluntarios"), {
      nombre:      fila[mapeo.nombre]?.toString().trim() || "",
      cedula:      fila[mapeo.cedula]?.toString().trim() || "",
      correo:      fila[mapeo.correo]?.toString().trim() || "",
      telefono:    fila[mapeo.telefono]?.toString().trim() || "",
      universidad: fila[mapeo.universidad]?.toString().trim() || "",
      carrera:     fila[mapeo.carrera]?.toString().trim() || "",
      anio:        fila[mapeo.anio]?.toString().trim() || "",
      area:        fila[mapeo.area]?.toString().trim() || "",
      totalHoras:  0,
      firmaEstado: "Firma faltante",
      importadoDeArchivo: new Date().toISOString(),
      creadoEn:    serverTimestamp(),
    });
    importados++;
    el("importar-progreso").textContent = `Importando... ${importados} de ${filas.length}`;
  }

  el("importar-progreso").textContent = `Listo: ${importados} importados${omitidos ? `, ${omitidos} duplicados omitidos` : ""}.`;
  el("btn-confirmar-importar").disabled = false;
  mostrarAlerta("success", `${importados} voluntarios importados.`);
  await cargarVoluntarios();
});

el("modal-preview-close").addEventListener("click", () => el("modal-preview").classList.remove("open"));

// ════════════════════════════════════════════════════════════
// VOLUNTARIOS
// ════════════════════════════════════════════════════════════

async function cargarVoluntarios() {
  el("voluntarios-spinner").style.display = "flex";
  try {
    const snap = await getDocs(query(collection(db, "voluntarios"), orderBy("creadoEn", "desc")));
    voluntarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    voluntarios = [];
  }
  el("voluntarios-spinner").style.display = "none";
  renderVoluntarios();
  actualizarStats();
}

function actualizarStats() {
  el("stat-total").textContent  = voluntarios.length;
  const totalH  = voluntarios.reduce((s, v) => s + (v.totalHoras || 0), 0);
  el("stat-horas").textContent  = totalH.toFixed(1) + "h";
  el("stat-firmas").textContent = voluntarios.filter(v => v.firmaEstado === "Firma aceptada").length;
}

function renderVoluntarios(filtro = "") {
  const tb = el("tabla-voluntarios-body");
  const lista = filtro
    ? voluntarios.filter(v =>
        v.nombre.toLowerCase().includes(filtro) ||
        (v.cedula || "").toLowerCase().includes(filtro)
      )
    : voluntarios;

  if (!lista.length) {
    tb.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--gris-medio)">${filtro ? "Sin coincidencias" : "Sin voluntarios registrados"}</td></tr>`;
    return;
  }

  tb.innerHTML = lista.map(v => {
    const esFaltante = v.firmaEstado !== "Firma aceptada";
    const firmaBadge = esFaltante
      ? `<span class="firma-badge firma-faltante">⚠ Firma faltante</span>`
      : `<span class="firma-badge firma-aceptada">✓ Firma aceptada</span>`;

    const firmaControl = puedeEditarFirma
      ? `<select class="firma-select" onchange="cambiarFirma('${v.id}',this.value)">
           <option value="Firma faltante"${esFaltante ? " selected" : ""}>⚠ Firma faltante</option>
           <option value="Firma aceptada"${!esFaltante ? " selected" : ""}>✓ Firma aceptada</option>
         </select>`
      : firmaBadge;

    return `<tr>
      <td>
        <strong>${v.nombre}</strong>
        ${v.correo ? `<br/><small style="color:var(--gris-medio)">${v.correo}</small>` : ""}
        ${v.anio   ? `<br/><small style="color:var(--gris-medio)">Año ${v.anio}</small>` : ""}
      </td>
      <td>${v.cedula || "—"}</td>
      <td>${v.area || "—"}</td>
      <td><span class="horas-badge">${(v.totalHoras || 0).toFixed(2)}h</span></td>
      <td>${firmaControl}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-outline btn-sm" onclick="verQR('${v.id}')" style="width:auto;margin-right:4px" title="Ver QR del voluntario">📷</button>
        <button onclick="eliminarVoluntario('${v.id}','${v.nombre.replace(/'/g, "\\'")}')"
          style="background:#dc3545;color:#fff;border:none;border-radius:8px;padding:5px 8px;cursor:pointer;font-size:12px;" title="Eliminar">🗑</button>
      </td>
    </tr>`;
  }).join("");
}

window.cambiarFirma = async function(id, nuevoEstado) {
  if (!puedeEditarFirma) return;
  try {
    await updateDoc(doc(db, "voluntarios", id), {
      firmaEstado:         nuevoEstado,
      firmaActualizadaPor: auth.currentUser?.uid || "",
      firmaActualizadaEn:  serverTimestamp(),
    });
    const v = voluntarios.find(x => x.id === id);
    if (v) v.firmaEstado = nuevoEstado;
    actualizarStats();
    mostrarAlerta("success", `Firma actualizada: ${nuevoEstado}`);
  } catch (e) { mostrarAlerta("error", "Error al actualizar firma: " + e.message); }
};

window.eliminarVoluntario = async function(id, nombre) {
  if (!confirm(`¿Eliminar al voluntario "${nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteDoc(doc(db, "voluntarios", id));
    voluntarios = voluntarios.filter(v => v.id !== id);
    renderVoluntarios(el("buscar-voluntario").value.toLowerCase().trim());
    actualizarStats();
    mostrarAlerta("success", "Voluntario eliminado.");
  } catch (e) { mostrarAlerta("error", "Error: " + e.message); }
};

el("buscar-voluntario").addEventListener("input", e => renderVoluntarios(e.target.value.toLowerCase().trim()));

// ── QR ────────────────────────────────────────────────────────────────────────
window.verQR = function(id) {
  const v = voluntarios.find(x => x.id === id);
  if (!v) return;
  el("qr-modal-nombre").textContent = v.nombre;
  el("qr-modal-info").textContent   = `ID: ${id}${v.cedula ? " · Cédula: " + v.cedula : ""}`;
  const wrap = el("qr-canvas-wrap");
  wrap.innerHTML = "";
  new QRCode(wrap, {
    text:         id,
    width:        200,
    height:       200,
    colorDark:    "#0E6655",
    colorLight:   "#ffffff",
    correctLevel: QRCode.CorrectLevel.H,
  });
  el("modal-qr").classList.add("open");
};

el("modal-qr-close").addEventListener("click", () => el("modal-qr").classList.remove("open"));

el("btn-descargar-qr").addEventListener("click", () => {
  const img = el("qr-canvas-wrap").querySelector("img") || el("qr-canvas-wrap").querySelector("canvas");
  if (!img) return;
  const a = document.createElement("a");
  a.href     = img.tagName === "CANVAS" ? img.toDataURL() : img.src;
  a.download = `QR_voluntario_${el("qr-modal-nombre").textContent.replace(/\s+/g, "_")}.png`;
  a.click();
});

el("btn-copiar-qr").addEventListener("click", async () => {
  const img = el("qr-canvas-wrap").querySelector("img") || el("qr-canvas-wrap").querySelector("canvas");
  if (!img) return;
  try {
    const blob = await (await fetch(img.tagName === "CANVAS" ? img.toDataURL() : img.src)).blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    mostrarAlerta("success", "QR copiado al portapapeles.");
  } catch {
    mostrarAlerta("warning", "No se pudo copiar. Usa el botón de descarga.");
  }
});

// ── EXPORTAR VOLUNTARIOS EXCEL ────────────────────────────────────────────────
el("btn-exportar-excel").addEventListener("click", () => {
  if (!voluntarios.length) { mostrarAlerta("warning", "No hay voluntarios para exportar."); return; }
  const filas = voluntarios.map(v => ({
    "Nombre":         v.nombre,
    "Cédula":         v.cedula || "",
    "Correo":         v.correo || "",
    "Teléfono":       v.telefono || "",
    "Universidad":    v.universidad || "",
    "Carrera":        v.carrera || "",
    "Año de carrera": v.anio || "",
    "Área":           v.area || "",
    "Horas ganadas":  +(v.totalHoras || 0).toFixed(2),
    "Firma física":   v.firmaEstado || "Firma faltante",
  }));
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Voluntarios");
  XLSX.writeFile(wb, `voluntarios_contecs_${new Date().toISOString().split("T")[0]}.xlsx`);
});

// ════════════════════════════════════════════════════════════
// ASISTENCIAS
// ════════════════════════════════════════════════════════════

async function cargarAsistencias() {
  const actividadId = el("filtro-actividad").value;
  const turnoId     = el("filtro-turno").value;
  el("asistencias-spinner").style.display = "flex";

  try {
    let q = actividadId
      ? query(collection(db, "asistencias_voluntarios"), where("actividadId", "==", actividadId), orderBy("creadoEn", "desc"))
      : query(collection(db, "asistencias_voluntarios"), orderBy("creadoEn", "desc"));
    const snap = await getDocs(q);
    asistenciasCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (turnoId) asistenciasCache = asistenciasCache.filter(a => a.turnoId === turnoId);
  } catch {
    asistenciasCache = [];
  }
  renderTablaAsistencias(asistenciasCache);
  el("asistencias-spinner").style.display = "none";
}

const ESTRELLAS = { 1: "⭐", 2: "⭐⭐", 3: "⭐⭐⭐", 4: "⭐⭐⭐⭐", 5: "⭐⭐⭐⭐⭐" };
const ETIQUETAS = { 1: "Necesita mejora", 2: "Regular", 3: "Bueno", 4: "Muy bueno", 5: "Excelente" };

function resolverAsistencia(a) {
  const vol   = voluntarios.find(v => v.id === a.voluntarioId);
  const act   = actividades.find(x => x.id === a.actividadId);
  const turno = act?.turnos?.find(t => t.id === a.turnoId);
  return {
    nomVol:   vol?.nombre   || "—",
    nomAct:   act?.nombre   || "—",
    nomTurno: turno?.nombre || "—",
    area:     act?.area     || "",
  };
}

function renderTablaAsistencias(lista) {
  const tb = el("tabla-asistencias-body");
  if (!lista.length) {
    tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--gris-medio)">Sin asistencias registradas</td></tr>`;
    return;
  }
  tb.innerHTML = lista.map(a => {
    const { nomVol, nomAct, nomTurno } = resolverAsistencia(a);
    return `
    <tr>
      <td><strong>${nomVol}</strong></td>
      <td>${nomAct}</td>
      <td>${nomTurno}</td>
      <td>${fmtHora(a.horaEntrada)}</td>
      <td>${a.horaSalida ? fmtHora(a.horaSalida) : '<span style="color:var(--vol-claro);font-weight:600">En curso</span>'}</td>
      <td><span class="horas-badge">${a.horasGanadas != null ? a.horasGanadas.toFixed(2) + "h" : "—"}</span></td>
      <td title="${ETIQUETAS[a.calificacion] || "Sin calificar"}">${ESTRELLAS[a.calificacion] || "—"}</td>
    </tr>`;
  }).join("");
}

el("filtro-actividad").addEventListener("change", async () => {
  const actId    = el("filtro-actividad").value;
  const selTurno = el("filtro-turno");
  selTurno.innerHTML = `<option value="">Todos los turnos</option>`;
  if (actId) {
    const a = actividades.find(x => x.id === actId);
    (a?.turnos || []).forEach(t => {
      const opt = document.createElement("option");
      opt.value       = t.id;
      opt.textContent = `${t.nombre} (${t.horaInicio}–${t.horaFin})`;
      selTurno.appendChild(opt);
    });
  }
  await cargarAsistencias();
});

el("filtro-turno").addEventListener("change", cargarAsistencias);

el("btn-exportar-asistencias").addEventListener("click", () => {
  if (!asistenciasCache.length) { mostrarAlerta("warning", "No hay asistencias para exportar."); return; }
  const filas = asistenciasCache.map(a => {
    const { nomVol, nomAct, nomTurno, area } = resolverAsistencia(a);
    return {
      "Voluntario":    nomVol,
      "Actividad":     nomAct,
      "Turno":         nomTurno,
      "Hora entrada":  fmtHora(a.horaEntrada),
      "Hora salida":   a.horaSalida ? fmtHora(a.horaSalida) : "En curso",
      "Horas ganadas": a.horasGanadas != null ? +a.horasGanadas.toFixed(2) : "",
      "Calificación":  a.calificacion ? ETIQUETAS[a.calificacion] : "Sin calificar",
      "Área":          area,
    };
  });
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Asistencias");
  XLSX.writeFile(wb, `asistencias_voluntarios_${new Date().toISOString().split("T")[0]}.xlsx`);
});

// ─── Utilidad tab ─────────────────────────────────────────────────────────────
function activarTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === tabId));
}

// ─── Init ─────────────────────────────────────────────────────────────────────
cargarActividades();
cargarVoluntarios();
