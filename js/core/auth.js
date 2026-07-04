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
import { tienePermiso } from "./permisos.js";

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

// Escucha cambios en el documento del usuario en Firestore en tiempo real
// Si el rol cambia, actualiza sessionStorage y recarga la página automáticamente
export function escucharCambiosDeRol(uid) {
  const ref = doc(db, "usuarios", uid);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const data       = snap.data();
    const rolActual  = sessionStorage.getItem("rol");
    const rolNuevo   = data.rol || "sin_rol";

    if (rolActual !== rolNuevo) {
      sessionStorage.setItem("rol",    rolNuevo);
      sessionStorage.setItem("nombre", data.nombre || sessionStorage.getItem("nombre"));
      window.location.href = prefijoHaciaPanel() + "dashboard.html";
    }
  });
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
        window.location.href = "dashboard.html";
      } else if (user && !esPublica) {
        // Si sessionStorage no tiene los datos de este usuario (pestaña nueva o
        // sesión restaurada sin haber pasado por el login en esta pestaña),
        // repoblarlos antes de seguir — de lo contrario getUsuarioActual()
        // devuelve campos vacíos aunque Firebase Auth sí reconozca al usuario.
        if (sessionStorage.getItem("uid") !== user.uid) {
          await cargarUsuario(user);
        }
        escucharCambiosDeRol(user.uid);
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
  };
}

export function usuarioTienePermiso(permiso) {
  const rol = sessionStorage.getItem("rol");
  return tienePermiso(rol, permiso);
}

export function requirePermiso(...permisos) {
  const tiene = permisos.some(p => usuarioTienePermiso(p));
  if (!tiene) {
    window.location.href = prefijoHaciaPanel() + "dashboard.html";
  }
}
