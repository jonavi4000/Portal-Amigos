# App de líderes de campaña (registro en árbol)

App para registrar líderes y personas de una campaña, en estructura de árbol
(cada quien puede meter gente debajo de sí), con código de referido tipo
`AMIGOS01`, `AMIGOS02`... y PIN de acceso.

## Qué incluye

- **Registro público** (`/registro.html`): nombre, teléfono, cédula y zona
  (urbana → Comuna Norte/Sur/Oriental/Occidental, o rural → vereda/corregimiento).
- **Link de referido**: cada persona registrada recibe un link tipo
  `https://tu-dominio.com/r/AMIGOS05`. Si alguien se registra entrando por ese
  link, queda automáticamente "debajo" de esa persona en el árbol.
- **Panel de líder** (`/lider.html`): entra con su código + PIN, ve su propio
  equipo (todo lo que tiene por debajo, sin límite de niveles) y puede buscar
  por nombre/cédula.
- **Panel de administrador** (`/admin.html`): entra con una contraseña (la
  defines tú en `.env`), ve el árbol completo de todas las personas, y puede
  crear líderes "raíz" (los primeros, sin invitación de nadie).
- Los datos se guardan en un archivo de base de datos SQLite
  (`campana.db`), que se crea solo la primera vez que corres la app.

## Cómo correrlo en VS Code

1. Instala [Node.js](https://nodejs.org/) (versión 18 o superior) si no lo
   tienes.
2. Abre esta carpeta en VS Code.
3. Abre una terminal dentro de VS Code (`Terminal > Nueva Terminal`) y corre:
   ```
   npm install
   ```
4. Copia el archivo de configuración de ejemplo:
   ```
   cp .env.example .env
   ```
   (en Windows, si `cp` no funciona, simplemente duplica el archivo
   `.env.example` y renómbralo a `.env`)
5. Abre el archivo `.env` y cambia al menos:
   - `ADMIN_PASSWORD` por la contraseña que va a usar Vanessa (o quien
     administre).
   - `SESSION_SECRET` por cualquier texto largo y aleatorio.
6. Corre el servidor:
   ```
   npm start
   ```
7. Abre en el navegador: `http://localhost:3000`

## Primer uso

1. Entra a `http://localhost:3000/admin.html` con la contraseña que pusiste
   en `.env`.
2. Abre "Registrar un líder inicial" y crea al primer líder (por ejemplo,
   Alex). El sistema te mostrará su código (`AMIGOS01`) y su PIN — guárdalos
   y entrégaselos a esa persona.
3. Ese líder entra a `http://localhost:3000/lider.html`, se loguea con su
   código y PIN, y copia su link de invitación desde su panel.
4. Comparte ese link (por WhatsApp, por ejemplo) con la siguiente persona
   (Sandra). Cuando Sandra lo abre, el formulario de registro ya sabe que
   viene invitada por Alex.
5. Así sucesivamente: cada persona que se registra obtiene su propio
   código, PIN y link para seguir invitando gente debajo de ella.
6. El administrador siempre puede ver el árbol completo en `/admin.html`.

## Publicarlo para que otras personas lo usen desde su celular

Mientras corra solo en tu computador (`localhost`), únicamente tú puedes
usarlo. Para que los líderes lo usen desde sus propios celulares necesitas
subir esta app a un servidor. Opciones sencillas y gratuitas/económicas para
empezar:

- [Render](https://render.com) (plan gratuito para apps pequeñas)
- [Railway](https://railway.app)
- Un VPS económico (DigitalOcean, Hetzner, etc.)

En cualquiera de esas, el proceso es: subes este código (por ejemplo a un
repositorio de GitHub), conectas el repositorio al servicio, defines las
mismas variables de entorno del `.env` en el panel del servicio, y el
servicio te da una URL pública (algo como `https://tu-app.onrender.com`).

Nota sobre la base de datos: SQLite guarda todo en el archivo `campana.db`.
En Render/Railway con el plan gratuito el disco puede reiniciarse; si vas a
usar esto en producción por mucho tiempo con datos importantes, conviene un
plan con "disco persistente" o migrar a una base de datos como PostgreSQL
más adelante. Para probar y para campañas de tamaño moderado, SQLite funciona
bien.

## Seguridad — antes de usarlo en la campaña real

- Cambia `ADMIN_PASSWORD` y `SESSION_SECRET` por valores propios (no dejes
  los de ejemplo).
- Cuando lo publiques en internet, hazlo con HTTPS (Render/Railway lo dan
  automático).
- El PIN de cada persona solo se muestra una vez, al momento de registrarse
  o al ser creada por el admin — dile a cada líder que lo guarde bien, no
  queda visible después.
