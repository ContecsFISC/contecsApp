import { db } from "../core/firebase-config.js";
import {
  collection, addDoc, getDocs, getDoc, doc, updateDoc, Timestamp, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getUsuarioActual } from "../core/auth.js";
import { ROLES } from "../core/permisos.js";

const el = id => document.getElementById(id);
const usuario = getUsuarioActual();
const reunionId = new URLSearchParams(window.location.search).get("id");
const esEdicion = !!reunionId;

let reunionExistente = null;

function mostrarAlerta(tipo, mensaje) {
  const a = el("alerta-global");
  a.textContent = mensaje;
  a.className = `alerta alerta-${tipo} show`;
  setTimeout(() => a.classList.remove("show"), 5000);
}

function fechaInputStr(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().slice(0, 10);
}
function horaInputStr(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toTimeString().slice(0, 5);
}

// ── Render de roles disponibles (marca los ya invitados si se está editando) ──
function renderRoles(rolesMarcados = []) {
  el("grid-roles").innerHTML = Object.entries(ROLES).map(([clave, info]) => `
    <label class="check-item">
      <input type="checkbox" name="rolInvitado" value="${clave}" ${rolesMarcados.includes(clave) ? "checked" : ""}/> ${info.label}
    </label>
  `).join("");
}

// ── Carga de usuarios para invitación individual (marca los ya invitados) ─────
async function cargarUsuarios(uidsMarcados = []) {
  try {
    const snap = await getDocs(collection(db, "usuarios"));
    const usuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (usuarios.length === 0) {
      el("grid-usuarios").innerHTML = `<span style="color:var(--gris-medio);font-size:13px;">No hay usuarios registrados.</span>`;
      return;
    }
    el("grid-usuarios").innerHTML = usuarios.map(u => `
      <label class="check-item usuario-item">
        <input type="checkbox" name="uidInvitado" value="${u.id}" ${uidsMarcados.includes(u.id) ? "checked" : ""}/>
        ${u.foto ? `<img src="${u.foto}" alt=""/>` : `<span class="avatar-fallback">${(u.nombre || "?").charAt(0).toUpperCase()}</span>`}
        ${u.nombre || u.email || "Sin nombre"}
      </label>
    `).join("");
  } catch (e) {
    console.error(e);
    el("grid-usuarios").innerHTML = `<span style="color:var(--rojo);font-size:13px;">Error al cargar usuarios.</span>`;
  }
}

// ── Toggle de bloques según modo de invitados ─────────────────────────────────
document.querySelectorAll('input[name="modoInvitados"]').forEach(radio => {
  radio.addEventListener("change", () => {
    el("bloque-rol").classList.toggle("activo", radio.value === "rol" && radio.checked);
    el("bloque-individual").classList.toggle("activo", radio.value === "individual" && radio.checked);
  });
});

// ── Toggle de campos de reunión virtual ───────────────────────────────────────
el("reu-es-virtual").addEventListener("change", function () {
  el("virtual-extra-fields").style.display = this.checked ? "block" : "none";
});

// ── Precargar datos si estamos editando una reunión existente ─────────────────
function prefillFormulario(r) {
  document.title = "CONTECS — Editar Reunión";
  el("pagina-titulo").textContent = "✏️ Editar Reunión";
  el("btn-agendar").textContent = "💾 Guardar cambios";
  el("link-cancelar").href = `minutaReunion.html?id=${r.id}`;

  el("reu-titulo").value = r.titulo || "";
  el("reu-agenda").value = r.agenda || "";
  el("reu-fecha-inicio").value = fechaInputStr(r.fechaInicio);
  el("reu-hora-inicio").value = horaInputStr(r.fechaInicio);
  el("reu-fecha-fin").value = fechaInputStr(r.fechaFin);
  el("reu-hora-fin").value = horaInputStr(r.fechaFin);
  el("reu-lugar").value = r.lugar || "";
  el("reu-es-virtual").checked = !!r.esVirtual;
  el("virtual-extra-fields").style.display = r.esVirtual ? "block" : "none";
  el("reu-link-virtual").value = r.linkVirtual || "";

  const radioModo = document.querySelector(`input[name="modoInvitados"][value="${r.modoInvitados || "todos"}"]`);
  if (radioModo) {
    radioModo.checked = true;
    radioModo.dispatchEvent(new Event("change"));
  }
}

async function init() {
  if (esEdicion) {
    try {
      const snap = await getDoc(doc(db, "reuniones", reunionId));
      if (!snap.exists()) {
        mostrarAlerta("error", "La reunión no existe.");
        setTimeout(() => { window.location.href = "minutas.html"; }, 1200);
        return;
      }
      reunionExistente = { id: snap.id, ...snap.data() };
    } catch (e) {
      console.error(e);
      mostrarAlerta("error", "Error al cargar la reunión.");
      return;
    }
  }

  renderRoles(reunionExistente?.invitadosRoles || []);
  await cargarUsuarios(reunionExistente?.invitadosUids || []);

  if (reunionExistente) prefillFormulario(reunionExistente);
}

// ── Guardar (crear o actualizar) ───────────────────────────────────────────────
el("btn-agendar").addEventListener("click", async () => {
  const btn = el("btn-agendar");
  const titulo = el("reu-titulo").value.trim();
  const agenda = el("reu-agenda").value.trim();
  const modoInvitados = document.querySelector('input[name="modoInvitados"]:checked').value;
  const invitadosRoles = [...document.querySelectorAll('input[name="rolInvitado"]:checked')].map(c => c.value);
  const invitadosUids = [...document.querySelectorAll('input[name="uidInvitado"]:checked')].map(c => c.value);
  const fechaInicioStr = el("reu-fecha-inicio").value;
  const horaInicioStr = el("reu-hora-inicio").value;
  const fechaFinStr = el("reu-fecha-fin").value;
  const horaFinStr = el("reu-hora-fin").value;
  const lugar = el("reu-lugar").value.trim();
  const esVirtual = el("reu-es-virtual").checked;
  const linkVirtual = el("reu-link-virtual").value.trim();

  if (!titulo) { mostrarAlerta("error", "El título de la reunión es requerido."); return; }
  if (modoInvitados === "rol" && invitadosRoles.length === 0) { mostrarAlerta("error", "Selecciona al menos un rol invitado."); return; }
  if (modoInvitados === "individual" && invitadosUids.length === 0) { mostrarAlerta("error", "Selecciona al menos un usuario invitado."); return; }
  if (!fechaInicioStr || !horaInicioStr) { mostrarAlerta("error", "La fecha y hora de inicio son requeridas."); return; }
  if (!fechaFinStr || !horaFinStr) { mostrarAlerta("error", "La fecha y hora de fin son requeridas."); return; }
  if (esVirtual && !linkVirtual) { mostrarAlerta("error", "Ingresa el link de la reunión virtual."); return; }

  const dtInicio = new Date(`${fechaInicioStr}T${horaInicioStr}`);
  const dtFin = new Date(`${fechaFinStr}T${horaFinStr}`);
  if (dtFin <= dtInicio) { mostrarAlerta("error", "La fecha/hora de fin debe ser posterior a la de inicio."); return; }

  const datos = {
    titulo,
    agenda,
    fechaInicio: Timestamp.fromDate(dtInicio),
    fechaFin: Timestamp.fromDate(dtFin),
    lugar,
    esVirtual,
    linkVirtual: esVirtual ? linkVirtual : "",
    modoInvitados,
    invitadosRoles,
    invitadosUids,
    actualizadoEn: serverTimestamp(),
  };

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = esEdicion ? "Guardando..." : "Agendando...";

  try {
    if (esEdicion) {
      await updateDoc(doc(db, "reuniones", reunionId), datos);
      mostrarAlerta("success", "Reunión actualizada correctamente.");
      setTimeout(() => { window.location.href = `minutaReunion.html?id=${reunionId}`; }, 900);
    } else {
      await addDoc(collection(db, "reuniones"), {
        ...datos,
        asistencia: {},
        minuta: {
          contenidoMarkdown: "",
          actualizadoEn: null,
          actualizadoPorUid: "",
          actualizadoPorNombre: "",
        },
        creadoPorUid: usuario.uid,
        creadoPorNombre: usuario.nombre,
        creadoEn: serverTimestamp(),
      });
      mostrarAlerta("success", "Reunión agendada correctamente.");
      setTimeout(() => { window.location.href = "minutas.html"; }, 900);
    }
  } catch (e) {
    console.error(e);
    mostrarAlerta("error", esEdicion ? "Error al guardar los cambios. Intenta de nuevo." : "Error al agendar la reunión. Intenta de nuevo.");
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
});

init();
