require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");

const { db, siguienteCodigo } = require("./db/database");
const { requiereLider, requiereAdmin } = require("./middleware/auth");
const { calcularNomina, leerReglas } = require("./nomina");

const fs = require("fs");
const app = express();
app.set("trust proxy", 1); // para que los links salgan con https detras de un tunel o hosting
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "clave-por-defecto-cambiala",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 horas
  })
);
app.use(express.static(path.join(__dirname, "public")));

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
  res.redirect(`/registro.html?ref=${encodeURIComponent(codigo)}`);
});

// ---------- Ver si un codigo de referido existe (para mostrar "invitado por...") ----------
app.get("/api/verificar-referido/:codigo", (req, res) => {
  const codigo = req.params.codigo.toUpperCase();
  const fila = db
    .prepare("SELECT codigo, nombre FROM personas WHERE codigo = ?")
    .get(codigo);
  if (!fila) return res.status(404).json({ existe: false });
  res.json({ existe: true, nombre: fila.nombre, codigo: fila.codigo });
});

// ---------- Ver si una cedula ya esta registrada (para avisar antes de llenar todo el formulario) ----------
app.get("/api/verificar-cedula/:cedula", (req, res) => {
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
}) {
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
    const encontrado = CATALOGO.barrios.find((b) => b.nombre === barrio.trim());
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
    return { status: 409, body: { error: "Esa cedula ya esta registrada." } };
  }

  let codigoNuevo = null;
  let pin = null;
  let pinHash = null;
  if (rol === "lider") {
    codigoNuevo = siguienteCodigo();
    pin = String(Math.floor(1000 + Math.random() * 9000)); // PIN de 4 digitos
    pinHash = bcrypt.hashSync(pin, 10);
  }

  db.prepare(
    `INSERT INTO personas
      (codigo, pin_hash, rol, nombre, telefono, cedula, rango_edad, tipo_zona, comuna, barrio, vereda, referido_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    refCodigo
  );

  if (rol === "lider") {
    return { status: 200, body: { ok: true, rol, codigo: codigoNuevo, pin } };
  }
  return { status: 200, body: { ok: true, rol } };
}

// ---------- Registro publico: siempre crea una "persona" normal (sin codigo/pin) ----------
app.post("/api/registro", (req, res) => {
  try {
    const resultado = registrarPersona({ ...req.body, rol: "persona" });
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
// Limite de intentos fallidos (protege contra adivinar el PIN)
const intentosFallidos = new Map(); // clave: ip + cedula -> { cuenta, hasta }
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 10 * 60 * 1000;

app.post("/api/login-lider", (req, res) => {
  const { cedula, pin } = req.body;
  if (!cedula || !pin) {
    return res.status(400).json({ error: "Falta la cedula o el PIN." });
  }
  const cedulaLimpia = String(cedula).trim();
  const clave = `${req.ip}|${cedulaLimpia}`;
  const registro = intentosFallidos.get(clave);
  if (registro && registro.hasta > Date.now()) {
    return res.status(429).json({ error: "Demasiados intentos. Espera 10 minutos e intenta de nuevo." });
  }

  const fila = db
    .prepare("SELECT * FROM personas WHERE cedula = ? AND rol = 'lider'")
    .get(cedulaLimpia);

  if (!fila || !fila.pin_hash || !bcrypt.compareSync(String(pin), fila.pin_hash)) {
    const cuenta = (registro ? registro.cuenta : 0) + 1;
    intentosFallidos.set(clave, {
      cuenta,
      hasta: cuenta >= MAX_INTENTOS ? Date.now() + BLOQUEO_MS : 0,
    });
    return res.status(401).json({ error: "Cedula o PIN incorrectos." });
  }

  intentosFallidos.delete(clave);
  req.session.codigoLider = fila.codigo;
  res.json({ ok: true, nombre: fila.nombre, codigo: fila.codigo });
});

// ---------- Login de administrador (solo contrasena) ----------
app.post("/api/login-admin", (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Contrasena incorrecta." });
  }
  req.session.esAdmin = true;
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
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
    const datos = { ...req.body, referido_por: null, rol: "lider" };
    const resultado = registrarPersona(datos);
    if (resultado.body.ok) {
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
  const valor = req.params.valor.trim();
  const fila = db
    .prepare("SELECT codigo, nombre, cedula, telefono FROM personas WHERE codigo = ? OR cedula = ?")
    .get(valor.toUpperCase(), valor);
  if (!fila) return res.status(404).json({ error: "No se encontró a esa persona." });
  res.json({ ok: true, ...fila });
});

// ---------- Admin resetea el PIN de alguien que lo olvido (solo lideres) ----------
app.post("/api/admin/resetear-pin", requiereAdmin, (req, res) => {
  const { valor } = req.body;
  if (!valor || !valor.trim()) {
    return res.status(400).json({ error: "Escribe un código o una cédula." });
  }
  const busqueda = valor.trim();
  const fila = db
    .prepare("SELECT codigo, nombre, rol FROM personas WHERE codigo = ? OR cedula = ?")
    .get(busqueda.toUpperCase(), busqueda);
  if (!fila) {
    return res.status(404).json({ error: "No se encontró a esa persona." });
  }
  if (fila.rol !== "lider") {
    return res.status(400).json({
      error: "Esa persona es un registro simple, no tiene PIN. Si necesita invitar gente, primero conviértela en líder.",
    });
  }

  const nuevoPin = String(Math.floor(1000 + Math.random() * 9000));
  const nuevoHash = bcrypt.hashSync(nuevoPin, 10);
  db.prepare("UPDATE personas SET pin_hash = ? WHERE codigo = ?").run(nuevoHash, fila.codigo);

  res.json({ ok: true, nombre: fila.nombre, codigo: fila.codigo, pin: nuevoPin });
});

// ---------- Admin convierte a una "persona" en "lider" (le crea codigo y pin) ----------
app.post("/api/admin/promover-a-lider", requiereAdmin, (req, res) => {
  const { cedula } = req.body;
  if (!cedula || !cedula.trim()) {
    return res.status(400).json({ error: "Escribe la cédula de la persona." });
  }
  const fila = db.prepare("SELECT * FROM personas WHERE cedula = ?").get(cedula.trim());
  if (!fila) {
    return res.status(404).json({ error: "No se encontró a esa persona." });
  }
  if (fila.rol === "lider") {
    return res.status(400).json({ error: "Esa persona ya es líder.", codigo: fila.codigo });
  }

  const codigoNuevo = siguienteCodigo();
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const pinHash = bcrypt.hashSync(pin, 10);

  db.prepare("UPDATE personas SET rol = 'lider', codigo = ?, pin_hash = ? WHERE id = ?").run(
    codigoNuevo,
    pinHash,
    fila.id
  );

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
  res.json({ ok: true });
});

app.post("/api/admin/nomina/pagada", requiereAdmin, (req, res) => {
  const codigo = String(req.body.codigo || "").trim().toUpperCase();
  const r = db
    .prepare("UPDATE bonificaciones SET estado = 'pagada', pagada_en = datetime('now','localtime') WHERE codigo_lider = ? AND estado = 'habilitada'")
    .run(codigo);
  if (r.changes === 0) return res.status(400).json({ error: "Esa bonificación no está en estado habilitada." });
  res.json({ ok: true });
});

// Revocar: solo mientras no se haya pagado
app.post("/api/admin/nomina/revocar", requiereAdmin, (req, res) => {
  const codigo = String(req.body.codigo || "").trim().toUpperCase();
  const r = db.prepare("DELETE FROM bonificaciones WHERE codigo_lider = ? AND estado = 'habilitada'").run(codigo);
  if (r.changes === 0) return res.status(400).json({ error: "No hay una bonificación habilitada para revocar." });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
