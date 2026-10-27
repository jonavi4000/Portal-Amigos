function requiereLider(req, res, next) {
  if (!req.session || !req.session.codigoLider) {
    return res.status(401).json({ error: "Debes iniciar sesion como lider." });
  }
  next();
}

function requiereAdmin(req, res, next) {
  if (!req.session || !req.session.esAdmin) {
    return res.status(401).json({ error: "Debes iniciar sesion como administrador." });
  }
  next();
}

module.exports = { requiereLider, requiereAdmin };
