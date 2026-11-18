// Piezas de seguridad reutilizables (sin dependencias externas).
// Se mantienen aparte de server.js para poder probarlas solas.
const crypto = require("crypto");

// ---------- Comparar claves sin filtrar informacion por tiempo ----------
function clavesIguales(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- PIN de 4 digitos generado con aleatoriedad criptografica ----------
function pinAleatorio() {
  return String(crypto.randomInt(1000, 10000));
}

// ---------- Limite de solicitudes por IP (ventana fija) ----------
function crearLimitador({ ventanaMs, max, mensaje }) {
  const golpes = new Map();
  setInterval(() => {
    const ahora = Date.now();
    for (const [k, r] of golpes) if (r.hasta <= ahora) golpes.delete(k);
  }, 60 * 1000).unref();

  return function limitador(req, res, next) {
    const ahora = Date.now();
    const clave = req.ip || "sin-ip";
    let r = golpes.get(clave);
    if (!r || r.hasta <= ahora) {
      r = { cuenta: 0, hasta: ahora + ventanaMs };
      golpes.set(clave, r);
    }
    r.cuenta += 1;
    if (r.cuenta > max) {
      res.set("Retry-After", String(Math.ceil((r.hasta - ahora) / 1000)));
      return res.status(429).json({ error: mensaje || "Demasiadas solicitudes. Intenta más tarde." });
    }
    next();
  };
}

// ---------- Control de intentos fallidos (para logins) ----------
function crearControlFallos() {
  const fallos = new Map();
  setInterval(() => {
    const ahora = Date.now();
    for (const [k, r] of fallos) if (r.expira <= ahora && r.bloqueadoHasta <= ahora) fallos.delete(k);
  }, 60 * 1000).unref();

  return {
    estaBloqueado(clave) {
      const r = fallos.get(clave);
      return !!(r && r.bloqueadoHasta > Date.now());
    },
    anotarFallo(clave, maxFallos, ventanaMs) {
      const ahora = Date.now();
      let r = fallos.get(clave);
      if (!r || (r.expira <= ahora && r.bloqueadoHasta <= ahora)) {
        r = { cuenta: 0, expira: ahora + ventanaMs, bloqueadoHasta: 0 };
      }
      r.cuenta += 1;
      if (r.cuenta >= maxFallos) r.bloqueadoHasta = ahora + ventanaMs;
      fallos.set(clave, r);
    },
    limpiar(clave) {
      fallos.delete(clave);
    },
  };
}

// ---------- Cabeceras de seguridad ----------
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://cdnjs.cloudflare.com",
  "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://unpkg.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function cabecerasSeguridad(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", CSP);
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000");
  next();
}

// ---------- Cache ----------
// Las respuestas de la API llevan datos personales: nunca se guardan.
function sinCacheEnApi(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
}

// Archivos estaticos: HTML/JS/CSS/JSON se revalidan siempre (si no cambiaron, responde 304 rapido);
// las imagenes y fuentes se guardan 1 hora.
const opcionesEstaticos = {
  setHeaders(res, rutaArchivo) {
    if (/\.(jpe?g|png|webp|svg|ico|gif|woff2?)$/i.test(rutaArchivo)) {
      res.setHeader("Cache-Control", "public, max-age=3600");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
};

module.exports = {
  clavesIguales,
  pinAleatorio,
  crearLimitador,
  crearControlFallos,
  cabecerasSeguridad,
  sinCacheEnApi,
  opcionesEstaticos,
  CSP,
};
