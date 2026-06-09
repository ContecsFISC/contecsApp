# CONTECS — Cambios Recientes (Sprint 3)

**Período:** 29 mayo – 7 junio 2026  
**Proyecto Firebase activo:** `contecs-fa6e6`  
**Rama principal:** `main`  
**Desarrolladores:** Maria Goods · Alpha Vilchez · Mateo Del Giudice

---

## Resumen ejecutivo

| Concepto | Valor |
|----------|-------|
| Archivos nuevos creados | 14 |
| Archivos modificados | 24 |
| Commits realizados | 19 |
| Pull requests mergeados | 1 (PR #4 — fix seguridad IDOR) |
| Colecciones Firestore nuevas | 3 |
| Cloud Functions desplegadas | 1 (`participantes-api`) |
| Cambios documentados en este sprint | 35 |

---

## 1. Autenticación — Login con Microsoft

**Archivos:** `index.html`, `js/core/auth.js`  
**Fecha:** 29–31 mayo 2026  
**Autora:** Maria Goods

### Qué se cambió
- Se agregó el proveedor `OAuthProvider("microsoft.com")` en `auth.js`.
- Se exportó la nueva función `loginConMicrosoft()`.
- Se añadió un botón "Continuar con Microsoft" en la pantalla de login con logo SVG oficial.
- Ambos botones (Google y Microsoft) comparten la misma función `manejarLogin()`.

### Por qué se hizo
La organización usa cuentas institucionales `@utp.ac.pa` de Microsoft 365. Permitir login con Microsoft elimina la necesidad de que los miembros tengan que recordar otro correo; inician sesión con su cuenta universitaria directamente.

---

## 2. Módulo Ventas 2 (`ventas2`)

**Archivos:** `js/modulos/ventas2.js`, `modulos/ventas2.html`  
**Fecha:** 31 mayo 2026  
**Autora:** Maria Goods

### Qué se cambió
- Se creó `js/modulos/ventas2.js` (874 líneas) como reescritura mejorada del módulo de ventas.
- El campo `lineaResumen` (tarjeta principal del carrito) ahora muestra únicamente `utilidadVenta`, excluyendo las pérdidas por merma.
- Las mermas se muestran en sus propias tarjetas rojas separadas, evitando confusión visual.

### Por qué se hizo
En la versión anterior, la tarjeta verde de resumen podía mostrar "Pérdida estimada" mezclando ventas y mermas en un solo número, lo que era confuso para los vendedores. La separación visual hace el resumen más claro durante el proceso de venta.

---

## 3. Bitácora — Panel de resumen de fondos

**Archivos:** `modulos/bitacora.html`  
**Fecha:** 31 mayo 2026  
**Autora:** Maria Goods

### Qué se cambió
- Se añadieron 4 tarjetas de resumen encima del historial en el tab de Fondos:
  - **Total de compras**: suma de `fondos_entrada` con `origen === "compra"`.
  - **Total de ventas**: suma de `fondos_entrada` con `origen === "venta"`.
  - **Ganancia de ventas realizada**: suma de `utilidadTotal` de la colección `ventas`.
  - **Ganancia en stock por vender**: `∑ (precioVenta − costo) × stock` de productos activos.
- El chip de resumen de venta ahora dice **"Pérdida total"** (rojo) o **"Ganancia total"** (verde) según el signo de `utilidadTotal`.

### Por qué se hizo
El tab de Fondos solo mostraba un listado de movimientos sin contexto financiero global. Las tarjetas permiten ver el estado financiero de la organización de un vistazo sin necesidad de sumar manualmente. El label dinámico evita mostrar "Ganancia total: -$12" que es contradictorio.

---

## 4. Dashboard — Módulos ocultos según permiso

**Archivos:** `dashboard.html`  
**Fecha:** 31 mayo 2026  
**Autora:** Maria Goods

### Qué se cambió
- Los módulos del panel principal que el usuario no tiene permiso de ver ahora **no se renderizan** en absoluto.
- Antes: aparecían visibles pero en gris con candado.
- Después: `MODULOS.filter(mod => tienePermiso(rol, mod.permiso))` — solo muestra los módulos accesibles.

### Por qué se hizo
Mostrar módulos bloqueados en gris generaba confusión: los usuarios preguntaban por qué existía un acceso que no podían usar. Ocultarlos directamente limpia la interfaz y reduce preguntas de soporte.

---

## 5. Correcciones de bugs (mayo 2026)

**Archivos:** `js/core/operaciones.js`, `modulos/catalogo.html`, `js/modulos/ventas2.js`  
**Fecha:** 29–31 mayo 2026  
**Autora:** Maria Goods

| Bug | Archivo | Solución |
|-----|---------|----------|
| Función `resumenItemPrincipal` declarada dos veces (línea 96 privada + línea 197 exportada) | `operaciones.js` | Se eliminó la declaración duplicada privada |
| Import incorrecto `"./js/catalogo.js"` que causaba error 404 | `catalogo.html` línea 441 | Corregido a `"../js/modulos/catalogo.js"` |
| `ventas2.js` existía en la raíz con imports rotos | raíz → `js/modulos/` | Movido a la carpeta correcta con imports actualizados a `../core/` |

---

## 6. Módulo de Participantes, Perfil y Registro

**Archivos:** `modulos/modulos_participantes.html`, `modulos/perfil.html`, `modulos/registro.html`, `perfil.html`, `registro.html`, `js/core/permisos.js`  
**Fecha:** 3 junio 2026  
**Autor:** Alpha Vilchez

### Qué se cambió
- Se creó `modulos/modulos_participantes.html` (786 líneas): vista completa de gestión de participantes inscritos en eventos.
- Se creó `modulos/perfil.html` (755 líneas): página de perfil del usuario con edición de datos personales.
- Se creó `modulos/registro.html` (1148 líneas): formulario completo de inscripción de participantes externos.
- Se reescribió `js/core/permisos.js` con roles y permisos expandidos para cubrir los nuevos módulos.

### Por qué se hizo
El sistema necesitaba un flujo completo para que participantes externos (no miembros del CONTECS) pudieran inscribirse a eventos y que los organizadores pudieran gestionar esas inscripciones desde el panel interno.

---

## 7. Fix de seguridad IDOR en inscripciones (PR #4)

**Archivos:** `firebase_rules/firestore.rules`, `firebase_rules/storage.rules`, `firebase_rules/firebase.json`, `firebase_rules/firestore.indexes.json`, `js/core/participantes-api.js`, `index.js`, `js/core/firebase-config.js`, `modulos/perfil.html`, `modulos/registro.html`  
**Fecha:** 3–5 junio 2026  
**Autor:** Mateo Del Giudice  
**Merge:** PR #4 → `main` el 5 junio 2026

### Qué se cambió

#### Cloud Function `participantes-api`
- Se creó `index.js` (300 líneas) con una Cloud Function HTTP que actúa como intermediario seguro para:
  - Leer datos de participantes (`GET /participantes`).
  - Registrar nuevos participantes (`POST /registro`).
- La función usa el Firebase Admin SDK, evitando que el cliente tenga acceso directo a Firestore.

#### Capa de acceso `participantes-api.js`
- Se creó `js/core/participantes-api.js` (52 líneas) como wrapper del cliente para llamar a la Cloud Function en lugar de consultar Firestore directamente.

#### Reglas de Firestore y Storage
- Se agregó `firebase_rules/firestore.rules` con reglas de seguridad completas para todas las colecciones, incluyendo:
  - `participantes`: solo staff puede leer/escribir.
  - `contadores`: solo Admin SDK (bloqueado en reglas).
  - Nuevas colecciones: `giras_voluntarios`, `asignaciones_voluntarios`, `actividades_ventas`.
- Se agregó `firebase_rules/storage.rules` con reglas para la carpeta de facturas de compras.

#### Módulos de registro y perfil
- `modulos/registro.html` y `modulos/perfil.html`: reemplazadas las consultas directas a Firestore por llamadas a `participantes-api.js`.
- Se mejoró el manejo de errores y se eliminaron queries que exponían datos de otros participantes.

### Por qué se hizo
Se identificó una vulnerabilidad IDOR (Insecure Direct Object Reference): cualquier usuario autenticado podía consultar el documento de cualquier participante modificando el ID en la URL o en las consultas del cliente. La solución centraliza el acceso en una Cloud Function con validación de permisos del lado del servidor, eliminando el acceso directo del cliente a la colección `participantes`.

---

## 8. Módulo de Voluntarios — Nuevas funcionalidades

**Archivos:** `modulos/voluntarios.html`, `js/modulos/voluntarios.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

### 8.1 Botones de eliminar actividad y gira

- Se añadió el botón 🗑 en la tabla de actividades registradas (tab de Asistencia).
- Se añadió el botón 🗑 en la tabla de giras registradas.
- Las funciones `window.eliminarActividad()` y `window.eliminarGira()` eliminan el documento de Firestore tras confirmación del usuario.

**Por qué:** No había forma de eliminar registros incorrectos sin acceder directamente a la consola de Firebase. El botón de eliminación es necesario para el mantenimiento normal de datos.

### 8.2 Asignación de grupo de voluntarios

- Se añadió el botón **"Asignar grupo de voluntarios"** junto al botón individual de asignación.
- Se creó un modal con lista de voluntarios con checkboxes.
- Lógica de validación:
  - Si ya hay voluntarios asignados, muestra aviso: `"Ya hay N voluntarios asignados para [nombre]"`.
  - Deshabilita los checkboxes cuando se alcanza el límite de voluntarios requeridos (`voluntariosReq`).
  - Detecta y previene duplicados usando `getEstadoVoluntarios()` que separa: ya asignados a este evento vs. con conflicto de horario.

**Por qué:** Asignar voluntarios uno por uno para eventos grandes era lento. La asignación en grupo permite seleccionar múltiples voluntarios en una sola operación, respetando el cupo máximo del evento.

### 8.3 Bloqueo de asignación individual cuando el cupo está lleno

- El botón "Asignar voluntario" individual ahora valida el cupo antes de guardar.
- Si el evento ya tiene todos los voluntarios requeridos, muestra el mensaje: `"Ya hay suficientes voluntarios en esta [actividad/gira/venta]"`.

**Por qué:** Sin esta validación, se podían asignar más voluntarios de los necesarios, generando confusión logística.

### 8.4 Notificaciones toast siempre visibles

- Se reemplazaron las alertas estáticas por notificaciones toast de posición fija (`position: fixed; top: 20px; right: 20px`).
- Se crean dinámicamente y se eliminan automáticamente tras la duración configurada.
- El color del toast varía según el tipo: verde (success), rojo (error), amarillo (warning).

**Por qué:** Las alertas anteriores se mostraban en la parte superior de la página. Si el usuario estaba con scroll hacia abajo (p. ej., revisando la tabla), no veía la confirmación ni el error. Los toasts fijos se ven independientemente del scroll.

### 8.5 Reemplazo de "Actividad Activa" por enlace al Calendario

- Se eliminó la sección "ACTIVIDAD ACTIVA" del módulo de voluntarios.
- Se reemplazó por un botón/enlace **"Ver calendario"** que dirige a `calendario.html`.

**Por qué:** La sección de "Actividad Activa" mostraba solo una actividad a la vez y requería mantenimiento manual. El calendario centraliza todas las actividades, giras y ventas en una vista mensual más útil.

---

## 9. Nuevo módulo: Actividad Ventas

**Archivos creados:** `modulos/actividadVentas.html`, `js/modulos/actividadVentas.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

### Qué se cambió
- Se creó un módulo completo para gestionar las actividades de ventas de CONTECS (ferias, ventas en campus, eventos externos).
- Funcionalidades incluidas:
  - Registro de ventas con: nombre, descripción, fecha, tipo, lugar, voluntarios requeridos, colaboración y turnos.
  - Campo **Responsables** como combobox con lista de usuarios del sistema + chips visuales (con fallback a texto libre si el usuario no tiene permiso de leer todos los usuarios).
  - Tab de listado con tabla completa, botones de editar, activar/desactivar y eliminar.
  - Exportación a Excel con `XLSX`.
  - Tarjetas de estadísticas: total de ventas, activas y voluntarios requeridos.

### Por qué se hizo
Anteriormente no existía un módulo específico para planificar y registrar las actividades de ventas de la organización. Los datos se manejaban fuera del sistema. Este módulo centraliza la planificación de ventas junto con los demás eventos (actividades y giras) de forma consistente.

---

## 10. Nuevo módulo: Calendario

**Archivos creados:** `modulos/calendario.html`, `js/modulos/calendario.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

### Qué se cambió
- Se creó una vista de calendario mensual que muestra actividades, giras y ventas en una grilla de 7 columnas.
- Funcionalidades:
  - Navegación por mes (anterior / siguiente).
  - Filtros por tipo: Todos / Actividades / Giras / Ventas.
  - Máximo 3 eventos visibles por celda; el resto muestra "+N más…" con clic para ver todos.
  - Modal de detalle al hacer clic en un evento.
  - Modal de "ver todos" al hacer clic en "+N más…".
  - Leyenda de colores (verde = actividad, amarillo = gira, rojo = venta).
  - El día actual se resalta con borde azul.

### Por qué se hizo
No había una vista unificada que permitiera ver en qué fechas estaban programados los distintos tipos de eventos. Los coordinadores tenían que revisar cada módulo por separado para saber si había solapamientos de fechas. El calendario centraliza todo en un vistazo.

---

## 11. Permisos nuevos en `permisos.js`

**Archivo:** `js/core/permisos.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

| Permiso | Roles autorizados | Motivo |
|---------|------------------|--------|
| `gestionar_ventas` | junta_principal, junta, ventas, logistica, ceo | Necesario para acceder al nuevo módulo `actividadVentas.html` |
| `gestionar_giras` | junta_principal, junta, giras, voluntariado, ceo | Necesario para gestionar giras dentro del módulo de voluntarios |

---

## 12. Reglas de Firestore — Colecciones nuevas

**Archivo:** `firebase_rules/firestore.rules`  
**Fecha:** 6 junio 2026

Se añadieron reglas para tres colecciones que no tenían cobertura, lo que impedía guardar datos:

| Colección | Quién puede leer | Quién puede escribir | Motivo |
|-----------|-----------------|---------------------|--------|
| `giras_voluntarios` | Todo staff | junta, voluntariado, giras, ceo | Almacena las giras creadas en el módulo de voluntarios |
| `asignaciones_voluntarios` | Todo staff | junta, voluntariado, ceo | Almacena qué voluntario está asignado a qué evento |
| `actividades_ventas` | Todo staff | junta, ventas, logistica, ceo | Almacena las actividades del nuevo módulo de ventas |

**Por qué:** Sin estas reglas, Firestore rechazaba todas las operaciones de escritura silenciosamente (error `permission-denied`), haciendo que los datos nunca se guardaran aunque el formulario indicaba éxito.

---

## 13. Colecciones Firestore nuevas

Las siguientes colecciones se crearon como parte de los módulos nuevos:

| Colección | Descripción | Campos principales |
|-----------|-------------|-------------------|
| `giras_voluntarios` | Giras planificadas por voluntariado | nombre, descripcion, fecha, lugar, voluntariosReq, turnos, activo, creadoPor |
| `asignaciones_voluntarios` | Registro de qué voluntario va a qué evento | voluntarioId, eventoId, eventoTipo, eventoNombre, fecha, turno, creadoEn |
| `actividades_ventas` | Actividades de venta planificadas | nombre, descripcion, fecha, tipo, lugar, voluntariosReq, responsables, turnos, colaboracion, activo |

---

## 14. Dashboard — Vínculo al Calendario

**Archivo:** `dashboard.html`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

- Se añadió un acceso directo al nuevo módulo de calendario desde el panel principal.
- El enlace aparece como tarjeta de módulo con ícono de calendario 📅.

**Por qué:** El calendario es un módulo de consulta frecuente para todos los roles. Tenerlo accesible desde el dashboard reduce los clics necesarios para llegar a él.

---

---

## 15. Ventas 2 — Vinculación a actividad de venta

**Archivos:** `modulos/ventas2.html`, `js/modulos/ventas2.js`, `js/core/operaciones.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

### Qué se cambió
- Se reemplazó el buscador de texto por un `<select id="sel-actividad">` que carga automáticamente todas las actividades de venta activas de la colección `actividades_ventas`.
- Debajo del combobox aparece una tarjeta informativa con: nombre, responsables, fecha, lugar y tipo de la actividad seleccionada.
- Seleccionar una actividad es **obligatorio** antes de registrar una venta. Si el carrito está listo pero no hay actividad seleccionada, el botón no avanza y muestra error.
- Los documentos generados en `ventas` y `mermas` ahora incluyen los campos `actividadVentaId` y `actividadVentaNombre`.
- La carga de actividades usa filtrado client-side (sin `where()` ni `orderBy()` en Firestore) para evitar requerir índices compuestos.

### Por qué se hizo
Cada venta necesita estar vinculada a una actividad de venta para saber quién fue el responsable, en qué fecha y lugar se realizó. Sin este vínculo, las ventas quedaban sin contexto logístico.

---

## 16. Calendario — Fixes de funcionalidad

**Archivos:** `modulos/calendario.html`, `js/modulos/calendario.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

### Qué se cambió

#### 16.1 Clicks en eventos no funcionaban
- Las funciones `verDetalle()` y `verDia()` eran locales a un módulo ES pero se llamaban como `onclick="verDetalle(...)"` en HTML generado dinámicamente, lo que no funciona en módulos ES.
- Se reemplazaron los atributos `onclick` inline por `data-id` y `data-tipo` en cada evento renderizado.
- Se añadió event delegation en el contenedor `cal-grid` y en `modal-detalle-contenido`.

#### 16.2 Filtro de ventas mostraba lista vacía
- Los documentos de `actividades_ventas` tienen su propio campo `tipo` (p. ej., `"Venta en la Facultad"`), que sobreescribía el valor `"venta"` asignado al mapear con `{ id, tipo: "venta", ...d.data() }`.
- Corregido poniendo `tipo` **después** del spread: `{ id, ...d.data(), tipo: "venta" }`.
- El mismo bug causaba `TypeError: Cannot read properties of undefined (reading 'bg')` en `verDetalle()`.

#### 16.3 Carga de colecciones con try/catch individual
- Se reemplazó el `Promise.all` único por una función helper `leerColeccion()` con try/catch por colección, evitando que una falla en una colección cancele todas las demás.

#### 16.4 Contador de voluntarios en modal de detalle
- El modal de detalle ahora muestra el conteo de voluntarios asignados vs requeridos: `"2 / 5"`.
- Color dinámico: verde si completo, ámbar si hay entre mitad y el total, rojo si hay menos de la mitad.
- Se muestra `"faltan N"` cuando no está completo.
- Se carga `asignaciones_voluntarios` junto con los demás eventos al inicializar.

### Por qué se hizo
- Los clicks no funcionaban por la incompatibilidad de módulos ES con `onclick` inline en strings HTML.
- El filtro de ventas fallaba silenciosamente por la colisión del campo `tipo` entre Firestore y el código.
- El contador de voluntarios en el calendario permite ver de un vistazo qué eventos necesitan más voluntarios sin tener que ir al módulo de voluntarios.

---

## 17. Voluntarios — Card de pendientes y correcciones de navegación

**Archivos:** `modulos/voluntarios.html`, `js/modulos/voluntarios.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

### Qué se cambió

#### 17.1 Card "Voluntarios pendientes"
- Se añadió una tarjeta al inicio del tab de Voluntariado que lista todos los eventos (actividades, giras y ventas) activos con `voluntariosReq > 0` que aún no tienen el cupo completo.
- Cada ítem muestra: nombre del evento, `"X / Y voluntarios"` y `"faltan N"`.
- Color del badge: rojo si hay menos de la mitad asignados, ámbar si está entre la mitad y el total.
- La tarjeta se actualiza automáticamente al asignar o eliminar voluntarios.

#### 17.2 Fix enlace "Asignar voluntarios"
- El botón de cada ítem pendiente tenía `href="nueva-asignacion"` (sin `#`), lo que navegaba a una URL inexistente.
- Corregido a `href="#nueva-asignacion"` (anchor interno).
- Se movió el `id="nueva-asignacion"` al elemento `<div class="card">` padre (antes estaba en un div interno), para que el scroll posicione el título de la sección correctamente.
- Se añadió `scroll-behavior: smooth` al `<style>` del módulo.

### Por qué se hizo
Los coordinadores de voluntariado necesitaban una vista rápida de qué eventos aún tienen cupos sin cubrir, sin tener que revisar cada evento individualmente. El fix de navegación era un enlace roto que no llevaba a ningún lado.

---

## 18. Voluntarios — Fix límite de asignación grupal

**Archivos:** `js/modulos/voluntarios.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

### Qué se cambió
- En la asignación de grupo, la función `actualizarBtnGrupo()` comparaba el número de selecciones contra `grupoReq` (total requerido), sin restar los voluntarios ya asignados.
- Con 3 ya asignados y 5 requeridos, el límite correcto es 2, pero el sistema permitía seleccionar hasta 5.
- **Fix**: se añadió el atributo `data-ya-asignado="1"` a los checkboxes marcados como "Ya asignado" (separándolos de los "Ocupado ese día" que también usan `data-fixed="1"`).
- En `actualizarBtnGrupo()` se cuenta `yaAsignadosCount` desde `data-ya-asignado="1"` y se calcula `cuposRestantes = grupoReq - yaAsignadosCount`.
- El bloqueo de checkboxes y el contador ahora usan `cuposRestantes` en lugar de `grupoReq`.
- El contador muestra `"X de Y disponibles"` (cupos restantes) en lugar de `"X de Y requeridos"` (total).

### Por qué se hizo
Sin esta corrección, era posible sobrepasignar el cupo de voluntarios de un evento: si se requerían 5 y ya había 3 asignados, el sistema permitía asignar 5 más (llegando a 8 total). El fix asegura que nunca se exceda el cupo máximo del evento.

---

---

## 19. Voluntarios — Ocultar card "Pendientes" cuando todos están completos

**Archivos:** `js/modulos/voluntarios.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

### Qué se cambió
- Cuando no hay eventos con cupos pendientes, el card completo desaparece (`display:none`) en lugar de mostrar el mensaje "Todos los eventos tienen sus voluntarios completos."
- Se usa `wrap.closest(".card")` para ocultar el contenedor padre completo sin necesidad de añadir un ID extra al HTML.
- El card vuelve a ser visible automáticamente al asignar o eliminar una asignación si quedan pendientes.

### Por qué se hizo
Mostrar un card vacío con texto de confirmación ocupaba espacio innecesario en la pantalla. Ocultarlo directamente hace la interfaz más limpia.

---

## 20. Voluntarios — Horario de clases como campo controlado

**Archivos:** `modulos/voluntarios.html`, `js/modulos/voluntarios.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

### Qué se cambió
- El campo `horario` pasó de texto libre a tres valores canónicos:
  - `Diurno` (7:50 am – 12:00 pm)
  - `Vespertino` (12:50 pm – 5:00 pm)
  - `Nocturno` (5:50 pm – 10:00 pm)
- Se añadió `HORARIOS` (constante con valor, label, rango inicio/fin y keywords de normalización) y `normalizarHorario()` que convierte texto libre del Excel al valor canónico al momento de importar.
- La tabla de voluntarios muestra un badge coloreado con el horario de cada voluntario (☀️ azul / 🌤️ naranja / 🌙 índigo).
- Se añadió `<select id="filtro-horario-vol">` junto al buscador para filtrar la tabla por turno de clases.
- Se añadió columna "Horario" en la cabecera de la tabla.

### Por qué se hizo
El horario de clases libre no permitía filtrar ni validar disponibilidad de forma automatizada. Con valores canónicos el sistema puede comparar rangos de horas y detectar conflictos.

---

## 21. Voluntarios — Validación de conflicto de horario de clases al asignar

**Archivos:** `js/modulos/voluntarios.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

### Qué se cambió
- Se añadieron los helpers `minutosDeHora()` y `hayConflictoHorario()` que comparan rangos de tiempo en minutos.
- **Asignación individual**: antes de guardar, si el voluntario tiene horario registrado y el turno seleccionado tiene horas definidas, se valida si se solapan. Si hay conflicto → error con mensaje específico: *"Maria Goods tiene clases en horario Diurno (7:50 am – 12:00 pm). El turno "Turno 1" (08:00–12:00) choca con su horario de clases."*
- **Asignación grupal**: `renderVoluntariosGrupo()` ahora calcula `esConflictoHorario` para cada voluntario al seleccionar un turno. Los que tienen conflicto aparecen deshabilitados con badge amarillo: *"⚠️ Choca con clases Diurno"*.
- El campo `HORARIOS` se actualizó para incluir los rangos `inicio` y `fin` usados en la comparación.

### Por qué se hizo
El sistema permitía asignar voluntarios diurnos a turnos que coincidían exactamente con su horario de clases, generando conflictos logísticos reales.

---

## 22. Voluntarios — Validación de doble asignación en misma fecha y turno

**Archivos:** `js/modulos/voluntarios.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

### Qué se cambió
- El handler de asignación individual (`btn-asignar`) ahora llama a `getEstadoVoluntarios()` antes de guardar.
- Si el voluntario ya está asignado a ese mismo evento → error: *"Yolanda Piti ya está asignada a este evento."*
- Si el voluntario tiene otra asignación en la misma fecha con turno superpuesto → error con el nombre del evento conflictivo: *"Yolanda Piti ya está asignada a "Prueba de evento" en Turno (08:00–12:00) en la misma fecha."*
- La lógica de solapamiento ya existía en `turnosSuperpuestos()` y era usada por el modal de grupo (badge "Ocupado ese día"). Ahora también protege el formulario individual.

### Por qué se hizo
El formulario individual no tenía ninguna validación de conflictos: era posible asignar la misma persona a dos eventos distintos en la misma fecha y turno. El modal de grupo sí lo detectaba visualmente pero el formulario individual no lo bloqueaba.

---

## 23. Voluntarios — Validaciones al crear turnos

**Archivos:** `js/modulos/voluntarios.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

### Qué se cambió
En el handler `btn-add-turno-evt`, antes de guardar el turno se valida:
1. **Hora de fin posterior al inicio**: si `fin ≤ inicio` → error *"La hora de fin debe ser posterior a la hora de inicio."*
2. **Duración mínima de 1 hora**: si `fin - inicio < 60 min` → error con los minutos reales: *"El turno "turno 3" dura solo 1 min. La duración mínima es 1 hora."*
3. **Sin superposición con turnos existentes**: usa `turnosSuperpuestos()` para detectar cruce de horarios. Si hay conflicto → error nombrando el turno que colisiona: *"El horario 08:00–14:00 se superpone con el turno "Turno 1" (08:00–12:00)."*

### Por qué se hizo
Era posible crear turnos de 1 minuto y turnos que se solapaban con otros ya existentes (ej. Turno 1: 08:00–12:00 y Turno 2: 08:00–14:00). Esto generaba inconsistencias al asignar voluntarios.

---

## 24. Voluntarios — Visibilidad de tabs por permiso

**Archivos:** `js/core/permisos.js`, `js/modulos/voluntarios.js`  
**Fecha:** 6 junio 2026  
**Autora:** Maria Goods

### Qué se cambió
- Se añadió el permiso `gestionar_actividades` en `permisos.js` con acceso para: `junta_principal`, `actividades`, `ceo`.
- En `voluntarios.js` se importa `tienePermiso` desde `permisos.js`.
- Se añadió la constante `TAB_PERMISOS` que mapea cada tab a su permiso requerido:
  - `tab-actividades` → `gestionar_actividades`
  - `tab-giras` → `gestionar_giras`
  - `tab-voluntariado`, `tab-importar`, `tab-voluntarios`, `tab-asistencias` → `gestionar_voluntarios`
- La función `aplicarPermisosTab()` oculta con `display:none` los tabs sin acceso y activa automáticamente el primer tab visible si el tab por defecto quedó oculto. Se ejecuta al cargar la página.

### Por qué se hizo
Un Líder de Giras no debería ver los tabs de Actividades ni Voluntariado, y un Líder de Voluntariado no debería ver el tab de Giras. La página antes mostraba todos los tabs a cualquier usuario con permiso para entrar al módulo.

---

## 25. Fix — `requirePermiso` con múltiples permisos y path relativo

**Archivos:** `js/core/auth.js`, `modulos/voluntarios.html`
**Fecha:** 7 junio 2026
**Autora:** Maria Goods

### Qué se cambió
- `requirePermiso(...permisos)` ahora acepta un número variable de permisos: pasa si el usuario tiene **al menos uno** de los permisos indicados.
- El redirect a `dashboard.html` ahora calcula el prefijo `../` según la profundidad de la URL actual, evitando que desde `modulos/` redirija a `/modulos/dashboard.html` (404).
- `modulos/voluntarios.html` actualizado para requerir `gestionar_voluntarios` **o** `gestionar_actividades` **o** `gestionar_giras`, permitiendo que el Líder de Actividades y el Líder de Giras accedan al módulo sin ser rechazados.

### Por qué se hizo
El Líder de Actividades solo tiene `gestionar_actividades`. La guardia del módulo exigía `gestionar_voluntarios`, por lo que cualquier usuario sin ese permiso era redirigido a `dashboard.html` usando una ruta relativa que desde `modulos/` resolvía como `/modulos/dashboard.html` (inexistente).

---

## 26. Inscripciones — Tab Participantes lee de colección `participantes`

**Archivos:** `modulos/inscripciones.html`, `js/modulos/inscripciones.js`
**Fecha:** 7 junio 2026
**Autora:** Maria Goods

### Qué se cambió
- Se añadió `participantesGlobal[]` como estado separado para el tab Participantes (los tabs Asistencia y Certificados siguen usando `inscripciones[]` del evento activo).
- Nueva función `cargarParticipantes()` que lee todos los documentos de la colección `participantes`.
- `renderParticipantes()` reescrito para mostrar las mismas columnas que `modulos_participantes.html`: Código, Nombre/Correo, Cédula, Categoría, Pago (badge), Método, Fecha de registro.
- Buscador actualizado: busca por nombre, correo, cédula y código.
- Estadísticas actualizadas: Total registrados / Pagos aprobados / Pendientes.
- El botón "Exportar todos los QR" itera `participantesGlobal` y genera el QR con `{codigo, token}` en lugar del ID del documento.
- `_verQR` busca en `participantesGlobal` y genera el QR con `{codigo, token}`.
- `init()` carga eventos y participantes en paralelo.

### Por qué se hizo
El tab Participantes mostraba datos de la colección `inscripciones` (importados manualmente, por evento). Se necesitaba que mostrara la lista global de personas registradas (colección `participantes`), que incluye tanto a quienes se registran por el formulario externo como a los importados manualmente.

---

## 27. Inscripciones — Importar escribe en colección `participantes` con dedup por correo

**Archivos:** `js/modulos/inscripciones.js`, `modulos/inscripciones.html`
**Fecha:** 7 junio 2026
**Autora:** Maria Goods

### Qué se cambió
- El proceso de importación ahora escribe en la colección `participantes` en lugar de `inscripciones`.
- Al iniciar la importación, se cargan todos los correos existentes en `participantes` en un `Set` en memoria. Las filas con correo duplicado se omiten en O(1) sin hacer una query por fila.
- Los documentos importados usan el mismo formato de ID que la Cloud Function: `c_${cedula}` si hay cédula, `e_${email}` si no. Esto garantiza que si alguien importado intenta registrarse luego por el formulario, la Cloud Function detecta el conflicto correctamente.
- Cada participante importado recibe: `codigo` (`IMP-2026-XXXXXX`), `token` aleatorio, y todos los campos del esquema de `participantes` (`apellido`, `nombreCompleto`, `categoria`, `pago`, `estadoRegistro`, `camposExtra`, etc.).
- Campos específicos del evento (facultad, carrera, nivelPython, temasInteres, tallaSueter) se guardan en `camposExtra`.
- Validación de correo relajada: acepta cualquier correo con `@`, no solo `@utp.ac.pa`.
- Se añadieron `apellido` y `categoria` al mapeo de columnas del CSV.
- Ya no se requiere seleccionar un evento activo para importar (la colección `participantes` es global).
- El resumen final indica: importados / duplicados omitidos / errores.

### Por qué se hizo
La importación anterior escribía en `inscripciones` con un esquema distinto al de `participantes`, lo que hacía que los importados no aparecieran en la lista global. Unificando el destino en `participantes` y compartiendo el esquema, los importados se mezclan con los registrados normalmente sin duplicaciones.

---

## 28. Voluntarios — Cupo para actividades de tipo Taller y para giras

**Archivos:** `modulos/voluntarios.html`, `js/modulos/voluntarios.js`
**Fecha:** 7 junio 2026
**Autora:** Maria Goods

### Qué se cambió
- **Actividades tipo Taller**: se añadió el campo `cupo` (cupo máximo de asistentes) en el formulario, visible solo cuando el tipo seleccionado es "Taller". Al cambiar a otro tipo el campo se oculta y limpia. El valor se guarda en Firestore como `cupo: N` (null para otros tipos). La tabla muestra la columna "Cupo" con el valor en azul o "—" si no aplica.
- **Giras**: se añadió `cupo` como campo siempre visible en el formulario (en la misma fila que Lugar y Voluntarios requeridos, con grid de 3 columnas). Se guarda en Firestore y se muestra en la tabla.
- Ambas tablas pasaron de `colspan="8"` a `colspan="9"` para la fila de estado vacío.
- `limpiarFormActividad()` y `limpiarFormGira()` resetean el campo `cupo`.
- `editarActividad()` y `editarGira()` populan el campo `cupo` al cargar el registro.

### Por qué se hizo
Las actividades tipo Taller y las giras tienen un límite real de asistentes independiente del número de voluntarios requeridos. Sin este campo no había forma de registrar ese límite en el sistema.

---

## 29. Inscripciones — Checkpoints del evento (colección separada + modal)

**Archivos:** `modulos/inscripciones.html`, `js/modulos/inscripciones.js`, `firebase_rules/firestore.rules`
**Fecha:** 7 junio 2026
**Autora:** Maria Goods

### Qué se cambió

#### 29.1 Colección `checkpoints` en Firestore
- Se creó la colección `checkpoints` (separada de `eventos`) con los campos: `eventoId`, `eventoNombre`, `nombre`, `titulo`, `tipo` (conferencia / taller / gira / workshop / panel / otro), `dia`, `salon`, `horaInicio`, `horaFin`, `exponente`, `cupos`, `cuposDisponibles`, `creadoEn`, `actualizadoEn`.
- Solo los tipos `taller` y `gira` usan `cupos` y `cuposDisponibles`.
- Se añadió la colección `inscripciones_checkpoint` para registros in-situ por QR en talleres.

#### 29.2 Días con hora por evento
- Al crear/editar un evento, el rango de fechas genera automáticamente una fila por día con campos `horaInicio` y `horaFin`.
- Los días se guardan en el evento como `diasEvento: [{ fecha, horaInicio, horaFin }]`.
- Al crear un checkpoint, el selector de día muestra las fechas del evento con sus horas.
- **Fix timezone**: se eliminaron todos los `.toISOString()` que convertían fechas a UTC; se usan `getFullYear()`, `getMonth()`, `getDate()` locales para evitar que al editar un evento de N días aparezca N+1 días.

#### 29.3 Modal "Gestionar checkpoints"
- Se eliminó el card de checkpoints incrustado en el Tab Evento.
- Se añadió un botón "📋 Gestionar checkpoints" con badge de conteo (`#cp-count-badge`) sobre el campo "Mínimo de checkpoints".
- Al hacer clic abre un modal con el formulario completo de checkpoint y la lista de los checkpoints existentes.
- El mínimo de checkpoints para certificado se calcula automáticamente como `⌈n × 0.60⌉` y se escribe en el campo `ev-min-cert` cada vez que cambia el total de checkpoints.
- El modal muestra un resumen: "N checkpoints · Mínimo para certificado: X".

#### 29.4 Card "Checkpoints del evento" (vista permanente)
- Se añadió un card visible debajo de "Eventos registrados" en el Tab Evento.
- Muestra el estado vacío cuando no hay evento activo.
- Al seleccionar un evento, muestra la lista completa de checkpoints con: nombre, tipo (badge), título, día, hora, salón, exponente y cupos disponibles.
- El botón "📋 Gestionar checkpoints" del card abre el mismo modal.
- La lista se actualiza automáticamente al agregar, editar o eliminar checkpoints.

#### 29.5 Reglas de Firestore
- `checkpoints`: lectura para todo staff, escritura para coordinador/actividades/junta/ceo.
- `inscripciones_checkpoint`: lectura y creación para todo staff, actualización/eliminación solo para roles de junta/coordinador.

### Por qué se hizo
Los checkpoints del programa (conferencias, talleres, giras) necesitaban un lugar estructurado en Firestore separado del documento de evento, para poder decrementar cupos de forma atómica con transacciones. El modal centraliza la gestión sin sobrecargar el formulario de evento.

---

## 30. Inscripciones — Fix "Missing or insufficient permissions" en carga inicial

**Archivos:** `js/modulos/inscripciones.js`
**Fecha:** 7 junio 2026
**Autora:** Maria Goods

### Qué se cambió
- Se importó `onAuthStateChanged` de Firebase Auth.
- Se reemplazó la llamada directa `init()` al final del módulo por `onAuthStateChanged(auth, async (user) => { if (!user) return; ... })`.
- Las queries a Firestore (`cargarEventos`, `cargarParticipantes`) solo se ejecutan una vez que Firebase confirma que hay un usuario autenticado con token válido.

### Por qué se hizo
`init()` se ejecutaba inmediatamente al cargar el módulo ES, antes de que Firebase Auth tuviera tiempo de establecer la sesión. Firestore recibía las queries sin token de autenticación y respondía con `permission-denied`. Envolver la carga inicial en `onAuthStateChanged` garantiza que las queries solo se disparan cuando el usuario está confirmado.

---

---

## 31. Inscripciones — Combobox de Exponente/Ponente en checkpoints

**Archivos:** `modulos/inscripciones.html`, `js/modulos/inscripciones.js`
**Fecha:** 7 junio 2026
**Autora:** Maria Goods

### Qué se cambió
- Se reemplazó el campo de texto libre "Exponente / Ponente" por un combobox que filtra participantes de `participantesGlobal` donde `camposExtra.ponencia === "si"`. Este campo ya existe en el formulario de registro (`registro.html`) para las categorías `academico_utp` y `academico_externo`, por lo que no fue necesario modificar ese archivo.
- El combobox muestra nombre + cédula de cada ponente. Al seleccionar uno, aparece una tarjeta de información verde con: nombre completo, cédula y origen (Interna — UTP o Externa — [institución]).
- Opción "✏️ Otro (ingresar manualmente)" para ponentes que no están en el sistema.
- Campos ocultos `cp-ponente-id` (referencia al documento de participantes) y `cp-exponente` (nombre como texto, para compatibilidad con checkpoint existentes).
- Nueva función `poblarSelectPonentes()` llamada al abrir el modal por cualquier vía.
- Se añadió el campo **"Tipo de presentación"** (`<select id="cp-tipo-presencia">`) con opciones: Presencial / Virtual / Mixto.
- Los checkpoints ahora guardan `ponenteId` y `tipoPresencia` además de `exponente`.
- `limpiarFormCp()` y `_editarCp()` actualizados para manejar los nuevos campos; `_editarCp()` restaura el ponente correcto en el select si tiene `ponenteId`.

### Por qué se hizo
El campo de texto libre para el exponente no permitía vincular el checkpoint con el registro del participante, lo que imposibilitaba generar certificados automáticos con la información completa (cédula, origen). Usando el campo `camposExtra.ponencia` del formulario de registro se evita crear una categoría separada y no se toca código de compañeros de equipo.

---

## 32. Inscripciones — Validaciones de horas en el formulario de checkpoint

**Archivos:** `js/modulos/inscripciones.js`
**Fecha:** 7 junio 2026
**Autora:** Maria Goods

### Qué se cambió
Se añadieron tres validaciones en el handler `btn-guardar-cp` antes de guardar en Firestore:

1. **Ambas o ninguna**: si solo se llena `horaInicio` o solo `horaFin` → error *"Debes indicar tanto la hora de inicio como la de fin."*
2. **Duración mínima de 30 minutos**: si `horaFin - horaInicio < 30 min` → error *"La duración mínima de un checkpoint es 30 minutos."*
3. **Límite del horario del evento ese día**: busca el día seleccionado en `eventoActivo.diasEvento[]`; si tiene `horaInicio` y `horaFin` definidos, verifica que el checkpoint no empiece antes ni termine después. Errores: *"El checkpoint no puede iniciar antes de las HH:MM (límite del evento ese día)."* / *"...terminar después de las HH:MM..."*. Si el día no tiene horario definido, esta validación se omite sin bloquear.

### Por qué se hizo
Era posible guardar checkpoints de 1 minuto (ej. 08:00–08:01) o con horarios fuera del rango del evento, lo que producía datos incorrectos en los reportes de horas.

---

## 33. Inscripciones — Alertas visibles dentro del modal de checkpoints

**Archivos:** `modulos/inscripciones.html`, `js/modulos/inscripciones.js`
**Fecha:** 7 junio 2026
**Autora:** Maria Goods

### Qué se cambió
- Se añadió `<div id="alerta-cp" class="alerta"></div>` dentro del modal de checkpoints, justo debajo del título.
- Se creó `mostrarAlertaCp(tipo, msg)` que escribe en ese div y llama a `scrollIntoView()` para asegurar visibilidad.
- Todos los mensajes del formulario de checkpoint (validaciones, éxito al guardar, error de Firestore) usan `mostrarAlertaCp` en lugar de `mostrarAlerta`.

### Por qué se hizo
`alerta-global` está en el cuerpo del documento (fuera del modal). El overlay del modal tiene `z-index: 200` y cubría visualmente el div de alerta, haciendo que los mensajes de error no aparecieran aunque la validación sí bloqueaba el guardado.

---

## 34. Inscripciones — Tab Certificados: 4 exportaciones documentales

**Archivos:** `modulos/inscripciones.html`, `js/modulos/inscripciones.js`
**Fecha:** 7 junio 2026
**Autora:** Maria Goods

### Qué se cambió
Se reemplazó el flujo de "Generar certificados PDF individuales" por 4 botones de exportación de documentos:

#### 34.1 PDF del programa (`btn-export-pdf-programa`)
- Genera `Programa_NombreEvento.pdf` en orientación vertical A4.
- Barra de cabecera verde con "CONTECS — Universidad Tecnológica de Panamá".
- Secciones: Título del evento, Objetivo (descripción), Fecha completa (rango), Horario por día (Día N · fecha larga: HH:MM – HH:MM).
- Tabla de actividades: Título | Salón | Día | Horas | Exponente.
- Manejo automático de saltos de página; pie con número de página en todas las hojas.

#### 34.2 Excel del programa (`btn-export-excel-programa`)
- Genera `Programa_NombreEvento.xlsx` con 2 hojas:
  - **"Información del evento"**: contenido (nombre), objetivo, fecha completa, horario por día.
  - **"Actividades"**: título, salón, fecha, horas calculadas, exponente.

#### 34.3 Excel de exponentes (`btn-export-excel-exponentes`)
- Genera `Exponentes_NombreEvento.xlsx`.
- Columnas: Nombre · Cédula · Tema que impartió · Día · Cantidad de horas · Tipo de presentación · Origen.
- Cruza `cp.ponenteId` con `participantesGlobal` para obtener cédula y origen (Interna UTP / Externa + institución). Si no hay `ponenteId` (entrada manual), usa el texto del campo `exponente`.

#### 34.4 Excel de participantes elegibles (`btn-export-excel-participantes`)
- Genera `Participantes_NombreEvento.xlsx`.
- Columnas: Nombre · Cédula · Origen · Horas.
- Las horas = suma de todos los checkpoints del evento (`calcHorasNum` sobre `horaInicio`/`horaFin`).
- Cruza por cédula con `participantesGlobal` para derivar el origen.
- **Nueva hoja cada 50 participantes** (`Participantes 1–50`, `51–100`, …).

#### Helpers nuevos en inscripciones.js
`calcHorasNum(ini, fin)`, `origenParticipante(p)`, `fmtDiaLargo(fechaStr)`, `fmtDiaCorto(fechaStr)`, `fmtRangoFechas(ini, fin)`.

#### Tabla de participantes elegibles actualizada
- Columna "Universidad" reemplazada por "Origen" (derivado de `categoria` + `camposExtra`).
- Botón "🏅 Certificado" individual eliminado.

### Por qué se hizo
El flujo anterior generaba PDFs individuales por participante sin información del programa. Los documentos nuevos son los requeridos por el proceso de certificación del congreso: un programa para archivo institucional, una lista de exponentes con datos completos para emitir sus constancias, y una lista de participantes formateada para el área académica.

---

## 35. Nueva página: Estadísticas del Congreso

**Archivos creados:** `modulos/reportes_estadisticaCont.html`, `js/modulos/reportes_estadisticaCont.js`
**Archivo modificado:** `dashboard.html`
**Fecha:** 7 junio 2026
**Autora:** Maria Goods

### Qué se cambió
Se creó desde cero una página de estadísticas con dos secciones:

#### 35.1 Conferencias y Talleres
- Fuentes: colección `checkpoints` + colección `inscripciones_checkpoint` (conteo por `checkpointId`).
- Tarjetas de resumen: total actividades, total asistencias, actividad más visitada (con conteo), promedio de asistentes por actividad, total de horas del congreso.
- **Gráfico de barras horizontal** (Chart.js): Top 10 actividades más visitadas.
- **Gráfico de dona**: distribución de actividades por tipo (conferencia, taller, gira, etc.).
- **Tabla de ranking**: posición, título (con nombre del evento), tipo (badge de color), día, exponente, asistentes, cupos, barra de porcentaje de ocupación, horas.

#### 35.2 Voluntarios
- Fuentes: colección `voluntarios` + `actividades_voluntarios` + `asistencias_voluntarios`.
- Tarjetas: total voluntarios, horas totales proporcionadas, promedio de horas por voluntario, actividades con voluntarios registrados, participaciones totales.
- **Gráfico de barras horizontal**: Top 10 voluntarios por horas (`v.totalHoras`).
- **Gráfico de barras vertical**: Horas totales por actividad de voluntariado (suma de `a.horasGanadas` agrupado por `actividadId`).
- **Tabla de voluntarios**: ranking, nombre, cédula, horas, participaciones, barra visual proporcional al máximo.

#### Dashboard
- Se añadió el acceso **"Estadísticas Congreso 📊"** al panel principal con permiso `ver_reportes`.

### Por qué se hizo
No existía ninguna vista consolidada de rendimiento del congreso ni de la participación de voluntarios. Esta página permite a la junta ver de un vistazo cuáles actividades atrajeron más público, qué voluntarios aportaron más horas y dónde hubo subutilización de cupos.

---

## Estado del proyecto tras Sprint 3

**Período actualizado:** 29 mayo – 7 junio 2026 · **Cambios documentados:** 35

| Módulo | Estado |
|--------|--------|
| Login Google + Microsoft | ✅ Completo |
| Dashboard con módulos por rol | ✅ Completo |
| Catálogo de productos | ✅ Completo |
| Ventas (ventas2) + vinculación a actividad | ✅ Completo |
| Compras con facturas | ✅ Completo |
| Fondos y detalle de fondo | ✅ Completo |
| Inventario y ajustes | ✅ Completo |
| Bitácora financiera | ✅ Completo |
| Inscripciones — Tab Participantes (colección global) | ✅ Completo |
| Inscripciones — Importar a `participantes` con dedup | ✅ Completo |
| Inscripciones — Checkpoints (modal + card + validaciones) | ✅ Actualizado — 7 jun |
| Inscripciones — Checkpoint: combobox ponente + tipo presencia | ✅ Nuevo — 7 jun |
| Inscripciones — Alertas visibles en modal (alerta-cp) | ✅ Nuevo — 7 jun |
| Inscripciones — Tab Certificados: 4 exportaciones | ✅ Nuevo — 7 jun |
| Perfil de usuario | ✅ Completo |
| Voluntarios (actividades, giras, asignaciones) | ✅ Completo |
| Voluntarios — Cupo para Talleres y Giras | ✅ Completo |
| Actividad Ventas (planificación) | ✅ Completo |
| Calendario unificado | ✅ Completo |
| Lectura QR (asistencia y voluntarios) | ✅ Completo |
| Estadísticas del Congreso (conferencias + voluntarios) | ✅ Nuevo — 7 jun |
| Reportes financieros | 🔶 Estructura base |
| Usuarios (gestión de roles) | ✅ Completo |
| Firebase Functions (participantes-api) | ✅ Desplegada |
| Reglas de Firestore | ✅ Actualizadas — pendiente deploy |
| Reglas de Storage | ✅ Configuradas |

---

## Pendientes identificados

- [ ] **Deploy obligatorio**: ejecutar `npm run deploy:rules` para publicar las reglas de `checkpoints` e `inscripciones_checkpoint` en el proyecto `contecs-fa6e6`. Sin esto, inscripciones.html muestra "Missing or insufficient permissions" al cargar y al guardar checkpoints.
- [ ] **Deploy Cloud Functions**: ejecutar `npm run deploy:functions` para publicar `registrarParticipante` y `accederParticipante`. Sin esto, `registro.html` muestra error 404/CORS.
- [ ] Crear índice de Firestore para query `productos` con `where("activo", "==", true)` — el enlace apareció en consola durante pruebas.
- [ ] Eliminar archivo huérfano `ventas2.js` de la raíz del proyecto.
- [ ] Los usuarios con rol `ventas` o `logistica` no pueden ver la lista de usuarios para el campo "Responsables" en Actividad Ventas, ya que las reglas de `usuarios` solo permiten acceso a roles de junta/coordinador. Se usa el campo de texto libre como respaldo.
- [ ] Inscripciones — el tab Asistencia sigue usando la colección `inscripciones` (event-specific). Si se quiere unificar con `participantes`, requiere agregar `eventoId` al esquema de `participantes` o crear una subcolección.
- [ ] Inscripciones — los participantes importados reciben código `IMP-2026-XXXXXX`. Si se desea el formato `CTCS-2026-XXXXX` secuencial, la importación debe pasar por la Cloud Function.
- [ ] Voluntarios — el campo `cupo` de Talleres y Giras aún no se valida al momento de asignar voluntarios ni se muestra en el calendario.
- [ ] Inscripciones — el combobox de ponentes solo muestra participantes con `camposExtra.ponencia === "si"` (categorías `academico_utp` y `academico_externo`). Ponentes de otras categorías solo pueden ingresarse manualmente.
- [ ] Estadísticas Congreso — si la colección `inscripciones_checkpoint` tiene muchos documentos, la carga puede ser lenta (sin paginación ni límite). Evaluar si se necesita un contador desnormalizado en el documento de checkpoint.
