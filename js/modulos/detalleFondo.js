import { guardRoute, requirePermiso } from "../core/auth.js";
import { db } from "../core/firebase-config.js";
import { formatearMoneda, resumenItemPrincipal } from "../core/operaciones.js";
import { generarReporteFinancieroExcel } from "./reporteFinancieroExcel.js";
import {
  doc, getDoc, collection, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

guardRoute();
requirePermiso("ver_fondos");

const estado = {
  balance: 0,
  movimientos: [],
  filtrados: [],
};

const cacheUsuarios = new Map();

const $ = (id) => document.getElementById(id);
const errorEl = $("detalle-error");
const detalleBody = $("detalle-body");

const filtroTexto = $("filtro-texto");
const filtroTipo = $("filtro-tipo");
const filtroOrigen = $("filtro-origen");
const filtroUsuario = $("filtro-usuario");
const filtroDesde = $("filtro-desde");
const filtroHasta = $("filtro-hasta");
const btnLimpiar = $("btn-limpiar-filtros");
const btnExportarExcel = $("btn-exportar-excel");

function mostrarError(msg) {
  errorEl.textContent = msg;
  errorEl.className = "alerta alerta-error show";
  errorEl.style.display = "block";
}

function ocultarError() {
  errorEl.className = "alerta alerta-error";
  errorEl.style.display = "none";
  errorEl.textContent = "";
}

function fechaTexto(ts) {
  if (!ts?.toDate) return "-";
  return ts.toDate().toLocaleString("es-PA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fechaSolo(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toISOString().slice(0, 10);
}

async function obtenerNombreUsuario(usuarioId) {
  if (!usuarioId) return "";
  if (cacheUsuarios.has(usuarioId)) return cacheUsuarios.get(usuarioId);

  const snap = await getDoc(doc(db, "usuarios", usuarioId));
  const nombre = snap.exists() ? (snap.data().nombre || usuarioId) : usuarioId;
  cacheUsuarios.set(usuarioId, nombre);
  return nombre;
}

async function resolverMovimiento(mov) {
  const tituloBase = mov.titulo || mov.descripcion || "Movimiento";
  const usuarioBase = mov.usuarioNombre || (await obtenerNombreUsuario(mov.usuarioId));

  if (!mov.referenciaId || (mov.origen !== "venta" && mov.origen !== "compra")) {
    return { ...mov, titulo: tituloBase, usuarioNombre: usuarioBase };
  }

  const coleccion = mov.origen === "venta" ? "ventas" : "compras";
  const snapRef = await getDoc(doc(db, coleccion, mov.referenciaId));
  if (!snapRef.exists()) {
    return { ...mov, titulo: tituloBase, usuarioNombre: usuarioBase };
  }

  const data = snapRef.data();
  return {
    ...mov,
    titulo: resumenItemPrincipal(data.items) || tituloBase,
    usuarioNombre: data.usuarioNombre || usuarioBase,
  };
}

function cargarFiltroUsuarios() {
  const usuarios = [...new Set(estado.movimientos.map((m) => m.usuarioNombre || m.usuarioId).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  const actual = filtroUsuario.value;
  filtroUsuario.innerHTML = '<option value="todos">Todos</option>' +
    usuarios.map((u) => `<option value="${u}">${u}</option>`).join("");

  if (usuarios.includes(actual)) filtroUsuario.value = actual;
}

function aplicarFiltros() {
  const texto = filtroTexto.value.trim().toLowerCase();
  const tipo = filtroTipo.value;
  const origen = filtroOrigen.value;
  const usuario = filtroUsuario.value;
  const desde = filtroDesde.value;
  const hasta = filtroHasta.value;

  estado.filtrados = estado.movimientos.filter((mov) => {
    const titulo = (mov.titulo || mov.descripcion || "").toLowerCase();
    const nombreUsuario = (mov.usuarioNombre || mov.usuarioId || "").toLowerCase();
    const referencia = (mov.referenciaId || "").toLowerCase();
    const fecha = fechaSolo(mov.creadoEn);

    if (texto && !titulo.includes(texto) && !nombreUsuario.includes(texto) && !referencia.includes(texto)) return false;
    if (tipo !== "todos" && mov.tipo !== tipo) return false;
    if (origen !== "todos" && mov.origen !== origen) return false;
    if (usuario !== "todos" && (mov.usuarioNombre || mov.usuarioId) !== usuario) return false;
    if (desde && fecha && fecha < desde) return false;
    if (hasta && fecha && fecha > hasta) return false;

    return true;
  });

  renderTabla();
  renderKpis();
}

function renderKpis() {
  let ingresos = 0;
  let egresos = 0;

  estado.filtrados.forEach((mov) => {
    const monto = Number(mov.monto || 0);
    if (mov.tipo === "ingreso") ingresos += monto;
    else egresos += monto;
  });

  $("kpi-balance").textContent = formatearMoneda(estado.balance);
  $("kpi-ingresos").textContent = formatearMoneda(ingresos);
  $("kpi-egresos").textContent = formatearMoneda(egresos);
  $("total-ingresos").textContent = formatearMoneda(ingresos);
  $("total-egresos").textContent = formatearMoneda(egresos);
}

function renderTabla() {
  if (estado.filtrados.length === 0) {
    detalleBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;color:var(--gris-medio);padding:20px;">No hay movimientos para los filtros seleccionados.</td>
      </tr>`;
    return;
  }

  detalleBody.innerHTML = estado.filtrados.map((mov) => {
    const ingreso = mov.tipo === "ingreso" ? formatearMoneda(mov.monto || 0) : "-";
    const egreso = mov.tipo === "salida" ? formatearMoneda(mov.monto || 0) : "-";

    return `
      <tr>
        <td class="col-fecha">${fechaTexto(mov.creadoEn)}</td>
        <td class="col-mov">${mov.titulo || mov.descripcion || "Movimiento"}</td>
        <td class="col-usuario">${mov.usuarioNombre || mov.usuarioId || "-"}</td>
        <td class="col-tipo">${mov.origen || "manual"}</td>
        <td class="col-tipo">${mov.referenciaId || "-"}</td>
        <td class="col-ingreso">${ingreso}</td>
        <td class="col-egreso">${egreso}</td>
      </tr>`;
  }).join("");
}

function limpiarFiltros() {
  filtroTexto.value = "";
  filtroTipo.value = "todos";
  filtroOrigen.value = "todos";
  filtroUsuario.value = "todos";
  filtroDesde.value = "";
  filtroHasta.value = "";
  aplicarFiltros();
}

function descripcionFiltros() {
  const partes = [];
  if (filtroTexto.value.trim()) partes.push(`texto="${filtroTexto.value.trim()}"`);
  if (filtroTipo.value !== "todos") partes.push(`tipo=${filtroTipo.value}`);
  if (filtroOrigen.value !== "todos") partes.push(`origen=${filtroOrigen.value}`);
  if (filtroUsuario.value !== "todos") partes.push(`usuario=${filtroUsuario.value}`);
  if (filtroDesde.value) partes.push(`desde=${filtroDesde.value}`);
  if (filtroHasta.value) partes.push(`hasta=${filtroHasta.value}`);
  return partes.length ? partes.join(", ") : "";
}

async function exportarExcel() {
  btnExportarExcel.disabled = true;
  const textoOriginal = btnExportarExcel.textContent;
  btnExportarExcel.textContent = "Generando reporte...";
  try {
    ocultarError();
    await generarReporteFinancieroExcel({
      movimientosFiltrados: estado.filtrados,
      balance: estado.balance,
      filtroInfo: descripcionFiltros(),
    });
  } catch (error) {
    mostrarError(error.message || "No se pudo generar el reporte financiero.");
  } finally {
    btnExportarExcel.disabled = false;
    btnExportarExcel.textContent = textoOriginal;
  }
}

function initFiltros() {
  [filtroTexto, filtroTipo, filtroOrigen, filtroUsuario, filtroDesde, filtroHasta]
    .forEach((el) => el.addEventListener("input", aplicarFiltros));
  btnLimpiar.addEventListener("click", limpiarFiltros);
  btnExportarExcel.addEventListener("click", exportarExcel);
}

onSnapshot(doc(db, "fondos", "principal"), (snap) => {
  const data = snap.exists() ? snap.data() : { balance: 0 };
  estado.balance = Number(data.balance || 0);
  renderKpis();
});

onSnapshot(query(collection(db, "fondos_entrada"), orderBy("creadoEn", "desc")), async (snap) => {
  try {
    ocultarError();
    const resueltos = await Promise.all(
      snap.docs.map(async (d) => resolverMovimiento({ id: d.id, ...d.data() }))
    );
    estado.movimientos = resueltos;
    cargarFiltroUsuarios();
    aplicarFiltros();
  } catch (error) {
    mostrarError(error.message || "No se pudo cargar el detalle del fondo.");
  }
});

initFiltros();
renderKpis();
