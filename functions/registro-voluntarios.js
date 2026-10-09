"use strict";

// Registro público de voluntarios (public/registro-voluntarios.html). No da
// acceso al panel ni envía correos ni QR: solo deja al voluntario en
// `voluntarios` con los datos normalizados, para sus credenciales y su
// asignación a turnos. Todos entran como "voluntario"; el comité organizador
// se marca después en el panel.
//
// La cédula es lo que lleva su QR (Lectura QR de voluntarios marca horas con
// ella), así que se normaliza y no puede repetirse: un documento-candado en
// identificadores_voluntarios/{cédula} lo garantiza dentro de la transacción.
// El correo tampoco puede repetirse: correos_voluntarios/{sha256(correo)} hace
// lo mismo (el hash porque un correo puede tener caracteres que no valen en un
// ID de documento).

const crypto = require("node:crypto");
const {HttpsError} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

const db = getFirestore();

const HORARIOS = new Set(["Diurno", "Vespertino", "Nocturno"]);
const ANIOS = new Set(["1", "2", "3", "4", "5", "Egresado"]);
const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// "8 - 888 - 8888", "pe-12-345", "8-av-12-345" -> "8-888-8888", "PE-12-345"...
// Sin guiones se toma como pasaporte (letras y números).
function normalizarCedula(texto) {
  // Guiones raros de teclados y móviles; espacios entre partes = guiones.
  const t = String(texto || "").toUpperCase()
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .trim()
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  if (/^(?:\d{1,2}|PE|E|N)(?:-(?:AV|PI))?-\d{1,4}-\d{1,6}$/.test(t)) return {ok: true, valor: t, tipo: "cedula"};
  const pasaporte = t.replace(/-/g, "");
  if (/^[A-Z0-9]{5,20}$/.test(pasaporte) && /\d/.test(pasaporte)) return {ok: true, valor: pasaporte, tipo: "pasaporte"};
  return {ok: false, valor: t};
}

const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y", "da", "van", "von"]);
// "MARÍA JOSÉ de la cruz" -> "María José de la Cruz".
function nombrePropio(texto) {
  return String(texto || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es")
      .split(" ").map((p, i) => (i > 0 && PARTICULAS.has(p) ? p : p.charAt(0).toLocaleUpperCase("es") + p.slice(1)))
      .join(" ");
}

function texto(valor, campo, {requerido = false, max = 200} = {}) {
  const t = typeof valor === "string" ? valor.trim().replace(/[ \t]+/g, " ") : "";
  if (requerido && !t) throw new HttpsError("invalid-argument", `El campo ${campo} es obligatorio.`);
  if (t.length > max) throw new HttpsError("invalid-argument", `El campo ${campo} es demasiado largo.`);
  const control = [...t].some((c) => {
    const n = c.charCodeAt(0);
    return n === 127 || (n < 32 && n !== 10 && n !== 13);
  });
  if (/[<>]/.test(t) || control) throw new HttpsError("invalid-argument", `El campo ${campo} contiene caracteres no permitidos.`);
  return t;
}

// Valida y deja los datos como se guardan. Exportada para las pruebas.
function normalizarVoluntario(data = {}) {
  const ced = normalizarCedula(texto(data.cedula, "cédula", {requerido: true, max: 30}));
  if (!ced.ok) {
    throw new HttpsError("invalid-argument", "La cédula no tiene un formato válido (ej.: 8-888-8888, PE-12-345, E-8-12345) ni parece un pasaporte.");
  }
  const correo = texto(data.correo, "correo", {requerido: true, max: 254}).toLowerCase();
  if (!RE_CORREO.test(correo)) throw new HttpsError("invalid-argument", "Ingresa un correo válido.");
  const telefono = texto(data.telefono, "teléfono", {requerido: true, max: 30});
  if ((telefono.match(/\d/g) || []).length < 7) throw new HttpsError("invalid-argument", "Ingresa un teléfono válido.");
  const horario = texto(data.horario, "horario", {requerido: true, max: 20});
  if (!HORARIOS.has(horario)) throw new HttpsError("invalid-argument", "Elige tu horario de clases de este semestre.");
  const anio = texto(data.anio, "año", {requerido: true, max: 10});
  if (!ANIOS.has(anio)) throw new HttpsError("invalid-argument", "Elige el año que cursas.");
  if (data.aceptaDatos !== true) {
    throw new HttpsError("invalid-argument", "Debes aceptar el uso de tus datos para el voluntariado.");
  }
  return {
    nombre: nombrePropio(texto(data.nombre, "nombre", {requerido: true, max: 100})),
    apellido: nombrePropio(texto(data.apellido, "apellido", {requerido: true, max: 100})),
    id: ced.valor,
    tipoDocumento: ced.tipo,
    correo,
    telefono: telefono.replace(/[^\d+]/g, "").replace(/^(\d{4})(\d{4})$/, "$1-$2"),
    centro: texto(data.centro, "centro regional", {requerido: true, max: 120}),
    facultad: texto(data.facultad, "facultad", {requerido: true, max: 150}),
    carrera: texto(data.carrera, "carrera", {requerido: true, max: 150}),
    anio,
    horario,
    habilidad: texto(data.habilidad, "habilidad", {max: 300}),
    experiencia: texto(data.experiencia, "experiencia", {max: 1000}),
    motivacion: texto(data.motivacion, "motivación", {max: 1000}),
  };
}

async function registrarVoluntario(request, {aplicarLimite}) {
  const datos = normalizarVoluntario(request.data || {});
  await aplicarLimite(request);
  const lockRef = db.collection("identificadores_voluntarios").doc(datos.id);
  const correoRef = db.collection("correos_voluntarios")
      .doc(crypto.createHash("sha256").update(datos.correo).digest("hex"));
  const volRef = db.collection("voluntarios").doc();
  await db.runTransaction(async (tx) => {
    const [lock, existentes, lockCorreo, mismoCorreo] = await Promise.all([
      tx.get(lockRef),
      // Voluntarios importados antes del registro no tienen candado.
      tx.get(db.collection("voluntarios").where("id", "==", datos.id).limit(1)),
      tx.get(correoRef),
      tx.get(db.collection("voluntarios").where("correo", "==", datos.correo).limit(1)),
    ]);
    if (lock.exists || !existentes.empty) {
      throw new HttpsError("already-exists",
          "Esta cédula ya está registrada como voluntario. Si necesitas corregir tus datos, escríbele al comité de voluntariado.");
    }
    if (lockCorreo.exists || !mismoCorreo.empty) {
      throw new HttpsError("already-exists",
          "Este correo ya está registrado como voluntario. Si necesitas corregir tus datos, escríbele al comité de voluntariado.");
    }
    tx.set(lockRef, {voluntarioId: volRef.id, creadoEn: FieldValue.serverTimestamp()});
    tx.set(correoRef, {voluntarioId: volRef.id, creadoEn: FieldValue.serverTimestamp()});
    tx.set(volRef, {
      ...datos,
      grupo: "voluntario",
      totalHoras: 0,
      origen: "registro",
      creadoEn: FieldValue.serverTimestamp(),
    });
  });
  console.log("registrarVoluntario:", volRef.id, datos.id);
  return {ok: true, nombre: datos.nombre};
}

module.exports = {registrarVoluntario, normalizarVoluntario, normalizarCedula, nombrePropio};
