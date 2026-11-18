require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");

const { db, siguienteCodigo } = require("./db/database");
const SqliteStore = require("./db/session-store");
const { requiereLider, requiereAdmin, requiereLiderOAdmin } = require("./middleware/auth");
const { calcularNomina, leerReglas } = require("./nomina");
const {
  clavesIguales,
  pinAleatorio,
  crearLimitador,
  crearControlFallos,
  cabecerasSeguridad,
  sinCacheEnApi,
  opcionesEstaticos,
} = require("./seguridad");

const fs = require("fs");
const crypto = require("crypto");
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // para que los links salgan con https detras de un tunel o hosting
const PORT = process.env.PORT || 3000;

// ---------- Configuracion obligatoria: sin esto el servidor NO arranca ----------
const ES_PRODUCCION = process.env.NODE_ENV === "production";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
if (!ADMIN_PASSWORD) {
  console.error("Falta ADMIN_PASSWORD en el archivo .env. El servidor no arranca sin la clave del administrador.");
  process.exit(1);
}
if (ADMIN_PASSWORD.startsWith("cambia-") || ADMIN_PASSWORD.length < 10) {
  const aviso = "ADMIN_PASSWORD es muy corta o es la de ejemplo. Usa una clave larga (minimo 10 caracteres).";
  if (ES_PRODUCCION) {
    console.error(aviso);
    process.exit(1);
  }
  console.warn("AVISO: " + aviso);
}
let SESSION_SECRET = process.env.SESSION_SECRET || "";
if (!SESSION_SECRET || SESSION_SECRET.startsWith("cambia-")) {
  if (ES_PRODUCCION) {
    console.error("Falta SESSION_SECRET (o es la de ejemplo) en el .env. Genera una con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
    process.exit(1);
  }
  console.warn("AVISO: SESSION_SECRET no esta configurada; se usa una temporal (las sesiones se pierden al reiniciar).");
  SESSION_SECRET = crypto.randomBytes(32).toString("hex");
}

// Version del texto de consentimiento que se acepta al registrarse (cambiala si cambias el texto legal)
const CONSENTIMIENTO_VERSION = "2026-11-v1";

// ---------- Limites y registro de acciones ----------
const MIN10 = 10 * 60 * 1000;
const HORA = 60 * 60 * 1000;
const fallos = crearControlFallos();
const limLogin = crearLimitador({ ventanaMs: MIN10, max: 40, mensaje: "Demasiados intentos de ingreso. Espera unos minutos." });
const limRegistro = crearLimitador({ ventanaMs: HORA, max: 150, mensaje: "Demasiados registros desde esta conexión. Intenta más tarde." });
const limVerificar = crearLimitador({ ventanaMs: MIN10, max: 60 });
const PIN_FALSO = bcrypt.hashSync("pin-falso-0000", 10); // para tardar igual aunque la cedula no exista

const insAuditoria = db.prepare("INSERT INTO auditoria (actor, accion, detalle, ip) VALUES (?, ?, ?, ?)");
function auditar(req, actor, accion, detalle) {
  try {
    insAuditoria.run(actor, accion, detalle ? String(detalle).slice(0, 300) : null, req.ip || null);
  } catch (err) {
    console.error("No se pudo escribir la auditoria:", err.message);
  }
}

// ---------- Middleware general ----------
app.use(cabecerasSeguridad);
app.use(express.json({ limit: "50kb" }));
app.use(
  session({
    name: "pa.sid",
    secret: SESSION_SECRET,
    store: new SqliteStore(db), // sobreviven a los reinicios del servidor
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8, // 8 horas
      httpOnly: true,
      sameSite: "lax",
      secure: "auto", // solo por https cuando hay https
    },
  })
);
app.use("/api", sinCacheEnApi);
app.use(express.static(path.join(__dirname, "public"), opcionesEstaticos));

// ---------- Configuracion de WhatsApp (para la pantalla de "gracias") ----------
// Se lee desde .env para que se pueda cambiar el numero/canal sin tocar codigo.
app.get("/api/config", (req, res) => {
  res.json({
    nombreCampana: process.env.CANDIDATO_NOMBRE || "",
    whatsappNumero: process.env.WHATSAPP_NUMERO || "",
    whatsappCanalUrl: process.env.WHATSAPP_CANAL_URL || "",
  });
});

// Catalogo oficial de barrios y corregimientos (tambien lo usa el formulario y el mapa)
const CATALOGO = JSON.parse(
  fs.readFileSync(path.join(__dirname, "public", "data", "barrios.json"), "utf8")
);
const SIN_REGISTRO = "Sin registro";

const COMUNAS_VALIDAS = ["Norte", "Sur", "Oriental", "Occidental"];
const RANGOS_EDAD_VALIDOS = ["18-26", "27-35", "36-45", "46-55", "56-65", "66 o más"];

// Solo letras (con tildes/ñ), espacios, apostrofes y guiones. Nada de numeros.
const REGEX_NOMBRE = /^[A-Za-zÀ-ÖØ-öø-ÿ'.-]+(\s+[A-Za-zÀ-ÖØ-öø-ÿ'.-]+)+$/;
// Solo digitos (7 a 10, numeros de telefono en Colombia). Nada de letras.
const REGEX_TELEFONO = /^[0-9]{7,10}$/;
// Solo digitos (5 a 12). Nada de letras.
const REGEX_CEDULA = /^[0-9]{5,12}$/;

// ---------- Helper: arma el arbol a partir de una lista plana ----------
// OJO: las "personas" (no lideres) no tienen codigo propio (queda null),
// asi que indexamos por id (siempre unico) y aparte armamos un mapa por
// codigo (solo para los que sí tienen, es decir los lideres) para poder
// engancharlos como hijos de su referido_por.
function construirArbol(lista, codigoRaiz) {
  const porId = {};
  lista.forEach((p) => {
    porId[p.id] = { ...p, hijos: [] };
  });
  const porCodigo = {};
  lista.forEach((p) => {
    if (p.codigo) porCodigo[p.codigo] = porId[p.id];
  });

  const raiz = [];
  lista.forEach((p) => {
    const nodo = porId[p.id];
    if (p.referido_por && porCodigo[p.referido_por]) {
      porCodigo[p.referido_por].hijos.push(nodo);
    } else if (codigoRaiz === null || p.codigo === codigoRaiz) {
      raiz.push(nodo);
    }
  });
  return raiz;
}

function limpiarFila(p) {
  // Nunca devolvemos el pin_hash al frontend
  const { pin_hash, ...resto } = p;
  return resto;
}

// ---------- Link de referido: /r/AMIGOS01 -> pagina de registro con el ref ----------
app.get("/r/:codigo", (req, res) => {
  const codigo = req.params.codigo.toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(codigo)) return res.redirect("/registro.html");
  res.redirect(`/registro.html?ref=${encodeURIComponent(codigo)}`);
});

// ---------- Ver si un codigo de referido existe (para mostrar "invitado por...") ----------
app.get("/api/verificar-referido/:codigo", limVerificar, (req, res) => {
  const codigo = req.params.codigo.toUpperCase();
  const fila = db
    .prepare("SELECT codigo, nombre FROM personas WHERE codigo = ?")
    .get(codigo);
  if (!fila) return res.status(404).json({ existe: false });
  res.json({ existe: true, nombre: fila.nombre, codigo: fila.codigo });
});

// ---------- Ver si una cedula ya esta registrada (solo para lideres/admin con sesion) ----------
// OJO: ya NO es publica, porque permitia a cualquiera averiguar quien esta en la campana.
// En el registro publico, la cedula repetida se avisa al enviar el formulario.
app.get("/api/verificar-cedula/:cedula", requiereLiderOAdmin, (req, res) => {
  const cedula = req.params.cedula.trim();
  const fila = db.prepare("SELECT id FROM personas WHERE cedula = ?").get(cedula);
  res.json({ existe: !!fila });
});

// ---------- Logica central de registro (usada por la ruta publica y por admin) ----------
function registrarPersona({
  nombre,
  telefono,
  cedula,
  rango_edad,
  tipo_zona,
  comuna,
  barrio,
  vereda,
  referido_por,
  rol,
  consentimiento,
}) {
  // Todo debe llegar como texto: si llega otra cosa se rechaza (400) en vez de fallar con error 500
  for (const v of [nombre, telefono, cedula, rango_edad, tipo_zona, comuna, barrio, vereda, referido_por]) {
    if (v !== undefined && v !== null && typeof v !== "string") {
      return { status: 400, body: { error: "Datos inválidos." } };
    }
  }
  if (!nombre || !telefono || !cedula || !tipo_zona || !rango_edad) {
    return { status: 400, body: { error: "Faltan campos obligatorios." } };
  }
  if (!["lider", "persona"].includes(rol)) {
    return { status: 400, body: { error: "Debes indicar si es líder o persona." } };
  }
  if (!REGEX_NOMBRE.test(nombre.trim())) {
    return { status: 400, body: { error: "Escribe nombre y apellido (solo letras, sin números)." } };
  }
  if (!REGEX_TELEFONO.test(telefono.trim())) {
    return { status: 400, body: { error: "El teléfono solo puede tener números (7 a 10 dígitos)." } };
  }
  if (!REGEX_CEDULA.test(cedula.trim())) {
    return { status: 400, body: { error: "La cédula solo puede tener números (5 a 12 dígitos)." } };
  }
  if (!RANGOS_EDAD_VALIDOS.includes(rango_edad)) {
    return { status: 400, body: { error: "Rango de edad inválido." } };
  }
  if (!["urbana", "rural"].includes(tipo_zona)) {
    return { status: 400, body: { error: "tipo_zona invalido." } };
  }
  if (tipo_zona === "urbana" && !COMUNAS_VALIDAS.includes(comuna)) {
    return { status: 400, body: { error: "Comuna invalida." } };
  }
  if (tipo_zona === "urbana" && (!barrio || !barrio.trim())) {
    return { status: 400, body: { error: "Debes escoger tu barrio." } };
  }
  if (tipo_zona === "rural" && (!vereda || !vereda.trim())) {
    return { status: 400, body: { error: "Debes escoger tu corregimiento o sector." } };
  }

  // El barrio / corregimiento debe ser de la lista oficial (o "Sin registro")
  let comunaFinal = comuna;
  if (tipo_zona === "urbana") {
    // Hay nombres de barrio que se repiten en varias comunas: se identifica por nombre + comuna.
    // Si el nombre es unico se acepta sin importar la comuna que mande el formulario.
    const coincidencias = CATALOGO.barrios.filter((b) => b.nombre === barrio.trim());
    const encontrado =
      coincidencias.find((b) => b.comuna === comuna) || (coincidencias.length === 1 ? coincidencias[0] : null);
    if (encontrado) {
      comunaFinal = encontrado.comuna;
    } else if (barrio.trim() !== SIN_REGISTRO) {
      return { status: 400, body: { error: "Escoge tu barrio de la lista." } };
    }
  } else if (
    !CATALOGO.rurales.some((r) => r.nombre === vereda.trim()) &&
    vereda.trim() !== SIN_REGISTRO
  ) {
    return { status: 400, body: { error: "Escoge tu corregimiento de la lista." } };
  }

  let refCodigo = null;
  if (referido_por && String(referido_por).trim()) {
    refCodigo = String(referido_por).trim().toUpperCase();
    const existeRef = db.prepare("SELECT codigo FROM personas WHERE codigo = ?").get(refCodigo);
    if (!existeRef) {
      return { status: 400, body: { error: "El codigo de quien invito no existe." } };
    }
  }

  const cedulaExiste = db.prepare("SELECT id FROM personas WHERE cedula = ?").get(cedula.trim());
  if (cedulaExiste) {
    return { status: 409, body: { error: "Esta cédula ya está registrada." } };
  }

  let codigoNuevo = null;
  let pin = null;
  let pinHash = null;
  if (rol === "lider") {
    codigoNuevo = siguienteCodigo();
    pin = pinAleatorio(); // PIN de 4 digitos
    pinHash = bcrypt.hashSync(pin, 10);
  }

  try {
  db.prepare(
    `INSERT INTO personas
      (codigo, pin_hash, rol, nombre, telefono, cedula, rango_edad, tipo_zona, comuna, barrio, vereda, referido_por,
       consentimiento_en, consentimiento_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now','localtime') END, ?)`
  ).run(
    codigoNuevo,
    pinHash,
    rol,
    nombre.trim(),
    telefono.trim(),
    cedula.trim(),
    rango_edad,
    tipo_zona,
    tipo_zona === "urbana" ? comunaFinal : null,
    tipo_zona === "urbana" ? barrio.trim() : null,
    tipo_zona === "rural" ? vereda.trim() : null,
    refCodigo,
    consentimiento === true ? 1 : 0,
    consentimiento === true ? CONSENTIMIENTO_VERSION : null
  );
  } catch (err) {
    // Misma cedula enviada dos veces al mismo tiempo: la base lo impide; respondemos claro
    if (err && String(err.code).startsWith("SQLITE_CONSTRAINT")) {
      return { status: 409, body: { error: "Esta cédula ya está registrada." } };
    }
    throw err;
  }

  if (rol === "lider") {
    return { status: 200, body: { ok: true, rol, codigo: codigoNuevo, pin } };
  }
  return { status: 200, body: { ok: true, rol } };
}

// ---------- Registro publico: siempre crea una "persona" normal (sin codigo/pin) ----------
app.post("/api/registro", limRegistro, (req, res) => {
  try {
    if (!req.body || req.body.consentimiento !== true) {
      return res.status(400).json({ error: "Debes aceptar el tratamiento de datos personales para registrarte." });
    }
    const resultado = registrarPersona({ ...req.body, rol: "persona", consentimiento: true });
    res.status(resultado.status).json(resultado.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno al registrar." });
  }
});

// ---------- Un lider logueado registra a otro lider debajo de si mismo ----------
app.post("/api/lider/crear-lider", requiereLider, (req, res) => {
  try {
    const resultado = registrarPersona({
      ...req.body,
      rol: "lider",
      referido_por: req.session.codigoLider,
      consentimiento: false,
    });
    if (resultado.body.ok) {
      resultado.body.link = `${req.protocol}://${req.get("host")}/r/${resultado.body.codigo}`;
    }
    res.status(resultado.status).json(resultado.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno al registrar." });
  }
});

// ---------- Login de lider (codigo + pin) ----------
// Proteccion contra adivinar el PIN: 5 fallos por IP+cedula (10 min) y 15 fallos por cedula desde cualquier IP (1 hora)
app.post("/api/login-lider", limLogin, (req, res) => {
  const { cedula, pin } = req.body || {};
  if (!cedula || !pin) {
    return res.status(400).json({ error: "Falta la cedula o el PIN." });
  }
  const cedulaLimpia = String(cedula).trim();
  const claveIp = `lider|${req.ip}|${cedulaLimpia}`;
  const claveCedula = `lider-cedula|${cedulaLimpia}`;
  if (fallos.estaBloqueado(claveIp) || fallos.estaBloqueado(claveCedula)) {
    return res.status(429).json({ error: "Demasiados intentos. Espera un rato e intenta de nuevo." });
  }

  const fila = db
    .prepare("SELECT * FROM personas WHERE cedula = ? AND rol = 'lider'")
    .get(cedulaLimpia);
  const hash = fila && fila.pin_hash ? fila.pin_hash : PIN_FALSO;
  const correcto = bcrypt.compareSync(String(pin), hash) && !!fila && !!fila.pin_hash;

  if (!correcto) {
    fallos.anotarFallo(claveIp, 5, MIN10);
    fallos.anotarFallo(claveCedula, 15, HORA);
    return res.status(401).json({ error: "Cedula o PIN incorrectos." });
  }

  fallos.limpiar(claveIp);
  const { codigo, nombre } = fila;
  // Sesion nueva al entrar (evita que alguien reutilice un identificador de sesion anterior)
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "No se pudo iniciar la sesión." });
    req.session.codigoLider = codigo;
    res.json({ ok: true, nombre, codigo });
  });
});

// ---------- Login de administrador (solo contrasena) ----------
app.post("/api/login-admin", limLogin, (req, res) => {
  const claveIp = `admin|${req.ip}`;
  if (fallos.estaBloqueado(claveIp)) {
    return res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos e intenta de nuevo." });
  }
  const { password } = req.body || {};
  if (typeof password !== "string" || !clavesIguales(password, ADMIN_PASSWORD)) {
    fallos.anotarFallo(claveIp, 5, 15 * 60 * 1000);
    auditar(req, "desconocido", "admin_login_fallido", null);
    return res.status(401).json({ error: "Contrasena incorrecta." });
  }
  fallos.limpiar(claveIp);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "No se pudo iniciar la sesión." });
    req.session.esAdmin = true;
    req.session.cookie.maxAge = 2 * HORA; // el admin ve todos los datos: sesion de 2 horas (lideres 8)
    auditar(req, "admin", "admin_login_ok", null);
    res.json({ ok: true });
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("pa.sid");
    res.json({ ok: true });
  });
});

// ---------- Datos del lider logueado (para el header del panel) ----------
app.get("/api/mi-info", requiereLider, (req, res) => {
  const fila = db
    .prepare("SELECT codigo, nombre FROM personas WHERE codigo = ?")
    .get(req.session.codigoLider);
  res.json({
    codigo: fila.codigo,
    nombre: fila.nombre,
    link: `${req.protocol}://${req.get("host")}/r/${fila.codigo}`,
  });
});

// ---------- Arbol del lider logueado (el y todos sus descendientes) ----------
app.get("/api/mi-equipo", requiereLider, (req, res) => {
  const raiz = req.session.codigoLider;
  const filas = db
    .prepare(
      `WITH RECURSIVE descendientes(id, codigo) AS (
         SELECT id, codigo FROM personas WHERE codigo = ?
         UNION ALL
         SELECT p.id, p.codigo FROM personas p
         INNER JOIN descendientes d ON p.referido_por = d.codigo
       )
       SELECT per.* FROM personas per
       INNER JOIN descendientes d ON per.id = d.id`
    )
    .all(raiz)
    .map(limpiarFila);

  const arbol = construirArbol(filas, raiz);
  res.json({ total: filas.length - 1, arbol });
});

// ---------- Arbol completo (solo admin) ----------
app.get("/api/arbol-completo", requiereAdmin, (req, res) => {
  const filas = db.prepare("SELECT * FROM personas").all().map(limpiarFila);
  const arbol = construirArbol(filas, null);
  res.json({ total: filas.length, arbol });
});

// ---------- Admin crea un lider raiz (sin referido_por) ----------
app.post("/api/admin/crear-raiz", requiereAdmin, (req, res) => {
  try {
    const datos = { ...req.body, referido_por: null, rol: "lider", consentimiento: false };
    const resultado = registrarPersona(datos);
    if (resultado.body.ok) {
      auditar(req, "admin", "crear_lider_raiz", resultado.body.codigo);
      resultado.body.link = `${req.protocol}://${req.get("host")}/r/${resultado.body.codigo}`;
    }
    res.status(resultado.status).json(resultado.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno al registrar." });
  }
});

// ---------- Admin busca una persona por codigo o cedula (para resetear PIN) ----------
app.get("/api/admin/buscar-persona/:valor", requiereAdmin, (req, res) => {
  const valor = String(req.params.valor).trim();
  const fila = db
    .prepare("SELECT codigo, nombre, cedula, telefono FROM personas WHERE codigo = ? OR cedula = ?")
    .get(valor.toUpperCase(), valor);
  if (!fila) return res.status(404).json({ error: "No se encontró a esa persona." });
  res.json({ ok: true, ...fila });
});

// ---------- Admin resetea el PIN de alguien que lo olvido (solo lideres) ----------
app.post("/api/admin/resetear-pin", requiereAdmin, (req, res) => {
  const busqueda = typeof (req.body || {}).valor === "string" ? req.body.valor.trim() : "";
  if (!busqueda) {
    return res.status(400).json({ error: "Escribe un código o una cédula." });
  }
  const fila = db
    .prepare("SELECT codigo, nombre, rol, cedula FROM personas WHERE codigo = ? OR cedula = ?")
    .get(busqueda.toUpperCase(), busqueda);
  if (!fila) {
    return res.status(404).json({ error: "No se encontró a esa persona." });
  }
  if (fila.rol !== "lider") {
    return res.status(400).json({
      error: "Esa persona es un registro simple, no tiene PIN. Si necesita invitar gente, primero conviértela en líder.",
    });
  }

  const nuevoPin = pinAleatorio();
  const nuevoHash = bcrypt.hashSync(nuevoPin, 10);
  db.prepare("UPDATE personas SET pin_hash = ? WHERE codigo = ?").run(nuevoHash, fila.codigo);
  fallos.limpiar(`lider-cedula|${fila.cedula}`); // si estaba bloqueado por intentos, queda libre
  auditar(req, "admin", "resetear_pin", fila.codigo);

  res.json({ ok: true, nombre: fila.nombre, codigo: fila.codigo, pin: nuevoPin });
});

// ---------- Admin convierte a una "persona" en "lider" (le crea codigo y pin) ----------
app.post("/api/admin/promover-a-lider", requiereAdmin, (req, res) => {
  const cedula = typeof (req.body || {}).cedula === "string" ? req.body.cedula.trim() : "";
  if (!cedula) {
    return res.status(400).json({ error: "Escribe la cédula de la persona." });
  }
  const fila = db.prepare("SELECT * FROM personas WHERE cedula = ?").get(cedula);
  if (!fila) {
    return res.status(404).json({ error: "No se encontró a esa persona." });
  }
  if (fila.rol === "lider") {
    return res.status(400).json({ error: "Esa persona ya es líder.", codigo: fila.codigo });
  }

  const codigoNuevo = siguienteCodigo();
  const pin = pinAleatorio();
  const pinHash = bcrypt.hashSync(pin, 10);

  db.prepare("UPDATE personas SET rol = 'lider', codigo = ?, pin_hash = ? WHERE id = ?").run(
    codigoNuevo,
    pinHash,
    fila.id
  );
  auditar(req, "admin", "promover_a_lider", codigoNuevo);

  res.json({ ok: true, nombre: fila.nombre, codigo: codigoNuevo, pin });
});


// ================= Nomina / bonificaciones (solo admin) =================
function configNomina() {
  const filas = db.prepare("SELECT clave, valor FROM nomina_config").all();
  return Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
}

function datosNomina() {
  const reglas = leerReglas(process.env, configNomina());
  const personas = db.prepare("SELECT * FROM personas").all();
  const bonos = db.prepare("SELECT * FROM bonificaciones").all();
  return { reglas, lideres: calcularNomina(personas, bonos, reglas) };
}

app.get("/api/admin/nomina", requiereAdmin, (req, res) => {
  res.json(datosNomina());
});

// Guardar requisitos y valor de la bonificacion (solo admin)
app.post("/api/admin/nomina/config", requiereAdmin, (req, res) => {
  const entero = (v) => (/^\d+$/.test(String(v).trim()) ? parseInt(v, 10) : NaN);
  const minDirectos = entero(req.body.minDirectos);
  const minRamas = entero(req.body.minRamas);
  const minPorRama = entero(req.body.minPorRama);
  const valor = entero(req.body.valorBonificacion);

  for (const [nombre, v] of [["Personas directas", minDirectos], ["Ramas que deben cumplir", minRamas], ["Personas por rama", minPorRama]]) {
    if (!Number.isInteger(v) || v < 1 || v > 1000) {
      return res.status(400).json({ error: `${nombre}: escribe un número entero entre 1 y 1000.` });
    }
  }
  if (!Number.isInteger(valor) || valor < 0 || valor > 1000000000) {
    return res.status(400).json({ error: "Valor de la bonificación: escribe solo números, sin puntos ni signos (máximo 1.000.000.000)." });
  }
  if (minRamas > minDirectos) {
    return res.status(400).json({ error: "Las ramas que deben cumplir no pueden ser más que las personas directas." });
  }

  const guardar = db.prepare("INSERT INTO nomina_config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor");
  db.transaction(() => {
    guardar.run("min_directos", String(minDirectos));
    guardar.run("min_ramas", String(minRamas));
    guardar.run("min_por_rama", String(minPorRama));
    guardar.run("valor_bonificacion", String(valor));
  })();
  auditar(req, "admin", "nomina_config", `directos=${minDirectos} ramas=${minRamas} porRama=${minPorRama} valor=${valor}`);
  res.json({ ok: true });
});

// Habilitar: el servidor vuelve a verificar que el lider cumpla (no se confia en el navegador)
app.post("/api/admin/nomina/habilitar", requiereAdmin, (req, res) => {
  const codigo = String(req.body.codigo || "").trim().toUpperCase();
  const nota = String(req.body.nota || "").trim().slice(0, 200);
  const { reglas, lideres } = datosNomina();
  const lider = lideres.find((l) => l.codigo === codigo);
  if (!lider) return res.status(404).json({ error: "No se encontró a ese líder." });
  if (lider.estado === "habilitada" || lider.estado === "pagada") {
    return res.status(400).json({ error: "Esa bonificación ya fue habilitada." });
  }
  if (!lider.cumple) {
    return res.status(400).json({ error: "Este líder todavía no cumple los requisitos." });
  }
  if (!reglas.valorBonificacion || reglas.valorBonificacion <= 0) {
    return res.status(400).json({ error: "Primero define el valor de la bonificación y guarda los cambios." });
  }
  // El valor queda fijado al habilitar: si luego cambias el valor general, no altera las ya habilitadas
  db.prepare("INSERT INTO bonificaciones (codigo_lider, estado, nota, monto) VALUES (?, 'habilitada', ?, ?)").run(
    codigo,
    nota,
    reglas.valorBonificacion
  );
  auditar(req, "admin", "nomina_habilitar", `${codigo} monto=${reglas.valorBonificacion}`);
  res.json({ ok: true });
});

app.post("/api/admin/nomina/pagada", requiereAdmin, (req, res) => {
  const codigo = String(req.body.codigo || "").trim().toUpperCase();
  const r = db
    .prepare("UPDATE bonificaciones SET estado = 'pagada', pagada_en = datetime('now','localtime') WHERE codigo_lider = ? AND estado = 'habilitada'")
    .run(codigo);
  if (r.changes === 0) return res.status(400).json({ error: "Esa bonificación no está en estado habilitada." });
  auditar(req, "admin", "nomina_pagada", codigo);
  res.json({ ok: true });
});

// Revocar: solo mientras no se haya pagado
app.post("/api/admin/nomina/revocar", requiereAdmin, (req, res) => {
  const codigo = String(req.body.codigo || "").trim().toUpperCase();
  const r = db.prepare("DELETE FROM bonificaciones WHERE codigo_lider = ? AND estado = 'habilitada'").run(codigo);
  if (r.changes === 0) return res.status(400).json({ error: "No hay una bonificación habilitada para revocar." });
  auditar(req, "admin", "nomina_revocar", codigo);
  res.json({ ok: true });
});

// Ultimas 200 acciones sensibles del administrador
app.get("/api/admin/auditoria", requiereAdmin, (req, res) => {
  const registros = db
    .prepare("SELECT creado_en, actor, accion, detalle, ip FROM auditoria ORDER BY id DESC LIMIT 200")
    .all();
  res.json({ registros });
});

// Rutas de API que no existen
app.use("/api", (req, res) => {
  res.status(404).json({ error: "No encontrado." });
});

// Errores no controlados: nunca mostramos detalles internos al navegador
app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Solicitud inválida." });
  }
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "La solicitud es demasiado grande." });
  }
  console.error(err);
  res.status(500).json({ error: "Error interno." });
});

// ---------- Copia de seguridad diaria de la base (RESPALDO_AUTOMATICO=no en el .env la apaga) ----------
// Las copias van a la carpeta backups/ (14 ultimas). Tienen datos personales: copialas fuera del servidor.
if (process.env.RESPALDO_AUTOMATICO !== "no") {
  const correrRespaldo = () => {
    const carpeta = path.join(__dirname, "backups");
    fs.mkdirSync(carpeta, { recursive: true, mode: 0o700 });
    const sello = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    db.backup(path.join(carpeta, `campana-${sello}.db`))
      .then(() => {
        fs.readdirSync(carpeta)
          .filter((f) => /^campana-.*\.db$/.test(f))
          .sort()
          .slice(0, -14)
          .forEach((f) => fs.unlinkSync(path.join(carpeta, f)));
      })
      .catch((err) => console.error("No se pudo crear el respaldo:", err.message));
  };
  setTimeout(correrRespaldo, 30 * 1000).unref();
  setInterval(correrRespaldo, 24 * 60 * 60 * 1000).unref();
}

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
