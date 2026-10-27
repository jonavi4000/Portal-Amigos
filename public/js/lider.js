const vistaLogin = document.getElementById("vistaLogin");
const vistaPanel = document.getElementById("vistaPanel");

async function verificarSesion() {
  const resp = await fetch("/api/mi-info");
  if (resp.ok) {
    const info = await resp.json();
    mostrarPanel(info);
  }
}
verificarSesion();

document.getElementById("formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("errorLogin");
  errorEl.classList.add("oculto");

  const cedula = document.getElementById("cedulaLogin").value.trim();
  const pin = document.getElementById("pin").value.trim();

  const resp = await fetch("/api/login-lider", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cedula, pin }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    errorEl.textContent = data.error || "No se pudo entrar.";
    errorEl.classList.remove("oculto");
    return;
  }
  const info = await (await fetch("/api/mi-info")).json();
  mostrarPanel(info);
});

async function mostrarPanel(info) {
  vistaLogin.classList.add("oculto");
  document.getElementById("marcaLogin").classList.add("oculto");
  vistaPanel.classList.remove("oculto");
  document.getElementById("saludo").textContent = info.nombre;
  document.getElementById("miCodigo").textContent = info.codigo;
  document.getElementById("miLink").value = info.link;
  const mensajeInvitacion = `Hola 👋 soy ${info.nombre}. Te invito a registrarte y ser parte de nuestra comunidad en Portal Amigos: ${info.link}`;
  document.getElementById("botonWhatsappInvitar").href = `https://wa.me/?text=${encodeURIComponent(mensajeInvitacion)}`;

  await refrescarEquipo();
}

async function refrescarEquipo() {
  const datos = await (await fetch("/api/mi-equipo")).json();
  window._arbolCompleto = datos.arbol;
  const plano = aplanar(datos.arbol, []).filter((n) => n.codigo !== document.getElementById("miCodigo").textContent);
  document.getElementById("totalEquipo").textContent = datos.total;
  document.getElementById("totalLideresEquipo").textContent = plano.filter((n) => n.rol === "lider").length;
  document.getElementById("totalPersonasEquipo").textContent = plano.filter((n) => n.rol === "persona").length;
  renderArbol(datos.arbol, document.getElementById("arbolEquipo"), true);
}

function iniciales(nombre) {
  return nombre.trim().charAt(0).toUpperCase();
}

function renderArbol(nodos, contenedorUl, esRaiz) {
  contenedorUl.innerHTML = "";
  nodos.forEach((nodo) => {
    const li = document.createElement("li");
    const zona =
      nodo.tipo_zona === "urbana"
        ? `Comuna ${nodo.comuna} · Barrio ${nodo.barrio}`
        : nodo.vereda;
    const etiquetaCodigo = nodo.codigo
      ? `<span class="nodo-codigo">${nodo.codigo}</span>`
      : `<span class="nodo-codigo persona-tag">persona</span>`;
    li.innerHTML = `
      <div class="nodo-tarjeta">
        <div class="avatar ${nodo.rol === "persona" ? "persona" : ""}">${iniciales(nodo.nombre)}</div>
        <div class="nodo-info">
          <div class="nodo-cabecera">
            <span class="nodo-nombre">${nodo.nombre}${esRaiz ? " (tú)" : ""}</span>
            ${etiquetaCodigo}
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
      renderArbol(nodo.hijos, subUl, false);
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
  const contenedor = document.getElementById("arbolEquipo");
  if (!texto) {
    renderArbol(window._arbolCompleto, contenedor, true);
    return;
  }
  const plano = aplanar(window._arbolCompleto, []);
  const encontrados = plano.filter(
    (n) =>
      n.nombre.toLowerCase().includes(texto) ||
      n.cedula.toLowerCase().includes(texto) ||
      (n.codigo && n.codigo.toLowerCase().includes(texto))
  );
  renderArbol(
    encontrados.map((n) => ({ ...n, hijos: [] })),
    contenedor,
    false
  );
});

document.getElementById("botonCopiar").addEventListener("click", () => {
  const input = document.getElementById("miLink");
  input.select();
  document.execCommand("copy");
});

// ---------- Formulario: registrar nuevo lider debajo de mi ----------
document.getElementById("nombre").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ\s'.-]/g, "");
});
document.getElementById("telefono").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
});
const cedulaInputLider = document.getElementById("cedula");
const avisoCedulaLider = document.getElementById("avisoCedula");
let cedulaDuplicadaLider = false;

cedulaInputLider.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 12);
  avisoCedulaLider.classList.add("oculto");
  cedulaDuplicadaLider = false;
});
cedulaInputLider.addEventListener("blur", async () => {
  const valor = cedulaInputLider.value.trim();
  if (valor.length < 5) return;
  try {
    const resp = await fetch(`/api/verificar-cedula/${encodeURIComponent(valor)}`);
    const data = await resp.json();
    if (data.existe) {
      avisoCedulaLider.textContent = "Esta cédula ya está registrada.";
      avisoCedulaLider.classList.remove("oculto");
      cedulaDuplicadaLider = true;
    } else {
      avisoCedulaLider.classList.add("oculto");
      cedulaDuplicadaLider = false;
    }
  } catch (err) {}
});

document.querySelectorAll('#formNuevoLider input[name="tipo_zona"]').forEach((r) =>
  r.addEventListener("change", () => {
    const valor = document.querySelector('#formNuevoLider input[name="tipo_zona"]:checked').value;
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

  if (cedulaDuplicadaLider) {
    errorEl.textContent = "Ya hay alguien registrado con esa cédula. Corrígela antes de continuar.";
    errorEl.classList.remove("oculto");
    return;
  }

  const tipo_zona = document.querySelector('#formNuevoLider input[name="tipo_zona"]:checked').value;
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

  const resp = await fetch("/api/lider/crear-lider", {
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
  document.getElementById("codigoNuevoLider").textContent = data.codigo;
  document.getElementById("pinNuevoLider").textContent = data.pin;
  exitoEl.classList.remove("oculto");
  document.getElementById("formNuevoLider").reset();

  await refrescarEquipo();
});

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

document.getElementById("cedulaLogin").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "");
});
