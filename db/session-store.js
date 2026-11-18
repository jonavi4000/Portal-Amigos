// Almacen de sesiones en SQLite: las sesiones sobreviven si reinicias el servidor
// (el almacen por defecto de express-session guarda en memoria y se pierde).
const session = require("express-session");

class SqliteStore extends session.Store {
  constructor(db, { duracionPorDefectoMs = 8 * 60 * 60 * 1000 } = {}) {
    super();
    this.duracion = duracionPorDefectoMs;
    db.exec(`CREATE TABLE IF NOT EXISTS sesiones (sid TEXT PRIMARY KEY, datos TEXT NOT NULL, expira INTEGER NOT NULL)`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_sesiones_expira ON sesiones(expira)");
    this._get = db.prepare("SELECT datos, expira FROM sesiones WHERE sid = ?");
    this._set = db.prepare(
      "INSERT INTO sesiones (sid, datos, expira) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET datos = excluded.datos, expira = excluded.expira"
    );
    this._del = db.prepare("DELETE FROM sesiones WHERE sid = ?");
    this._touch = db.prepare("UPDATE sesiones SET expira = ? WHERE sid = ?");
    this._limpiar = db.prepare("DELETE FROM sesiones WHERE expira < ?");
    this._limpiar.run(Date.now());
    const t = setInterval(() => {
      try { this._limpiar.run(Date.now()); } catch (e) { /* se intenta de nuevo en la proxima vuelta */ }
    }, 15 * 60 * 1000);
    if (t.unref) t.unref();
  }
  _expiracion(sess) {
    const e = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : NaN;
    return Number.isFinite(e) ? e : Date.now() + this.duracion;
  }
  get(sid, cb) {
    try {
      const f = this._get.get(sid);
      if (!f) return cb(null, null);
      if (f.expira < Date.now()) { this._del.run(sid); return cb(null, null); }
      cb(null, JSON.parse(f.datos));
    } catch (err) { cb(err); }
  }
  set(sid, sess, cb) {
    try { this._set.run(sid, JSON.stringify(sess), this._expiracion(sess)); if (cb) cb(null); } catch (err) { if (cb) cb(err); }
  }
  destroy(sid, cb) {
    try { this._del.run(sid); if (cb) cb(null); } catch (err) { if (cb) cb(err); }
  }
  touch(sid, sess, cb) {
    try { this._touch.run(this._expiracion(sess), sid); if (cb) cb(null); } catch (err) { if (cb) cb(err); }
  }
}
module.exports = SqliteStore;
