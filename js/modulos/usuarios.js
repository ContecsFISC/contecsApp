import { guardRoute, requirePermiso, getUsuarioActual, usuarioTienePermiso } from "../core/auth.js";
import {
  ROLES, CATALOGO_PERMISOS, SUBPERMISOS, infoRol, rolIncluyePermiso, admiteAjustes, ajusteDePermiso,
  tienePermiso, venceEnMs,
} from "../core/permisos.js";
import { escaparAtributo, escaparHtml, urlImagenSegura } from "../core/seguridad.js";
import { app, db } from "../core/firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, orderBy, query, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";

guardRoute();
await requirePermiso("gestionar_usuarios");

const functions = getFunctions(app, "us-central1");
const rolSesion = getUsuarioActual().rol;
const esCeo = rolSesion === "ceo";
const puedeEliminar = usuarioTienePermiso("eliminar_usuarios");
const puedeFiltrar  = usuarioTienePermiso("filtrar_usuarios");
// Los permisos individuales los edita solo el CEO (firestore.rules lo exige).
const puedeEditarPermisos = esCeo;

let filtroActivo = "todos";
let todosUsuarios = [];

const lista = document.getElementById("lista-usuarios");
const contador = document.getElementById("contador");
const spinner = document.getElementById("spinner");
const inpBuscar = document.getElementById("inp-buscar-usuario");
const filRol = document.getElementById("fil-rol-usuario");

const ICONO_ELIMINAR = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
const ICONO_PERMISOS = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`;

// Solo el CEO da o quita el rol de CEO (firestore.rules lo exige).
const rolesAsignables = Object.entries(ROLES).filter(([key]) => esCeo || key !== "ceo");

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

// Ajustes que hoy cuentan (los "otorgar" vencidos ya no).
function ajustesVigentes(usuario) {
  return Object.keys(usuario.permisosExtra || {})
    .filter(p => ajusteDePermiso(usuario.rol, p, usuario.permisosExtra) !== null);
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
    // Fuera del CEO nadie toca la cuenta de un CEO.
    const bloqueado = esMismo || (!esCeo && usuario.rol === "ceo");
    const nAjustes  = admiteAjustes(usuario.rol) ? ajustesVigentes(usuario).length : 0;
    const conPermisos = puedeEditarPermisos && !esMismo && admiteAjustes(usuario.rol);

    const card = document.createElement("div");
    card.className = `usuario-card ${sinRol ? "sin-rol" : "con-rol"}`;
    card.innerHTML = `
      <div class="foto">
        ${tieneFoto ? `<img src="${escaparAtributo(fotoSegura)}" alt="${inicial}" referrerpolicy="no-referrer"/>` : inicial}
      </div>
      <div class="info">
        <div class="nombre">${escaparHtml(usuario.nombre || "Sin nombre")} ${esMismo ? '<span style="font-size:11px;color:#39b54a;">(tú)</span>' : ""}${!conPermisos && nAjustes ? `<span class="chip-ajustes">· permisos ajustados</span>` : ""}</div>
        <div class="email">${escaparHtml(usuario.email || "")}</div>
      <div class="guardando" id="guardando-${usuario.id}">Guardado</div>
      </div>
      <select class="rol-select" id="select-${usuario.id}" ${bloqueado ? "disabled" : ""}>
        <option value="sin_rol" ${sinRol ? "selected" : ""}>Sin rol</option>
        ${(bloqueado ? Object.entries(ROLES) : rolesAsignables).map(([key, val]) =>
          `<option value="${key}" ${usuario.rol === key ? "selected" : ""}>${val.label}</option>`
        ).join("")}
      </select>
      ${conPermisos
        ? `<button type="button" class="btn-permisos" title="Permisos individuales">${ICONO_PERMISOS}Permisos${nAjustes ? `<span class="n-ajustes" aria-label="${nAjustes} ajustes">${nAjustes}</span>` : ""}</button>`
        : ""}
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

    card.querySelector(".btn-permisos")?.addEventListener("click", () => abrirPermisos(usuario));
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

// ── GESTOR DE PERMISOS ─────────────────────────────────────────────────────
// El rol es la base; aquí el CEO le da o le quita permisos sueltos a una
// persona. Se guarda en usuarios/{uid}.permisosExtra (ver js/core/permisos.js).
// La pantalla muestra lo que la persona puede hacer al final (casilla) y
// resalta lo que difiere de su rol.
const dlg = document.getElementById("dlg-permisos");
const permBody = document.getElementById("perm-body");
const permAviso = document.getElementById("perm-aviso");
const btnGuardar = document.getElementById("perm-guardar");

const PERMISO_INFO = new Map(CATALOGO_PERMISOS.flatMap(m => m.permisos.map(p => [p.id, p])));
// Acciones con roles propios que dependen de un permiso de entrada
// (ver_participantes -> aprobar_pagos...). Los sub-permisos van en SUBPERMISOS.
const DEPENDIENTES = new Map();
PERMISO_INFO.forEach(p => {
  if (p.requiere) DEPENDIENTES.set(p.requiere, [...(DEPENDIENTES.get(p.requiere) || []), p.id]);
});
const SUBS_DE = new Map();
Object.entries(SUBPERMISOS).forEach(([sub, modulo]) => SUBS_DE.set(modulo, [...(SUBS_DE.get(modulo) || []), sub]));

let editando = null; // { usuario, borrador: { permiso: { modo, vence(ms|null) } } }

// Lo que la persona podría hacer con el borrador actual (mismo cálculo que
// la sesión: rol + ajustes + herencia de sub-permisos).
function puedeEnBorrador(permiso) {
  return tienePermiso(editando.usuario.rol, permiso, editando.borrador);
}

// Lo que tendría sin ajuste propio: su rol o, si es sub-permiso, su módulo.
function baseDe(permiso) {
  const modulo = SUBPERMISOS[permiso];
  return modulo ? puedeEnBorrador(modulo) : rolIncluyePermiso(editando.usuario.rol, permiso);
}

// Deja `permiso` como `quiere` (true/false) relativo a su base: si coincide
// no queda ajuste guardado.
function fijar(permiso, quiere) {
  const base = baseDe(permiso);
  if (quiere === base) delete editando.borrador[permiso];
  else if (quiere) editando.borrador[permiso] = { modo: "otorgar", vence: editando.borrador[permiso]?.vence ?? null };
  else editando.borrador[permiso] = { modo: "quitar", vence: null };
}

function etiquetaPermiso(id) {
  return PERMISO_INFO.get(id)?.label || id;
}

function avisar(texto) {
  permAviso.textContent = texto;
  permAviso.hidden = !texto;
}

// Valor de <input type="date"> <-> fin de ese día (hora local).
function fechaAInputs(ms) {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function inputAMs(valor) {
  if (!valor) return null;
  const [a, m, d] = valor.split("-").map(Number);
  return new Date(a, m - 1, d, 23, 59, 59).getTime();
}
function hoyInput() {
  return fechaAInputs(Date.now());
}

function abrirPermisos(usuario) {
  // Los "otorgar" vencidos no cuentan: se descartan al abrir.
  const borrador = {};
  Object.entries(usuario.permisosExtra || {}).forEach(([permiso, ajuste]) => {
    if (ajusteDePermiso(usuario.rol, permiso, usuario.permisosExtra) === null) return;
    borrador[permiso] = { modo: ajuste.modo, vence: venceEnMs(ajuste.vence) };
  });
  editando = { usuario, borrador };
  document.getElementById("perm-titulo").textContent = `Permisos de ${usuario.nombre || usuario.email || "usuario"}`;
  document.getElementById("perm-sub").textContent = `Rol base: ${infoRol(usuario.rol).label} · ${usuario.email || ""}`;
  avisar("");
  btnGuardar.disabled = false;
  renderPermisos();
  dlg.showModal();
}

function renderPermisos() {
  const { usuario, borrador } = editando;
  const abiertos = new Set([...permBody.querySelectorAll("details[open]")].map(d => d.dataset.modulo));
  const primeraVez = !permBody.childElementCount;

  permBody.innerHTML = CATALOGO_PERMISOS.map(modulo => {
    const activos = modulo.permisos.filter(p => puedeEnBorrador(p.id)).length;
    const ajustados = modulo.permisos.filter(p => borrador[p.id]).length;
    // Abiertos al empezar: los módulos donde la persona tiene algo o hay ajustes.
    const abierto = primeraVez ? (activos > 0 || ajustados > 0) : abiertos.has(modulo.modulo);
    return `
      <details class="perm-modulo" data-modulo="${escaparAtributo(modulo.modulo)}" ${abierto ? "open" : ""}>
        <summary>${escaparHtml(modulo.modulo)}
          <span class="resumen">${activos} de ${modulo.permisos.length}${ajustados ? ` · ${ajustados} ajustado${ajustados !== 1 ? "s" : ""}` : ""}</span>
        </summary>
        ${modulo.permisos.map(p => {
          const ajuste = borrador[p.id];
          const puede = puedeEnBorrador(p.id);
          const esSub = !!SUBPERMISOS[p.id];
          const clase = [esSub ? "sub" : "",
            ajuste?.modo === "otorgar" ? "otorgado" : ajuste?.modo === "quitar" ? "quitado" : ""].join(" ").trim();
          const idInput = `perm-${p.id}`;
          const tag = ajuste?.modo === "otorgar"
            ? `<span class="perm-tag tag-otorgado">Otorgado</span>`
            : ajuste?.modo === "quitar"
              ? `<span class="perm-tag tag-quitado">Quitado</span>`
              : esSub
                ? `<span class="perm-tag tag-rol">Igual que el módulo</span>`
                : `<span class="perm-tag tag-rol">${rolIncluyePermiso(usuario.rol, p.id) ? "Por su rol" : "Su rol no lo trae"}</span>`;
          return `
            <div class="perm-fila ${clase}">
              <input type="checkbox" id="${idInput}" data-permiso="${escaparAtributo(p.id)}" ${puede ? "checked" : ""}/>
              <label for="${idInput}">
                <div class="p-label">${escaparHtml(p.label)}</div>
                ${p.detalle ? `<div class="p-detalle">${escaparHtml(p.detalle)}</div>` : ""}
              </label>
              <div class="p-estado">
                ${tag}
                ${ajuste ? `<button type="button" class="perm-deshacer" data-deshacer="${escaparAtributo(p.id)}">${esSub ? "Como el módulo" : "Como su rol"}</button>` : ""}
              </div>
              ${ajuste?.modo === "otorgar" ? `
                <div class="p-vence">
                  <span>Vence:</span>
                  <input type="date" data-vence="${escaparAtributo(p.id)}" min="${hoyInput()}" value="${fechaAInputs(ajuste.vence)}" aria-label="Fecha en que vence ${escaparAtributo(p.label)}"/>
                  <span>${ajuste.vence ? "(al terminar ese día)" : "sin fecha: queda hasta que se quite"}</span>
                </div>` : ""}
            </div>`;
        }).join("")}
      </details>`;
  }).join("");
}

permBody.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches("input[type=checkbox][data-permiso]")) {
    const permiso = t.dataset.permiso;
    const quiere = t.checked;
    const extras = [];
    fijar(permiso, quiere);
    const info = PERMISO_INFO.get(permiso);
    // Dar una acción sin poder entrar al módulo no sirve: se da la entrada.
    if (quiere && info?.requiere && !puedeEnBorrador(info.requiere)) {
      fijar(info.requiere, true);
      extras.push(`También se dio "${etiquetaPermiso(info.requiere)}": sin eso no podría entrar al módulo.`);
    }
    // Igual con una pestaña: se da la entrada al módulo (salvo las páginas
    // propias, como Lectura QR). Las demás pestañas lo siguen y quedan activas.
    const modulo = SUBPERMISOS[permiso];
    if (quiere && modulo && !info?.independiente && !puedeEnBorrador(modulo)) {
      const hermanasAntes = (SUBS_DE.get(modulo) || []).filter(s => s !== permiso);
      fijar(modulo, true);
      // Que solo quede la pestaña pedida: las hermanas que se activarían
      // por herencia se quitan.
      hermanasAntes.filter(puedeEnBorrador).forEach(s => fijar(s, false));
      // La pedida ya la da el módulo: sin ajuste propio.
      fijar(permiso, true);
      extras.push(`También se dio "${etiquetaPermiso(modulo)}" para poder entrar; sus otras pestañas quedan sin marcar.`);
    }
    if (!quiere) {
      // Quitar la entrada deja sin uso sus acciones: se quitan con ella.
      const sueltos = (DEPENDIENTES.get(permiso) || []).filter(puedeEnBorrador);
      sueltos.forEach(d => fijar(d, false));
      // Y las pestañas otorgadas sueltas (las demás ya lo siguen solas).
      const subsSueltas = (SUBS_DE.get(permiso) || [])
        .filter(s => !PERMISO_INFO.get(s)?.independiente && editando.borrador[s]?.modo === "otorgar");
      subsSueltas.forEach(s => delete editando.borrador[s]);
      const todas = [...sueltos, ...subsSueltas];
      if (todas.length) {
        extras.push(`También se quitó: ${todas.map(etiquetaPermiso).join(", ")}.`);
      }
    }
    avisar(extras.join(" "));
    renderPermisos();
  } else if (t.matches("input[type=date][data-vence]")) {
    const ajuste = editando.borrador[t.dataset.vence];
    if (ajuste?.modo === "otorgar") ajuste.vence = inputAMs(t.value);
    renderPermisos();
  }
});

permBody.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-deshacer]");
  if (!btn) return;
  delete editando.borrador[btn.dataset.deshacer];
  avisar("");
  renderPermisos();
});

document.getElementById("perm-restablecer").addEventListener("click", () => {
  if (!Object.keys(editando.borrador).length) return;
  if (!confirm("¿Quitar todos los ajustes? La persona quedará solo con los permisos de su rol.")) return;
  editando.borrador = {};
  avisar("");
  renderPermisos();
});

function cerrarPermisos() {
  dlg.close();
  editando = null;
}
// Enter en la fecha no debe cerrar el diálogo sin guardar.
document.getElementById("perm-form").addEventListener("submit", (e) => e.preventDefault());
document.getElementById("perm-cerrar").addEventListener("click", cerrarPermisos);
document.getElementById("perm-cancelar").addEventListener("click", cerrarPermisos);
dlg.addEventListener("cancel", () => { editando = null; });

btnGuardar.addEventListener("click", async () => {
  if (!editando) return;
  const { usuario, borrador } = editando;
  const ahora = Date.now();
  const vencidas = Object.entries(borrador)
    .filter(([, a]) => a.modo === "otorgar" && a.vence != null && a.vence <= ahora);
  if (vencidas.length) {
    avisar(`La fecha de "${etiquetaPermiso(vencidas[0][0])}" ya pasó. Elige una fecha futura o déjala vacía.`);
    return;
  }

  // Ajustes que ya no cambian nada (p. ej. una pestaña otorgada cuyo módulo
  // ahora sí tiene) no se guardan. Primero los permisos, luego las pestañas,
  // que dependen de ellos.
  const ids = Object.keys(borrador);
  [...ids.filter(p => !SUBPERMISOS[p]), ...ids.filter(p => SUBPERMISOS[p])].forEach(permiso => {
    const a = borrador[permiso];
    const base = baseDe(permiso);
    if ((a.modo === "otorgar" && base) || (a.modo === "quitar" && !base)) delete borrador[permiso];
  });

  const permisosExtra = {};
  Object.entries(borrador).forEach(([permiso, a]) => {
    permisosExtra[permiso] = a.modo === "otorgar"
      ? { modo: "otorgar", vence: a.vence == null ? null : Timestamp.fromMillis(a.vence) }
      : { modo: "quitar" };
  });

  btnGuardar.disabled = true;
  try {
    await updateDoc(doc(db, "usuarios", usuario.id), {
      permisosExtra,
      permisosActualizadosPor: getUsuarioActual().uid,
      permisosActualizadosEn: serverTimestamp(),
    });
    cerrarPermisos();
    // onSnapshot vuelve a pintar la tarjeta con el nuevo número de ajustes.
  } catch (err) {
    console.error("[Usuarios] No se pudieron guardar los permisos:", err);
    avisar("No se pudieron guardar los permisos. Intenta de nuevo.");
    btnGuardar.disabled = false;
  }
});

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
