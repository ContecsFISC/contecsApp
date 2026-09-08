# Arreglo completo — Giras: correos que no llegan y botón que no se activa

Todo está aplicado dentro del zip. Reemplaza tu carpeta por la del zip, o copia
archivo por archivo respetando las rutas.

## Archivos tocados

| Archivo | Estado |
|---|---|
| `functions/index.js` | modificado |
| `functions/plantillas.js` | modificado |
| `functions/templates/correo-notificacion-gira.html` | modificado |
| `functions/package.json` | modificado |
| `functions/test/diagnostico-correo.js` | **nuevo** |
| `functions/test/plantillas.test.js` | **nuevo** |
| `functions/test/envios.test.js` | **nuevo** |
| `js/core/participantes-api.js` | modificado |
| `js/modulos/voluntarios.js` | modificado |

**60 pruebas pasan** (`npm --prefix functions test`). Antes eran 31.

---

# Parte 1 — Por qué no llegaban los correos

### 1. El límite de velocidad de Brevo (la causa principal)

`notificarParticipantesGira` y `notificarNoSeleccionadosGira` disparaban todos
los correos a la vez con `Promise.allSettled(lista.map(...))`. Una gira de 40
personas abría 40 peticiones simultáneas contra Brevo, que responde **429** a la
mayoría. Y `brevoRequest` solo reintentaba en 5xx, así que esos 429 se perdían.

**Arreglado:**
- `enLotes(items, limite, tarea)` envía con un máximo de 4 correos simultáneos
  (`ENVIOS_SIMULTANEOS`). Sustituye a `Promise.allSettled` en las dos funciones.
- `brevoRequest` reintenta hasta 4 veces en **429**, 5xx y cortes de red, con
  espera creciente, algo de aleatoriedad y respetando el `Retry-After` de Brevo.
- `brevoRequestOnce` ahora expone `statusCode` y `retryAfter` en el error.
- No se reintenta en 400 ni 401: un correo inválido o una API key vencida no se
  arreglan repitiendo.

### 2. Los fallos eran invisibles

Se contaba `fallidos` y se descartaba `r.reason`. En el panel salía "3 no se
pudo(ieron) enviar" y en los logs de Cloud Functions no quedaba nada. Un correo
mal escrito, una API key vencida y un remitente sin verificar se veían igual.

**Arreglado:** `resumirEnvios` devuelve `errores: [{destinatario, motivo}]`, cada
fallo se escribe con `console.error`, y el panel muestra hasta 5 destinatarios
con su motivo.

### 3. `name` vacío rechazado por Brevo

`enviarCorreoNotificacionGira` y `enviarCorreoPagoAprobado` mandaban siempre
`to: [{email, name: nombre}]`. Con `nombre` vacío, Brevo responde 400. Solo el
aviso a no seleccionados se cuidaba de esto.

**Arreglado** en las tres funciones: `name` solo va si hay nombre.

### 4. Correo del participante sin validar

Solo se comprobaba que no estuviera vacío. Direcciones con basura pegada
(`<ana@x.com`, `ana@gmail.com.`) llegaban tal cual a Brevo.

**Arreglado:** `esCorreoValido` también en la ruta de participantes, igual que ya
hacía la de no seleccionados.

### 5. La trampa del "ya fueron notificados"

`gira.notificados` nunca se limpiaba. Si un envío se marcó como exitoso pero el
correo no llegó, o si cambiabas la hora o el lugar después, el botón contestaba
"Todos ya fueron notificados" y no había forma de reintentar.

**Arreglado:**
- Parámetro `forzar` en ambas Cloud Functions.
- Botones **Reenviar** y **Reenviar aviso** en la tarjeta, visibles solo si ya
  hubo un envío previo, con confirmación.
- Al guardar una gira se limpia de `notificados` a quien ya no está en la lista.
  Antes, si sacabas a alguien y lo volvías a añadir, su id seguía marcado y nunca
  recibía el correo de la nueva selección.

### 6. "Hola ," en el correo

Un participante sin nombre guardado recibía el saludo vacío.

**Arreglado:** la plantilla de gira usa `{{saludo_html}}`, igual que ya hacía la
de no seleccionados.

---

# Parte 2 — Por qué el botón no se activaba

Tu consola mostraba `ERR_BLOCKED_BY_CLIENT` contra `firestore.googleapis.com`.
**No es un error del código**: algo en tu navegador corta la petición antes de
que salga (bloqueador de anuncios, extensión de privacidad, Shields de Brave, o
el proxy de la universidad).

La cadena era esta:

1. La extensión bloquea Firestore.
2. `cargarGiras()` fallaba y tenía un `catch { giras = []; }` **vacío**.
3. La pantalla pintaba las giras con `participantes` vacío.
4. El botón se deshabilitaba porque su única condición era
   `(g.participantes || []).length`.

Desde el panel se veía idéntico a "esta gira no tiene participantes".

### Lo que arreglé

**Siete cargas silenciaban errores exactamente igual** (giras, actividades,
voluntarios, asistencias, ventas, asignaciones, solicitudes). Todas migradas a un
helper único:

- `leerDocs(consulta, etiqueta)` — lee y, si falla, avisa en vez de callar.
- `pistaDeErrorDeRed(e)` — cuando el error huele a red, sugiere el bloqueador y
  el modo incógnito; cuando es `permission-denied`, lo dice.
- `avisarFalloDeCarga` — con un tope de 4 s entre avisos, porque si Firestore
  está bloqueado fallan las siete cargas a la vez y saldrían siete alertas
  iguales.
- El mensaje advierte explícitamente que **la lista está vacía por el error, no
  porque no haya datos**, para que nadie recree giras que sí existen.

**El tooltip del botón deshabilitado explica por qué lo está**, incluida la pista
del bloqueador. Y el botón muestra el número de participantes.

**"Guardar gira" ya no se cuelga.** Con la red cortada, el SDK de Firestore encola
la escritura y la promesa queda pendiente para siempre: el botón se quedaba en
"Guardando..." y parecía que había guardado. Ahora hay un tope de 20 s y un
mensaje que aclara que el formulario no se limpió.

**Los toasts respetan los saltos de línea** (`white-space: pre-line`), que hacía
falta para que el detalle de errores se lea como lista.

---

# Cómo desplegar

Tu workflow de GitHub Actions **solo publica el frontend**. Las funciones van a
mano.

```bash
cd functions
npm install            # el zip no trae node_modules
npm test               # 60 pruebas, deben pasar todas
npm run lint

cd ..
firebase deploy --only functions
```

El frontend (`js/`) se publica solo al hacer push a `main`.

---

# Antes de mandarle a una gira completa

**1. Quita el bloqueo del navegador.** Abre el panel en incógnito con las
extensiones desactivadas. Si el botón se activa, era eso. Después, agrega
`firestore.googleapis.com` a la lista blanca de tu bloqueador.

Ojo: la URL de tu error era del canal de **Write**, así que probablemente también
se bloqueó algún guardado. Entra a editar la gira y confirma que los
participantes siguen ahí antes de notificar.

**2. Comprueba Brevo.**

```bash
export BREVO_API_KEY="$(firebase functions:secrets:access BREVO_API_KEY)"

npm --prefix functions run diag:correo                        # solo revisa
node functions/test/diagnostico-correo.js tucorreo@utp.ac.pa  # además envía
```

El script separa los tres fallos que desde el panel se ven igual:

1. **API key inválida (401)** — se regeneró en Brevo y no se volvió a guardar en
   Secret Manager, o se guardó pero no se redesplegó.
2. **Remitente sin verificar** — `contecs.logistica@utp.ac.pa` tiene que estar
   dado de alta **y** confirmado en Brevo. Es la causa nº1 de que no llegue nada.
   El script te lista los remitentes que sí existen en la cuenta.
3. **Sin créditos** — el plan gratuito de Brevo son 300 correos/día.

El correo de prueba usa la plantilla real de gira, así que también te sirve para
verla antes de mandársela a 40 personas.

Si el script dice que Brevo aceptó el correo pero igual no llega, el problema ya
no es del código: míralo en Brevo → *Transactional* → *Logs*, que te dice si fue
rebote, bloqueo o spam.

**3. Si algo falla en el envío real**, ahora sí hay rastro:

```bash
firebase functions:log --only notificarParticipantesGira
```

Sale una línea por destinatario con el motivo exacto.
