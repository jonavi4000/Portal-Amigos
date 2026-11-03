// Modulo "Líderes y sus registros" para el panel de administrador.
// Es independiente: se agrega solo (menu + seccion) y lee el arbol que ya carga el admin.
// Para activarlo basta con cargar este archivo en admin.html, despues de admin.js.

// ---------- Logica (sin pantalla) ----------
function calcularLideres(arbol) {
  function contarEquipo(nodo) {
    let total = 0;
    let ultima = "";
    (nodo.hijos || []).forEach((h) => {
      total += 1;
      if ((h.creado_en || "") > ultima) ultima = h.creado_en || "";
      const r = contarEquipo(h);
      total += r.total;
      if (r.ultima > ultima) ultima = r.ultima;
    });
    return { total, ultima };
  }
  const lista = [];
  (function recorrer(nodos) {
    nodos.forEach((n) => {
      if (n.rol === "lider") {
        const r = contarEquipo(n);
        const hijos = n.hijos || [];
        lista.push({
          nombre: n.nombre,
          codigo: n.codigo || "",
          telefono: n.telefono || "",
          cedula: n.cedula || "",
          lugar: (n.tipo_zona === "urbana" ? n.barrio : n.vereda) || "",
          directos: hijos.length,
          directosLideres: hijos.filter((h) => h.rol === "lider").length,
          equipo: r.total,
          ultima: r.ultima,
        });
      }
      recorrer(n.hijos || []);
    });
  })(arbol || []);
  // Primero los que no han registrado a nadie, luego de menos a mas
  lista.sort((a, b) => a.directos - b.directos || a.nombre.localeCompare(b.nombre, "es"));
  return lista;
}

if (typeof module !== "undefined") module.exports = { calcularLideres };

// ---------- Pantalla ----------
if (typeof document !== "undefined") {
  (function () {
    function esc(t) {
      return String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    const estilo = document.createElement("style");
    estilo.textContent = `
      .estado-lider { display:inline-block; padding:2px 10px; border-radius:999px; font-size:.75rem; font-weight:700; }
      .estado-lider.sin { background:#fde8e8; color:#b42318; }
      .estado-lider.ok { background:#e3f6ec; color:#157347; }
      .controles-lideres { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; margin:12px 0; }
      .controles-lideres > div { flex:1 1 180px; }
      .controles-lideres label { margin:0 0 4px; font-size:.8rem; }
      .controles-lideres button { padding:10px 16px; font-size:.88rem; }
      .link-wsp-lider { color:#128C3E; font-weight:700; text-decoration:none; }
    `;
    document.head.appendChild(estilo);

    // ----- Seccion -----
    const seccion = document.createElement("div");
    seccion.className = "tarjeta-seccion";
    seccion.id = "lideresRegistros";
    seccion.innerHTML = `
      <h2>👥 Líderes y sus registros</h2>
      <p class="subtitulo">Mira cuántas personas ha registrado cada líder. Los que no han registrado a nadie salen primero.</p>
      <div class="tarjetas-stat">
        <div class="tarjeta-stat"><div class="valor" id="lrTotal">0</div><div class="etiqueta">Líderes</div></div>
        <div class="tarjeta-stat verde"><div class="valor" id="lrCon">0</div><div class="etiqueta">Con registros</div></div>
        <div class="tarjeta-stat naranja"><div class="valor" id="lrSin">0</div><div class="etiqueta">Sin registros</div></div>
      </div>
      <div class="controles-lideres">
        <div>
          <label for="lrEstado">Mostrar</label>
          <select id="lrEstado">
            <option value="">Todos los líderes</option>
            <option value="sin">Solo los que no han registrado a nadie</option>
            <option value="con">Solo los que ya registraron</option>
          </select>
        </div>
        <div>
          <label for="lrBuscar">Buscar líder</label>
          <input type="text" id="lrBuscar" placeholder="Nombre, cédula o código…" />
        </div>
        <button type="button" id="lrExportar" class="secundario">📥 Descargar esta lista</button>
      </div>
      <p class="subtitulo" id="lrConteo"></p>
      <div class="tabla-scroll">
        <table>
          <thead><tr>
            <th>Líder</th><th>Código</th><th>Teléfono</th><th>Barrio / sector</th>
            <th>Invitados directos</th><th>Equipo total</th><th>Último registro</th><th>Estado</th><th>Contacto</th>
          </tr></thead>
          <tbody id="lrCuerpo"></tbody>
        </table>
      </div>`;

    const ancla =
      document.getElementById("crearLider") ||
      document.getElementById("tabla") ||
      null;
    if (ancla && ancla.parentNode) ancla.parentNode.insertBefore(seccion, ancla);
    else (document.querySelector(".contenido-principal, main") || document.body).appendChild(seccion);

    // ----- Boton del menu lateral -----
    const modelo = document.querySelector(".navlink[data-ir]");
    const salir = document.querySelector(".barra-lateral .salir");
    if (modelo) {
      const boton = document.createElement("button");
      boton.className = modelo.className.replace(/\bactivo\b/g, "").trim();
      boton.textContent = "👥 Líderes";
      boton.addEventListener("click", () => {
        document.querySelectorAll(".navlink[data-ir]").forEach((b) => b.classList.remove("activo"));
        boton.classList.add("activo");
        seccion.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      if (salir && salir.parentNode) salir.parentNode.insertBefore(boton, salir);
      else modelo.parentNode.appendChild(boton);
    }

    // ----- Dibujar -----
    let todos = [];
    function filtrados() {
      const estado = document.getElementById("lrEstado").value;
      const q = document.getElementById("lrBuscar").value.trim().toLowerCase();
      return todos.filter((l) => {
        if (estado === "sin" && l.directos > 0) return false;
        if (estado === "con" && l.directos === 0) return false;
        if (q && !(l.nombre + " " + l.cedula + " " + l.codigo).toLowerCase().includes(q)) return false;
        return true;
      });
    }

    function dibujar() {
      const lista = filtrados();
      document.getElementById("lrTotal").textContent = todos.length;
      document.getElementById("lrCon").textContent = todos.filter((l) => l.directos > 0).length;
      document.getElementById("lrSin").textContent = todos.filter((l) => l.directos === 0).length;
      document.getElementById("lrConteo").textContent = `Mostrando ${lista.length} de ${todos.length} líderes.`;
      document.getElementById("lrCuerpo").innerHTML = lista.length
        ? lista
            .map((l) => {
              const primer = l.nombre.split(" ")[0];
              const msg = `Hola ${primer}, te escribimos de la campaña. ¿Cómo vas con tus invitaciones? Cualquier duda te ayudamos 🙌`;
              const contacto = /^3\d{9}$/.test(l.telefono)
                ? `<a class="link-wsp-lider" target="_blank" rel="noopener" href="https://wa.me/57${l.telefono}?text=${encodeURIComponent(msg)}">💬 Escribirle</a>`
                : "—";
              const estado = l.directos === 0
                ? '<span class="estado-lider sin">Sin registros</span>'
                : '<span class="estado-lider ok">Activo</span>';
              const extra = l.directosLideres ? ` <small>(${l.directosLideres} líder${l.directosLideres > 1 ? "es" : ""})</small>` : "";
              return `<tr>
                <td><strong>${esc(l.nombre)}</strong></td><td>${esc(l.codigo)}</td><td>${esc(l.telefono)}</td><td>${esc(l.lugar)}</td>
                <td><strong>${l.directos}</strong>${extra}</td><td>${l.equipo}</td>
                <td>${l.ultima ? esc(l.ultima.slice(0, 10)) : "—"}</td><td>${estado}</td><td>${contacto}</td></tr>`;
            })
            .join("")
        : '<tr><td colspan="9">No hay líderes con ese filtro.</td></tr>';
    }

    function celda(v) {
      let t = v == null ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
      return '"' + t.replace(/"/g, '""') + '"';
    }

    document.getElementById("lrExportar").addEventListener("click", () => {
      const filas = [["Líder", "Código", "Cédula", "Teléfono", "Barrio / sector", "Invitados directos", "Equipo total", "Último registro", "Estado"]];
      filtrados().forEach((l) =>
        filas.push([l.nombre, l.codigo, l.cedula, l.telefono, l.lugar, l.directos, l.equipo, l.ultima ? l.ultima.slice(0, 10) : "", l.directos === 0 ? "Sin registros" : "Activo"])
      );
      const csv = "\uFEFF" + filas.map((f) => f.map(celda).join(";")).join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `lideres_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    document.getElementById("lrEstado").addEventListener("change", dibujar);
    document.getElementById("lrBuscar").addEventListener("input", dibujar);

    // Se actualiza solo cuando el admin carga o recarga los datos
    let ultimoArbol = null;
    setInterval(() => {
      const arbol = window._arbolCompleto;
      if (arbol && arbol !== ultimoArbol) {
        ultimoArbol = arbol;
        todos = calcularLideres(arbol);
        dibujar();
      }
    }, 1000);
  })();
}
