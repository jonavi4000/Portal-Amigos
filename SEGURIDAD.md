# Seguridad de Portal Amigos — estado y pendientes

## Ya aplicado en el codigo (probado con pruebas automaticas simuladas)
**Acceso**
- El servidor no arranca sin `ADMIN_PASSWORD`. Con `NODE_ENV=production` tampoco con claves de ejemplo.
- Login de admin: comparacion segura, 5 fallos = bloqueo de 15 min por IP. Sesion de **2 horas** (lideres: 8).
- Login de lider (cedula + PIN): 5 fallos por IP+cedula (10 min) y 15 por cedula desde cualquier IP (1 hora). Si el admin resetea el PIN, el bloqueo se libera.
- Sesion nueva al iniciar sesion; cookie `httpOnly`, `sameSite=lax`, `secure` automatico con https.
- **Sesiones guardadas en la base de datos** (sobreviven a reinicios del servidor).
- PIN generado con aleatoriedad criptografica.
- `/api/verificar-cedula` ya no es publica (solo lideres y admin con sesion).

**Datos**
- Todo dato debe llegar como texto; si no, responde 400 (no error 500). Cedula repetida simultanea responde 409.
- El barrio / corregimiento debe ser de la lista oficial (`public/data/barrios.json`) o "Sin registro". Un barrio se identifica por **nombre + comuna** (hay nombres repetidos en comunas distintas).
- Codigo de lider nuevo = mayor numero existente + 1 (ya no puede repetirse un codigo).
- Consentimiento (Ley 1581): se guarda fecha y version del texto (`consentimiento_en`, `consentimiento_version`) en cada registro publico.
- Los paneles escapan el HTML al mostrar datos (segunda barrera; el servidor ya valida).

**Navegador y cache**
- Cabeceras de seguridad y CSP (solo se permiten los dominios que usa la app).
- `/api/*` nunca se guarda en cache (`no-store`); HTML/JS/CSS/JSON se revalidan siempre; imagenes 1 hora.
- Limites: registro (150 por hora por IP), consulta de referido, login.

**Registro y respaldo**
- Auditoria: login de admin (ok y fallido), crear lider raiz, resetear PIN, promover y todas las acciones de nomina. Consulta: `GET /api/admin/auditoria` (ultimas 200, estando logueado como admin). Nunca guarda claves ni PIN.
- Errores: respuesta generica, sin detalles internos.
- Respaldo: automatico cada 24 h y manual con `npm run backup` (ultimas 14 copias en `backups/`).

## Pendiente (en orden de prioridad)
1. **HTTPS + proxy** (Nginx o Caddy) delante de la app, firewall y usuario sin permisos de administrador en el servidor.
2. **Proceso que se reinicie solo** (pm2 o systemd) y **copiar `backups/` fuera del servidor** (las copias dentro del mismo disco no sirven si el disco falla).
3. **Abogado**: revisar terminos y politica de privacidad (responsable del tratamiento, canal para pedir borrado/actualizacion de datos, tiempo de conservacion). Si cambias el texto, cambia `CONSENTIMIENTO_VERSION` en `server.js`.
4. **Consentimiento de quienes registran los lideres**: lo que se registra desde el panel del lider o del admin queda sin constancia de consentimiento. Agregar una casilla "la persona autorizo el tratamiento de sus datos".
5. **Barrios repetidos** en `barrios.json` (16 nombres en dos comunas, p. ej. "El Bosque", "Idema", "Tovar Zambrano"). El codigo ya los distingue por comuna, pero revisa si son barrios distintos o el mismo listado dos veces (hay pares con coordenadas casi iguales, como "Tovar Zambrano").
6. **Archivos sobrantes publicos**: `public/data/barriosborrar.json` y `barrios3.json` se sirven a cualquiera. Borralos si no los usas.
7. **Librerias externas**: Leaflet se carga desde unpkg sin verificacion de integridad. Lo mas seguro es copiarlo a `public/` y servirlo desde tu propio sitio.
8. **Auditoria de descargas**: bajar los archivos de Excel desde el panel todavia no queda registrado, y no hay pagina para ver la auditoria (solo la ruta del API).
9. Admin con clave unica: cuando haya mas de una persona administrando, crear usuarios individuales.
10. PIN de 4 digitos: los bloqueos lo protegen, pero un PIN de 6 es mas fuerte. Cambiarlo implica ajustar los formularios.
11. Revisar dependencias cada cierto tiempo con `npm audit`.
