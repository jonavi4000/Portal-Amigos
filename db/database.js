const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "..", "campana.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

// Tabla principal: cada fila es una persona (puede ser lider o "persona simple",
// aqui no distinguimos rol: TODOS pueden tener gente registrada debajo si comparten
// su link/codigo).
db.exec(`
  CREATE TABLE IF NOT EXISTS personas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT UNIQUE,
    pin_hash TEXT,
    rol TEXT NOT NULL CHECK(rol IN ('lider','persona')),
    nombre TEXT NOT NULL,
    telefono TEXT NOT NULL,
    cedula TEXT NOT NULL UNIQUE,
    tipo_zona TEXT NOT NULL CHECK(tipo_zona IN ('urbana','rural')),
    rango_edad TEXT NOT NULL,
    comuna TEXT,
    barrio TEXT,
    vereda TEXT,
    referido_por TEXT,
    creado_en TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (referido_por) REFERENCES personas(codigo)
  );
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_referido_por ON personas(referido_por);`);

// Bonificaciones (modulo de nomina, solo admin): un lider habilitado y, luego, pagado.
db.exec(`
  CREATE TABLE IF NOT EXISTS bonificaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_lider TEXT NOT NULL UNIQUE,
    estado TEXT NOT NULL CHECK(estado IN ('habilitada','pagada')),
    habilitada_en TEXT DEFAULT (datetime('now','localtime')),
    pagada_en TEXT,
    nota TEXT,
    monto INTEGER,
    FOREIGN KEY (codigo_lider) REFERENCES personas(codigo)
  );
`);

// Bases creadas antes de existir la columna "monto"
const colsBono = db.prepare("PRAGMA table_info(bonificaciones)").all().map((c) => c.name);
if (!colsBono.includes("monto")) db.exec("ALTER TABLE bonificaciones ADD COLUMN monto INTEGER");

// Configuracion del modulo de nomina que el admin cambia desde el panel
db.exec(`CREATE TABLE IF NOT EXISTS nomina_config (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);`);

const PREFIJO = process.env.PREFIJO_CODIGO || "AMIGOS";
const ANCHO = parseInt(process.env.ANCHO_CODIGO || "2", 10);

// Genera el siguiente codigo secuencial: AMIGOS01, AMIGOS02, ... (solo cuenta lideres)
function siguienteCodigo() {
  const fila = db.prepare("SELECT COUNT(*) AS total FROM personas WHERE rol = 'lider'").get();
  const numero = fila.total + 1;
  return PREFIJO + String(numero).padStart(ANCHO, "0");
}

module.exports = { db, siguienteCodigo };
