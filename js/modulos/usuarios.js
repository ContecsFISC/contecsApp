import { guardRoute, requirePermiso, getUsuarioActual, usuarioTienePermiso } from "../core/auth.js";
import {
  ROLES, CATALOGO_PERMISOS, SUBPERMISOS, infoRol, rolIncluyePermiso, admiteAjustes, ajusteDePermiso,
  ajusteDelRol, tienePermiso, venceEnMs,
} from "../core/permisos.js";
import { escaparAtributo, escaparHtml, urlImagenSegura } from "../core/seguridad.js";
import { app, db } from "../core/firebase-config.js";
import {
  collection, onSnapshot, doc, orderBy, query
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";

guardRoute();
await requirePermiso("gestionar_usuarios");

const functions = getFunctions(app, "us-central1");
const rolSesion = getUsuarioActual().rol;
const esCeo = rolSesion === "ceo";
const puedeEliminar = usuarioTienePermiso("eliminar_usuarios");
const puedeFiltrar  = usuarioTienePermiso("filtrar_usuarios");
// Los permisos individuales y por rol los edita solo el CEO (las Cloud
// Functions guardarPermisosUsuario/guardarPermisosRol lo exigen).
const puedeEditarPermisos = esCeo;

let filtroActivo = "todos";
let todosUsuarios = [];
let ajustesRoles = {}; // config/permisos_roles.roles
document.getElementById("btn-permisos-rol").hidden = !puedeEditarPermisos;

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
      // Si se cancela o falla, el selector vuelve a mostrar el rol real.
      select.value = usuario.rol || "sin_rol";
      const cambiado = await pedirClaveYCambiarRol(usuario, nuevoRol);
      if (!cambiado) return;
      select.value = nuevoRol;
      guardandoEl.style.display = "block";
      setTimeout(() => guardandoEl.style.display = "none", 2000);
    });

    card.querySelector(".btn-permisos")?.addEventListener("click", () => abrirPermisos(usuario));
    card.querySelector(".btn-eliminar-usuario")?.addEventListener("click", (e) =>
      eliminarUsuario(usuario, e.currentTarget));

    lista.appendChild(card);
  });
}

// ── CAMBIAR ROL (con contraseña) ───────────────────────────────────────────
// El rol solo lo cambia la Cloud Function cambiarRolUsuario, que valida la
// contraseña contra su hash en Secret Manager (firestore.rules no deja
// cambiar `rol` desde el navegador). Resuelve true si se cambió.
const dlgRol = document.getElementById("dlg-rol");
const cambiarRolEnServidor = httpsCallable(functions, "cambiarRolUsuario");
const etiquetaRol = rol => (rol === "sin_rol" || !rol ? "Sin rol" : infoRol(rol).label);

function pedirClaveYCambiarRol(usuario, nuevoRol) {
  const form = document.getElementById("rol-form");
  const input = document.getElementById("rol-clave");
  const error = document.getElementById("rol-error");
  const btn = document.getElementById("rol-confirmar");
  document.getElementById("rol-sub").textContent = `${usuario.nombre || "Sin nombre"} · ${usuario.email || ""}`;
  document.getElementById("rol-cambio").innerHTML =
    `<span class="r-de">${escaparHtml(etiquetaRol(usuario.rol))}</span><span aria-hidden="true">→</span><span class="r-a">${escaparHtml(etiquetaRol(nuevoRol))}</span>`;
  input.value = "";
  error.hidden = true;
  btn.disabled = false;
  dlgRol.showModal();
  setTimeout(() => input.focus(), 30);

  return new Promise(resolve => {
    let enviando = false;
    const terminar = valor => {
      form.removeEventListener("submit", alEnviar);
      document.getElementById("rol-cerrar").removeEventListener("click", alCancelar);
      document.getElementById("rol-cancelar").removeEventListener("click", alCancelar);
      dlgRol.removeEventListener("cancel", alCancelar);
      input.value = "";
      if (dlgRol.open) dlgRol.close();
      resolve(valor);
    };
    const alCancelar = e => { e?.preventDefault?.(); if (!enviando) terminar(false); };
    const alEnviar = async e => {
      e.preventDefault();
      if (enviando || !input.value) return;
      enviando = true;
      btn.disabled = true;
      btn.textContent = "Verificando…";
      error.hidden = true;
      try {
        await cambiarRolEnServidor({ uid: usuario.id, rol: nuevoRol, clave: input.value });
        terminar(true);
      } catch (err) {
        error.textContent = err?.message || "No se pudo cambiar el rol.";
        error.hidden = false;
        input.select();
      } finally {
        enviando = false;
        btn.disabled = false;
        btn.textContent = "Cambiar rol";
      }
    };
    form.addEventListener("submit", alEnviar);
    document.getElementById("rol-cerrar").addEventListener("click", alCancelar);
    document.getElementById("rol-cancelar").addEventListener("click", alCancelar);
    dlgRol.addEventListener("cancel", alCancelar);
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
// Dos modos con el mismo catálogo:
// - "usuario": el CEO le da o le quita permisos sueltos a una persona
//   (usuarios/{uid}.permisosExtra). Su base es su rol con los permisos por rol.
// - "rol": lo mismo para todos los de un rol (config/permisos_roles). Su base
//   es lo que el rol trae en el código (js/core/permisos.js).
// La persona: ajuste propio > ajuste de su rol > rol en el código. Ambos se
// guardan por Cloud Function con el pase de la contraseña.
const dlg = document.getElementById("dlg-permisos");
const permBody = document.getElementById("perm-body");
const permAviso = document.getElementById("perm-aviso");
const btnGuardar = document.getElementById("perm-guardar");
const selRolPermisos = document.getElementById("perm-rol");
const guardarPermisosUsuario = httpsCallable(functions, "guardarPermisosUsuario");
const guardarPermisosRol = httpsCallable(functions, "guardarPermisosRol");

const PERMISO_INFO = new Map(CATALOGO_PERMISOS.flatMap(m => m.permisos.map(p => [p.id, p])));
// Acciones con roles propios que dependen de un permiso de entrada
// (ver_participantes -> aprobar_pagos...). Los sub-permisos van en SUBPERMISOS.
const DEPENDIENTES = new Map();
PERMISO_INFO.forEach(p => {
  if (p.requiere) DEPENDIENTES.set(p.requiere, [...(DEPENDIENTES.get(p.requiere) || []), p.id]);
});
const SUBS_DE = new Map();
Object.entries(SUBPERMISOS).forEach(([sub, modulo]) => SUBS_DE.set(modulo, [...(SUBS_DE.get(modulo) || []), sub]));
const ROLES_AJUSTABLES = Object.keys(ROLES).filter(admiteAjustes);

// { modo: "usuario"|"rol", rol, usuario?, borrador: { permiso: { modo, vence(ms|null) } } }
let editando = null;

// Lo que tendría con este borrador (mismo cálculo que la sesión: ajuste
// propio, ajuste del rol, herencia de sub-permisos y rol en el código).
function puedeCon(borrador, permiso) {
  const { modo, rol } = editando;
  return modo === "usuario"
    ? tienePermiso(rol, permiso, borrador, ajustesRoles[rol])
    : tienePermiso(rol, permiso, null, borrador);
}
function puedeEnBorrador(permiso) {
  return puedeCon(editando.borrador, permiso);
}

// Lo que tendría sin ajuste en ESTE nivel para `permiso`.
function baseDe(permiso) {
  const { [permiso]: _, ...resto } = editando.borrador;
  return puedeCon(resto, permiso);
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

function abrirDialogo() {
  const enRol = editando.modo === "rol";
  selRolPermisos.hidden = !enRol;
  document.getElementById("perm-ayuda-usuario").hidden = enRol;
  document.getElementById("perm-ayuda-rol").hidden = !enRol;
  document.getElementById("perm-restablecer").textContent = enRol ? "Volver a lo predeterminado" : "Volver a solo su rol";
  avisar("");
  btnGuardar.disabled = false;
  permBody.innerHTML = "";
  renderPermisos();
  if (!dlg.open) dlg.showModal();
}

function abrirPermisos(usuario) {
  // Los "otorgar" vencidos no cuentan: se descartan al abrir.
  const borrador = {};
  Object.entries(usuario.permisosExtra || {}).forEach(([permiso, ajuste]) => {
    if (ajusteDePermiso(usuario.rol, permiso, usuario.permisosExtra) === null) return;
    borrador[permiso] = { modo: ajuste.modo, vence: venceEnMs(ajuste.vence) };
  });
  editando = { modo: "usuario", rol: usuario.rol, usuario, borrador };
  const nRol = Object.keys(ajustesRoles[usuario.rol] || {}).length;
  document.getElementById("perm-titulo").textContent = `Permisos de ${usuario.nombre || usuario.email || "usuario"}`;
  document.getElementById("perm-sub").textContent =
    `Rol base: ${infoRol(usuario.rol).label}${nRol ? ` (con ${nRol} ajuste${nRol !== 1 ? "s" : ""} del rol)` : ""} · ${usuario.email || ""}`;
  abrirDialogo();
}

function borradorDeRol(rol) {
  const borrador = {};
  Object.entries(ajustesRoles[rol] || {}).forEach(([permiso, a]) => {
    if (a?.modo === "otorgar" || a?.modo === "quitar") borrador[permiso] = { modo: a.modo, vence: null };
  });
  return borrador;
}

function subtituloRol(rol) {
  const miembros = todosUsuarios.filter(u => u.rol === rol);
  const conPropios = miembros.filter(u => ajustesVigentes(u).length).length;
  return `Afecta a ${miembros.length} persona${miembros.length !== 1 ? "s" : ""}` +
    (conPropios ? ` · ${conPropios} con ajustes propios, que mandan sobre estos` : "");
}

function abrirPermisosRol(rol = ROLES_AJUSTABLES[0]) {
  editando = { modo: "rol", rol, borrador: borradorDeRol(rol) };
  selRolPermisos.value = rol;
  document.getElementById("perm-titulo").textContent = `Permisos del rol ${infoRol(rol).label}`;
  document.getElementById("perm-sub").textContent = subtituloRol(rol);
  abrirDialogo();
}

selRolPermisos.innerHTML = ROLES_AJUSTABLES
  .map(rol => `<option value="${escaparAtributo(rol)}">${escaparHtml(infoRol(rol).label)}</option>`).join("");
selRolPermisos.addEventListener("change", () => {
  const cambios = JSON.stringify(editando.borrador) !== JSON.stringify(borradorDeRol(editando.rol));
  if (cambios && !confirm("Hay cambios sin guardar en este rol. ¿Descartarlos?")) {
    selRolPermisos.value = editando.rol;
    return;
  }
  abrirPermisosRol(selRolPermisos.value);
});

// Etiqueta de una fila sin ajuste en este nivel: de dónde le viene.
function tagBase(p) {
  const { modo, rol } = editando;
  if (modo === "usuario") {
    const delRol = ajusteDelRol(rol, p.id, ajustesRoles[rol]);
    if (delRol === "otorgar") return `<span class="perm-tag tag-rol-ajuste">Dado a su rol</span>`;
    if (delRol === "quitar") return `<span class="perm-tag tag-rol-ajuste">Quitado a su rol</span>`;
  }
  if (SUBPERMISOS[p.id]) return `<span class="perm-tag tag-rol">Igual que el módulo</span>`;
  const trae = rolIncluyePermiso(rol, p.id);
  if (modo === "rol") return `<span class="perm-tag tag-rol">${trae ? "Por defecto del rol" : "El rol no lo trae"}</span>`;
  return `<span class="perm-tag tag-rol">${trae ? "Por su rol" : "Su rol no lo trae"}</span>`;
}

function renderPermisos() {
  const { modo, borrador } = editando;
  const abiertos = new Set([...permBody.querySelectorAll("details[open]")].map(d => d.dataset.modulo));
  const primeraVez = !permBody.childElementCount;

  permBody.innerHTML = CATALOGO_PERMISOS.map(modulo => {
    const activos = modulo.permisos.filter(p => puedeEnBorrador(p.id)).length;
    const ajustados = modulo.permisos.filter(p => borrador[p.id]).length;
    // Abiertos al empezar: los módulos donde hay algo activo o ajustes.
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
              : tagBase(p);
          const deshacer = esSub ? "Como el módulo" : modo === "rol" ? "Por defecto" : "Como su rol";
          return `
            <div class="perm-fila ${clase}">
              <input type="checkbox" id="${idInput}" data-permiso="${escaparAtributo(p.id)}" ${puede ? "checked" : ""}/>
              <label for="${idInput}">
                <div class="p-label">${escaparHtml(p.label)}</div>
                ${p.detalle ? `<div class="p-detalle">${escaparHtml(p.detalle)}</div>` : ""}
              </label>
              <div class="p-estado">
                ${tag}
                ${ajuste ? `<button type="button" class="perm-deshacer" data-deshacer="${escaparAtributo(p.id)}">${deshacer}</button>` : ""}
              </div>
              ${modo === "usuario" && ajuste?.modo === "otorgar" ? `
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
  const texto = editando.modo === "rol"
    ? "¿Quitar todos los ajustes del rol? Quedará con lo que trae por defecto."
    : "¿Quitar todos los ajustes? La persona quedará solo con los permisos de su rol.";
  if (!confirm(texto)) return;
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
  const { modo, usuario, rol, borrador } = editando;
  const ahora = Date.now();
  const vencidas = Object.entries(borrador)
    .filter(([, a]) => modo === "usuario" && a.modo === "otorgar" && a.vence != null && a.vence <= ahora);
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

  const ajustes = {};
  Object.entries(borrador).forEach(([permiso, a]) => {
    ajustes[permiso] = a.modo === "otorgar" && modo === "usuario"
      ? { modo: "otorgar", vence: a.vence ?? null }
      : { modo: a.modo };
  });

  btnGuardar.disabled = true;
  try {
    if (modo === "usuario") {
      await guardarPermisosUsuario({ pase: pase(), uid: usuario.id, permisosExtra: ajustes });
    } else {
      await guardarPermisosRol({ pase: pase(), rol, ajustes });
    }
    cerrarPermisos();
    // onSnapshot vuelve a pintar las tarjetas con lo guardado.
  } catch (err) {
    console.error("[Usuarios] No se pudieron guardar los permisos:", err);
    btnGuardar.disabled = false;
    if (err?.code === "functions/unauthenticated") {
      cerrarPermisos();
      bloquear(err.message);
      return;
    }
    avisar(err?.message || "No se pudieron guardar los permisos. Intenta de nuevo.");
  }
});

document.getElementById("btn-permisos-rol")?.addEventListener("click", () => abrirPermisosRol());

// ── ENTRADA CON CONTRASEÑA ─────────────────────────────────────────────────
// Usuarios no muestra nada hasta escribir la contraseña. desbloquearUsuarios
// la valida (mismo límite de intentos que cambiar rol) y devuelve un pase que
// vive solo en memoria: al recargar o volver a entrar se pide otra vez.
// Cambiar un rol la sigue pidiendo cada vez.
const desbloquearEnServidor = httpsCallable(functions, "desbloquearUsuarios");
const pantallaBloqueo = document.getElementById("bloqueo");
const panelUsuarios = document.getElementById("panel-usuarios");
const formBloqueo = document.getElementById("bloqueo-form");
const claveBloqueo = document.getElementById("bloqueo-clave");
const errorBloqueo = document.getElementById("bloqueo-error");
const btnBloqueo = document.getElementById("bloqueo-entrar");
let sesion = null; // { pase, vence }
let temporizadorPase = null;
let cancelarUsuarios = null;
let cancelarAjustesRoles = null;

function pase() {
  return sesion?.pase || "";
}

function bloquear(mensaje = "") {
  sesion = null;
  clearTimeout(temporizadorPase);
  cancelarUsuarios?.();
  cancelarAjustesRoles?.();
  cancelarUsuarios = cancelarAjustesRoles = null;
  if (dlg.open) cerrarPermisos();
  todosUsuarios = [];
  lista.innerHTML = "";
  panelUsuarios.hidden = true;
  pantallaBloqueo.hidden = false;
  errorBloqueo.textContent = mensaje;
  errorBloqueo.hidden = !mensaje;
  claveBloqueo.value = "";
  setTimeout(() => claveBloqueo.focus(), 30);
}

function desbloquear(datos) {
  sesion = { pase: datos.pase, vence: datos.vence };
  claveBloqueo.value = "";
  pantallaBloqueo.hidden = true;
  panelUsuarios.hidden = false;
  clearTimeout(temporizadorPase);
  temporizadorPase = setTimeout(() => bloquear("La sesión de Usuarios venció. Vuelve a escribir la contraseña."),
    Math.max(0, datos.vence - Date.now()));
  escucharDatos();
}

formBloqueo.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!claveBloqueo.value || btnBloqueo.disabled) return;
  btnBloqueo.disabled = true;
  btnBloqueo.textContent = "Verificando…";
  errorBloqueo.hidden = true;
  try {
    const { data } = await desbloquearEnServidor({ clave: claveBloqueo.value });
    desbloquear(data);
  } catch (err) {
    errorBloqueo.textContent = err?.message || "No se pudo verificar la contraseña.";
    errorBloqueo.hidden = false;
    claveBloqueo.select();
  } finally {
    btnBloqueo.disabled = false;
    btnBloqueo.textContent = "Entrar";
  }
});

function escucharDatos() {
  spinner.style.display = "";
  cancelarUsuarios = onSnapshot(query(collection(db, "usuarios"), orderBy("creadoEn", "desc")), (snap) => {
    todosUsuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    spinner.style.display = "none";
    renderUsuarios();
  });
  // Los permisos por rol: base de cada persona en su diálogo.
  cancelarAjustesRoles = onSnapshot(doc(db, "config", "permisos_roles"), (snap) => {
    ajustesRoles = (snap.exists() && snap.data().roles) || {};
    if (editando?.modo === "usuario") renderPermisos();
  }, (err) => console.warn("[Usuarios] Permisos por rol:", err));
}

document.querySelectorAll(".filtro-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filtro-btn").forEach(b => b.classList.remove("activo"));
    btn.classList.add("activo");
    filtroActivo = btn.dataset.filtro;
    renderUsuarios();
  });
});

bloquear();
