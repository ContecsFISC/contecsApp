// =============================================
// CONTECS — Quién lleva credencial (módulo Credenciales)
// =============================================
// Convierte participantes, voluntarios y checkpoints en "personas" que el
// motor de dibujo (credenciales.js) sabe imprimir. Sin Firebase ni DOM, para
// probarlo con el código real (functions/test/credenciales-personas.test.mjs).
//
// Cada persona trae:
//   _clave  id estable para la selección y el historial de impresión
//   _tipo   participante | voluntario | comite | expositor
//   _sub    texto corto para la lista
//   _buscar texto normalizado para el buscador
//   cred    (todas menos participante) QR, código, etiqueta y tema de color

import { textoQr, tieneCredencial, categoriaDe, nombreDe } from "./credenciales.js";

export const TIPOS = {
  participante: { nombre: "Participantes", singular: "Participante", color: "#00722e" },
  voluntario: { nombre: "Voluntarios", singular: "Voluntario", color: "#00897b" },
  comite: { nombre: "Comité organizador", singular: "Comité organizador", color: "#6a2c91" },
  expositor: { nombre: "Expositores", singular: "Expositor", color: "#1565c0" },
};

export const normalizar = texto => String(texto || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();

const slug = texto => normalizar(texto).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);

const nombreVol = v => [v.nombre, v.apellido].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || v.id || "Voluntario";

// ── Participantes ──────────────────────────────────────────────────────────
// Tal cual: el motor ya sabe dibujarlos. Solo se marca si pueden llevar QR.
export function personaParticipante(p) {
  return {
    ...p,
    _clave: `participante_${p.id}`,
    _tipo: "participante",
    _sub: [p.codigo, categoriaDe(p)].filter(Boolean).join(" · "),
    _buscar: normalizar([nombreDe(p), p.cedula, p.codigo, p.correo].join(" ")),
    _imprimible: tieneCredencial(p),
    _aprobado: p.pago?.estado === "aprobado",
  };
}

// ── Voluntarios y comité organizador ───────────────────────────────────────
// El QR es la cédula (campo `id`): lo que lee Lectura QR de voluntarios para
// marcar horas, así que el comité organizador también registra las suyas.
// La clave usa el documento, no el grupo: si alguien pasa de voluntario a
// comité, conserva su historial de impresión.
export function personaVoluntario(v) {
  const comite = v.grupo === "comite";
  const cedula = String(v.id || "").trim();
  return {
    nombre: v.nombre || "", apellido: v.apellido || "",
    nombreCompleto: nombreVol(v),
    cedula: "", // ya va en la etiqueta bajo el QR
    cred: {
      tema: comite ? "comite" : "voluntario",
      qr: cedula,
      codigo: cedula,
      etiqueta: comite ? "Comité organizador" : "Voluntario",
      cabecera: comite ? "COMITÉ ORGANIZADOR" : "VOLUNTARIADO",
      institucion: v.carrera || "",
      titulo: comite ? "Comité Organizador" : "¡Gracias por tu apoyo!",
      subtitulo: "Presenta este QR para registrar tus horas de voluntariado",
    },
    _clave: `voluntario_${v._docId || v.docId || cedula}`,
    _tipo: comite ? "comite" : "voluntario",
    _sub: [cedula, v.carrera, v.horario].filter(Boolean).join(" · "),
    _buscar: normalizar([nombreVol(v), cedula, v.correo, v.carrera].join(" ")),
    _imprimible: !!cedula,
    _aviso: cedula ? "" : "Sin cédula: no tiene QR",
  };
}

// ── Expositores ────────────────────────────────────────────────────────────
// Dos fuentes:
//   - participantes que exponen (marcaron ponencia en el registro o están
//     elegidos como ponente en un checkpoint): su QR sigue siendo el de
//     acceso al congreso;
//   - nombres escritos a mano en el checkpoint (exponente sin inscripción):
//     van sin QR, con lo que exponen en su lugar.
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function diaCorto(dia) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia || "");
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}

export function lineaCharla(cp) {
  const cuando = [diaCorto(cp.dia), cp.horaInicio].filter(Boolean).join(", ");
  return [cp.nombre || "Actividad", cuando].filter(Boolean).join(" — ");
}

const ordenCharla = (a, b) => `${a.dia || ""} ${a.horaInicio || ""}`.localeCompare(`${b.dia || ""} ${b.horaInicio || ""}`);
const operativo = cp => cp && cp.estado !== "cancelado" && cp.activo !== false;

export function personasExpositores({ participantes = [], checkpoints = [] }) {
  const charlas = checkpoints.filter(operativo).sort(ordenCharla);
  const porId = new Map(participantes.map(p => [p.id, p]));
  const charlasDe = new Map(); // participanteId -> checkpoints
  const externos = new Map(); // nombre normalizado -> { nombre, charlas }

  charlas.forEach(cp => {
    if (cp.ponenteId && porId.has(cp.ponenteId)) {
      if (!charlasDe.has(cp.ponenteId)) charlasDe.set(cp.ponenteId, []);
      charlasDe.get(cp.ponenteId).push(cp);
    } else if (String(cp.exponente || "").trim()) {
      const nombre = String(cp.exponente).replace(/\s+/g, " ").trim();
      const k = normalizar(nombre);
      if (!externos.has(k)) externos.set(k, { nombre, charlas: [] });
      externos.get(k).charlas.push(cp);
    }
  });

  // Un nombre escrito a mano que coincide con un inscrito que expone se le
  // suma a ese inscrito en vez de salir como otra persona.
  const expone = p => p.camposExtra?.ponencia === "si" || charlasDe.has(p.id);
  const inscritoPorNombre = new Map(participantes.filter(expone).map(p => [normalizar(nombreDe(p)), p.id]));
  externos.forEach((e, k) => {
    const id = inscritoPorNombre.get(k);
    if (!id) return;
    if (!charlasDe.has(id)) charlasDe.set(id, []);
    charlasDe.get(id).push(...e.charlas);
    charlasDe.get(id).sort(ordenCharla);
    externos.delete(k);
  });

  const inscritos = participantes
    .filter(expone)
    .map(p => {
      const suyas = charlasDe.get(p.id) || [];
      const conQr = tieneCredencial(p);
      return {
        ...p,
        cred: {
          tema: "expositor",
          qr: conQr ? textoQr(p) : "",
          codigo: p.codigo || "",
          etiqueta: "Expositor",
          cabecera: "EXPOSITOR",
          titulo: "¡Gracias por compartir!",
          subtitulo: conQr ? "Este QR también es tu acceso al Congreso" : "",
          detalleTitulo: "Expone",
          detalle: suyas.map(lineaCharla),
        },
        _clave: `expositor_${p.id}`,
        _tipo: "expositor",
        _sub: [p.codigo, suyas.length ? `${suyas.length} actividad${suyas.length !== 1 ? "es" : ""}` : "Ponencia en el registro"].filter(Boolean).join(" · "),
        _buscar: normalizar([nombreDe(p), p.cedula, p.codigo, ...suyas.map(c => c.nombre)].join(" ")),
        _imprimible: true,
        _origen: "inscrito",
      };
    });

  const sinInscripcion = [...externos.values()]
    .map(e => ({
      nombreCompleto: e.nombre,
      cedula: "",
      cred: {
        tema: "expositor",
        qr: "",
        codigo: "",
        etiqueta: "Expositor",
        cabecera: "EXPOSITOR",
        institucion: "",
        titulo: "¡Gracias por compartir!",
        subtitulo: "",
        detalleTitulo: "Expone",
        detalle: e.charlas.map(lineaCharla),
      },
      _clave: `expositor_ext_${slug(e.nombre)}`,
      _tipo: "expositor",
      _sub: `${e.charlas.length} actividad${e.charlas.length !== 1 ? "es" : ""} · sin inscripción (sin QR)`,
      _buscar: normalizar([e.nombre, ...e.charlas.map(c => c.nombre)].join(" ")),
      _imprimible: true,
      _origen: "externo",
    }));

  return [...inscritos, ...sinInscripcion]
    .sort((a, b) => nombreDe(a).localeCompare(nombreDe(b), "es"));
}

// ── Historial de impresión ─────────────────────────────────────────────────
// credenciales_impresas/{_clave}: cuántas veces y cuándo se imprimió.
export function estadoImpresion(persona, impresas) {
  const r = impresas.get(persona._clave);
  return r ? { impresa: true, veces: r.veces || 1, ultima: r.ultimaEn || null } : { impresa: false, veces: 0, ultima: null };
}
