# Mapa de arquitectura — contecsApp

- Generado: **2026-10-15T18:12:41.323696+00:00**
- AlphaToolGraph: **v4.0.0** · esquema **4**
- Huella del proyecto: `8694af1d6e511a44…`
- Archivos analizados: **255**
- Relaciones internas tipadas: **1110**
- Símbolos detectados: **6484**
- Llamadas detectadas: **14077**
- IDs DOM definidos: **1163**
- Paquetes externos usados: **34**
- Colecciones de Firestore detectadas: **39**
- Cloud Functions detectadas: **28**
- Archivos huerfanos: **83**
- Dependencias circulares: **0**
- Posibles acoples implicitos (via window.X, sin confirmar): **5**

- Diagnósticos: **0 errores · 0 advertencias**

## Cerebro para IA: tres niveles

- `GraphCompacto.json` — ~**18,824 tokens** · leer primero
- `GraphCompleto.json` — ~**89,006 tokens** · relaciones exactas
- `GraphProfundo.json` — ~**157,600 tokens** · evidencia exhaustiva
- Reducción estimada al empezar por el compacto: **88.1%** frente al profundo

## Diagnósticos de integridad

Hallazgos estáticos: deben confirmarse en código cuando intervienen rutas o valores dinámicos.

- 🔵 `js/modulos/voluntarios.js:362` — ID DOM opcional #sel-actividad no está en las páginas anfitrionas (uso protegido)

## Archivos de mayor RIESGO al modificar

Combina: cuantas conexiones tiene, si esta metido en un ciclo, y su tamaño. Revisa estos primero.

- `js/core/auth.js` — riesgo 353.7 (conexiones: 175, 369 lineas)
- `panel/dashboard.html` — riesgo 136.9 (conexiones: 61, 1495 lineas)
- `panel/modulos/congreso/modulos_participantes.html` — riesgo 116.6 (conexiones: 47, 2256 lineas)
- `js/core/seguridad.js` — riesgo 116.4 (conexiones: 58, 40 lineas)
- `js/modulos/voluntarios.js` — riesgo 94.7 (conexiones: 30, 3317 lineas)
- `manifest.json` — riesgo 90.3 (conexiones: 45, 34 lineas)
- `apple-touch-icon.png` — riesgo 90.0 (conexiones: 45, 0 lineas)
- `favicon.ico` — riesgo 90.0 (conexiones: 45, 0 lineas)
- `js/core/navbar-pagina.js` — riesgo 85.3 (conexiones: 42, 135 lineas)
- `js/core/firebase-config.js` — riesgo 84.3 (conexiones: 42, 35 lineas)
- `css/styles.css` — riesgo 81.2 (conexiones: 36, 922 lineas)
- `js/modulos/inscripciones.js` — riesgo 81.2 (conexiones: 30, 2121 lineas)
- `js/modulos/credenciales.js` — riesgo 81.1 (conexiones: 36, 911 lineas)
- `css/navbar.css` — riesgo 80.5 (conexiones: 36, 846 lineas)
- `panel/modulos/logistica/catalogo.html` — riesgo 76.8 (conexiones: 34, 880 lineas)

## God nodes (mas conectados) y que exponen

- `js/core/auth.js` — grado 175 | exporta: aplicarPermisosDom, cargarUsuario, cerrarSesion, escucharCambiosDeRol, esperarSesionLista, getUsuarioActual, guardRoute, loginConGoogle
- `panel/dashboard.html` — grado 61 | exporta: (sin exports detectados)
- `js/core/seguridad.js` — grado 58 | exporta: escaparAtributo, escaparHtml, neutralizarFormulaHoja, urlHttpSegura, urlImagenSegura
- `panel/modulos/congreso/modulos_participantes.html` — grado 47 | exporta: (sin exports detectados)
- `apple-touch-icon.png` — grado 45 | exporta: (sin exports detectados)
- `favicon.ico` — grado 45 | exporta: (sin exports detectados)
- `manifest.json` — grado 45 | exporta: (sin exports detectados)
- `js/core/firebase-config.js` — grado 42 | exporta: analytics, app, auth, db, storage
- `js/core/navbar-pagina.js` — grado 42 | exporta: (sin exports detectados)
- `css/navbar.css` — grado 36 | exporta: (sin exports detectados)
- `css/styles.css` — grado 36 | exporta: (sin exports detectados)
- `css/tokens.css` — grado 36 | exporta: (sin exports detectados)
- `js/modulos/credenciales.js` — grado 36 | exporta: LIMITES, TAMANOS, TEMAS, categoriaDe, codigoDe, descargarBlob, dibujarCredencial, generarPdf
- `panel/modulos/logistica/catalogo.html` — grado 34 | exporta: (sin exports detectados)
- `css/movil.css` — grado 33 | exporta: (sin exports detectados)

## 🟡 Posibles acoples implicitos (via variables globales `window.X`)

Esto es HEURISTICO, no certeza — revisalo a ojo antes de asumir que es real:

- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/inscripciones.js`
- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/actividadVentas.js`
- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/voluntarios.js`
- `window.eliminarActividad` definida en `js/modulos/voluntarios.js`, leida en `docs/cambios recientes.md`
- `window.eliminarGira` definida en `js/modulos/voluntarios.js`, leida en `docs/cambios recientes.md`

## Cloud Functions detectadas

- `functions/index.js`: accederGiraParticipante, accederParticipante, accederPersonal, asegurarTokensPersonal, cambiarRolUsuario, desbloquearUsuarios, ejecutarOperacionFinanciera, ejecutarOperacionQr, eliminarEventoOCheckpoint, eliminarParticipante, eliminarUsuario, entrarConLinkPosper, enviarCorreoQrParticipante, guardarPermisosRol, guardarPermisosUsuario, importarParticipantes, liberarIdentidadParticipante, linkAccesoPosper, listarParticipantesParaGiras, mapaPublico, marcarCheckpointGira, notificarNoSeleccionadosGira, notificarPagoAprobado, notificarParticipantesGira, registrarParticipante, registrarVoluntario, subirFotoEfectivo, validarTokenSSO

## Archivos huerfanos

- `.claude/settings.json`
- `AGENTS.md`
- `assets/img/fisc-logo.png`
- `assets/img/utp-logo.png`
- `docs/Sprint 2 - bitacora_actualizaciones.md`
- `docs/arreglo-giras-correos.md`
- `docs/cambios recientes.md`
- `firebase.json`
- `firebase_rules/firebase_backup.json`
- `firebase_rules/firestore.indexes.json`
- `firebase_rules/firestore.rules`
- `firebase_rules/storage.rules`
- `functions/.eslintrc.js`
- `functions/package.json`
- `functions/templates/correo-no-seleccionado-gira.html`
- `functions/templates/correo-notificacion-gira.html`
- `functions/templates/correo-pago-aprobado.html`
- `functions/test/envios.test.js`
- `functions/test/permisos-reglas.integration.mjs`
- `icons/bebida-lata.svg`
- `img/credenciales/expositor.jpg`
- `img/credenciales/organizador.jpg`
- `img/credenciales/participante.jpg`
- `img/credenciales/voluntario.jpg`
- `img/iconos/activar.svg`
- `img/iconos/agua.svg`
- `img/iconos/bubble_tea.svg`
- `img/iconos/cafe.svg`
- `img/iconos/caja.svg`
- `img/iconos/cancelar.svg`
- `img/iconos/cat_bebidas.svg`
- `img/iconos/cat_comida.svg`
- `img/iconos/cat_dulces.svg`
- `img/iconos/cat_otros.svg`
- `img/iconos/cat_postres.svg`
- `img/iconos/cat_snacks.svg`
- `img/iconos/chocolate.svg`
- `img/iconos/combo.svg`
- `img/iconos/combo_hamburguesa_soda.svg`
- `img/iconos/combo_pizza_soda.svg`
- ...y 43 mas

## Colecciones de Firestore y quien las usa

### `actividades_ventas`
- `functions/operaciones-financieras.js`
- `js/modulos/actividadVentas.js`
- `js/modulos/ventaRapida.js`
- `js/modulos/voluntarios.js`
- `panel/modulos/finanzas/bitacora.html`

### `actividades_voluntarios`
- `functions/operaciones-qr.js`
- `functions/personal.js`
- `js/modulos/informeActividad.js`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/mapa.js`
- `js/modulos/reportes_estadisticaCont.js`
- `js/modulos/voluntarios.js`

### `asignaciones_voluntarios`
- `js/modulos/voluntarios.js`

### `asistencias_congreso`
- `functions/eliminaciones.js`
- `functions/mapa-publico.js`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `functions/test/permisos-reglas.integration.mjs`
- `js/modulos/inscripciones.js`
- `js/modulos/mapa.js`
- `js/modulos/reportes_estadisticaCont.js`

### `asistencias_giras`
- `functions/eliminaciones.js`
- `functions/index.js`
- `functions/operaciones-qr.js`

### `asistencias_voluntarios`
- `functions/operaciones-qr.js`
- `functions/personal.js`
- `functions/test/permisos-reglas.integration.mjs`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/reportes_estadisticaCont.js`
- `js/modulos/voluntarios.js`

### `cambios_permisos`
- `functions/permisos-admin.js`
- `functions/test/permisos-admin.integration.js`

### `cambios_rol`
- `functions/cambio-rol.js`
- `functions/test/cambio-rol.integration.js`

### `categorias`
- `js/modulos/catalogo.js`
- `js/modulos/reporteFinancieroExcel.js`

### `checkpoints`
- `functions/eliminaciones.js`
- `functions/eliminar-eventos.js`
- `functions/mapa-publico.js`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `js/core/salones-firestore.js`
- `js/modulos/gestorCredenciales.js`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/mapa.js`
- ...y 3 archivos mas

### `compras`
- `functions/operaciones-financieras.js`
- `functions/test/permisos-reglas.integration.mjs`
- `js/core/operaciones.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `config`
- `functions/acceso-posper.js`
- `functions/permisos-admin.js`
- `js/core/auth.js`
- `js/modulos/usuarios.js`

### `correos_voluntarios`
- `functions/registro-voluntarios.js`

### `credenciales_impresas`
- `js/modulos/gestorCredenciales.js`

### `eventos`
- `functions/eliminar-eventos.js`
- `functions/mapa-publico.js`
- `functions/operaciones-qr.js`
- `functions/personal.js`
- `functions/test/operaciones-qr.integration.js`
- `js/modulos/gestorCredenciales.js`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/mapa.js`
- ...y 5 archivos mas

### `expositores`
- `js/modulos/gestorCredenciales.js`
- `js/modulos/inscripciones.js`

### `fondos`
- `functions/test/permisos-reglas.integration.mjs`
- `js/modulos/detalleFondo.js`
- `js/modulos/fondo.js`
- `panel/dashboard.html`

### `fondos_entrada`
- `functions/operaciones-financieras.js`
- `js/modulos/detalleFondo.js`
- `js/modulos/fondo.js`
- `panel/modulos/finanzas/bitacora.html`

### `giras_voluntarios`
- `functions/eliminaciones.js`
- `functions/index.js`
- `functions/operaciones-qr.js`
- `js/modulos/lecturaQRGiras.js`
- `js/modulos/voluntarios.js`

### `identificadores_participantes`
- `functions/eliminaciones.js`
- `functions/registro.js`
- `functions/test/importaciones.integration.js`

### `identificadores_voluntarios`
- `functions/registro-voluntarios.js`

### `informes_actividad`
- `js/modulos/informeActividad.js`

### `inscripciones`
- `functions/test/operaciones-qr.integration.js`
- `functions/test/permisos-reglas.integration.mjs`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/reportes_estadisticaCont.js`

### `inscripciones_checkpoint`
- `functions/eliminaciones.js`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `functions/test/permisos-reglas.integration.mjs`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/reportes_estadisticaCont.js`

### `intentos_cambio_rol`
- `functions/cambio-rol.js`

### `limites_registro`
- `functions/index.js`

### `mermas`
- `functions/operaciones-financieras.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `movimientos_inventario`
- `functions/operaciones-financieras.js`
- `panel/modulos/finanzas/bitacora.html`

### `participantes`
- `functions/eliminaciones.js`
- `functions/importaciones.js`
- `functions/index.js`
- `functions/operaciones-qr.js`
- `functions/registro.js`
- `functions/test/importaciones.integration.js`
- `functions/test/operaciones-qr.integration.js`
- `functions/test/permisos-reglas.integration.mjs`
- `js/modulos/gestorCredenciales.js`
- `js/modulos/inscripciones.js`
- ...y 6 archivos mas

### `productos`
- `functions/operaciones-financieras.js`
- `js/modulos/actividadVentas.js`
- `js/modulos/catalogo.js`
- `js/modulos/compras.js`
- `js/modulos/compras2.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `js/modulos/ventaRapida.js`
- `panel/dashboard.html`
- `panel/modulos/finanzas/bitacora.html`
- ...y 1 archivos mas

### `publico`
- `functions/mapa-publico.js`

### `reuniones`
- `js/modulos/agendarReunion.js`
- `js/modulos/minutaReunion.js`
- `js/modulos/minutas.js`
- `panel/dashboard.html`

### `rfid_participantes`
- `functions/eliminaciones.js`
- `functions/eliminar-eventos.js`
- `functions/operaciones-qr.js`

### `salones`
- `functions/mapa-publico.js`
- `js/core/salones-firestore.js`

### `solicitudes_actividad`
- `js/modulos/informeActividad.js`
- `js/modulos/solicitudActividad.js`
- `js/modulos/voluntarios.js`

### `turnos_congreso`
- `functions/operaciones-qr.js`
- `functions/personal.js`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/voluntarios.js`

### `usuarios`
- `functions/acceso-posper.js`
- `functions/cambio-rol.js`
- `functions/eliminaciones.js`
- `functions/eliminar-eventos.js`
- `functions/importaciones.js`
- `functions/index.js`
- `functions/operaciones-financieras.js`
- `functions/operaciones-qr.js`
- `functions/permisos-admin.js`
- `functions/personal.js`
- ...y 15 archivos mas

### `ventas`
- `functions/operaciones-financieras.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `voluntarios`
- `functions/operaciones-qr.js`
- `functions/personal.js`
- `functions/registro-voluntarios.js`
- `functions/test/permisos-reglas.integration.mjs`
- `functions/test/registro-voluntarios.integration.js`
- `js/modulos/gestorCredenciales.js`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/reportes_estadisticaCont.js`
- `js/modulos/voluntarios.js`
- `panel/dashboard.html`

## Cobertura de reglas de Firestore

- `actividades_ventas` — regla explícita · 7 operaciones detectadas
- `actividades_voluntarios` — regla explícita · 9 operaciones detectadas
- `asignaciones_voluntarios` — regla explícita · 3 operaciones detectadas
- `asistencias_congreso` — regla explícita · 3 operaciones detectadas
- `asistencias_giras` — regla explícita · 1 operaciones detectadas
- `asistencias_voluntarios` — regla explícita · 2 operaciones detectadas
- `cambios_permisos` — regla explícita · 0 operaciones detectadas
- `cambios_rol` — regla explícita · 0 operaciones detectadas
- `categorias` — regla explícita · 4 operaciones detectadas
- `checkpoints` — regla explícita · 13 operaciones detectadas
- `compras` — regla explícita · 4 operaciones detectadas
- `comprobantes` — regla explícita · 0 operaciones detectadas
- `config` — regla explícita · 1 operaciones detectadas
- `contadores` — regla explícita · 0 operaciones detectadas
- `correos_voluntarios` — regla explícita · 0 operaciones detectadas
- `credenciales_impresas` — regla explícita · 3 operaciones detectadas
- `eventos` — regla explícita · 12 operaciones detectadas
- `expositores` — regla explícita · 6 operaciones detectadas
- `fondos` — regla explícita · 1 operaciones detectadas
- `fondos_entrada` — regla explícita · 6 operaciones detectadas
- `giras_voluntarios` — regla explícita · 5 operaciones detectadas
- `identificadores_participantes` — regla explícita · 0 operaciones detectadas
- `identificadores_voluntarios` — regla explícita · 0 operaciones detectadas
- `informes_actividad` — regla explícita · 2 operaciones detectadas
- `inscripciones` — regla explícita · 3 operaciones detectadas
- `inscripciones_checkpoint` — regla explícita · 6 operaciones detectadas
- `intentos_cambio_rol` — regla explícita · 0 operaciones detectadas
- `limites_registro` — regla explícita · 0 operaciones detectadas
- `mermas` — regla explícita · 3 operaciones detectadas
- `movimientos_inventario` — regla explícita · 1 operaciones detectadas
- `participantes` — regla explícita · 7 operaciones detectadas
- `productos` — regla explícita · 19 operaciones detectadas
- `publico` — regla explícita · 0 operaciones detectadas
- `reuniones` — regla explícita · 8 operaciones detectadas
- `rfid_participantes` — regla explícita · 1 operaciones detectadas
- `salones` — regla explícita · 3 operaciones detectadas
- `solicitudes_actividad` — regla explícita · 3 operaciones detectadas
- `turnos_congreso` — regla explícita · 1 operaciones detectadas
- `usuarios` — regla explícita · 12 operaciones detectadas
- `ventas` — regla explícita · 4 operaciones detectadas
- `voluntarios` — regla explícita · 10 operaciones detectadas

## Tipos de relaciones

- `calls_imported_symbol`: 359
- `imports`: 305
- `loads_asset`: 160
- `loads_stylesheet`: 143
- `loads_script`: 76
- `navigates_to`: 67

## Paquetes/SDKs externos

- `crypto` — usado en 7 archivo(s)
- `firebase-admin/app` — usado en 10 archivo(s)
- `firebase-admin/auth` — usado en 3 archivo(s)
- `firebase-admin/firestore` — usado en 22 archivo(s)
- `firebase-admin/storage` — usado en 2 archivo(s)
- `firebase-functions/params` — usado en 1 archivo(s)
- `firebase-functions/v2` — usado en 1 archivo(s)
- `firebase-functions/v2/core` — usado en 1 archivo(s)
- `firebase-functions/v2/firestore` — usado en 1 archivo(s)
- `firebase-functions/v2/https` — usado en 13 archivo(s)
- `fs` — usado en 2 archivo(s)
- `https` — usado en 2 archivo(s)
- `https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.min.js` — usado en 2 archivo(s)
- `https://contecs-app.vercel.app/logocontecs.png` — usado en 4 archivo(s)
- `https://esm.sh/docx@9` — usado en 3 archivo(s)
- `https://esm.sh/qrcode@1.5.4` — usado en 1 archivo(s)
- `https://fonts.googleapis.com` — usado en 45 archivo(s)
- `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap` — usado en 45 archivo(s)
- `https://fonts.gstatic.com` — usado en 45 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js` — usado en 1 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js` — usado en 1 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js` — usado en 6 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js` — usado en 37 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js` — usado en 15 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js` — usado en 3 archivo(s)
- `node:assert/strict` — usado en 22 archivo(s)
- `node:crypto` — usado en 1 archivo(s)
- `node:module` — usado en 3 archivo(s)
- `path` — usado en 2 archivo(s)
- `readline` — usado en 1 archivo(s)
- `three` — usado en 1 archivo(s)
- `three/addons/controls/OrbitControls.js` — usado en 1 archivo(s)
- `three/addons/renderers/CSS2DRenderer.js` — usado en 1 archivo(s)
- `vm` — usado en 1 archivo(s)
