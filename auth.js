import { auth, db } from "./firebase-config.js";
import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { tienePermiso } from "./permisos.js";

const provider = new GoogleAuthProvider();

const PUBLIC_PAGES = ["index.html", ""];

export function guardRoute() {
  const page = window.location.pathname.split("/").pop() || "index.html";
  onAuthStateChanged(auth, async (user) => {
    if (!user && !PUBLIC_PAGES.includes(page)) {
      window.location.href = "index.html";
    } else if (user && PUBLIC_PAGES.includes(page)) {
      await cargarUsuario(user);
      window.location.href = "dashboard.html";
    }
  });
}

async function cargarUsuario(user) {
  const snap = await getDoc(doc(db, "usuarios", user.uid));
  if (snap.exists()) {
    const data = snap.data();
    sessionStorage.setItem("uid",    user.uid);
    sessionStorage.setItem("nombre", data.nombre);
    sessionStorage.setItem("rol",    data.rol);
    sessionStorage.setItem("email",  user.email);
    return data;
  } else {
    sessionStorage.setItem("uid",    user.uid);
    sessionStorage.setItem("nombre", user.displayName || user.email);
    sessionStorage.setItem("rol",    "sin_rol");
    sessionStorage.setItem("email",  user.email);
    return null;
  }
}

export async function loginConGoogle() {
  const result = await signInWithPopup(auth, provider);
  await cargarUsuario(result.user);
  return result.user;
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
