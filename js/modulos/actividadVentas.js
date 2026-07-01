import { db, auth } from "../core/firebase-config.js";
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getUsuarioActual } from "../core/auth.js";

const el = id => document.getElementById(id);
const XLSX = window.XLSX;

let ventas           = [];
let turnosForm       = [];
let responsablesForm = [];
let productosForm    = [];
let combosForm       = [];
let comboItemsTemp   = [];
let editandoId       = null;

function formatearMonedaLocal(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

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

// ─── TABS ─────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    el(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "tab-lista") renderTablaVentas();
  });
});

// ─── TURNOS ───────────────────────────────────────────────────────────────────
function renderTurnos() {
  el("venta-turnos-lista").innerHTML = turnosForm.map((t, i) => `
    <span class="turno-tag">
      🕐 <strong>${t.nombre}</strong> &nbsp;${t.horaInicio} – ${t.horaFin}
      <button onclick="quitarTurno(${i})">×</button>
    </span>`).join("");
}

window.quitarTurno = function(i) { turnosForm.splice(i, 1); renderTurnos(); };

el("btn-add-turno-venta").addEventListener("click", () => {
  const nombre = el("venta-turno-nombre").value.trim();
  const inicio = el("venta-turno-inicio").value;
  const fin    = el("venta-turno-fin").value;
  if (!nombre || !inicio || !fin) { mostrarAlerta("error", "Completa nombre, hora inicio y hora fin del turno."); return; }
  if (turnosForm.some(t => t.nombre.toLowerCase() === nombre.toLowerCase())) {
    mostrarAlerta("error", "Ya existe un turno con ese nombre."); return;
  }
  turnosForm.push({ id: `t_${Date.now()}`, nombre, horaInicio: inicio, horaFin: fin });
  renderTurnos();
  el("venta-turno-nombre").value = el("venta-turno-inicio").value = el("venta-turno-fin").value = "";
});

// ─── RESPONSABLES ────────────────────────────────────────────────────────────
async function cargarUsuariosEnSelector() {
  const sel = el("venta-responsables-sel");
  const txt = el("venta-responsables-texto");
  try {
    const snap = await getDocs(query(collection(db, "usuarios"), orderBy("nombre")));
    sel.innerHTML = `<option value="">— Selecciona un organizador —</option>`;
    let count = 0;
    snap.docs.forEach(d => {
      const data = d.data();
      if (!data.nombre) return;
      const opt = document.createElement("option");
      opt.value = data.nombre;
      opt.textContent = `${data.nombre}${data.rol ? ` (${data.rol.replace(/_/g, " ")})` : ""}`;
      sel.appendChild(opt);
      count++;
    });
    if (count === 0) throw new Error("Sin datos");
  } catch (e) {
    // Sin permiso o sin datos: activar input de texto como respaldo
    sel.style.display = "none";
    txt.style.display = "";
    console.warn("Selector de usuarios no disponible:", e.message);
  }
}

function renderResponsables() {
  el("venta-responsables-lista").innerHTML = responsablesForm.map((n, i) => `
    <span class="turno-tag">
      👤 <strong>${n}</strong>
      <button onclick="quitarResponsable(${i})">×</button>
    </span>`).join("");
}

window.quitarResponsable = function(i) { responsablesForm.splice(i, 1); renderResponsables(); };

el("btn-add-responsable").addEventListener("click", () => {
  const sel = el("venta-responsables-sel");
  const txt = el("venta-responsables-texto");
  const nombre = (txt.style.display !== "none" ? txt.value : sel.value).trim();
  if (!nombre) { mostrarAlerta("error", "Selecciona o escribe el nombre del responsable."); return; }
  if (responsablesForm.includes(nombre)) { mostrarAlerta("error", "Este responsable ya fue agregado."); return; }
  responsablesForm.push(nombre);
  renderResponsables();
  sel.value = "";
  txt.value = "";
});

// ─── PRODUCTOS DE LA VENTA ──────────────────────────────────────────────────────
async function cargarProductosEnSelector() {
  const sel = el("venta-productos-sel");
  try {
    const snap = await getDocs(query(collection(db, "productos"), where("activo", "==", true)));
    sel.innerHTML = `<option value="">— Selecciona un producto —</option>`;
    snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.nombre;
        sel.appendChild(opt);
      });
  } catch (e) {
    sel.innerHTML = `<option value="">— Sin productos disponibles —</option>`;
    console.warn("Selector de productos no disponible:", e.message);
  }
}

function renderProductosForm() {
  el("venta-productos-lista").innerHTML = productosForm.map((p, i) => `
    <span class="turno-tag">
      🛒 <strong>${p.nombre}</strong>
      <button onclick="quitarProductoForm(${i})">×</button>
    </span>`).join("");
}

window.quitarProductoForm = function(i) { productosForm.splice(i, 1); renderProductosForm(); };

el("btn-add-producto-venta").addEventListener("click", () => {
  const sel = el("venta-productos-sel");
  const productoId = sel.value;
  const nombre = sel.options[sel.selectedIndex]?.textContent || "";
  if (!productoId) { mostrarAlerta("error", "Selecciona un producto."); return; }
  if (productosForm.some(p => p.productoId === productoId)) { mostrarAlerta("error", "Este producto ya fue agregado."); return; }
  productosForm.push({ productoId, nombre });
  renderProductosForm();
  sel.value = "";
});

// ─── COMBOS DE LA VENTA ─────────────────────────────────────────────────────────
async function cargarProductosEnSelectorCombo() {
  const sel = el("combo-producto-sel");
  try {
    const snap = await getDocs(query(collection(db, "productos"), where("activo", "==", true)));
    sel.innerHTML = `<option value="">— Selecciona un producto —</option>`;
    snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.nombre;
        sel.appendChild(opt);
      });
  } catch (e) {
    sel.innerHTML = `<option value="">— Sin productos disponibles —</option>`;
    console.warn("Selector de productos (combo) no disponible:", e.message);
  }
}

function renderComboItemsTemp() {
  el("combo-items-lista").innerHTML = comboItemsTemp.map((it, i) => `
    <span class="turno-tag">
      ${it.nombre} · ${formatearMonedaLocal(it.precio)}
      <button onclick="quitarComboItemTemp(${i})">×</button>
    </span>`).join("");
}

window.quitarComboItemTemp = function(i) { comboItemsTemp.splice(i, 1); renderComboItemsTemp(); };

el("btn-add-item-combo").addEventListener("click", () => {
  const sel = el("combo-producto-sel");
  const precioInput = el("combo-producto-precio");
  const productoId = sel.value;
  const nombre = sel.options[sel.selectedIndex]?.textContent || "";
  const precio = parseFloat(precioInput.value);
  if (!productoId) { mostrarAlerta("error", "Selecciona un producto para el combo."); return; }
  if (!Number.isFinite(precio) || precio < 0) { mostrarAlerta("error", "Ingresa un precio válido para el producto del combo."); return; }
  if (comboItemsTemp.some(it => it.productoId === productoId)) { mostrarAlerta("error", "Este producto ya está en el combo."); return; }
  comboItemsTemp.push({ productoId, nombre, precio });
  renderComboItemsTemp();
  sel.value = "";
  precioInput.value = "";
});

function renderCombos() {
  el("venta-combos-lista").innerHTML = combosForm.map((c, i) => `
    <div style="background:#fff;border:1px solid #f98080;border-radius:var(--radio-sm);padding:8px 10px;margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong style="color:#c81e1e;">🍔 ${c.nombre}</strong>
        <span style="display:flex;align-items:center;gap:8px;">
          <strong style="color:#c81e1e;">${formatearMonedaLocal(c.precioTotal)}</strong>
          <button onclick="quitarCombo(${i})" style="background:none;border:none;cursor:pointer;color:#c81e1e;font-size:15px;">×</button>
        </span>
      </div>
      <div style="font-size:12px;color:var(--gris-medio);margin-top:4px;">
        ${c.items.map(it => `${it.nombre} (${formatearMonedaLocal(it.precio)})`).join(" + ")}
      </div>
    </div>`).join("");
}

window.quitarCombo = function(i) { combosForm.splice(i, 1); renderCombos(); };

el("btn-guardar-combo").addEventListener("click", () => {
  const nombre = el("combo-nombre").value.trim();
  if (!nombre) { mostrarAlerta("error", "Ingresa el nombre del combo."); return; }
  if (comboItemsTemp.length < 2) { mostrarAlerta("error", "Un combo debe tener al menos 2 productos."); return; }
  if (combosForm.some(c => c.nombre.toLowerCase() === nombre.toLowerCase())) {
    mostrarAlerta("error", "Ya existe un combo con ese nombre."); return;
  }
  const precioTotal = comboItemsTemp.reduce((s, it) => s + it.precio, 0);
  combosForm.push({ id: `c_${Date.now()}`, nombre, items: [...comboItemsTemp], precioTotal });
  renderCombos();
  el("combo-nombre").value = "";
  comboItemsTemp = [];
  renderComboItemsTemp();
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────
el("btn-guardar-venta").addEventListener("click", async () => {
  const nombre = el("venta-nombre").value.trim();
  const fecha  = el("venta-fecha").value;
  const tipo   = el("venta-tipo").value;
  if (!nombre || !fecha || !tipo) { mostrarAlerta("error", "Nombre, fecha y tipo son obligatorios."); return; }

  const data = {
    nombre,
    descripcion:    el("venta-descripcion").value.trim(),
    fecha:          new Date(fecha + "T12:00:00"),
    tipo,
    lugar:          el("venta-lugar").value.trim(),
    voluntariosReq: parseInt(el("venta-voluntarios-req").value) || 0,
    colaboracion:   el("venta-colaboracion").value.trim(),
    responsables:   responsablesForm.join(", "),
    turnos:         turnosForm,
    productos:      productosForm,
    combos:         combosForm,
    activo:         true,
    actualizadoEn:  serverTimestamp(),
  };

  el("btn-guardar-venta").disabled = true;
  el("btn-guardar-venta").textContent = "Guardando...";
  try {
    if (editandoId) {
      await updateDoc(doc(db, "actividades_ventas", editandoId), data);
      mostrarAlerta("success", "Venta actualizada.");
    } else {
      data.creadoEn  = serverTimestamp();
      data.creadoPor = auth.currentUser?.uid || "";
      await addDoc(collection(db, "actividades_ventas"), data);
      mostrarAlerta("success", "Venta registrada correctamente.");
    }
    limpiarForm();
    await cargarVentas();
    activarTab("tab-lista");
  } catch (e) { mostrarAlerta("error", "Error al guardar: " + e.message); }
  el("btn-guardar-venta").disabled = false;
  el("btn-guardar-venta").textContent = "Guardar venta";
});

function limpiarForm() {
  el("venta-nombre").value = el("venta-descripcion").value = el("venta-fecha").value = "";
  el("venta-tipo").value = el("venta-lugar").value = "";
  el("venta-voluntarios-req").value = el("venta-colaboracion").value = "";
  el("venta-responsables-sel").value = "";
  el("venta-responsables-texto").value = "";
  turnosForm = []; renderTurnos();
  responsablesForm = []; renderResponsables();
  productosForm = []; renderProductosForm();
  combosForm = []; renderCombos();
  comboItemsTemp = []; renderComboItemsTemp();
  el("combo-nombre").value = "";
  editandoId = null;
  el("form-venta-titulo").textContent = "Registrar nueva venta";
  el("btn-cancelar-venta").style.display = "none";
}

window.editarVenta = function(id) {
  const v = ventas.find(x => x.id === id);
  if (!v) return;
  editandoId = id;
  el("venta-nombre").value          = v.nombre || "";
  el("venta-descripcion").value     = v.descripcion || "";
  el("venta-tipo").value            = v.tipo || "";
  el("venta-lugar").value           = v.lugar || "";
  el("venta-voluntarios-req").value = v.voluntariosReq || "";
  el("venta-colaboracion").value = v.colaboracion || "";
  responsablesForm = v.responsables
    ? v.responsables.split(",").map(r => r.trim()).filter(Boolean)
    : [];
  renderResponsables();
  if (v.fecha) {
    const d = v.fecha.toDate ? v.fecha.toDate() : new Date(v.fecha);
    el("venta-fecha").value = d.toISOString().split("T")[0];
  }
  turnosForm = [...(v.turnos || [])];
  renderTurnos();
  productosForm = [...(v.productos || [])];
  renderProductosForm();
  combosForm = [...(v.combos || [])];
  renderCombos();
  el("form-venta-titulo").textContent = "Editar venta";
  el("btn-cancelar-venta").style.display = "inline-flex";
  activarTab("tab-ventas");
  el("venta-nombre").scrollIntoView({ behavior: "smooth" });
};

window.toggleVenta = async function(id, estadoActual) {
  try {
    await updateDoc(doc(db, "actividades_ventas", id), { activo: !estadoActual, actualizadoEn: serverTimestamp() });
    await cargarVentas();
  } catch (e) { mostrarAlerta("error", "Error: " + e.message); }
};

window.eliminarVenta = async function(id, nombre) {
  if (!confirm(`¿Eliminar la venta "${nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteDoc(doc(db, "actividades_ventas", id));
    ventas = ventas.filter(v => v.id !== id);
    renderTablaVentas();
    actualizarStats();
    mostrarAlerta("success", "Venta eliminada.");
  } catch (e) { mostrarAlerta("error", "Error: " + e.message); }
};

el("btn-cancelar-venta").addEventListener("click", limpiarForm);
el("btn-nueva-venta").addEventListener("click", () => { limpiarForm(); activarTab("tab-ventas"); });

// ─── CARGA Y RENDER ───────────────────────────────────────────────────────────
async function cargarVentas() {
  try {
    const snap = await getDocs(query(collection(db, "actividades_ventas"), orderBy("creadoEn", "desc")));
    ventas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { ventas = []; }
  renderTablaVentas();
  actualizarStats();
}

function actualizarStats() {
  el("stat-total-ventas").textContent   = ventas.length;
  el("stat-ventas-activas").textContent = ventas.filter(v => v.activo).length;
  el("stat-vol-req-total").textContent  = ventas.reduce((s, v) => s + (v.voluntariosReq || 0), 0);
}

function renderTablaVentas() {
  const tb = el("tabla-ventas-body");
  if (!ventas.length) {
    tb.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--gris-medio)">Sin ventas registradas. Registra la primera usando el formulario.</td></tr>`;
    return;
  }
  tb.innerHTML = ventas.map(v => `
    <tr>
      <td>
        <strong>${v.nombre}</strong>
        ${v.descripcion ? `<br/><small style="color:var(--gris-medio)">${v.descripcion}</small>` : ""}
        ${v.colaboracion ? `<br/><small style="color:var(--gris-medio)">🤝 ${v.colaboracion}</small>` : ""}
      </td>
      <td>${fmtFecha(v.fecha)}</td>
      <td>${v.tipo || "—"}</td>
      <td>${v.lugar || "—"}</td>
      <td style="text-align:center;">${v.voluntariosReq ? `<strong style="color:#c81e1e">${v.voluntariosReq}</strong>` : "—"}</td>
      <td>${v.responsables || "—"}</td>
      <td>
        ${(v.turnos || []).map(t => `<span style="font-size:11px;background:#fde8e8;color:#c81e1e;padding:2px 6px;border-radius:8px;display:inline-block;margin:1px;">${t.nombre} ${t.horaInicio}–${t.horaFin}</span>`).join("") || "—"}
      </td>
      <td>
        ${(v.productos || []).map(p => `<span style="font-size:11px;background:#fde8e8;color:#c81e1e;padding:2px 6px;border-radius:8px;display:inline-block;margin:1px;">🛒 ${p.nombre}</span>`).join("") || "—"}
      </td>
      <td>
        ${(v.combos || []).map(c => `<span style="font-size:11px;background:#fde8e8;color:#c81e1e;padding:2px 6px;border-radius:8px;display:inline-block;margin:1px;" title="${c.items.map(it => `${it.nombre} (${formatearMonedaLocal(it.precio)})`).join(" + ")}">🍔 ${c.nombre} · ${formatearMonedaLocal(c.precioTotal)}</span>`).join("") || "—"}
      </td>
      <td>
        <span style="font-size:12px;background:${v.activo ? "#fde8e8" : "#f8f9fa"};color:${v.activo ? "#c81e1e" : "var(--gris-medio)"};padding:2px 8px;border-radius:12px;">
          ${v.activo ? "Activa" : "Inactiva"}
        </span>
      </td>
      <td style="white-space:nowrap;">
        <button class="btn btn-outline btn-sm" onclick="editarVenta('${v.id}')" style="width:auto;margin-right:4px">✏️</button>
        <button onclick="toggleVenta('${v.id}',${!!v.activo})" style="background:${v.activo ? "var(--rojo)" : "#f05252"};color:#fff;border:none;border-radius:8px;padding:5px 9px;cursor:pointer;font-size:12px;">
          ${v.activo ? "Desactivar" : "Activar"}
        </button>
        <button onclick="eliminarVenta('${v.id}','${v.nombre.replace(/'/g, "\\'")}')"
          style="background:#6b7280;color:#fff;border:none;border-radius:8px;padding:5px 8px;cursor:pointer;font-size:12px;margin-left:2px;">🗑</button>
      </td>
    </tr>`).join("");
}

// ─── EXPORTAR ─────────────────────────────────────────────────────────────────
el("btn-exportar-ventas").addEventListener("click", () => {
  if (!ventas.length) { mostrarAlerta("warning", "No hay ventas para exportar."); return; }
  const filas = ventas.map(v => ({
    "Nombre":              v.nombre,
    "Descripción":         v.descripcion || "",
    "Fecha":               fmtFecha(v.fecha),
    "Tipo":                v.tipo || "",
    "Lugar":               v.lugar || "",
    "Voluntarios req.":    v.voluntariosReq || 0,
    "Colaboración":        v.colaboracion || "",
    "Responsables":        v.responsables || "",
    "Turnos":              (v.turnos || []).map(t => `${t.nombre} ${t.horaInicio}-${t.horaFin}`).join("; "),
    "Productos":           (v.productos || []).map(p => p.nombre).join("; "),
    "Combos":              (v.combos || []).map(c => `${c.nombre} [${c.items.map(it => `${it.nombre} ${formatearMonedaLocal(it.precio)}`).join(" + ")}] = ${formatearMonedaLocal(c.precioTotal)}`).join("; "),
    "Estado":              v.activo ? "Activa" : "Inactiva",
  }));
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ventas");
  XLSX.writeFile(wb, `ventas_contecs_${new Date().toISOString().split("T")[0]}.xlsx`);
});

// ─── Utilidad ─────────────────────────────────────────────────────────────────
function activarTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === tabId));
}

// ─── Init ─────────────────────────────────────────────────────────────────────
cargarVentas();
cargarUsuariosEnSelector();
cargarProductosEnSelector();
cargarProductosEnSelectorCombo();
