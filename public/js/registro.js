const params = new URLSearchParams(window.location.search);
const ref = params.get("ref");

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
  // al volver a escribir, ocultamos el aviso hasta que se vuelva a validar
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
      avisoCedula.textContent = "Esta cédula ya está registrada. No puedes continuar con este número.";
      avisoCedula.classList.remove("oculto");
      cedulaDuplicada = true;
    } else {
      avisoCedula.classList.add("oculto");
      cedulaDuplicada = false;
    }
  } catch (err) {
    // si falla la verificacion, no bloqueamos: el servidor igual la valida al enviar
  }
});

const radios = document.querySelectorAll('input[name="tipo_zona"]');
const bloqueUrbana = document.getElementById("bloqueUrbana");
const bloqueRural = document.getElementById("bloqueRural");

function actualizarBloques() {
  const valor = document.querySelector('input[name="tipo_zona"]:checked').value;
  bloqueUrbana.classList.toggle("oculto", valor !== "urbana");
  bloqueRural.classList.toggle("oculto", valor !== "rural");
}
radios.forEach((r) => r.addEventListener("change", actualizarBloques));
actualizarBloques();

if (ref) {
  fetch(`/api/verificar-referido/${encodeURIComponent(ref)}`)
    .then((r) => r.json())
    .then((data) => {
      const caja = document.getElementById("cajaReferido");
      if (data.existe) {
        caja.textContent = `Te está invitando ${data.nombre} (${data.codigo}).`;
      } else {
        caja.textContent = "El link de invitación no es válido, pero puedes registrarte igual.";
      }
    });
}

document.getElementById("formRegistro").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("mensajeError");
  errorEl.classList.add("oculto");

  if (cedulaDuplicada) {
    errorEl.textContent = "Ya hay alguien registrado con esa cédula. Corrígela antes de continuar.";
    errorEl.classList.remove("oculto");
    cedulaInput.focus();
    return;
  }

  if (!document.getElementById("consentimiento").checked) {
    errorEl.textContent = "Debes aceptar el tratamiento de datos para continuar.";
    errorEl.classList.remove("oculto");
    return;
  }

  const tipo_zona = document.querySelector('input[name="tipo_zona"]:checked').value;
  const nombreEscrito = document.getElementById("nombre").value.trim();
  const cuerpo = {
    nombre: nombreEscrito,
    telefono: document.getElementById("telefono").value,
    cedula: document.getElementById("cedula").value,
    rango_edad: document.getElementById("rango_edad").value,
    tipo_zona,
    comuna: tipo_zona === "urbana" ? document.getElementById("comuna").value : null,
    barrio: tipo_zona === "urbana" ? document.getElementById("barrio").value : null,
    vereda: tipo_zona === "rural" ? document.getElementById("vereda").value : null,
    referido_por: ref || null,
  };

  try {
    const resp = await fetch("/api/registro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const data = await resp.json();
    if (!resp.ok) {
      errorEl.textContent = data.error || "Ocurrió un error.";
      errorEl.classList.remove("oculto");
      return;
    }
    document.getElementById("formRegistro").classList.add("oculto");
    document.getElementById("nombrePersona").textContent = nombreEscrito.split(" ")[0];
    const tarjeta = document.getElementById("tarjetaExito");
    tarjeta.classList.remove("oculto");

    await mostrarBotonesWhatsapp(nombreEscrito);
  } catch (err) {
    errorEl.textContent = "No se pudo conectar con el servidor.";
    errorEl.classList.remove("oculto");
  }
});

// ---------- Botones de WhatsApp en la pantalla de agradecimiento ----------
async function mostrarBotonesWhatsapp(nombreCompleto) {
  const contenedor = document.getElementById("botonesWhatsapp");
  try {
    const config = await (await fetch("/api/config")).json();
    const piezas = [];

    if (config.whatsappCanalUrl) {
      piezas.push(
        `<a class="boton-whatsapp" href="${config.whatsappCanalUrl}" target="_blank" rel="noopener">Unirme al canal oficial de WhatsApp</a>`
      );
    }

    let linkDirecto = "";
    if (config.whatsappNumero) {
      const campana = config.nombreCampana || "nuestro candidato";
      const mensaje = `Hola, soy ${nombreCompleto}. Me acabo de registrar en la página web y quiero recibir información de la campaña de ${campana}.`;
      linkDirecto = `https://wa.me/${config.whatsappNumero}?text=${encodeURIComponent(mensaje)}`;
      piezas.push(
        `<a class="boton-whatsapp secundario-wsp" href="${linkDirecto}">Abrir WhatsApp</a>`
      );
    }

    contenedor.innerHTML = piezas.join("");

    // Salta directo a WhatsApp con el mensaje listo (en el celular abre la app)
    if (linkDirecto) {
      window.location.href = linkDirecto;
    }
  } catch (err) {
    // Si falla, simplemente no mostramos los botones de WhatsApp; el registro ya quedo guardado.
  }
}
