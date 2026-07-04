import { db } from "../core/firebase-config.js";
import {
  collection, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { formatearDuracion } from "./reuniones-utils.js";

const el = id => document.getElementById(id);

function fmtFechaHora(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("es-PA", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    + " · " + d.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" });
}

function etiquetaInvitados(reunion) {
  if (reunion.modoInvitados === "todos") return "👥 Todos";
  if (reunion.modoInvitados === "rol") return `👥 ${(reunion.invitadosRoles || []).length} rol(es)`;
  if (reunion.modoInvitados === "individual") return `👤 ${(reunion.invitadosUids || []).length} invitado(s)`;
  return "—";
}

function render(reuniones) {
  const cont = el("lista-reuniones");
  if (reuniones.length === 0) {
    cont.innerHTML = `<div class="sin-reuniones">No hay reuniones agendadas todavía.</div>`;
    return;
  }
  cont.innerHTML = reuniones.map(r => {
    const tieneMinuta = !!(r.minuta?.contenidoMarkdown || "").trim();
    const asistentes = Object.keys(r.asistencia || {}).length;
    return `
      <a class="reunion-card" href="minutaReunion.html?id=${r.id}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
          <div class="reunion-titulo">${r.titulo || "Sin título"}</div>
          <span class="badge-minuta ${tieneMinuta ? "badge-lista" : "badge-vacia"}">${tieneMinuta ? "Minuta guardada" : "Sin minuta"}</span>
        </div>
        <div class="reunion-meta">
          <span>🗓️ ${fmtFechaHora(r.fechaInicio)}</span>
          <span>⏱️ ${formatearDuracion(r.fechaInicio, r.fechaFin)}</span>
          <span>📍 ${r.esVirtual ? "Virtual" : (r.lugar || "—")}</span>
          <span>${etiquetaInvitados(r)}</span>
          <span>✅ ${asistentes} asistente(s)</span>
        </div>
      </a>
    `;
  }).join("");
}

onSnapshot(
  query(collection(db, "reuniones"), orderBy("fechaInicio", "desc")),
  (snap) => {
    const reuniones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render(reuniones);
  },
  (error) => {
    console.error(error);
    el("lista-reuniones").innerHTML = `<div class="sin-reuniones">No se pudieron cargar las reuniones.</div>`;
  }
);
