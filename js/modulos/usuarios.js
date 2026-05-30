import { guardRoute, requirePermiso, getUsuarioActual } from "../core/auth.js";
import { ROLES } from "../core/permisos.js";
import { db } from "../core/firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, orderBy, query
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

guardRoute();
requirePermiso("gestionar_usuarios");

let filtroActivo = "todos";
let todosUsuarios = [];

const lista = document.getElementById("lista-usuarios");
const contador = document.getElementById("contador");
const spinner = document.getElementById("spinner");

function renderUsuarios() {
  const usuarioActual = getUsuarioActual();

  let filtrados = todosUsuarios;
  if (filtroActivo === "sin_rol") filtrados = todosUsuarios.filter(u => !u.rol || u.rol === "sin_rol");
  if (filtroActivo === "con_rol") filtrados = todosUsuarios.filter(u => u.rol && u.rol !== "sin_rol");

  const sinRol = todosUsuarios.filter(u => !u.rol || u.rol === "sin_rol").length;
  contador.innerHTML =
    `<strong>${todosUsuarios.length}</strong> miembros registrados · <strong style="color:${sinRol > 0 ? "#d4850a" : "#39b54a"}">${sinRol}</strong> sin rol asignado`;

  lista.innerHTML = "";

  if (filtrados.length === 0) {
    lista.innerHTML = `<p style="text-align:center;color:#8a9e8d;padding:24px 0;font-size:14px;">No hay usuarios en esta categoría.</p>`;
    return;
  }

  filtrados.forEach(usuario => {
    const tieneFoto = usuario.foto && usuario.foto !== "";
    const inicial   = (usuario.nombre || "?")[0].toUpperCase();
    const sinRol    = !usuario.rol || usuario.rol === "sin_rol";
    const esMismo   = usuario.id === usuarioActual?.uid;

    const card = document.createElement("div");
    card.className = `usuario-card ${sinRol ? "sin-rol" : "con-rol"}`;
    card.innerHTML = `
      <div class="foto">
        ${tieneFoto ? `<img src="${usuario.foto}" alt="${inicial}"/>` : inicial}
      </div>
      <div class="info">
        <div class="nombre">${usuario.nombre || "Sin nombre"} ${esMismo ? '<span style="font-size:11px;color:#39b54a;">(tú)</span>' : ""}</div>
        <div class="email">${usuario.email || ""}</div>
        <div class="guardando" id="guardando-${usuario.id}">✓ Guardado</div>
      </div>
      <select class="rol-select" id="select-${usuario.id}" ${esMismo ? "disabled" : ""}>
        <option value="sin_rol" ${sinRol ? "selected" : ""}>Sin rol</option>
        ${Object.entries(ROLES).map(([key, val]) =>
          `<option value="${key}" ${usuario.rol === key ? "selected" : ""}>${val.label}</option>`
        ).join("")}
      </select>`;

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

    lista.appendChild(card);
  });
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
