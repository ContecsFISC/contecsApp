// =============================================
// CONTECS — Acceso (index.html y panel/index.html)
// =============================================
// Tres formas de entrar, todas a la vista: correo y contraseña (las cuentas
// compartidas de POSPER y de Voluntarios, que no son de Google), Google y
// Microsoft (UTP). Las dos páginas de acceso usan este mismo módulo; solo
// cambia la ruta del dashboard.

import { loginConGoogle, loginConSSO, loginConCorreo, guardRoute } from "./auth.js";

const MENSAJES_CORREO = {
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/invalid-login-credentials": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/user-not-found": "Correo o contraseña incorrectos.",
  "auth/invalid-email": "Ese correo no es válido.",
  "auth/user-disabled": "Esta cuenta está desactivada.",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos e intenta de nuevo.",
  "auth/network-request-failed": "Sin conexión. Revisa el internet del equipo.",
  "auth/operation-not-allowed": "El acceso con correo no está activado en Firebase (Authentication → Sign-in method → Correo electrónico/contraseña).",
};

const el = id => document.getElementById(id);

/** @param {{ destino: string }} o  ruta del dashboard desde la página */
export function iniciarLogin({ destino }) {
  guardRoute();

  const msgError = el("msg-error");
  const msgAviso = el("msg-aviso");
  const ocultarMensajes = () => {
    msgError.classList.remove("show");
    msgAviso.classList.remove("show");
  };
  const error = texto => {
    msgError.textContent = texto;
    msgError.classList.add("show");
  };

  // Cuenta recién creada sin rol: se queda aquí y entra sola cuando el CEO
  // la active.
  async function esperarRol() {
    msgAviso.textContent = "Tu cuenta fue registrada. Aún no tienes un rol asignado: cuando el administrador te active, entrarás automáticamente.";
    msgAviso.classList.add("show");
    const uid = sessionStorage.getItem("uid");
    if (!uid) return;
    const { db } = await import("./firebase-config.js");
    const { doc, onSnapshot } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
    onSnapshot(doc(db, "usuarios", uid), snap => {
      if (!snap.exists()) return;
      const nuevoRol = snap.data().rol || "sin_rol";
      if (nuevoRol !== "sin_rol") {
        sessionStorage.setItem("rol", nuevoRol);
        window.location.href = destino;
      }
    });
  }

  async function entrar(boton, etiqueta, accion) {
    const texto = boton.querySelector("[data-etiqueta]") || boton;
    boton.disabled = true;
    texto.textContent = "Conectando...";
    ocultarMensajes();
    try {
      await accion();
      if (sessionStorage.getItem("rol") === "sin_rol") {
        await esperarRol();
        return;
      }
      window.location.href = destino;
    } finally {
      boton.disabled = false;
      texto.textContent = etiqueta;
    }
  }

  // ── Correo y contraseña ──
  const form = el("form-correo");
  const botonEntrar = el("btn-entrar");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const correo = form.correo.value.trim();
    const clave = form.clave.value;
    if (!correo || !clave) {
      error("Escribe tu correo y tu contraseña.");
      (correo ? form.clave : form.correo).focus();
      return;
    }
    try {
      await entrar(botonEntrar, "Entrar", () => loginConCorreo(correo, clave));
    } catch (e) {
      error(MENSAJES_CORREO[e.code] || "No se pudo iniciar sesión. Intenta de nuevo.");
    }
  });

  el("ver-clave").addEventListener("click", () => {
    const visible = form.clave.type === "text";
    form.clave.type = visible ? "password" : "text";
    el("ver-clave").setAttribute("aria-pressed", String(!visible));
    el("ver-clave").setAttribute("aria-label", visible ? "Mostrar contraseña" : "Ocultar contraseña");
  });

  // ── Google ──
  const btnGoogle = el("btn-google");
  btnGoogle.addEventListener("click", async () => {
    try {
      await entrar(btnGoogle, "Google", loginConGoogle);
    } catch (e) {
      if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
      if (e.code === "auth/popup-blocked") {
        error("El navegador bloqueó la ventana emergente. Permite popups para este sitio e intenta de nuevo.");
      } else if (e.code === "auth/unauthorized-domain") {
        error("Firebase no tiene autorizado este dominio. Agrega este sitio en Firebase Console > Authentication > Settings > Authorized domains.");
      } else {
        error("Error al iniciar sesión. Intenta de nuevo.");
      }
    }
  });

  // ── Microsoft (UTP) ──
  const btnMicrosoft = el("btn-microsoft");
  btnMicrosoft.addEventListener("click", () => {
    btnMicrosoft.disabled = true;
    btnMicrosoft.querySelector("[data-etiqueta]").textContent = "Conectando...";
    loginConSSO();
  });
}
