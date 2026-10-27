const vistaLogin = document.getElementById("vistaLogin");
const vistaPanel = document.getElementById("vistaPanel");

async function verificarSesion() {
  const resp = await fetch("/api/arbol-completo");
  if (resp.ok) {
    const datos = await resp.json();
    mostrarPanel(datos);
  }
}
verificarSesion();

document.getElementById("formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("errorLogin");
  errorEl.classList.add("oculto");
  const password = document.getElementById("password").value;

  const resp = await fetch("/api/login-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    errorEl.textContent = data.error || "No se pudo entrar.";
    errorEl.classList.remove("oculto");
    return;
  }
  const datos = await (await fetch("/api/arbol-completo")).json();
  mostrarPanel(datos);
});

function mostrarPanel(datos) {
  vistaLogin.classList.add("oculto");
  document.getElementById("marcaLogin").classList.add("oculto");
  vistaPanel.classList.remove("oculto");
  window._arbolCompleto = datos.arbol;

  const plano = aplanar(datos.arbol, []);
  document.getElementById("totalPersonas").textContent = datos.total;
  document.getElementById("totalLideres").textContent = plano.filter((p) => p.rol === "lider").length;
  document.getElementById("totalPersonasSimples").textContent = plano.filter((p) => p.rol === "persona").length;
  document.getElementById("totalUrbana").textContent = plano.filter((p) => p.tipo_zona === "urbana").length;

  renderArbol(datos.arbol, document.getElementById("arbolCompleto"));
  renderTabla();
  renderMapa(plano).catch((err) => console.error("No se pudo dibujar el mapa:", err));
  cargarNomina();
}

function iniciales(nombre) {
  return nombre.trim().charAt(0).toUpperCase();
}

function renderArbol(nodos, contenedorUl) {
  contenedorUl.innerHTML = "";
  nodos.forEach((nodo) => {
    const li = document.createElement("li");
    const zona =
      nodo.tipo_zona === "urbana"
        ? `Comuna ${nodo.comuna} · Barrio ${nodo.barrio}`
        : nodo.vereda;
    li.innerHTML = `
      <div class="nodo-tarjeta">
        <div class="avatar ${nodo.rol === "persona" ? "persona" : ""}">${iniciales(nodo.nombre)}</div>
        <div class="nodo-info">
          <div class="nodo-cabecera">
            <span class="nodo-nombre">${nodo.nombre}</span>
            ${nodo.codigo ? `<span class="nodo-codigo">${nodo.codigo}</span>` : `<span class="nodo-codigo persona-tag">persona</span>`}
          </div>
          <div class="nodo-detalle">
            Tel. ${nodo.telefono} · C.C. ${nodo.cedula} · ${nodo.rango_edad} ·
            <span class="badge-zona">${zona}</span>
          </div>
        </div>
      </div>
    `;
    if (nodo.hijos && nodo.hijos.length) {
      const subUl = document.createElement("ul");
      subUl.className = "arbol-tarjetas";
      li.appendChild(subUl);
      renderArbol(nodo.hijos, subUl);
    }
    contenedorUl.appendChild(li);
  });
}

function aplanar(nodos, acumulado) {
  nodos.forEach((n) => {
    acumulado.push(n);
    if (n.hijos) aplanar(n.hijos, acumulado);
  });
  return acumulado;
}

document.getElementById("buscador").addEventListener("input", (e) => {
  const texto = e.target.value.trim().toLowerCase();
  const contenedor = document.getElementById("arbolCompleto");
  if (!texto) {
    renderArbol(window._arbolCompleto, contenedor);
    return;
  }
  const plano = aplanar(window._arbolCompleto, []);
  const encontrados = plano.filter(
    (n) =>
      n.nombre.toLowerCase().includes(texto) ||
      n.cedula.toLowerCase().includes(texto) ||
      (n.codigo && n.codigo.toLowerCase().includes(texto))
  );
  renderArbol(encontrados.map((n) => ({ ...n, hijos: [] })), contenedor);
});

// ---------- Filtrar mientras se escribe: nombre sin numeros, telefono/cedula solo numeros ----------
document.getElementById("nombre").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ\s'.-]/g, "");
});
document.getElementById("telefono").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
});
const cedulaInput = document.getElementById("cedula");
const avisoCedula = document.getElementById("avisoCedula");
let cedulaDuplicada = false;

cedulaInput.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 12);
  avisoCedula.classList.add("oculto");
  cedulaDuplicada = false;
});

cedulaInput.addEventListener("blur", async () => {
  const valor = cedulaInput.value.trim();
  if (valor.length < 5) return;
  try {
    const resp = await fetch(`/api/verificar-cedula/${encodeURIComponent(valor)}`);
    const data = await resp.json();
    if (data.existe) {
      avisoCedula.textContent = "Esta cédula ya está registrada.";
      avisoCedula.classList.remove("oculto");
      cedulaDuplicada = true;
    } else {
      avisoCedula.classList.add("oculto");
      cedulaDuplicada = false;
    }
  } catch (err) {}
});

// ---------- Formulario para crear un lider inicial (raiz) ----------
const radios = document.querySelectorAll('input[name="tipo_zona"]');
radios.forEach((r) =>
  r.addEventListener("change", () => {
    const valor = document.querySelector('input[name="tipo_zona"]:checked').value;
    document.getElementById("bloqueUrbana").classList.toggle("oculto", valor !== "urbana");
    document.getElementById("bloqueRural").classList.toggle("oculto", valor !== "rural");
  })
);

document.getElementById("formNuevoLider").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("errorNuevoLider");
  const exitoEl = document.getElementById("exitoNuevoLider");
  errorEl.classList.add("oculto");
  exitoEl.classList.add("oculto");

  if (cedulaDuplicada) {
    errorEl.textContent = "Ya hay alguien registrado con esa cédula. Corrígela antes de continuar.";
    errorEl.classList.remove("oculto");
    return;
  }

  const tipo_zona = document.querySelector('input[name="tipo_zona"]:checked').value;
  const cuerpo = {
    nombre: document.getElementById("nombre").value,
    telefono: document.getElementById("telefono").value,
    cedula: document.getElementById("cedula").value,
    rango_edad: document.getElementById("rango_edad").value,
    tipo_zona,
    comuna: tipo_zona === "urbana" ? document.getElementById("comuna").value : null,
    barrio: tipo_zona === "urbana" ? document.getElementById("barrio").value : null,
    vereda: tipo_zona === "rural" ? document.getElementById("vereda").value : null,
  };

  const resp = await fetch("/api/admin/crear-raiz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const data = await resp.json();
  if (!resp.ok) {
    errorEl.textContent = data.error || "No se pudo crear.";
    errorEl.classList.remove("oculto");
    return;
  }
  mostrarCredenciales(exitoEl, "Líder creado: " + data.nombre, data.codigo, data.pin);
  document.getElementById("formNuevoLider").reset();

  const datos = await (await fetch("/api/arbol-completo")).json();
  mostrarPanel(datos);
});

// ---------- Resetear PIN de alguien que lo olvido ----------
document.getElementById("formResetPin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("errorReset");
  const exitoEl = document.getElementById("exitoReset");
  errorEl.classList.add("oculto");
  exitoEl.classList.add("oculto");

  const valor = document.getElementById("valorReset").value;

  const resp = await fetch("/api/admin/resetear-pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ valor }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    errorEl.textContent = data.error || "No se pudo resetear.";
    errorEl.classList.remove("oculto");
    return;
  }
  mostrarCredenciales(exitoEl, "Nuevo PIN para " + data.nombre, data.codigo, data.pin);
  document.getElementById("formResetPin").reset();
});

// ---------- Convertir una persona en lider ----------
document.getElementById("formPromover").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("errorPromover");
  const exitoEl = document.getElementById("exitoPromover");
  errorEl.classList.add("oculto");
  exitoEl.classList.add("oculto");

  const cedula = document.getElementById("cedulaPromover").value;

  const resp = await fetch("/api/admin/promover-a-lider", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cedula }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    errorEl.textContent = data.error || "No se pudo convertir.";
    errorEl.classList.remove("oculto");
    return;
  }
  mostrarCredenciales(exitoEl, data.nombre + " ahora es líder", data.codigo, data.pin);
  document.getElementById("formPromover").reset();

  const datos = await (await fetch("/api/arbol-completo")).json();
  mostrarPanel(datos);
});

// ---------- Tabla completa con filtros ----------
function filtrarLista(lista) {
  const rol = document.getElementById("filtroRol").value;
  const zona = document.getElementById("filtroZona").value;
  const comuna = document.getElementById("filtroComuna").value;
  const edad = document.getElementById("filtroEdad").value;
  const barrio = document.getElementById("filtroBarrio").value.trim().toLowerCase();

  return lista.filter((p) => {
    if (rol && p.rol !== rol) return false;
    if (zona && p.tipo_zona !== zona) return false;
    if (comuna && p.comuna !== comuna) return false;
    if (edad && p.rango_edad !== edad) return false;
    if (barrio) {
      const campo = (p.tipo_zona === "urbana" ? p.barrio : p.vereda) || "";
      if (!campo.toLowerCase().includes(barrio)) return false;
    }
    return true;
  });
}

function renderTabla() {
  const lista = aplanar(window._arbolCompleto || [], []);

  const filtrados = filtrarLista(lista);

  document.getElementById("totalFiltrados").textContent =
    `${filtrados.length} de ${lista.length} registros`;

  const cuerpo = document.getElementById("cuerpoTabla");
  cuerpo.innerHTML = filtrados
    .map((p) => {
      const zonaTexto = p.tipo_zona === "urbana" ? "Urbana" : "Rural";
      const lugar = p.tipo_zona === "urbana" ? p.barrio || "" : p.vereda || "";
      return `<tr>
        <td>${p.nombre}</td>
        <td>${p.cedula}</td>
        <td>${p.telefono}</td>
        <td>${p.rango_edad}</td>
        <td>${p.rol === "lider" ? "Líder" : "Persona"}</td>
        <td>${p.codigo || "—"}</td>
        <td>${zonaTexto}</td>
        <td>${p.tipo_zona === "urbana" ? p.comuna : "—"}</td>
        <td>${lugar}</td>
        <td>${p.referido_por || "—"}</td>
      </tr>`;
    })
    .join("");
}

["filtroRol", "filtroZona", "filtroComuna", "filtroEdad"].forEach((id) =>
  document.getElementById(id).addEventListener("change", renderTabla)
);
document.getElementById("filtroBarrio").addEventListener("input", renderTabla);

document.getElementById("botonSalir").addEventListener("click", async (e) => {
  e.preventDefault();
  await fetch("/api/logout", { method: "POST" });
  window.location.reload();
});

// ---------- Barra lateral: resaltar seccion activa al hacer click ----------
document.querySelectorAll(".navlink[data-ir]").forEach((boton) => {
  boton.addEventListener("click", () => {
    document.querySelectorAll(".navlink[data-ir]").forEach((b) => b.classList.remove("activo"));
    boton.classList.add("activo");
    const destino = document.querySelector(boton.dataset.ir);
    if (destino) destino.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});


// ---------- Exportar a CSV (se abre con Excel / Google Sheets) ----------
function celdaCSV(valor) {
  let texto = valor === null || valor === undefined ? "" : String(valor);
  // Evita que Excel interprete texto como formula (=, +, -, @)
  if (/^[=+\-@\t\r]/.test(texto)) texto = "'" + texto;
  return '"' + texto.replace(/"/g, '""') + '"';
}

function exportarCSV(filas, prefijoArchivo) {
  const todos = aplanar(window._arbolCompleto || [], []);
  const nombrePorCodigo = {};
  todos.forEach((p) => {
    if (p.codigo) nombrePorCodigo[p.codigo] = p.nombre;
  });

  const encabezados = [
    "Nombre", "Cédula", "Teléfono", "Rango de edad", "Rol", "Código", "Zona",
    "Comuna", "Barrio / Vereda", "Invitado por (código)", "Invitado por (nombre)", "Fecha de registro",
  ];
  const lineas = [encabezados.map(celdaCSV).join(";")];
  filas.forEach((p) => {
    lineas.push(
      [
        p.nombre,
        p.cedula,
        p.telefono,
        p.rango_edad,
        p.rol === "lider" ? "Líder" : "Persona",
        p.codigo || "",
        p.tipo_zona === "urbana" ? "Urbana" : "Rural",
        p.tipo_zona === "urbana" ? p.comuna : "",
        p.tipo_zona === "urbana" ? p.barrio : p.vereda,
        p.referido_por || "",
        p.referido_por ? nombrePorCodigo[p.referido_por] || "" : "",
        p.creado_en || "",
      ].map(celdaCSV).join(";")
    );
  });

  // \uFEFF = marca para que Excel muestre bien tildes y la ñ
  const blob = new Blob(["\uFEFF" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const hoy = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${prefijoArchivo}_${hoy}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  document.getElementById("infoExportar").textContent = `Se descargaron ${filas.length} registros.`;
}

document.getElementById("botonExportarTodo").addEventListener("click", () => {
  exportarCSV(aplanar(window._arbolCompleto || [], []), "personas_todas");
});

document.getElementById("botonExportarFiltrado").addEventListener("click", () => {
  const filtrados = filtrarLista(aplanar(window._arbolCompleto || [], []));
  exportarCSV(filtrados, "personas_filtradas");
});


// ---------- Muestra codigo + PIN bien visibles ----------
function mostrarCredenciales(el, titulo, codigo, pin) {
  el.className = "tarjeta-exito";
  el.innerHTML =
    `<p style="margin:0 0 6px;"><strong>${titulo}</strong></p>` +
    `<p style="margin:0;">Código: <span class="codigo">${codigo}</span></p>` +
    `<p style="margin:6px 0 0;">PIN: <span class="pin">${pin}</span></p>` +
    `<p class="subtitulo" style="margin:10px 0 0;">Entrégaselo ya, el PIN no vuelve a aparecer. Entra en /lider.html con su cédula y este PIN.</p>`;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}


// ---------- Mapa de barrios (Leaflet + OpenStreetMap) ----------
function normalizarTexto(t) {
  return String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

let mapaBarrios = null;
let capaBarrios = null;
let catalogoMapa = null;

async function renderMapa(plano) {
  const contenedor = document.getElementById("mapaBarrios");
  if (typeof L === "undefined") {
    contenedor.style.height = "auto";
    contenedor.innerHTML = '<p class="error">El mapa necesita conexión a internet para cargar. Revisa tu conexión y recarga la página.</p>';
    return;
  }
  if (!catalogoMapa) {
    catalogoMapa = await (await fetch("/data/barrios.json")).json();
  }
  const cat = catalogoMapa;

  // ----- Contar personas por lugar -----
  const lugares = [];
  cat.barrios.forEach((b) => lugares.push({ ...b, zona: "Comuna " + b.comuna, rural: false, total: 0, lideres: 0, personas: 0 }));
  cat.rurales.forEach((r) => lugares.push({ ...r, zona: "Rural", rural: true, total: 0, lideres: 0, personas: 0 }));
  const porNombre = {};
  lugares.forEach((l) => (porNombre[normalizarTexto(l.nombre)] = l));

  let sinUbicar = 0;
  const porComuna = { Occidental: 0, Norte: 0, Oriental: 0, Sur: 0 };
  let totalRural = 0;
  plano.forEach((p) => {
    const clave = normalizarTexto(p.tipo_zona === "urbana" ? p.barrio : p.vereda);
    const lugar = porNombre[clave];
    if (lugar) {
      lugar.total++;
      if (p.rol === "lider") lugar.lideres++;
      else lugar.personas++;
    } else {
      sinUbicar++;
    }
    if (p.tipo_zona === "urbana") {
      if (p.comuna in porComuna) porComuna[p.comuna]++;
    } else {
      totalRural++;
    }
  });

  // ----- Tarjetas resumen por comuna -----
  const tarjetas = [
    ["", "Occidental", porComuna.Occidental],
    ["verde", "Norte", porComuna.Norte],
    ["morado", "Oriental", porComuna.Oriental],
    ["naranja", "Sur", porComuna.Sur],
    ["", "Zona rural", totalRural],
  ];
  document.getElementById("resumenComunas").innerHTML = tarjetas
    .map(([clase, nombre, n]) => `<div class="tarjeta-stat ${clase}"><div class="valor">${n}</div><div class="etiqueta">${nombre === "Zona rural" ? nombre : "Comuna " + nombre}</div></div>`)
    .join("");

  // ----- Crear el mapa una sola vez -----
  if (!mapaBarrios) {
    mapaBarrios = L.map("mapaBarrios").setView([1.6144, -75.6062], 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapaBarrios);
    capaBarrios = L.layerGroup().addTo(mapaBarrios);

    const urbanos = cat.barrios.map((b) => [b.lat, b.lng]);
    const todos = urbanos.concat(cat.rurales.map((r) => [r.lat, r.lng]));
    document.getElementById("verCiudad").addEventListener("click", () => mapaBarrios.fitBounds(urbanos, { padding: [30, 30] }));
    document.getElementById("verTodo").addEventListener("click", () => mapaBarrios.fitBounds(todos, { padding: [30, 30] }));
    document.getElementById("verSinRegistros").addEventListener("change", () => dibujarCirculos());
    mapaBarrios.fitBounds(urbanos, { padding: [30, 30] });
  }
  setTimeout(() => mapaBarrios.invalidateSize(), 200);

  window._lugaresMapa = lugares;
  dibujarCirculos();

  // ----- Nota y ranking -----
  document.getElementById("notaSinUbicar").textContent = sinUbicar
    ? `${sinUbicar} persona(s) no se pueden ubicar en el mapa (eligieron "Mi barrio no está en la lista" o se registraron antes con el barrio escrito a mano). Siguen contadas en la tabla.`
    : "Todas las personas registradas están ubicadas en el mapa.";

  const ranking = lugares.filter((l) => l.total > 0).sort((a, b) => b.total - a.total).slice(0, 15);
  document.getElementById("cuerpoRanking").innerHTML = ranking.length
    ? ranking
        .map((l, i) => `<tr><td>${i + 1}</td><td>${l.nombre}</td><td>${l.zona}</td><td><strong>${l.total}</strong></td><td>${l.lideres}</td><td>${l.personas}</td></tr>`)
        .join("")
    : '<tr><td colspan="6">Todavía no hay personas ubicadas en barrios de la lista.</td></tr>';
}

function dibujarCirculos() {
  capaBarrios.clearLayers();
  const lugares = window._lugaresMapa || [];
  const verVacios = document.getElementById("verSinRegistros").checked;
  const maximo = Math.max(1, ...lugares.map((l) => l.total));

  lugares.forEach((l) => {
    if (l.total === 0) {
      if (!verVacios) return;
      L.circleMarker([l.lat, l.lng], { radius: 4, color: "#9aa3b2", fillColor: "#c3cad6", fillOpacity: 0.8, weight: 1 })
        .bindPopup(`<strong>${l.nombre}</strong><br>${l.zona}<br>Sin personas registradas`)
        .addTo(capaBarrios);
      return;
    }
    const ratio = l.total / maximo;
    const color = ratio < 0.25 ? "#8fd0a9" : ratio < 0.5 ? "#087939" : ratio < 0.75 ? "#f59e0b" : "#ef4444";
    const radio = 12 + 24 * Math.sqrt(ratio);
    L.circleMarker([l.lat, l.lng], { radius: radio, color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 0.85 })
      .bindPopup(`<strong>${l.nombre}</strong><br>${l.zona}<br>Total: <strong>${l.total}</strong><br>Líderes: ${l.lideres} · Personas: ${l.personas}`)
      .bindTooltip(String(l.total), { permanent: true, direction: "center", className: "etiqueta-mapa" })
      .addTo(capaBarrios);
  });
}


// ================= Nomina / bonificaciones =================
let _nomina = { reglas: null, lideres: [] };
const ETIQUETA_ESTADO = { en_progreso: "En progreso", cumple: "Cumple", habilitada: "Habilitada", pagada: "Pagada" };

const _fmtCOP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
function dinero(n) {
  return _fmtCOP.format(n || 0);
}

function nomMostrarError(msg) {
  const el = document.getElementById("nomError");
  el.textContent = msg || "";
  el.classList.toggle("oculto", !msg);
}

async function cargarNomina() {
  const resp = await fetch("/api/admin/nomina");
  if (!resp.ok) return;
  _nomina = await resp.json();
  const r = _nomina.reglas;
  document.getElementById("reglaNomina").textContent =
    `Un líder se puede habilitar cuando tiene al menos ${r.minDirectos} personas registradas por él, ` +
    `y al menos ${r.minRamas} de ellas (que deben ser líderes) registraron a su vez ${r.minPorRama} cada una. ` +
    `Solo cuenta la descendencia de cada líder.`;
  const cuenta = (e) => _nomina.lideres.filter((l) => l.estado === e).length;
  document.getElementById("nomCumplen").textContent = cuenta("cumple");
  document.getElementById("nomHabilitadas").textContent = cuenta("habilitada");
  document.getElementById("nomPagadas").textContent = cuenta("pagada");
  document.getElementById("nomProgreso").textContent = cuenta("en_progreso");

  const suma = (e) => _nomina.lideres.filter((l) => l.estado === e).reduce((t, l) => t + (l.monto || 0), 0);
  document.getElementById("nomTotales").textContent =
    `Valor actual por líder: ${dinero(r.valorBonificacion)} · Habilitado por pagar: ${dinero(suma("habilitada"))} · Ya pagado: ${dinero(suma("pagada"))}`;

  // Rellena el formulario de configuracion (si el admin no esta escribiendo en el)
  const enfocado = document.activeElement && document.activeElement.id && document.activeElement.id.startsWith("nomCfg");
  if (!enfocado) {
    document.getElementById("nomCfgDirectos").value = r.minDirectos;
    document.getElementById("nomCfgRamas").value = r.minRamas;
    document.getElementById("nomCfgPorRama").value = r.minPorRama;
    document.getElementById("nomCfgValor").value = r.valorBonificacion;
  }
  renderNomina();
}

function nomFiltrados() {
  const estado = document.getElementById("nomFiltro").value;
  const q = normalizarTexto(document.getElementById("nomBuscar").value.trim());
  return _nomina.lideres.filter((l) => {
    if (estado && l.estado !== estado) return false;
    if (q && !normalizarTexto(`${l.nombre} ${l.codigo} ${l.cedula}`).includes(q)) return false;
    return true;
  });
}

function celdaProgreso(valor, meta) {
  const td = document.createElement("td");
  const caja = document.createElement("div");
  caja.className = "prog-nomina";
  const t = document.createElement("div");
  t.className = "texto";
  t.textContent = `${valor} / ${meta}`;
  const barra = document.createElement("div");
  barra.className = "barra";
  const relleno = document.createElement("span");
  relleno.style.width = Math.min(100, Math.round((valor / meta) * 100)) + "%";
  barra.appendChild(relleno);
  caja.append(t, barra);
  td.appendChild(caja);
  return td;
}

function botonNomina(texto, clase, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = texto;
  if (clase) b.className = clase;
  b.addEventListener("click", onClick);
  return b;
}

async function accionNomina(ruta, codigo, cuerpoExtra) {
  nomMostrarError("");
  const resp = await fetch("/api/admin/nomina/" + ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codigo, ...(cuerpoExtra || {}) }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    nomMostrarError(data.error || "No se pudo completar la acción.");
    return;
  }
  await cargarNomina();
}

function renderNomina() {
  const cuerpo = document.getElementById("cuerpoNomina");
  cuerpo.innerHTML = "";
  const lista = nomFiltrados();
  if (lista.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "No hay líderes para mostrar con ese filtro.";
    tr.appendChild(td);
    cuerpo.appendChild(tr);
    return;
  }
  const r = _nomina.reglas;
  lista.forEach((l) => {
    const tr = document.createElement("tr");

    const tdNombre = document.createElement("td");
    const nom = document.createElement("strong");
    nom.textContent = l.nombre;
    const sub = document.createElement("div");
    sub.className = "subtitulo";
    sub.style.margin = "2px 0 0";
    sub.textContent = `${l.codigo} · Cédula ${l.cedula} · Descendencia: ${l.descendencia}`;
    tdNombre.append(nom, sub);

    const tdEstado = document.createElement("td");
    const et = document.createElement("span");
    et.className = "estado-nomina " + l.estado;
    et.textContent = ETIQUETA_ESTADO[l.estado];
    tdEstado.appendChild(et);
    if (l.habilitadaEn) {
      const f = document.createElement("div");
      f.className = "subtitulo";
      f.style.margin = "4px 0 0";
      f.textContent =
        (l.monto !== null ? `Valor: ${dinero(l.monto)} · ` : "") +
        (l.pagadaEn ? `Pagada: ${l.pagadaEn}` : `Habilitada: ${l.habilitadaEn}`);
      tdEstado.appendChild(f);
    }

    const tdAccion = document.createElement("td");
    const acciones = document.createElement("div");
    acciones.className = "acciones-nomina";
    const detalle = document.createElement("tr");
    detalle.className = "detalle-nomina oculto";
    acciones.appendChild(
      botonNomina("Ver ramas", "secundario", () => detalle.classList.toggle("oculto"))
    );
    if (l.estado === "cumple") {
      acciones.appendChild(
        botonNomina("Habilitar bonificación", "", () => {
          if (!confirm(`¿Habilitar la bonificación de ${l.nombre} por ${dinero(_nomina.reglas.valorBonificacion)}?`)) return;
          const nota = prompt("Nota opcional (por ejemplo, una referencia de pago):", "") || "";
          accionNomina("habilitar", l.codigo, { nota });
        })
      );
    } else if (l.estado === "habilitada") {
      acciones.appendChild(
        botonNomina("Marcar como pagada", "", () => {
          if (confirm(`¿Confirmas que ya se pagó la bonificación de ${l.nombre}${l.monto !== null ? " (" + dinero(l.monto) + ")" : ""}?`)) accionNomina("pagada", l.codigo);
        })
      );
      acciones.appendChild(
        botonNomina("Revocar", "secundario", () => {
          if (confirm(`¿Quitar la habilitación de ${l.nombre}?`)) accionNomina("revocar", l.codigo);
        })
      );
    }
    tdAccion.appendChild(acciones);
    if (l.nota) {
      const n = document.createElement("div");
      n.className = "subtitulo";
      n.style.margin = "6px 0 0";
      n.textContent = "Nota: " + l.nota;
      tdAccion.appendChild(n);
    }

    tr.append(tdNombre, celdaProgreso(l.directos, r.minDirectos), celdaProgreso(l.ramasQueCumplen, r.minRamas), tdEstado, tdAccion);

    const tdDet = document.createElement("td");
    tdDet.colSpan = 5;
    if (l.ramas.length === 0) {
      tdDet.textContent = "Todavía no tiene personas registradas directamente.";
    } else {
      const titulo = document.createElement("div");
      titulo.className = "subtitulo";
      titulo.textContent = `Personas registradas por ${l.nombre} y cuántas registró cada una (meta: ${r.minPorRama}):`;
      const ul = document.createElement("ul");
      l.ramas.forEach((ra) => {
        const li = document.createElement("li");
        if (ra.cumple) li.className = "ok";
        const tipo = ra.rol === "lider" ? "" : " (persona simple, no puede registrar gente)";
        li.textContent = `${ra.nombre}${tipo}: ${ra.registrados}${ra.cumple ? " ✓" : ""}`;
        ul.appendChild(li);
      });
      tdDet.append(titulo, ul);
    }
    detalle.appendChild(tdDet);
    cuerpo.append(tr, detalle);
  });
}

document.getElementById("nomFiltro").addEventListener("change", renderNomina);
document.getElementById("nomBuscar").addEventListener("input", renderNomina);

document.getElementById("nomExportar").addEventListener("click", () => {
  const enc = ["Líder", "Código", "Cédula", "Teléfono", "Directos", "Ramas que cumplen", "Descendencia total", "Estado", "Valor (COP)", "Habilitada", "Pagada", "Nota"];
  const lineas = [enc.map(celdaCSV).join(";")];
  nomFiltrados().forEach((l) => {
    lineas.push(
      [l.nombre, l.codigo, l.cedula, l.telefono, l.directos, l.ramasQueCumplen, l.descendencia,
       ETIQUETA_ESTADO[l.estado], l.monto === null ? "" : l.monto, l.habilitadaEn || "", l.pagadaEn || "", l.nota]
        .map(celdaCSV).join(";")
    );
  });
  const blob = new Blob(["\uFEFF" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nomina_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

document.getElementById("nomCfgGuardar").addEventListener("click", async () => {
  const err = document.getElementById("nomCfgError");
  const ok = document.getElementById("nomCfgOk");
  err.classList.add("oculto");
  ok.classList.add("oculto");
  const cuerpo = {
    minDirectos: document.getElementById("nomCfgDirectos").value,
    minRamas: document.getElementById("nomCfgRamas").value,
    minPorRama: document.getElementById("nomCfgPorRama").value,
    valorBonificacion: document.getElementById("nomCfgValor").value,
  };
  const resp = await fetch("/api/admin/nomina/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const data = await resp.json();
  if (!resp.ok) {
    err.textContent = data.error || "No se pudo guardar.";
    err.classList.remove("oculto");
    return;
  }
  document.activeElement && document.activeElement.blur();
  await cargarNomina();
  ok.textContent = "✓ Cambios guardados.";
  ok.classList.remove("oculto");
});
