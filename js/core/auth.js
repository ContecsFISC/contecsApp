import { auth, db } from "./firebase-config.js";
import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { SSO_LOGIN_URL } from "./sso-config.js";
import {
  doc, getDoc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { tienePermiso, venceEnMs, admiteAjustes } from "./permisos.js";

const provider = new GoogleAuthProvider();
const PUBLIC_PAGES = ["index.html", "auth.html"];

function esPaginaPublica() {
  const page = window.location.pathname.split("/").pop() || "index.html";
  if (PUBLIC_PAGES.includes(page)) return true;
  const path = window.location.pathname;
  return path.endsWith("/ms/auth") || path.includes("/ms/auth");
}


// Calcula cuántos "../" se necesitan para llegar a panel/ (donde viven
// index.html y dashboard.html) desde la página actual, sin importar
// el subpath de hosting (ej. /contecsApp/) ni la profundidad del módulo.
function prefijoHaciaPanel() {
  const partes = window.location.pathname.split("/").filter(Boolean);
  const idx = partes.lastIndexOf("panel");
  if (idx === -1) return ""; // no estamos bajo panel/ (ej. páginas públicas)
  const niveles = partes.length - idx - 2; // -1 por "panel" mismo, -1 por el archivo actual
  return niveles > 0 ? "../".repeat(niveles) : "";
}

// La app tiene dos páginas de acceso: /index.html y /panel/index.html.
// Desde la raíz hay que entrar a panel/; desde cualquier página bajo panel/
// se conserva la navegación relativa existente.
function rutaHaciaDashboard() {
  const path = window.location.pathname;
  if (path.includes("/panel/")) {
    return prefijoHaciaPanel() + "dashboard.html";
  }
  return "panel/dashboard.html";
}

function esErrorDePermisosFirestore(error) {
  return error?.code === "permission-denied" || error?.code === "firestore/permission-denied";
}

function esErrorDeDominioNoAutorizado(error) {
  return error?.code === "auth/unauthorized-domain";
}

function manejarErrorAuth(error, contexto) {
  if (esErrorDePermisosFirestore(error)) {
    console.error(
      `[Auth] Firestore bloqueó la operación (${contexto}). Revisa tus reglas: el usuario autenticado debe poder leer/escribir su propio documento en usuarios/{uid}.`,
      error
    );
    return;
  }

  if (esErrorDeDominioNoAutorizado(error)) {
    console.error(
      `[Auth] El dominio actual no está autorizado para OAuth (${contexto}). Agrega ${window.location.hostname} en Firebase Console > Authentication > Settings > Authorized domains.`,
      error
    );
    return;
  }
  console.error(`[Auth] Error en ${contexto}:`, error);
}

// usuarios/{uid}.permisosExtra tal como se guarda en sessionStorage: el
// vencimiento en milisegundos para que sobreviva a JSON. Las claves van
// ordenadas: el texto se compara para saber si algo cambió.
function serializarPermisosExtra(extra) {
  const limpio = {};
  Object.entries(extra || {}).sort(([a], [b]) => a.localeCompare(b)).forEach(([permiso, ajuste]) => {
    if (ajuste?.modo !== "otorgar" && ajuste?.modo !== "quitar") return;
    limpio[permiso] = { modo: ajuste.modo, vence: venceEnMs(ajuste.vence) };
  });
  return JSON.stringify(limpio);
}

function leerPermisosExtra() {
  try {
    return JSON.parse(sessionStorage.getItem("permisosExtra") || "{}") || {};
  } catch {
    return {};
  }
}

// Permisos por rol (config/permisos_roles, los que el CEO cambia en Usuarios →
// "Permisos por rol"): en sessionStorage solo los del rol de la sesión.
const refPermisosRoles = () => doc(db, "config", "permisos_roles");

function serializarAjustesRol(datos, rol) {
  const delRol = datos?.roles?.[rol] || {};
  const limpio = {};
  Object.keys(delRol).sort().forEach(permiso => {
    const modo = delRol[permiso]?.modo;
    if (modo === "otorgar" || modo === "quitar") limpio[permiso] = { modo };
  });
  return JSON.stringify(limpio);
}

function leerAjustesRol() {
  try {
    return JSON.parse(sessionStorage.getItem("ajustesRol") || "{}") || {};
  } catch {
    return {};
  }
}

async function cargarAjustesRol(rol) {
  if (!admiteAjustes(rol)) {
    sessionStorage.setItem("ajustesRol", "{}");
    return;
  }
  try {
    const snap = await getDoc(refPermisosRoles());
    sessionStorage.setItem("ajustesRol", serializarAjustesRol(snap.exists() ? snap.data() : null, rol));
  } catch (error) {
    // Sin poder leerlos, el rol queda como en el código (igual que en las reglas
    // si el documento no existe).
    sessionStorage.setItem("ajustesRol", "{}");
    console.warn("[Auth] No se pudieron leer los permisos por rol:", error);
  }
}

// Un permiso otorgado "hasta el viernes" deja de valer en las reglas a esa
// hora exacta; la página se recarga entonces para dejar de mostrar lo que ya
// no se puede usar. Solo se programa si vence en las próximas 24 h.
let temporizadorVencimiento = null;
function programarRecargaPorVencimiento() {
  clearTimeout(temporizadorVencimiento);
  const ahora = Date.now();
  const proximo = Object.values(leerPermisosExtra())
    .map(a => a.modo === "otorgar" ? a.vence : null)
    .filter(v => typeof v === "number" && v > ahora)
    .sort((a, b) => a - b)[0];
  if (proximo && proximo - ahora < 24 * 60 * 60 * 1000) {
    temporizadorVencimiento = setTimeout(() => window.location.reload(), proximo - ahora + 1000);
  }
}

// Escucha cambios en el documento del usuario en Firestore en tiempo real.
// Si cambia el rol, vuelve al dashboard; si cambian solo sus permisos
// individuales, recarga la página actual (requirePermiso la saca de ahí si
// ya no tiene acceso).
export function escucharCambiosDeRol(uid) {
  const ref = doc(db, "usuarios", uid);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const data       = snap.data();
    const rolActual  = sessionStorage.getItem("rol");
    const rolNuevo   = data.rol || "sin_rol";
    const extraActual = sessionStorage.getItem("permisosExtra") || "{}";
    const extraNuevo  = serializarPermisosExtra(data.permisosExtra);

    if (rolActual !== rolNuevo) {
      sessionStorage.setItem("rol",    rolNuevo);
      sessionStorage.setItem("nombre", data.nombre || sessionStorage.getItem("nombre"));
      sessionStorage.setItem("permisosExtra", extraNuevo);
      window.location.href = prefijoHaciaPanel() + "dashboard.html";
    } else if (extraActual !== extraNuevo) {
      sessionStorage.setItem("permisosExtra", extraNuevo);
      window.location.reload();
    }
  });
}

// Igual con los permisos de su rol: si el CEO los cambia, se recarga.
function escucharAjustesDeRol() {
  const rol = sessionStorage.getItem("rol");
  if (!admiteAjustes(rol)) return null;
  return onSnapshot(refPermisosRoles(), (snap) => {
    const nuevo = serializarAjustesRol(snap.exists() ? snap.data() : null, rol);
    if ((sessionStorage.getItem("ajustesRol") || "{}") !== nuevo) {
      sessionStorage.setItem("ajustesRol", nuevo);
      window.location.reload();
    }
  }, (error) => console.warn("[Auth] Permisos por rol:", error));
}

let resolverSesionLista;
const sesionLista = new Promise((resolve) => { resolverSesionLista = resolve; });

export function guardRoute() {
  onAuthStateChanged(auth, async (user) => {
    try {
      const esPublica = esPaginaPublica();
      if (!user && !esPublica) {
        window.location.href = prefijoHaciaPanel() + "index.html";
      } else if (user && esPublica) {
        await cargarUsuario(user);
        // Un usuario recién registrado sin rol debe permanecer en la pantalla
        // de acceso hasta que un administrador lo active.
        if (sessionStorage.getItem("rol") !== "sin_rol") {
          window.location.href = rutaHaciaDashboard();
        }
      } else if (user && !esPublica) {
        // Si sessionStorage no tiene los datos de este usuario (pestaña nueva o
        // sesión restaurada sin haber pasado por el login en esta pestaña),
        // repoblarlos antes de seguir — de lo contrario getUsuarioActual()
        // devuelve campos vacíos aunque Firebase Auth sí reconozca al usuario.
        if (sessionStorage.getItem("uid") !== user.uid) {
          await cargarUsuario(user);
        }
        escucharCambiosDeRol(user.uid);
        escucharAjustesDeRol();
        programarRecargaPorVencimiento();
      }
    } catch (error) {
      manejarErrorAuth(error, "guardRoute/onAuthStateChanged");
    } finally {
      resolverSesionLista();
    }
  });
}

// Promesa que se resuelve cuando guardRoute() ya determinó el estado de
// autenticación y (si aplica) terminó de poblar sessionStorage. Útil para
// código que necesita leer getUsuarioActual() de forma confiable al cargar
// una página, en vez de leerlo de forma optimista antes de que Firebase Auth
// resuelva el estado de sesión.
export function esperarSesionLista() {
  return sesionLista;
}

export async function cargarUsuario(user) {
  const ref  = doc(db, "usuarios", user.uid);
  const nombreFallback = user.displayName || user.email;
  const rolFallback = "sin_rol";

  try {
    const snap = await getDoc(ref);

    if (snap.exists()) {
      // Usuario ya existe — cargar sus datos
      const data = snap.data();
      sessionStorage.setItem("uid",    user.uid);
      sessionStorage.setItem("nombre", data.nombre || nombreFallback);
      sessionStorage.setItem("rol",    data.rol || rolFallback);
      sessionStorage.setItem("email",  user.email);
      sessionStorage.setItem("permisosExtra", serializarPermisosExtra(data.permisosExtra));
      await cargarAjustesRol(data.rol || rolFallback);
      return;
    }

    // Primera vez que entra — crear documento automáticamente con sin_rol
    const nuevoUsuario = {
      nombre:    nombreFallback,
      email:     user.email,
      foto:      user.photoURL || "",
      rol:       rolFallback,
      creadoEn:  serverTimestamp(),
    };
    await setDoc(ref, nuevoUsuario);
    sessionStorage.setItem("uid",    user.uid);
    sessionStorage.setItem("nombre", nuevoUsuario.nombre);
    sessionStorage.setItem("rol",    rolFallback);
    sessionStorage.setItem("email",  user.email);
    sessionStorage.setItem("permisosExtra", "{}");
    sessionStorage.setItem("ajustesRol", "{}");
  } catch (error) {
    if (!esErrorDePermisosFirestore(error)) {
      throw error;
    }

    // Si Firestore no deja leer/escribir usuarios/{uid}, no bloqueamos el login.
    // El usuario entra con los datos básicos de Firebase Auth y rol provisional.
    sessionStorage.setItem("uid",    user.uid);
    sessionStorage.setItem("nombre", nombreFallback);
    sessionStorage.setItem("rol",    rolFallback);
    sessionStorage.setItem("email",  user.email);
    sessionStorage.setItem("permisosExtra", "{}");
    sessionStorage.setItem("ajustesRol", "{}");
    console.warn(
      `[Auth] Firestore no permitió acceder a usuarios/${user.uid}. Se usaron datos de respaldo de Auth.`,
      error
    );
  }
}

export async function loginConGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    await cargarUsuario(result.user);
    return result.user;
  } catch (error) {
    manejarErrorAuth(error, "loginConGoogle");
    throw error;
  }
}

export function loginConSSO() {
  window.location.href = SSO_LOGIN_URL;
}

export async function cerrarSesion() {
  sessionStorage.clear();
  await signOut(auth);
  window.location.href = prefijoHaciaPanel() + "index.html";
}

export function getUsuarioActual() {
  return {
    uid:    sessionStorage.getItem("uid"),
    nombre: sessionStorage.getItem("nombre"),
    rol:    sessionStorage.getItem("rol"),
    email:  sessionStorage.getItem("email"),
    permisosExtra: leerPermisosExtra(),
    ajustesRol: leerAjustesRol(),
  };
}

// Rol + permisos individuales + permisos por rol de quien tiene la sesión abierta.
export function usuarioTienePermiso(permiso) {
  const rol = sessionStorage.getItem("rol");
  return tienePermiso(rol, permiso, leerPermisosExtra(), leerAjustesRol());
}

// Oculta todo elemento con data-permiso="..." que la sesión no puede usar
// (pestañas, botones, enlaces). Con !important, para que un
// `style.display = ""` posterior de la página no lo vuelva a mostrar.
// Si se oculta la pestaña activa, abre la primera visible con un click, así
// que la página debe llamarlo después de registrar sus manejadores de tabs.
export function aplicarPermisosDom(raiz = document) {
  if (!document.getElementById("estilo-sin-permiso")) {
    const estilo = document.createElement("style");
    estilo.id = "estilo-sin-permiso";
    estilo.textContent = "[data-sin-permiso]{display:none !important}";
    document.head.appendChild(estilo);
  }
  let tabActivaOculta = false;
  raiz.querySelectorAll("[data-permiso]").forEach(elemento => {
    if (usuarioTienePermiso(elemento.dataset.permiso)) return;
    elemento.setAttribute("data-sin-permiso", "");
    if (!elemento.matches(".tab-btn")) return;
    // Su panel también, por si la página lo abre por código.
    const tab = elemento.dataset.tab;
    (document.getElementById(tab) || document.getElementById(`tab-${tab}`))?.setAttribute("data-sin-permiso", "");
    if (elemento.matches(".active, .activo")) tabActivaOculta = true;
  });
  if (tabActivaOculta) {
    const primera = [...document.querySelectorAll(".tab-btn")].find(b => !b.hasAttribute("data-sin-permiso"));
    primera?.click();
  }
}

export async function requirePermiso(...permisos) {
  await esperarSesionLista();

  // guardRoute ya inició la navegación al login. Mantener pendiente la
  // evaluación del módulo evita que continúe consultando datos protegidos.
  if (!auth.currentUser) {
    await new Promise(() => {});
  }

  const tiene = permisos.some(p => usuarioTienePermiso(p));
  if (!tiene) {
    window.location.replace(prefijoHaciaPanel() + "dashboard.html");
    await new Promise(() => {});
  }
  return true;
}
