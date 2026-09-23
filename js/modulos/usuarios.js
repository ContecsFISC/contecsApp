import { guardRoute, requirePermiso, getUsuarioActual } from "../core/auth.js";
import { ROLES, tienePermiso } from "../core/permisos.js";
import { escaparAtributo, escaparHtml, urlImagenSegura } from "../core/seguridad.js";
import { app, db } from "../core/firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, orderBy, query
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";

guardRoute();
await requirePermiso("gestionar_usuarios");

const functions = getFunctions(app, "us-central1");
const rolSesion = getUsuarioActual().rol;
const puedeEliminar = tienePermiso(rolSesion, "eliminar_usuarios");
const puedeFiltrar  = tienePermiso(rolSesion, "filtrar_usuarios");

let filtroActivo = "todos";
let todosUsuarios = [];

const lista = document.getElementById("lista-usuarios");
const contador = document.getElementById("contador");
const spinner = document.getElementById("spinner");
const inpBuscar = document.getElementById("inp-buscar-usuario");
const filRol = document.getElementById("fil-rol-usuario");

const ICONO_ELIMINAR = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;

if (puedeFiltrar) {
  filRol.insertAdjacentHTML("beforeend",
    `<option value="sin_rol">Sin rol</option>` +
    Object.entries(ROLES).map(([key, val]) =>
      `<option value="${escaparAtributo(key)}">${escaparHtml(val.label)}</option>`
    ).join(""));
  document.getElementById("busqueda-bar").hidden = false;
  inpBuscar.addEventListener("input", renderUsuarios);
  filRol.addEventListener("change", renderUsuarios);
}

// Quita tildes para que "maria" encuentre a "María".
function normalizar(texto) {
  return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function renderUsuarios() {
  const usuarioActual = getUsuarioActual();

  let filtrados = todosUsuarios;
  if (filtroActivo === "sin_rol") filtrados = filtrados.filter(u => !u.rol || u.rol === "sin_rol");
  if (filtroActivo === "con_rol") filtrados = filtrados.filter(u => u.rol && u.rol !== "sin_rol");

  if (puedeFiltrar) {
    const rolFiltro = filRol.value;
    const busq = normalizar(inpBuscar.value);
    if (rolFiltro === "sin_rol") filtrados = filtrados.filter(u => !u.rol || u.rol === "sin_rol");
    else if (rolFiltro) filtrados = filtrados.filter(u => u.rol === rolFiltro);
    if (busq) {
      filtrados = filtrados.filter(u =>
        normalizar(u.nombre).includes(busq) || normalizar(u.email).includes(busq));
    }
  }

  const sinRol = todosUsuarios.filter(u => !u.rol || u.rol === "sin_rol").length;
  const mostrando = filtrados.length !== todosUsuarios.length
    ? ` · mostrando <strong>${filtrados.length}</strong>` : "";
  contador.innerHTML =
    `<strong>${todosUsuarios.length}</strong> miembros registrados · <strong style="color:${sinRol > 0 ? "#c47f17" : "#39b54a"}">${sinRol}</strong> sin rol asignado${mostrando}`;

  lista.innerHTML = "";

  if (filtrados.length === 0) {
    lista.innerHTML = `<p style="text-align:center;color:#86868b;padding:24px 0;font-size:14px;">No hay usuarios en esta categoría.</p>`;
    return;
  }

  filtrados.forEach(usuario => {
    const fotoSegura = urlImagenSegura(usuario.foto);
    const tieneFoto = !!fotoSegura;
    const inicialTexto = (String(usuario.nombre || "?")[0] || "?").toUpperCase();
    const inicial = escaparHtml(inicialTexto);
    const sinRol    = !usuario.rol || usuario.rol === "sin_rol";
    const esMismo   = usuario.id === usuarioActual?.uid;

    const card = document.createElement("div");
    card.className = `usuario-card ${sinRol ? "sin-rol" : "con-rol"}`;
    card.innerHTML = `
      <div class="foto">
        ${tieneFoto ? `<img src="${escaparAtributo(fotoSegura)}" alt="${inicial}" referrerpolicy="no-referrer"/>` : inicial}
      </div>
      <div class="info">
        <div class="nombre">${escaparHtml(usuario.nombre || "Sin nombre")} ${esMismo ? '<span style="font-size:11px;color:#39b54a;">(tú)</span>' : ""}</div>
        <div class="email">${escaparHtml(usuario.email || "")}</div>
      <div class="guardando" id="guardando-${usuario.id}">Guardado</div>
      </div>
      <select class="rol-select" id="select-${usuario.id}" ${esMismo ? "disabled" : ""}>
        <option value="sin_rol" ${sinRol ? "selected" : ""}>Sin rol</option>
        ${Object.entries(ROLES).map(([key, val]) =>
          `<option value="${key}" ${usuario.rol === key ? "selected" : ""}>${val.label}</option>`
        ).join("")}
      </select>
      ${puedeEliminar && !esMismo
        ? `<button type="button" class="btn-eliminar-usuario" title="Eliminar usuario" aria-label="Eliminar a ${escaparAtributo(usuario.nombre || usuario.email || "usuario")}">${ICONO_ELIMINAR}</button>`
        : ""}`;

    const select = card.querySelector(`#select-${usuario.id}`);
    select.addEventListener("change", async () => {
      const nuevoRol    = select.value;
      const guardandoEl = document.getElementById(`guardando-${usuario.id}`);
      try {
        await updateDoc(doc(db, "usuarios", usuario.id), { rol: nuevoRol });
        guardandoEl.style.display = "block";
        setTimeout(() => guardandoEl.style.display = "none", 2000);
      } catch {
        alert("Error al guardar. Intenta de nuevo.");
        select.value = usuario.rol || "sin_rol";
      }
    });

    card.querySelector(".btn-eliminar-usuario")?.addEventListener("click", (e) =>
      eliminarUsuario(usuario, e.currentTarget));

    lista.appendChild(card);
  });
}

async function eliminarUsuario(usuario, boton) {
  const etiqueta = `${usuario.nombre || "Sin nombre"} (${usuario.email || "sin correo"})`;
  const ok = confirm(
    `¿Eliminar definitivamente a ${etiqueta}?\n\n` +
    "Se borrará su cuenta y perderá el acceso al panel. Si vuelve a iniciar sesión aparecerá como un usuario nuevo con rol \"Sin rol\".\n\n" +
    "Esta acción no se puede deshacer."
  );
  if (!ok) return;

  boton.disabled = true;
  try {
    await httpsCallable(functions, "eliminarUsuario")({ uid: usuario.id });
    // onSnapshot quita la tarjeta en cuanto Firestore confirma el borrado.
  } catch (err) {
    alert(err?.message || "No se pudo eliminar el usuario. Intenta de nuevo.");
    boton.disabled = false;
  }
}

onSnapshot(query(collection(db, "usuarios"), orderBy("creadoEn", "desc")), (snap) => {
  todosUsuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  spinner.style.display = "none";
  renderUsuarios();
});

document.querySelectorAll(".filtro-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filtro-btn").forEach(b => b.classList.remove("activo"));
    btn.classList.add("activo");
    filtroActivo = btn.dataset.filtro;
    renderUsuarios();
  });
});
