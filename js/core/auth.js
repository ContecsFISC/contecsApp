import { auth, db } from "./firebase-config.js";
import {
  signInWithPopup,
  GoogleAuthProvider,
  OAuthProvider,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
  doc, getDoc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { tienePermiso } from "./permisos.js";

const provider = new GoogleAuthProvider();
const microsoftProvider = new OAuthProvider("microsoft.com");
const PUBLIC_PAGES = ["index.html"];

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
      window.location.href = "dashboard.html";
    }
  });
}

export function guardRoute() {
  const page = window.location.pathname.split("/").pop() || "index.html";
  onAuthStateChanged(auth, async (user) => {
    try {
      if (!user && !PUBLIC_PAGES.includes(page)) {
        window.location.href = "index.html";
      } else if (user && PUBLIC_PAGES.includes(page)) {
        await cargarUsuario(user);
        window.location.href = "dashboard.html";
      } else if (user && !PUBLIC_PAGES.includes(page)) {
        escucharCambiosDeRol(user.uid);
      }
    } catch (error) {
      manejarErrorAuth(error, "guardRoute/onAuthStateChanged");
    }
  });
}

async function cargarUsuario(user) {
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

export async function loginConMicrosoft() {
  try {
    const result = await signInWithPopup(auth, microsoftProvider);
    await cargarUsuario(result.user);
    return result.user;
  } catch (error) {
    manejarErrorAuth(error, "loginConMicrosoft");
    throw error;
  }
}

export async function cerrarSesion() {
  sessionStorage.clear();
  await signOut(auth);
  window.location.href = "index.html";
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

export function requirePermiso(permiso) {
  if (!usuarioTienePermiso(permiso)) {
    window.location.href = "dashboard.html";
  }
}
