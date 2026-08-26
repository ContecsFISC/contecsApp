# Wiki de ContecsApp

Documentación completa de **ContecsApp**, la plataforma web de gestión del congreso **CONTECS 2026** (FISC — Universidad Tecnológica de Panamá).

> Esta wiki describe el estado del repositorio `ContecsFISC/contecsApp` en la rama `main`. El código fuente y las reglas de Firebase son siempre la fuente definitiva; si detectas una diferencia, corrige aquí.

---

## Índice

1. [Visión general](#1-visión-general)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Arquitectura](#3-arquitectura)
4. [Estructura del repositorio](#4-estructura-del-repositorio)
5. [Autenticación y sesión](#5-autenticación-y-sesión)
6. [Roles y permisos](#6-roles-y-permisos)
7. [Modelo de datos (Firestore)](#7-modelo-de-datos-firestore)
8. [Cloud Functions](#8-cloud-functions)
9. [Seguridad](#9-seguridad)
10. [Flujo público: inscripción al congreso](#10-flujo-público-inscripción-al-congreso)
11. [Credencial digital, QR y checkpoints](#11-credencial-digital-qr-y-checkpoints)
12. [Módulo Congreso](#12-módulo-congreso)
13. [Módulo Finanzas](#13-módulo-finanzas)
14. [Módulo Logística](#14-módulo-logística)
15. [Módulo Voluntariado y Giras](#15-módulo-voluntariado-y-giras)
16. [Módulo Administración y Secretaría](#16-módulo-administración-y-secretaría)
17. [Reportes y exportaciones](#17-reportes-y-exportaciones)
18. [Correos transaccionales (Brevo)](#18-correos-transaccionales-brevo)
19. [Despliegue](#19-despliegue)
20. [Desarrollo local, lint y pruebas](#20-desarrollo-local-lint-y-pruebas)
21. [Mapa de arquitectura (AlphaToolGraph)](#21-mapa-de-arquitectura-alphatoolgraph)
22. [Convenciones de código](#22-convenciones-de-código)
23. [Solución de problemas frecuentes](#23-solución-de-problemas-frecuentes)
24. [Glosario](#24-glosario)

---

## 1. Visión general

ContecsApp cubre todo el ciclo operativo del congreso:

| Dominio | Qué resuelve |
|---|---|
| **Inscripciones** | Registro público multi-paso, cobro por categoría, comprobantes de pago, aprobación por staff, credencial digital con QR. |
| **Congreso** | Checkpoints y eventos del programa, asistencia por QR, inscripción in-situ a talleres con control de cupos, estadísticas. |
| **Finanzas** | Punto de venta (Venta Rápida), compras con factura, mermas, fondo de caja, bitácora de auditoría y reportes. |
| **Logística** | Catálogo de productos y categorías, inventario, alertas de stock, actividades de venta. |
| **Voluntariado** | Voluntarios, actividades con turnos, asistencia por QR, horas acumuladas, carnets, giras con check-in/check-out. |
| **Administración** | Gestión de usuarios y roles, exportaciones, secretaría (reuniones, minutas, calendario). |

Es una aplicación **sin build**: HTML + CSS + JavaScript ES Modules servidos estáticamente, con Firebase como backend.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | HTML5, CSS3 (`css/styles.css`), JavaScript ES2020+ con módulos nativos (`type="module"`). Sin bundler ni framework. |
| SDK cliente | Firebase Web SDK **12.12.1** cargado por URL desde `gstatic.com` (App, Auth, Firestore, Storage, Functions, Analytics). |
| Backend | Cloud Functions for Firebase **v2** (Node.js 22, `firebase-functions ^7`, `firebase-admin ^14`). |
| Base de datos | Cloud Firestore (proyecto `contecs-fa6e6`, región `us-central1`). |
| Archivos | Cloud Storage (`contecs-fa6e6.firebasestorage.app`). |
| Correo | API transaccional de **Brevo** (secreto `BREVO_API_KEY`). |
| SSO | Single Sign-On institucional UTP (`https://sso.utp.ac.pa/ms/`). |
| Librerías locales (`js/libs/`) | ExcelJS, SheetJS (`xlsx`), PapaParse, jsPDF, JSZip, `html5-qrcode`, `qrcode`. |
| Librerías por CDN | Chart.js 4.5.0, `docx@9` y `qrcode@1.5.4` vía `esm.sh`. |
| Hosting | GitHub Pages (producción actual) y Firebase Hosting (configurado en `firebase.json`). |
| Análisis estático | `AlphaToolGraph.py` → `graph-out/`. |

---

## 3. Arquitectura

```
┌─────────────────────────── NAVEGADOR ───────────────────────────┐
│  Público                         Panel interno (staff)          │
│  ├─ registro.html                ├─ panel/index.html (login)    │
│  ├─ public/perfil.html           ├─ panel/dashboard.html        │
│  ├─ public/gira.html             └─ panel/modulos/**/*.html     │
│  └─ public/ms/auth.html (SSO)          │                        │
│         │                              │                        │
│         │  js/core/*  (auth, permisos, seguridad, operaciones)  │
│         │  js/modulos/* (lógica de cada pantalla)               │
└─────────┼──────────────────────────────┼────────────────────────┘
          │ httpsCallable                │ Firestore SDK (lecturas)
          ▼                              ▼
┌──────────────── FIREBASE (proyecto contecs-fa6e6) ──────────────┐
│  Cloud Functions v2 (us-central1)                               │
│   ├─ ejecutarOperacionFinanciera  → ventas, compras, mermas,    │
│   │                                  ajustes, fondos            │
│   ├─ ejecutarOperacionQr          → asistencias y talleres      │
│   ├─ marcarCheckpointGira         → entrada/salida de giras     │
│   ├─ registrarParticipante / accederParticipante                │
│   ├─ enviarCorreoQrParticipante / notificarPagoAprobado         │
│   ├─ listarParticipantesParaGiras / notificarParticipantesGira  │
│   ├─ accederGiraParticipante / subirFotoEfectivo                │
│   └─ validarTokenSSO (onRequest)                                │
│  Firestore (27 colecciones) · Storage · Auth (Google + custom)  │
│  Reglas: firebase_rules/firestore.rules · storage.rules         │
└─────────────────────────────────────────────────────────────────┘
```

**Principio central de diseño:** el navegador **nunca escribe** datos contables, asistencias ni saldos. Toda mutación sensible pasa por una Cloud Function que valida sesión, rol y consistencia dentro de una transacción de Firestore; las reglas de seguridad declaran `allow create/update/delete: if false` para esas colecciones. El cliente solo lee (cuando su rol lo permite) y escribe datos de bajo riesgo (catálogo, eventos, voluntarios, reuniones).

### Capas del frontend

- **`js/core/`** — infraestructura compartida:
  - `firebase-config.js`: inicializa `app`, `db`, `auth`, `storage` y `analytics` (opcional, tolerante a fallos).
  - `auth.js`: guardia de rutas, sesión, login Google/SSO, escucha de cambios de rol.
  - `permisos.js`: catálogo de roles y matriz de permisos.
  - `operaciones.js`: envoltorio de las operaciones financieras (`httpsCallable`) + subida de facturas + `formatearMoneda`.
  - `participantes-api.js`: envoltorio de las funciones de participantes y giras, con traducción de códigos de error a mensajes en español.
  - `seguridad.js`: sanitización (`escaparHtml`, `urlHttpSegura`, `neutralizarFormulaHoja`).
  - `iconos.js`: catálogo de iconos SVG.
  - `sso-config.js`: URLs del SSO UTP y del perfil público.
- **`js/modulos/`** — un archivo por pantalla del panel; importa `core` y manipula el DOM de su HTML anfitrión.
- **`panel/`** — vistas HTML; cada una llama a `guardRoute()` y `await requirePermiso("...")` antes de cargar datos.

---

## 4. Estructura del repositorio

```
contecsApp/
├── index.html                  # Login público (Google + SSO UTP)
├── registro.html               # Formulario público de inscripción (multi-paso)
├── AGENTS.md                   # Guía de contexto para agentes de IA
├── AlphaToolGraph.py           # Generador del mapa de arquitectura
├── firebase.json               # Hosting, reglas, functions, headers
├── .firebaserc                 # Alias del proyecto Firebase
├── package.json                # Scripts raíz (lint, emulators, deploy)
├── assets/, img/, icons/       # Logos e iconos SVG
├── css/styles.css              # Hoja de estilos global (variables de marca)
├── docs/                       # Documentación y bitácoras de cambios
├── firebase_rules/
│   ├── firestore.rules         # RBAC de Firestore
│   ├── storage.rules           # RBAC de Storage
│   ├── firestore.indexes.json  # Índices compuestos
│   └── firebase_backup.json    # Respaldo de configuración
├── functions/
│   ├── index.js                # Punto de entrada de las 12 Cloud Functions
│   ├── operaciones-financieras.js
│   ├── operaciones-qr.js
│   ├── qr-participante.js      # Construcción de enlaces perfil/gira
│   ├── plantillas.js           # Carga y relleno de plantillas de correo
│   ├── templates/*.html        # Plantillas HTML de correo
│   └── test/operaciones-qr.integration.js
├── graph-out/                  # Mapa generado (NO editar a mano)
├── js/
│   ├── core/                   # Infraestructura compartida
│   ├── libs/                   # Librerías vendorizadas
│   └── modulos/                # Lógica por pantalla
├── panel/
│   ├── index.html              # Login del panel
│   ├── dashboard.html          # Home del staff
│   └── modulos/
│       ├── admin/              # usuarios, exportar, secretaria, minutas, reuniones
│       ├── congreso/           # participantes, inscripciones, lecturaQR, estadísticas
│       ├── finanzas/           # fondos, ventaRapida, compras, reportes, bitácora
│       ├── logistica/          # inventario, catálogo, actividades de venta
│       └── voluntariado/       # voluntarios, actividades, giras, calendario, QR
└── public/
    ├── perfil.html             # Credencial digital del participante
    ├── gira.html               # Información pública de una gira
    └── ms/auth.html            # Callback del SSO UTP
```

---

## 5. Autenticación y sesión

### 5.1 Métodos de acceso

| Método | Flujo |
|---|---|
| **Google** | `loginConGoogle()` → `signInWithPopup` con `GoogleAuthProvider`. |
| **SSO UTP** | `loginConSSO()` redirige a `https://sso.utp.ac.pa/ms/login`; el SSO regresa a `public/ms/auth.html`, que consulta `SSO_USER_URL` para obtener los datos del usuario y los envía a la función HTTP `validarTokenSSO`, que verifica el token contra la UTP y devuelve un **custom token** de Firebase para iniciar sesión. |
| **Participantes** | No usan Firebase Auth: acceden con `código + token` a `public/perfil.html` / `public/gira.html` mediante Cloud Functions públicas. |

### 5.2 Guardia de rutas (`js/core/auth.js`)

- `guardRoute()` se ejecuta al inicio de cada página. Si no hay sesión y la página no es pública (`index.html`, `auth.html`, `/ms/auth`), redirige al login; si hay sesión en una página pública, redirige al dashboard.
- `cargarUsuario(user)` lee `usuarios/{uid}`. Si no existe, **crea** el documento con `rol: "sin_rol"`; los datos quedan en `sessionStorage` (`uid`, `nombre`, `rol`, `email`).
- `escucharCambiosDeRol(uid)` mantiene un `onSnapshot` sobre el documento del usuario: si un administrador cambia el rol, la sesión se actualiza y la página se recarga automáticamente.
- `esperarSesionLista()` devuelve una promesa que resuelve cuando el estado de autenticación ya se determinó (evita leer `sessionStorage` demasiado pronto).
- `requirePermiso(...permisos)` espera la sesión y redirige al dashboard si el rol no tiene **ninguno** de los permisos indicados.
- `prefijoHaciaPanel()` calcula los `../` necesarios, de modo que la app funciona igual en la raíz del dominio o bajo un subpath (`/contecsApp/`).

Un usuario nuevo entra con `sin_rol`: ve la pantalla “Acceso pendiente de activación” hasta que un CEO o Junta Directiva_A le asigne rol desde **Administración → Usuarios**.

---

## 6. Roles y permisos

### 6.1 Roles (`js/core/permisos.js`)

| Clave | Etiqueta |
|---|---|
| `ceo` | CEO / Desarrollador (acceso total, sin excepciones) |
| `junta_principal` | Junta Directiva_A |
| `junta` | Junta Directiva |
| `coordinador` | Coordinador |
| `finanzas` | Líder de Finanzas |
| `logistica` | Líder de Logística |
| `ventas` | Líder de Ventas |
| `secretario` | Secretario |
| `actividades` | Líder de Actividades |
| `patrocinios` | Líder de Patrocinios |
| `investigacion` | Líder de Investigación |
| `voluntariado` | Líder de Voluntariado |
| `giras` | Líder de Giras |
| `comunicaciones` | Líder de Comunicaciones |
| `staff_contecs` | Staff CONTECS |
| `miembro` | Miembro General |
| `sin_rol` | (implícito) usuario recién registrado, sin acceso |

### 6.2 Matriz de permisos

| Permiso | Roles con acceso |
|---|---|
| `ver_bitacora` | junta_principal, finanzas, ceo |
| `ver_inventario` | junta_principal, junta, ventas, logistica, ceo |
| `registrar_ventas` | junta_principal, junta, logistica, ventas, ceo |
| `registrar_compras` | junta_principal, junta, finanzas, ventas, logistica, ceo |
| `acceso_venta_rapida` | todos los roles **excepto** `staff_contecs` |
| `ver_fondos` / `editar_fondos` | junta_principal, finanzas, ceo |
| `ver_reportes` | junta_principal, finanzas, ceo |
| `editar_catalogo` | junta_principal, ventas, logistica, ceo |
| `ver_precios` | junta_principal, finanzas, ventas, ceo |
| `aprobar_gastos` | junta_principal, ceo |
| `exportar_datos` | junta_principal, ceo |
| `gestionar_usuarios` | junta_principal, ceo |
| `gestionar_inscripciones` | ceo, staff_contecs |
| `gestionar_voluntarios` | junta_principal, voluntariado, ceo |
| `gestionar_actividades` | junta_principal, actividades, ceo |
| `gestionar_ventas` | junta_principal, junta, ventas, ceo |
| `gestionar_giras` | junta_principal, giras, ceo |
| `ver_participantes` | ceo, junta_principal, junta, staff_contecs |
| `aprobar_pagos` | ceo, junta_principal, junta, finanzas, secretario, staff_contecs |
| `ver_estadisticas_congreso` | ceo, junta_principal, finanzas, staff_contecs |
| `ver_calendario` | todos los roles |
| `gestionar_secretaria` | ceo, secretario |

`tienePermiso(rol, permiso)` devuelve siempre `true` para `ceo`.

### 6.3 Tres capas de autorización

Los permisos se replican deliberadamente en tres lugares y deben mantenerse sincronizados al cambiar un rol:

1. **UI** — `js/core/permisos.js` (qué botones se muestran) + `requirePermiso()` en cada página.
2. **Backend** — conjuntos de roles en `functions/*.js` (`ROLES_VENTA`, `ROLES_COMPRA`, `ROLES_INVENTARIO`, `ROLES_FONDOS`, `ROLES_CONGRESO`, `ROLES_VOLUNTARIADO`, `ROLES_GIRAS`, `ROLES_ENVIAR_CORREO_QR`, `ROLES_LISTAR_PARTICIPANTES_GIRAS`).
3. **Reglas** — `firebase_rules/firestore.rules` y `storage.rules` (`isStaff()`, `canGestionarParticipantes()`, `hasRol([...])`).

---

## 7. Modelo de datos (Firestore)

27 colecciones. Convención: nombres en español, snake_case; marcas de tiempo `creadoEn` / `actualizadoEn` con `serverTimestamp()`.

### 7.1 Usuarios y participantes

| Colección | Contenido | Escritura |
|---|---|---|
| `usuarios/{uid}` | `nombre`, `email`, `foto`, `rol`, `creadoEn`. Espejo del usuario de Firebase Auth. | Cliente: alta propia con `rol: "sin_rol"` y edición de `nombre`/`foto`; cambio de rol solo `ceo`/`junta_principal`. |
| `participantes/{docId}` | Inscrito al congreso. `docId` = `c_<cédula>` o `e_<correo>`. Campos: `codigo` (`CTCS-2026-00001`), `token`, `nombre`, `apellido`, `nombreCompleto`, `cedula`, `correo`, `telefono`, `categoria`, `categoriaNombre`, `camposExtra`, `pago{metodo, estado, comprobanteRuta, monto, aprobadoPor, aprobadoEn, notas}`, `esColegio`, `tutor`, `colegio`, `estudiantes[]`, `estadoRegistro`, `asistencias{}`, `correo_enviado`, `correo_pendiente`, `fechaRegistro`. | Alta solo por Cloud Function; actualización por staff sin tocar `asistencias`/`totalAsistencias`. |
| `identificadores_participantes/{hash}` | Cerrojos anti-duplicado: `correo_<sha256>` y `cedula_<sha256>`. | Solo Admin SDK (`read, write: if false`). |
| `contadores/inscripciones2026` | Contador secuencial de códigos de participante. | Solo Admin SDK. |
| `limites_registro/{id}` | Límite antiabuso por IP (máx. 25 registros/hora). | Solo Admin SDK. |

**Estados de pago:** `pendiente_efectivo` → `aprobado`; `comprobante_enviado` → `aprobado` / `rechazado`.

### 7.2 Congreso

| Colección | Contenido |
|---|---|
| `eventos/{id}` | Eventos del programa (fecha, lugar, tipo). |
| `checkpoints/{id}` | Puntos de control físicos: `titulo`, `tipo` (incluye talleres con cupo), `cupos`/`cuposDisponibles`, horario, `eventoId`. |
| `inscripciones/{id}` | Colección histórica/alterna de inscritos (compatibilidad). |
| `inscripciones_checkpoint/{id}` | Inscripción in-situ a un taller (decrementa cupos). Solo Admin SDK. |
| `asistencias_congreso/{id}` | Registro auditable de cada asistencia confirmada por QR. Solo Admin SDK. |

### 7.3 Finanzas e inventario

| Colección | Contenido |
|---|---|
| `productos/{id}` | `nombre`, `precioVenta`, `precioCompra`/`ultimoCosto`, `stock`, `alertaMinima`, `iconoId`, `categoriaId`, `activo`. |
| `categorias/{id}` | Categorías del catálogo, con icono. |
| `ventas/{id}` | `items[]` (con `precioUnitario`, `costoUnitario`, utilidad por línea), `total`, `utilidadTotal`, `perdidaTotal`, `metodoPago`, `mermas[]`, `actividadVentaId/Nombre`, `usuarioId/Nombre`. |
| `compras/{id}` | `proveedor`, `items[]`, `total`, `metodoPago`, `factura`, `facturaEstado` (`pendiente`/`subida`), `facturaError`. |
| `mermas/{id}` | Pérdidas de inventario: `items[]`, `motivo`, `totalPerdida`, `referenciaVenta`. |
| `movimientos_inventario/{id}` | Kardex: `tipo` (entrada/salida), `origen` (venta/compra/ajuste/merma), `antes`, `despues`, `motivo`, `referenciaId`. |
| `fondos/principal` | Único documento con `balance` y `actualizadoEn`. Nadie puede escribirlo desde el cliente. |
| `fondos_entrada/{id}` | Movimientos del fondo: `tipo` (ingreso/salida), `origen` (venta/compra/manual), `monto`, `titulo`, `descripcion`, `referenciaId`, `usuarioId/Nombre`. |
| `actividades_ventas/{id}` | Actividades comerciales (ferias, jornadas) a las que se imputa cada venta; `activo`. |

### 7.4 Voluntariado y giras

| Colección | Contenido |
|---|---|
| `voluntarios/{id}` | Datos del voluntario y `totalHoras` (solo acumulable por backend). |
| `actividades_voluntarios/{id}` | Actividades con `turnos[]` (Diurno 07:50–12:00, Vespertino 12:50–17:00, Nocturno 17:50–22:00). |
| `asignaciones_voluntarios/{id}` | Asignación de voluntarios a actividades/turnos. |
| `asistencias_voluntarios/{voluntario_actividad_turno}` | Entrada/salida por QR y horas calculadas. Solo Admin SDK. |
| `giras_voluntarios/{id}` | Giras/excursiones: datos, cupo y lista de participantes seleccionados. |
| `asistencias_giras/{id}` | Check-in (`entrada`) y check-out (`salida`) de gira. Solo Admin SDK. |

### 7.5 Formularios y secretaría

| Colección | Contenido |
|---|---|
| `solicitudes_actividad/{id}` | Solicitud universitaria de actividad, con número correlativo. |
| `informes_actividad/{id}` | Informe posterior a la actividad. |
| `reuniones/{id}` | Reuniones y minutas (Secretaría). |

Todo lo no declarado explícitamente en las reglas está denegado (`match /{document=**} { allow read, write: if false; }`).

---

## 8. Cloud Functions

Todas en `us-central1`. Definidas/exportadas desde `functions/index.js`.

| Función | Tipo | Acceso | Propósito |
|---|---|---|---|
| `registrarParticipante` | `onCall` (`invoker: public`) | Público | Alta de inscripción (individual o grupo de colegio) con validación, límite por IP, códigos correlativos y cerrojos anti-duplicado. |
| `accederParticipante` | `onCall` (público) | Público | Devuelve los datos saneados del participante a partir de `código + token` (usado por `perfil.html`). |
| `accederGiraParticipante` | `onCall` (público) | Público | Igual, pero para la página pública de una gira (`gira.html`), validando pertenencia a la gira. |
| `ejecutarOperacionFinanciera` | `onCall` | Staff autorizado | Enrutador de operaciones contables: `venta`, `venta_merma`, `compra`, `ajuste_stock`, `merma`, `movimiento_fondo`. |
| `ejecutarOperacionQr` | `onCall` | Staff autorizado | Enrutador QR: `asistencia_participante`, `inscripcion_taller`, `asistencia_voluntario`. |
| `marcarCheckpointGira` | `onCall` | ceo, junta_principal, giras | Check-in/check-out de gira; no valida estado de pago del congreso. |
| `listarParticipantesParaGiras` | `onCall` | ceo, junta_principal, giras | Lista mínima (id, nombre, cédula, código, categoría) para armar giras sin exponer `/participantes`. |
| `notificarParticipantesGira` | `onCall` | ceo, junta_principal, giras | Envía el correo de gira solo a quienes aún no fueron notificados. |
| `enviarCorreoQrParticipante` | `onCall` | Staff con permiso de correo | Envía/reenvía el correo de pago aprobado con enlace a la credencial (máx. 4 reenvíos). |
| `notificarPagoAprobado` | Trigger `onDocumentUpdated` sobre `participantes/{id}` | — | Al pasar `pago.estado` a `aprobado`, envía el correo y propaga la aprobación a los estudiantes del grupo de colegio. |
| `subirFotoEfectivo` | `onCall` | Staff con permiso de pagos | Sube la foto del pago en efectivo a Storage y actualiza `pago.comprobanteRuta`. |
| `validarTokenSSO` | `onRequest` | Orígenes permitidos | Valida el token del SSO UTP y devuelve un custom token de Firebase. |

### 8.1 Operaciones financieras (`functions/operaciones-financieras.js`)

Todas se ejecutan dentro de `db.runTransaction`, de modo que stock, fondo y documentos quedan consistentes o no se aplica nada.

- **Venta** (`venta` / `venta_merma`)
  1. Valida rol (`ROLES_VENTA`) y que exista una **actividad de venta** activa.
  2. Carga productos, verifica que estén activos y descuenta stock (rechaza stock negativo).
  3. Calcula precio (permite precio modificado, registrando `precioCatalogo` y `precioModificado`), costo y utilidad por línea.
  4. Crea un documento en `movimientos_inventario` por línea, el documento de `ventas` y, si hubo mermas, en `mermas`.
  5. Incrementa `fondos/principal.balance` y registra el ingreso en `fondos_entrada`.
- **Compra** (`compra`): valida rol (`ROLES_COMPRA`), suma stock, actualiza `precioCompra`/`ultimoCosto`, descuenta del fondo (rechaza saldo insuficiente), crea `compras` con `facturaEstado: "pendiente"`. La factura se sube después a Storage (`compras/{id}/facturas/...`) y el cliente actualiza solo `factura`, `facturaEstado`, `facturaError`.
- **Ajuste de stock** (`ajuste_stock`): entrada/salida manual con motivo, sin efecto en el fondo; rechaza stock negativo.
- **Merma** (`merma`): reutiliza el flujo de venta con `items: []`, registrando pérdida sin ingreso monetario.
- **Movimiento de fondo** (`movimiento_fondo`): ingreso/salida manual (`ROLES_FONDOS`), monto entre 0 y 1 000 000; rechaza balance negativo.

Métodos de pago admitidos: `efectivo`, `yappy`, `transferencia`, `tarjeta`, `otro`.

### 8.2 Operaciones QR (`functions/operaciones-qr.js`)

- `asistencia_participante`: valida checkpoint/evento, evita duplicados, escribe `asistencias_congreso` y actualiza `asistencias` y `totalAsistencias` del participante.
- `inscripcion_taller`: verifica que el checkpoint admita cupos, que haya `cuposDisponibles`, evita doble inscripción, decrementa el cupo y crea `inscripciones_checkpoint` + asistencia.
- `asistencia_voluntario`: entrada/salida por `voluntarioId_actividadId_turnoId`, calcula horas y las acumula en `voluntarios.totalHoras`.
- `marcarCheckpointGira`: `entrada`/`salida` en `asistencias_giras`, exige que el participante esté en la lista de la gira.

---

## 9. Seguridad

### 9.1 Reglas de Firestore (`firebase_rules/firestore.rules`)

- Helpers: `signedIn()`, `userExists()`, `userRol()`, `hasRol([...])`, `isStaff()` (lista cerrada de roles) y `canGestionarParticipantes()`.
- Colecciones **solo backend** (`create/update/delete: if false`): `ventas`, `compras` (salvo el cierre de factura), `mermas`, `fondos`, `fondos_entrada`, `movimientos_inventario`, `asistencias_congreso`, `asistencias_voluntarios`, `asistencias_giras`, `inscripciones_checkpoint`, `participantes` (alta), `contadores`, `identificadores_participantes`, `limites_registro`.
- `productos`: la creación exige `stock == 0`, `activo == true` y una lista cerrada de campos; la actualización solo permite `nombre`, `iconoId`, `precioVenta`, `alertaMinima`, `activo`; nunca se borra.
- `usuarios`: cada quien lee y edita su `nombre`/`foto`; el rol solo lo cambian `ceo` y `junta_principal`.
- `reuniones`: escritura solo `ceo` y `secretario`.
- Cierre por defecto: todo lo no declarado está denegado.

### 9.2 Reglas de Storage (`firebase_rules/storage.rules`)

- `comprobantes/{archivo}`: lectura para roles que gestionan participantes; **escritura solo por Admin SDK**.
- `compras/{compraId}/facturas/{archivo}`: lectura y escritura para roles financieros/logísticos, con límite de 10 MB y `contentType` PDF o imagen.
- Resto: denegado.

### 9.3 Endurecimiento adicional

- **Cabeceras HTTP** (`firebase.json`): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()`, `Cache-Control: must-revalidate`.
- **Sanitización** (`js/core/seguridad.js`): `escaparHtml` para todo dato externo insertado en el DOM; `urlHttpSegura`/`urlImagenSegura` para atributos navegables; `neutralizarFormulaHoja` antepone `'` a valores que empiezan por `= + - @` para evitar **inyección de fórmulas** en exportaciones a Excel/CSV.
- **Antiabuso**: máximo 25 registros por hora e IP, máximo 60 estudiantes por grupo de colegio, máximo 4 reenvíos del correo de credencial, comprobantes de hasta 10 MB con tipos permitidos (`application/pdf`, `image/jpeg|png|gif|webp`).
- **Secretos**: `BREVO_API_KEY` se define con `defineSecret` y nunca se versiona. La configuración pública de Firebase (`apiKey` web) sí está en el repo: es identificadora, no secreta, y la protección real está en las reglas.
- **SSO**: `validarTokenSSO` solo acepta orígenes de una lista blanca (`https://contecsfisc.github.io` y localhost de desarrollo).

---

## 10. Flujo público: inscripción al congreso

`registro.html` es un asistente de varios pasos:

1. **Categoría** — se elige entre:

   | Categoría | Precio |
   |---|---|
   | Estudiante UTP | $10 |
   | Estudiante Externo | $20 |
   | Académico UTP | $20 |
   | Académico Externo | $30 |
   | Profesional | $30 |
   | Autor de Resumen | $35 |
   | Otros | $20 |
   | Colegio | $6 por persona |

2. **Datos** — formulario dinámico según la categoría (universidad, facultad, empresa, título del paper, modalidad, coautores, etc.). Los campos específicos se guardan en `camposExtra`.
3. **Grupo de colegio** — el tutor registra a sus estudiantes (grado, bachillerato); el total es `$6 × (1 + n estudiantes)`. Tutor y estudiantes se crean en **una sola transacción**: o se guarda todo el grupo o nada.
4. **Pago** — `transferencia`/Yappy (exige adjuntar comprobante, enviado en Base64 y almacenado por la función) o `efectivo` (el staff sube después la foto del pago).
5. **Confirmación** — el backend genera el `código` correlativo (`CTCS-2026-#####`) y un `token` aleatorio de 24 bytes.

**Anti-duplicados:** además de los cerrojos hash en `identificadores_participantes`, se consulta la colección histórica por correo para bloquear inscripciones anteriores a la introducción de los cerrojos. Si la transacción falla, el comprobante ya subido se elimina.

Tras la aprobación del pago, el trigger `notificarPagoAprobado` envía el correo con el enlace a la credencial. El correo **no** incluye el QR como imagen: enlaza a `public/perfil.html?c=<codigo>&t=<token>`, donde el QR se genera en el navegador.

---

## 11. Credencial digital, QR y checkpoints

### 11.1 `public/perfil.html`

- Acceso con `código + token` (por enlace del correo o escribiéndolos manualmente).
- Muestra estado del pago, datos del participante y la **credencial QR**, generada localmente con `qrcode.min.js`.
- El QR solo se habilita cuando el pago está `aprobado`.
- El QR codifica la URL del perfil (con `c` y `t`), no un JSON crudo; el lector acepta ambos formatos por compatibilidad.

### 11.2 Lectores QR del panel

| Página | Módulo | Uso |
|---|---|---|
| `panel/modulos/congreso/lecturaQR.html` | `lecturaQR.js` | Asistencia al congreso e inscripción in-situ a talleres. |
| `panel/modulos/voluntariado/lecturaQRVoluntarios.html` | `lecturaQRVoluntarios.js` | Entrada/salida de voluntarios por turno. |
| `panel/modulos/voluntariado/lecturaQRGiras.html` | `lecturaQRGiras.js` | Check-in/check-out de gira. |

Todos usan `html5-qrcode` con la cámara (`Permissions-Policy: camera=(self)`) y delegan la escritura en Cloud Functions.

### 11.3 `public/gira.html`

Página pública por gira: el participante entra con `código + token + giraId` (enlace del correo de giras) y ve la información logística de su gira. Reutiliza el token del participante; no crea credenciales nuevas.

---

## 12. Módulo Congreso

| Pantalla | Permiso | Descripción |
|---|---|---|
| **Participantes** (`modulos_participantes.html`) | `ver_participantes` | Listado, búsqueda y filtros de inscritos; revisión de comprobantes, aprobación/rechazo de pagos, reenvío del correo de credencial, vista del QR. |
| **Gestión de Evento** (`inscripciones.html` + `inscripciones.js`) | `gestionar_inscripciones` | Administración de eventos y checkpoints del programa, cupos de talleres, control de asistencia y acceso al lector QR. |
| **Estadísticas** (`reportes_estadisticaCont.html` + `reportes_estadisticaCont.js`) | `ver_estadisticas_congreso` | Gráficas (Chart.js) de asistencia, checkpoints, actividades y voluntarios. Separado a propósito de los reportes financieros para que Staff CONTECS pueda verlas sin acceso a dinero. |

---

## 13. Módulo Finanzas

| Pantalla | Permiso | Descripción |
|---|---|---|
| **Venta Rápida** (`ventaRapida.html` + `ventaRapida.js`) | `acceso_venta_rapida` | POS táctil optimizado para eventos: catálogo por categoría con iconos, combos con reparto proporcional de precio, carrito persistido en `sessionStorage` (se pierde al cerrar la pestaña, no entre vendedores), selección de actividad de venta, método de pago y registro de mermas junto a la venta. |
| **Compras** (`compras2.html` + `compras2.js`; `compras.html`/`compras.js` es la versión previa) | `registrar_compras` | Registro de compras por proveedor, precios por paquete, adjunto de factura (PDF/imagen ≤ 10 MB) y descuento automático del fondo. |
| **Fondos** (`fondos.html` + `fondo.js`) | `ver_fondos` | Saldo del fondo `fondos/principal`, ingresos/salidas manuales y accesos al detalle. |
| **Detalle de fondo** (`detalleFondo.html` + `detalleFondo.js`) | `ver_fondos` | Historial completo de `fondos_entrada` con filtros. |
| **Bitácora** (`bitacora.html`) | `ver_bitacora` | Libro de auditoría unificado: ventas, compras, mermas, movimientos de inventario, movimientos de fondo y actividades de venta en una sola línea de tiempo. |
| **Reportes** (`reportes.html`) | `ver_reportes` | Portal con enlaces al reporte financiero y a las estadísticas del evento. |
| **Reporte financiero** (`reportes_financieros.html` + `reportes_financieros.js`) | `ver_reportes` | KPIs de ventas, compras, mermas y utilidad; agrupación por producto y series mensuales. Exportación a Excel con `reporteFinancieroExcel.js` (ExcelJS, con la paleta de marca y neutralización de fórmulas). |

---

## 14. Módulo Logística

| Pantalla | Permiso | Descripción |
|---|---|---|
| **Inventario** (`inventario.html`) | `ver_inventario` | Stock actual, alertas por `alertaMinima`, ajustes manuales de entrada/salida con motivo. |
| **Catálogo** (`catalogo.html` + `catalogo.js`) | `editar_catalogo` | Alta y edición de categorías y productos, precios, iconos SVG (`js/core/iconos.js`) y desactivación de productos (nunca se borran). |
| **Actividades de venta** (`actividadVentas.html` + `actividadVentas.js`) | `gestionar_ventas` | Crear/activar/desactivar las actividades comerciales a las que se imputan las ventas, con su resumen. |

---

## 15. Módulo Voluntariado y Giras

| Pantalla | Permiso | Descripción |
|---|---|---|
| **Voluntarios** (`voluntarios.html` + `voluntarios.js`) | `gestionar_voluntarios` | Registro de voluntarios, asignación a actividades y turnos, horas acumuladas, generación de **carnets** con Canvas y exportación a Excel. |
| **Actividades** (`actividades.html`) | `gestionar_actividades` | Actividades de voluntariado con turnos Diurno (07:50–12:00), Vespertino (12:50–17:00) y Nocturno (17:50–22:00). |
| **Giras** (`giras.html`) | `gestionar_giras` | Creación de giras, selección manual de participantes (vía `listarParticipantesParaGiras`), notificación por correo y seguimiento de check-in/check-out. |
| **Calendario** (`calendario.html` + `calendario.js`) | `ver_calendario` | Vista unificada de eventos, actividades y reuniones. |
| **Solicitud de actividad** (`solicitudActividad.html` + `solicitudActividad.js`) | `gestionar_actividades` | Formulario universitario con número correlativo automático; exportable a `.docx`. |
| **Informe de actividad** (`informeActividad.html` + `informeActividad.js`) | `gestionar_actividades` | Informe posterior con numeración automática y exportación. |
| **Lectores QR** (`lecturaQRVoluntarios.html`, `lecturaQRGiras.html`) | `gestionar_voluntarios` / `gestionar_giras` | Escaneo de asistencia. |

---

## 16. Módulo Administración y Secretaría

| Pantalla | Permiso | Descripción |
|---|---|---|
| **Usuarios** (`usuarios.html` + `usuarios.js`) | `gestionar_usuarios` | Activación de usuarios `sin_rol` y cambio de rol. El cambio se propaga en vivo a la sesión del afectado. |
| **Exportar** (`exportar.html`) | `exportar_datos` | Punto de acceso a exportaciones de reportes y bitácoras (PDF/Excel). |
| **Secretaría** (`secretaria.html`) | `gestionar_secretaria` | Portal con minutas, agendamiento de reuniones y calendario. |
| **Agendar reunión** (`agendarReunion.html` + `agendarReunion.js`) | `gestionar_secretaria` | Alta de reuniones (presenciales o virtuales) con convocados. |
| **Minutas** (`minutas.html` + `minutas.js`) | `gestionar_secretaria` | Listado de reuniones y sus minutas. |
| **Minuta de reunión** (`minutaReunion.html` + `minutaReunion.js`) | `gestionar_secretaria` | Redacción de la minuta y exportación a `.docx` (`esm.sh/docx@9`). |

`reuniones-utils.js` centraliza quién puede ver y quién puede editar cada reunión.

---

## 17. Reportes y exportaciones

| Salida | Herramienta | Dónde |
|---|---|---|
| Excel financiero con formato de marca | ExcelJS (`js/libs/exceljs.min.js`) | `reporteFinancieroExcel.js` |
| Excel/CSV de listados (participantes, voluntarios, actividades) | SheetJS `XLSX` global | `inscripciones.js`, `voluntarios.js`, `actividadVentas.js` |
| Importación CSV | PapaParse | Carga masiva de datos |
| Documentos `.docx` | `docx@9` vía `esm.sh` | Minutas, solicitudes e informes de actividad |
| PDF | jsPDF | Exportaciones puntuales |
| Gráficas | Chart.js 4.5.0 | Estadísticas del congreso y reportes |

Toda celda proveniente de datos de usuario pasa por `neutralizarFormulaHoja()` antes de exportarse.

---

## 18. Correos transaccionales (Brevo)

- Remitente: **CONTECS 2026** `<contecs.logistica@utp.ac.pa>`.
- Plantillas HTML en `functions/templates/`:
  - `correo-pago-aprobado.html` — confirmación de inscripción con botón hacia la credencial.
  - `correo-notificacion-gira.html` — información de la gira asignada.
- `functions/plantillas.js` carga la plantilla y sustituye los marcadores; `functions/qr-participante.js` construye los enlaces `perfil.html?c=&t=` y `gira.html?c=&t=&g=`.
- Envío con reintentos sobre la API HTTPS de Brevo; el estado se refleja en `correo_enviado` / `correo_pendiente` y se limita a 4 reenvíos por participante.

---

## 19. Despliegue

### 19.1 GitHub Pages (producción actual)

`.github/workflows/deploy.yml` se dispara en cada push a `main`: copia `index.html`, `registro.html`, logos y las carpetas `assets css icons img js panel public` a `_site` y publica con `actions/deploy-pages`. URL base: `https://contecsfisc.github.io/contecsApp/`.

Las Cloud Functions **no** se despliegan desde este workflow.

### 19.2 Firebase

```bash
npm run deploy          # functions + hosting + firestore + storage
firebase deploy --only functions
firebase deploy --only firestore:rules,storage:rules
```

`firebase.json` publica la raíz del repo ignorando `functions/`, `firebase_rules/`, `docs/`, `graph-out/`, `.github/` y archivos de configuración, aplica las cabeceras de seguridad y reescribe `/ms/auth` → `/public/ms/auth.html`. El `predeploy` de functions ejecuta el lint.

Antes de desplegar functions hay que configurar el secreto:

```bash
firebase functions:secrets:set BREVO_API_KEY
```

---

## 20. Desarrollo local, lint y pruebas

```bash
# Emuladores (Firestore, Auth, Functions, Hosting)
npm run emulators

# Lint (ESLint + eslint-config-google sobre functions/)
npm run lint

# Prueba de integración de las operaciones QR contra el emulador de Firestore
cd functions && npm run test:qr
```

Notas:

- No hay paso de build: cualquier servidor estático sirve el frontend (`firebase emulators:start` incluye Hosting en `http://localhost:5000`, origen ya permitido por `validarTokenSSO`).
- El único test automatizado es `functions/test/operaciones-qr.integration.js` (asistencias, talleres y cupos).
- Node.js 22 es el runtime declarado para las funciones.
- El dominio desde el que se sirve la app debe estar en *Firebase Console → Authentication → Authorized domains*, o el login con Google fallará con `auth/unauthorized-domain`.

---

## 21. Mapa de arquitectura (AlphaToolGraph)

`AlphaToolGraph.py` genera un índice estático del proyecto en `graph-out/`:

| Archivo | Uso |
|---|---|
| `GraphCompacto.json` | Enrutador de bajo consumo — **leer primero** para localizar dominio y archivos. |
| `GraphCompleto.json` | Relaciones exactas entre archivos, símbolos y colecciones. |
| `GraphProfundo.json` | Evidencia por línea: símbolos, IDs del DOM, eventos, auditorías. |
| `REPORTE.md` | Resumen legible: archivos de mayor riesgo, god nodes, colecciones, funciones, huérfanos. |
| `graph.html` | Visualización navegable. |

Regenerar con `python AlphaToolGraph.py .` desde la raíz. **Nunca editar `graph-out/` a mano**: todos sus archivos comparten una misma huella del proyecto.

Archivos de mayor riesgo al modificar (según el último reporte): `js/core/auth.js`, `js/core/seguridad.js`, `panel/dashboard.html`, `css/styles.css`, `js/core/firebase-config.js`.

---

## 22. Convenciones de código

- **Idioma:** identificadores, comentarios y textos de UI en español.
- **Módulos ES nativos**, sin transpilación; imports de Firebase por URL con versión fija (`12.12.1`). Al actualizar, hay que cambiar la versión en **todos** los archivos.
- **Nombres:** `camelCase` para funciones y variables, `SCREAMING_SNAKE_CASE` para constantes, `snake_case` para colecciones y campos de Firestore.
- **Patrón de página del panel:**

  ```js
  import { guardRoute, requirePermiso } from "../../../js/core/auth.js";
  guardRoute();
  await requirePermiso("mi_permiso");
  // ...luego cargar datos
  ```

- **Nunca** escribir datos financieros o de asistencia desde el cliente: usar los envoltorios de `js/core/operaciones.js` o `participantes-api.js`.
- **Siempre** escapar datos externos con `escaparHtml()` antes de insertarlos en el DOM y con `neutralizarFormulaHoja()` antes de exportarlos.
- Las versiones de UI se propagan con querystring (`?v=20260817.3`) para invalidar caché.
- Tras tocar código compartido, revisar consumidores, contratos de Firebase, rutas, IDs del DOM y permisos antes de dar por buena la modificación.

---

## 23. Solución de problemas frecuentes

| Síntoma | Causa probable / solución |
|---|---|
| “Acceso pendiente de activación” tras iniciar sesión | El usuario tiene `rol: "sin_rol"`. Un CEO o Junta Directiva_A debe asignarle rol en **Administración → Usuarios**. |
| El login con Google falla con `auth/unauthorized-domain` | Agregar el dominio en Firebase Console → Authentication → Settings → Authorized domains. |
| `permission-denied` al leer una colección | El rol no está incluido en la regla correspondiente de `firestore.rules`; revisar también `permisos.js` y los sets de roles del backend. |
| “Ya existe una inscripción con esta cédula o correo” | Existe un cerrojo en `identificadores_participantes` o un documento histórico en `participantes` con ese correo. |
| “El fondo no tiene saldo suficiente” al registrar una compra | `fondos/principal.balance` es menor que el total; registrar antes un ingreso manual. |
| La compra se guardó pero la factura no | La contabilidad se confirma primero en el servidor; si la subida a Storage falla, la compra queda con `facturaEstado: "pendiente"` y `facturaError`. Se puede reintentar la subida. |
| El participante no recibe el correo | Verificar el secreto `BREVO_API_KEY`, el estado `pago.estado === "aprobado"` y el contador de reenvíos (máx. 4). |
| El QR no aparece en la credencial | El pago aún no está aprobado: el QR se bloquea hasta entonces. |
| La cámara no abre en el lector QR | El sitio debe servirse por HTTPS y `Permissions-Policy` permite `camera=(self)`; revisar permisos del navegador. |
| Cambié un rol y el usuario sigue viendo lo anterior | `escucharCambiosDeRol` recarga automáticamente; si la pestaña estaba inactiva, basta con recargar. |

---

## 24. Glosario

| Término | Significado |
|---|---|
| **Venta Rápida** | Punto de venta táctil optimizado para eventos de alta rotación. |
| **Merma** | Pérdida de inventario (producto dañado, vencido o regalado) sin ingreso monetario. |
| **Fondo** | Cuenta de capital líquido (`fondos/principal`) sobre la que impactan ventas, compras y movimientos manuales. |
| **Bitácora** | Libro de auditoría centralizado de todas las operaciones financieras y de inventario. |
| **Actividad de venta** | Evento comercial (feria, jornada) al que se imputa cada venta para medir su rendimiento. |
| **Checkpoint** | Punto físico de control con QR: asistencia o taller con cupos. |
| **Gira** | Excursión o visita de campo con lista cerrada de participantes y doble checkpoint (entrada/salida). |
| **Turno** | Franja horaria de voluntariado: Diurno, Vespertino o Nocturno. |
| **Carnet** | Credencial de voluntario generada en el navegador con Canvas. |
| **Comprobante** | Prueba de pago (transferencia/Yappy) enviada en Base64 y almacenada en `comprobantes/` de Storage. |
| **Identificadores** | Documentos-cerrojo con hash SHA-256 de correo y cédula que impiden inscripciones duplicadas. |
| **Lógica de Colegio** | Registro padre-hijo: un tutor inscribe y paga por su grupo de estudiantes en una sola transacción. |
| **Neutralizar fórmula** | Anteponer `'` a valores que empiezan por `= + - @` para evitar inyección de fórmulas en Excel/CSV. |
| **SSO UTP** | Single Sign-On institucional de la Universidad Tecnológica de Panamá. |
| **God node** | Archivo con muchísimas conexiones (ej. `js/core/auth.js`); modificarlo es de alto riesgo. |
