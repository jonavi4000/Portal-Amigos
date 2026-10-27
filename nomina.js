// Logica del modulo de nomina / bonificaciones (solo admin).
// Es una funcion pura (sin base de datos) para poder probarla facilmente.
//
// REGLA (configurable en .env):
//   Un lider queda "habilitado" para bonificacion cuando:
//     1) tiene registradas directamente al menos NOMINA_MIN_DIRECTOS personas, y
//     2) al menos NOMINA_MIN_RAMAS de esas personas directas (que tienen que ser
//        lideres, porque solo los lideres tienen codigo para registrar gente)
//        cumplen a su vez NOMINA_MIN_POR_RAMA registros directos cada una.
//   Solo cuenta la descendencia propia de cada lider (su propia "linea").

function entero(valor, porDefecto) {
  const n = parseInt(valor, 10);
  return Number.isFinite(n) && n >= 1 ? n : porDefecto;
}

// Prioridad: lo que el admin guardo en el panel > .env > valor por defecto (10)
function leerReglas(env = process.env, guardado = {}) {
  const dinero = parseInt(guardado.valor_bonificacion, 10);
  return {
    minDirectos: entero(guardado.min_directos ?? env.NOMINA_MIN_DIRECTOS, 10),
    minRamas: entero(guardado.min_ramas ?? env.NOMINA_MIN_RAMAS, 10),
    minPorRama: entero(guardado.min_por_rama ?? env.NOMINA_MIN_POR_RAMA, 10),
    valorBonificacion: Number.isFinite(dinero) && dinero >= 0 ? dinero : 0,
  };
}

// personas: filas de la tabla personas (codigo, nombre, cedula, telefono, rol, referido_por, ...)
// bonos: filas de la tabla bonificaciones
function calcularNomina(personas, bonos, reglas) {
  const hijosPorCodigo = new Map();
  personas.forEach((p) => {
    if (!p.referido_por) return;
    if (!hijosPorCodigo.has(p.referido_por)) hijosPorCodigo.set(p.referido_por, []);
    hijosPorCodigo.get(p.referido_por).push(p);
  });
  const hijosDe = (codigo) => (codigo ? hijosPorCodigo.get(codigo) || [] : []);

  const bonoPorCodigo = new Map(bonos.map((b) => [b.codigo_lider, b]));

  function contarDescendencia(codigo, visitados = new Set()) {
    let total = 0;
    for (const h of hijosDe(codigo)) {
      if (visitados.has(h.cedula)) continue;
      visitados.add(h.cedula);
      total += 1 + (h.codigo ? contarDescendencia(h.codigo, visitados) : 0);
    }
    return total;
  }

  const lideres = personas
    .filter((p) => p.rol === "lider" && p.codigo)
    .map((l) => {
      const directos = hijosDe(l.codigo);
      const ramas = directos.map((d) => {
        const registrados = hijosDe(d.codigo).length;
        return {
          nombre: d.nombre,
          codigo: d.codigo || "",
          rol: d.rol,
          registrados,
          cumple: d.rol === "lider" && registrados >= reglas.minPorRama,
        };
      });
      ramas.sort((a, b) => b.registrados - a.registrados || a.nombre.localeCompare(b.nombre));

      const ramasQueCumplen = ramas.filter((r) => r.cumple).length;
      const cumple = directos.length >= reglas.minDirectos && ramasQueCumplen >= reglas.minRamas;
      const bono = bonoPorCodigo.get(l.codigo) || null;

      return {
        codigo: l.codigo,
        nombre: l.nombre,
        cedula: l.cedula,
        telefono: l.telefono,
        directos: directos.length,
        ramasQueCumplen,
        faltanDirectos: Math.max(0, reglas.minDirectos - directos.length),
        faltanRamas: Math.max(0, reglas.minRamas - ramasQueCumplen),
        descendencia: contarDescendencia(l.codigo),
        cumple,
        estado: bono ? bono.estado : cumple ? "cumple" : "en_progreso",
        habilitadaEn: bono ? bono.habilitada_en : null,
        pagadaEn: bono ? bono.pagada_en : null,
        monto: bono && bono.monto !== null && bono.monto !== undefined ? bono.monto : null,
        nota: bono ? bono.nota || "" : "",
        ramas,
      };
    });

  const orden = { habilitada: 0, cumple: 1, en_progreso: 2, pagada: 3 };
  lideres.sort(
    (a, b) =>
      orden[a.estado] - orden[b.estado] ||
      b.ramasQueCumplen - a.ramasQueCumplen ||
      b.directos - a.directos ||
      a.nombre.localeCompare(b.nombre)
  );
  return lideres;
}

module.exports = { calcularNomina, leerReglas };
