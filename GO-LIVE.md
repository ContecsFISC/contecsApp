# CONTECS — Runbook de go-live (VM como sistema oficial)

Guía para el día en que la UTP entregue la infraestructura y CONTECS pase a ser
el sistema principal, corriendo en la VM en vez de Firebase.

Está escrita para ejecutarse **junto con Claude Code** en la VM. Cada paso dice
quién lo hace (UTP / vos / Claude) y el comando exacto.

> **Contexto rápido**
> - Repo: `~/contecs-deploy` → despliegue: `/opt/contecs`
> - Backend: servicio `contecs.service` (Express, `127.0.0.1:3000`)
> - Base: PostgreSQL `contecs`, rol de app `contecs_app`
> - Origen actual (vivo): Firebase, proyecto `contecs-fa6e6`
> - Contraseña sudo del operador: se ingresa al momento (no queda en archivos)

---

## Qué se le pidió a la UTP (prerequisitos)

El corte **no arranca** hasta tener las tres cosas (ver `SOLICITUD-DECANATO.pdf`):

1. **Subdominio** bajo `utp.ac.pa` (ej. `contecs.fisc.utp.ac.pa`) apuntando a la IP de la VM.
2. **Acceso de red entrante**: IP alcanzable desde internet en **TCP/443** (firewall abierto).
3. **Certificado TLS** para el subdominio (de la CA de la UTP, o vía Let's Encrypt).

---

## Fase 0 — Confirmar el subdominio en la configuración

El backend ya está configurado para `contecs.fisc.utp.ac.pa`. **Si la UTP asigna
un nombre distinto**, hay que actualizar dos lugares. Pedile a Claude:

> "Actualizá el subdominio del sistema a `<NUEVO_SUBDOMINIO>`."

Claude revisa y ajusta:

- `/etc/contecs/contecs.env` → `CORS_ORIGINS`, `URL_BASE_PERFIL`, `URL_BASE_GIRA`
- `/etc/nginx/sites-available/contecs` → `server_name`
- Reinicio: `sudo systemctl restart contecs.service && sudo systemctl reload nginx`

Verificación de los valores actuales (Claude, solo lectura):

```bash
sudo grep -E 'CORS_ORIGINS|URL_BASE' /etc/contecs/contecs.env
sudo grep -n 'server_name' /etc/nginx/sites-available/contecs
```

> Si el subdominio ES `contecs.fisc.utp.ac.pa`, **no hay nada que cambiar acá.**

---

## Fase 1 — DNS y red (UTP)

- UTP crea el registro **A** `contecs.fisc.utp.ac.pa → <IP de la VM>`.
- UTP abre el firewall entrante a **TCP/443** (y 80 si se usará redirección/ACME).

Comprobar cuando esté listo (Claude):

```bash
# resuelve al IP correcto?
getent hosts contecs.fisc.utp.ac.pa
# el sitio responde desde afuera? (probar también desde una red externa)
curl -I https://contecs.fisc.utp.ac.pa/registro.html
```

---

## Fase 2 — Certificado TLS

**Opción A · certificado de la UTP:** colocar los archivos y recargar Nginx.

```bash
sudo install -m 644 /ruta/al/fullchain.pem /etc/nginx/tls/contecs.crt
sudo install -m 600 /ruta/a/la/privada.key /etc/nginx/tls/contecs.key
sudo nginx -t && sudo systemctl reload nginx
```

**Opción B · Let's Encrypt** (si la UTP lo autoriza y el puerto 80 llega a la VM):

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d contecs.fisc.utp.ac.pa
```

Verificar (Claude):

```bash
echo | openssl s_client -servername contecs.fisc.utp.ac.pa \
  -connect contecs.fisc.utp.ac.pa:443 2>/dev/null | openssl x509 -noout -issuer -dates
```

---

## Fase 3 — Corte de datos final (refresh desde Firebase)

Firebase siguió recibiendo inscripciones, así que se trae la foto más reciente.
**Es el mismo procedimiento ya probado en producción.**

### 3.1 · Exportar de Firebase (vos, en el navegador)

1. Servir el exportador (Claude):
   ```bash
   cd ~/contecs-deploy/app/postgres && python3 -m http.server 8000 --bind 127.0.0.1 &
   ```
2. Abrir `http://localhost:8000/exportdb.html`, iniciar sesión con la cuenta
   admin/CEO, y clic en **"Exportar todo"**.
3. El archivo cae en `~/Downloads/contecs-fa6e6-export-AAAA-MM-DD.json`.
   Anotá el conteo de participantes que muestra la herramienta.

### 3.2 · Importar a la VM (un solo comando)

> **Congelá inscripciones en Firebase** justo antes de exportar, para no perder
> registros entre el export y el corte.

Reemplazá la fecha por la del archivo real:

```bash
echo 'SUDO_PASSWORD' | sudo -S bash -c 'runuser -u postgres -- pg_dump -Fc contecs > /var/backups/contecs/pre-golive.dump; rm -rf /var/tmp/cb; mkdir /var/tmp/cb; cp /home/lab/contecs-deploy/app/postgres/import.js /home/lab/contecs-deploy/app/postgres/schema.sql /var/tmp/cb/; cp -r /home/lab/contecs-deploy/app/server/node_modules /var/tmp/cb/node_modules; cp /home/lab/Downloads/contecs-fa6e6-export-AAAA-MM-DD.json /var/tmp/cb/export.json; chown -R postgres:postgres /var/tmp/cb; systemctl stop contecs.service; if runuser -u postgres -- env PGHOST=/var/run/postgresql PGDATABASE=contecs /usr/bin/node /var/tmp/cb/import.js /var/tmp/cb/export.json; then runuser -u postgres -- psql -q -d contecs -c "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO contecs_app; GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO contecs_app;"; echo ===CORTE-OK===; else echo ===FALLO-BASE-INTACTA===; fi; systemctl start contecs.service; rm -rf /var/tmp/cb; runuser -u postgres -- psql -tAc "SELECT count(*) FROM participantes" -d contecs'
```

Qué hace: respalda → prepara → para el servicio → importa (transacción atómica)
→ regraba permisos de la app → arranca → imprime el conteo.

- **`===CORTE-OK===` + un número** = éxito.
- **`===FALLO-BASE-INTACTA===`** = la importación revirtió sola; la base quedó
  como estaba, sin pérdida. Pasarle el error a Claude.

---

## Fase 4 — Verificación (Claude, solo lectura)

```bash
# conteos actuales
sudo -u postgres psql -d contecs -tAc "SELECT 'participantes='||count(*) FROM participantes UNION ALL SELECT 'con_credencial='||count(*) FROM participantes WHERE codigo IS NOT NULL AND token IS NOT NULL;"

# la app conserva permisos tras recrear tablas?
sudo -u postgres psql -d contecs -tAc "SELECT has_table_privilege('contecs_app','participantes','SELECT');"

# el sitio y la API responden por el subdominio real
curl -s -o /dev/null -w "registro: %{http_code}\n" https://contecs.fisc.utp.ac.pa/registro.html
curl -s -o /dev/null -w "api:      %{http_code}\n" https://contecs.fisc.utp.ac.pa/api/sesion   # 401 esperado

# prueba de oro: un QR real resuelve? (Claude toma un codigo+token del export, sin exponer datos)
```

Checklist de aceptación:

- [ ] participantes = el número que mostró el exportador
- [ ] `has_table_privilege` = `t`
- [ ] `registro.html` responde 200 **desde una red externa**, no solo localhost
- [ ] `/api/sesion` responde 401 (guardia activa)
- [ ] un QR real resuelve por `/api/public/participantes/acceder`
- [ ] login institucional funciona (probar con una cuenta de staff real)

---

## Fase 5 — registro.html escribe oficialmente en la base de la VM

**No hay cambio de código.** `registro.html` usa `js/core/api-config.js` con
`API_BASE_URL = ""` (mismo origen): siempre escribe contra el backend que sirve
la página, que es la VM. Por eso el "cambio" es la **DNS**: cuando
`contecs.fisc.utp.ac.pa` apunta a la VM, cada inscripción hecha en ese registro
entra directo en PostgreSQL de la VM.

Lo único a confirmar (Claude): que se dejó de usar la URL vieja de Firebase.

- Comunicar el nuevo enlace (`https://contecs.fisc.utp.ac.pa/registro.html`).
- Opcional: en Firebase Hosting, redirigir el sitio viejo al nuevo, o bajarlo,
  para que nadie siga inscribiéndose en Firestore.

Prueba end-to-end real (vos): abrir el registro por el subdominio, inscribir una
prueba, y pedirle a Claude que confirme que la fila entró:

```bash
sudo -u postgres psql -d contecs -tAc "SELECT codigo, fecha_registro FROM participantes ORDER BY fecha_registro DESC LIMIT 1;"
```

(borrar esa fila de prueba después, con ayuda de Claude).

---

## Brevo (correos) — cuando se quiera activar el envío

Hoy `BREVO_API_KEY` está vacío en `/etc/contecs/contecs.env`, así que aprobar un
pago o notificar una gira **no envía correo** (no rompe nada; solo no sale el
mail). Para activarlo:

```bash
# obtener la key desde Firebase Secret Manager, o del panel de Brevo
firebase functions:secrets:access BREVO_API_KEY
# cargarla en la VM y reiniciar
sudo sed -i 's#^\s*BREVO_API_KEY=.*#  BREVO_API_KEY=xkeysib-TU-KEY#' /etc/contecs/contecs.env
sudo systemctl restart contecs.service
```

Verificar sin spamear (script incluido en el repo): probar la key contra la
cuenta y el remitente `contecs.logistica@utp.ac.pa` antes de confiar en ella.

---

## Rollback (si algo sale mal después del corte)

```bash
sudo systemctl stop contecs.service
sudo runuser -u postgres -- bash -c 'dropdb contecs && createdb contecs && pg_restore -d contecs /var/backups/contecs/pre-golive.dump'
sudo runuser -u postgres -- psql -q -d contecs -c "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO contecs_app; GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO contecs_app;"
sudo systemctl start contecs.service
```

---

## Para pegarle a Claude el día del go-live

> "Estamos haciendo el go-live de CONTECS. La UTP ya nos dio el subdominio
> `<SUBDOMINIO>`, la IP y el certificado. Seguí el runbook `GO-LIVE.md`:
> confirmá/actualizá el subdominio (Fase 0), verificá DNS y TLS (Fases 1–2),
> guiame en el corte de datos final (Fase 3, yo corro el comando), verificá todo
> (Fase 4) y confirmá que el registro escribe en la VM (Fase 5). Avisame en cada
> paso qué corro yo y qué verificás vos."

---

### Estado a la fecha de este documento (30-ago-2026)

- ✅ Sistema desplegado en la VM y verificado.
- ✅ Datos migrados: **277 participantes**, credenciales intactas (ensayo de
  producción ya realizado con éxito).
- ✅ Feature de giras (selección de participantes, QR, notificación, página
  pública) completa y probada.
- ⏳ Pendiente **solo de la UTP**: subdominio, IP entrante y certificado TLS.
