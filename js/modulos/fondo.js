import { guardRoute, requirePermiso, usuarioTienePermiso, getUsuarioActual } from "../core/auth.js";
import { db, auth } from "../core/firebase-config.js";
import { formatearMoneda, registrarMovimientoFondo, resumenItemPrincipal } from "../core/operaciones.js";
import {
  doc, getDoc, collection, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

guardRoute();
requirePermiso("ver_fondos");
const estado = {
  balance: 0,
  movimientos: [],
};

const cacheUsuarios = new Map();

const $ = (id) => document.getElementById(id);
const alerta = $("alerta-fondo");
const resumenBalance = $("fondo-balance");
const resumenUltimo = $("fondo-ultimo");
const historial = $("historial-fondo");
const form = $("form-movimiento-fondo");
const tipo = $("tipo-movimiento");
const monto = $("monto-movimiento");
const descripcion = $("descripcion-movimiento");
const btnGuardar = $("btn-guardar-fondo");
const bloqueEdicion = $("bloque-edicion-fondo");

function mostrarAlerta(tipoAlerta, mensaje) {
  alerta.textContent = mensaje;
  alerta.className = `alerta alerta-${tipoAlerta} show`;
  alerta.style.display = "block";
}

function ocultarAlerta() {
  alerta.className = "alerta alerta-error";
  alerta.style.display = "none";
  alerta.textContent = "";
}

async function obtenerNombreUsuario(usuarioId) {
  if (!usuarioId) return "";
  if (cacheUsuarios.has(usuarioId)) return cacheUsuarios.get(usuarioId);

  const snap = await getDoc(doc(db, "usuarios", usuarioId));
  const nombre = snap.exists() ? (snap.data().nombre || usuarioId) : usuarioId;
  cacheUsuarios.set(usuarioId, nombre);
  return nombre;
}

async function resolverTituloYUsuario(mov) {
  const tituloBase = mov.titulo || mov.descripcion || "Movimiento";
  const usuarioBase = mov.usuarioNombre || (await obtenerNombreUsuario(mov.usuarioId));

  if (!mov.referenciaId || (mov.origen !== "venta" && mov.origen !== "compra")) {
    return { ...mov, titulo: tituloBase, usuarioNombre: usuarioBase };
  }

  const coleccionOrigen = mov.origen === "venta" ? "ventas" : "compras";
  const snapRef = await getDoc(doc(db, coleccionOrigen, mov.referenciaId));
  if (!snapRef.exists()) {
    return { ...mov, titulo: tituloBase, usuarioNombre: usuarioBase };
  }

  const data = snapRef.data();
  const titulo = resumenItemPrincipal(data.items) || tituloBase;
  const usuarioNombre = data.usuarioNombre || usuarioBase;

  return {
    ...mov,
    titulo,
    usuarioNombre,
  };
}

function renderBalance() {
  resumenBalance.textContent = formatearMoneda(estado.balance);
}

function renderHistorial() {
  if (estado.movimientos.length === 0) {
    historial.innerHTML = `
      <div class="empty-state" style="padding:24px 16px;">
        <div class="emoji">💳</div>
        <p>No hay movimientos registrados todavía.</p>
      </div>`;
    return;
  }

  historial.innerHTML = estado.movimientos.map((mov) => {
    const clase = mov.tipo === "ingreso" ? "ingreso" : "salida";
    const icono = mov.tipo === "ingreso" ? "▲" : "▼";
    return `
      <div class="fondo-item ${clase}">
        <div>
          <div class="fondo-titulo">${icono} ${mov.titulo || mov.descripcion || "Movimiento"}</div>
          <div class="fondo-meta">${mov.origen || "manual"} · ${mov.usuarioNombre || mov.usuarioId || ""}</div>
        </div>
        <div class="fondo-monto ${clase}">${mov.tipo === "ingreso" ? "+" : "-"}${formatearMoneda(mov.monto || 0)}</div>
      </div>`;
  }).join("");
}

async function guardarMovimiento(event) {
  const btn = document.getElementById("btn-guardar-fondo");

  event.preventDefault();
  ocultarAlerta();

  // Evitar múltiples clics
  if (btn.disabled) return;

  const usuarioActual = auth.currentUser;
  if (!usuarioActual) {
    mostrarAlerta("error", "No se pudo identificar al usuario. Intenta iniciar sesión de nuevo.");
    return;
  }

  // Bloquear el botón y cambiar texto
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "⏳ Guardando...";

  try {
    const datosUsuario = getUsuarioActual();
    await registrarMovimientoFondo({
      usuarioId: usuarioActual.uid,
      usuarioNombre: datosUsuario.nombre || usuarioActual.displayName || usuarioActual.email,
      tipo: tipo.value,
      monto: monto.value,
      descripcion: descripcion.value.trim(),
      titulo: descripcion.value.trim() || "Movimiento",
    });

    monto.value = "";
    descripcion.value = "";
    mostrarAlerta("success", "Movimiento registrado correctamente.");
  } catch (error) {
    mostrarAlerta("error", error.message || "No se pudo registrar el movimiento.");
  } finally {
    // Reactivar el botón en caso de error o al terminar
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

onSnapshot(doc(db, "fondos", "principal"), (snap) => {
  const data = snap.exists() ? snap.data() : { balance: 0 };
  estado.balance = Number(data.balance || 0);
  renderBalance();
  resumenUltimo.textContent = data.actualizadoEn ? "Actualizado en tiempo real" : "Sin movimientos";
});

onSnapshot(query(collection(db, "fondos_entrada"), orderBy("creadoEn", "desc")), async (snap) => {
  const resueltos = await Promise.all(
    snap.docs.map(async (d) => resolverTituloYUsuario({ id: d.id, ...d.data() }))
  );
  estado.movimientos = resueltos;
  renderHistorial();
});

if (!usuarioTienePermiso("editar_fondos")) {
  bloqueEdicion.style.display = "none";
} else {
  form.addEventListener("submit", guardarMovimiento);
}
