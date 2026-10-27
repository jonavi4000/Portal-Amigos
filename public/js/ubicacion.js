// Llena las listas de barrio y corregimiento con el catalogo oficial (/data/barrios.json)
(async function () {
  const selBarrio = document.getElementById("barrio");
  const selVereda = document.getElementById("vereda");
  const selComuna = document.getElementById("comuna");
  const bloqueComuna = document.getElementById("bloqueComuna");
  if (!selBarrio || !selVereda) return;

  let catalogo;
  try {
    catalogo = await (await fetch("/data/barrios.json")).json();
  } catch (err) {
    selBarrio.innerHTML = '<option value="">No se pudo cargar la lista</option>';
    selVereda.innerHTML = '<option value="">No se pudo cargar la lista</option>';
    return;
  }

  function opcion(valor, texto) {
    const o = document.createElement("option");
    o.value = valor;
    o.textContent = texto;
    return o;
  }

  // ----- Barrios agrupados por comuna -----
  selBarrio.innerHTML = "";
  selBarrio.appendChild(opcion("", "Selecciona tu barrio…"));
  catalogo.comunas.forEach((comuna) => {
    const grupo = document.createElement("optgroup");
    grupo.label = "Comuna " + comuna;
    catalogo.barrios
      .filter((b) => b.comuna === comuna)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      .forEach((b) => grupo.appendChild(opcion(b.nombre, b.nombre)));
    selBarrio.appendChild(grupo);
  });
  selBarrio.appendChild(opcion("Sin registro", "Mi barrio no está en la lista"));

  // ----- Corregimientos -----
  selVereda.innerHTML = "";
  selVereda.appendChild(opcion("", "Selecciona…"));
  catalogo.rurales
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .forEach((r) => selVereda.appendChild(opcion(r.nombre, r.nombre)));
  selVereda.appendChild(opcion("Sin registro", "Mi sector no está en la lista"));

  // ----- La comuna se completa sola al escoger el barrio -----
  function actualizarComuna() {
    if (selBarrio.value === "Sin registro") {
      if (bloqueComuna) bloqueComuna.classList.remove("oculto");
      return;
    }
    if (bloqueComuna) bloqueComuna.classList.add("oculto");
    const b = catalogo.barrios.find((x) => x.nombre === selBarrio.value);
    if (b && selComuna) selComuna.value = b.comuna;
  }
  selBarrio.addEventListener("change", actualizarComuna);

  // Si el formulario se limpia (reset), volver a esconder la comuna
  const form = selBarrio.closest("form");
  if (form) form.addEventListener("reset", () => setTimeout(actualizarComuna, 0));
})();
