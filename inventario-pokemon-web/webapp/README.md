# Inventario Pokémon TCG — Victor0629

Web personal de inventario, compras y ventas, con exportación directa a Cardmarket.

## Qué necesitas (todo gratis)

1. Una cuenta en **[supabase.com](https://supabase.com)** — la base de datos
2. Una cuenta en **[vercel.com](https://vercel.com)** — donde vive la web
3. Una cuenta en **[github.com](https://github.com)** — para subir el proyecto (Vercel se conecta desde ahí)

---

## Paso 1 — Crear la base de datos en Supabase

1. Entra en supabase.com, crea una cuenta gratis y dale a **"New project"**
2. Ponle un nombre (por ejemplo `inventario-pokemon`) y una contraseña de base de datos (guárdala, no la necesitarás para esto pero por si acaso)
3. Espera 1-2 minutos a que se cree
4. En el menú de la izquierda, entra en **SQL Editor**
5. Abre el archivo `supabase_setup_completo.sql` de esta carpeta, copia **todo** su contenido, pégalo en el editor de Supabase y dale a **Run**
6. Esto crea las tablas (`items`, `compras`, `ventas`) y mete tus 658 cartas, 9 compras y 15 ventas ya precargadas

7. Ahora ve a **Project Settings → API** (icono de engranaje, abajo a la izquierda)
8. Copia dos valores, los necesitarás en el paso 3:
   - **Project URL** (algo como `https://xxxxx.supabase.co`)
   - **anon public key** (una clave larga)

⚠️ **Aviso de seguridad honesto:** para que la app funcione sin necesidad de que te loguees cada vez, he desactivado la protección por usuario (RLS) en las tablas. Eso significa que cualquiera que consiga tu URL + clave anon podría leer o modificar tus datos. Para uso personal esto es lo normal y lo que hace todo el mundo en proyectos así, pero no publiques esas dos claves en ningún sitio público (GitHub público, redes, etc.). Si más adelante quieres añadir una contraseña de acceso, dímelo y lo montamos.

---

## Paso 2 — Subir el proyecto a GitHub

1. Entra en github.com, crea una cuenta si no tienes, y dale a **"New repository"**
2. Ponle un nombre (por ejemplo `inventario-pokemon`), déjalo en **Private** (privado, para que no lo vea nadie más)
3. Sube todos los archivos de esta carpeta (arrastra y suelta desde la web de GitHub, o usa GitHub Desktop si prefieres interfaz gráfica)

---

## Paso 3 — Desplegar en Vercel

1. Entra en vercel.com, crea una cuenta gratis **conectando tu GitHub**
2. Dale a **"Add New" → "Project"**
3. Busca el repositorio que acabas de subir y dale a **Import**
4. Antes de darle a "Deploy", despliega la sección **"Environment Variables"** y añade dos:
   - `VITE_SUPABASE_URL` → pega la Project URL del paso 1
   - `VITE_SUPABASE_ANON_KEY` → pega la anon public key del paso 1
5. Dale a **Deploy**. Espera 1-2 minutos.
6. Te da una URL tipo `inventario-pokemon.vercel.app` — esa es tu web, ya accesible desde cualquier dispositivo.

---

## Cómo lo tocas después

Cada vez que quieras un cambio (nueva función, ajuste de diseño, lo que sea), vuelves aquí a Claude, me lo pides, te doy los archivos actualizados, los subes a tu repositorio de GitHub (reemplazando los antiguos) y Vercel **se actualiza solo** en 1-2 minutos, sin que tengas que hacer nada más en Vercel.

## Desarrollo local (opcional)

Si quieres probarlo en tu ordenador antes de subirlo:

```
npm install
cp .env.example .env
```

Rellena `.env` con tus claves de Supabase, y luego:

```
npm run dev
```

### Tests

La lógica de negocio (cálculo de precios, generación de IDs, sincronización de
stock al vender/editar/borrar, exportación CSV) está separada en `src/lib.js`
y cubierta por 25 tests en `src/lib.test.mjs`. Para ejecutarlos:

```
npm test
```

No necesitan Supabase ni navegador — corren con el runner de Node directamente.

---

## Qué hace la app

- **Inventario** — busca, filtra por colección, edita cantidad/precio/coste/idioma/variante/estado
- **Movimientos** — registra compras y ventas. **Una venta puede llevar varias cartas** (carrito: buscas y añades cartas una tras otra dentro del mismo pedido; comisión y envío se meten una sola vez para todo el pedido, no por carta). Al guardar, el stock de cada carta vendida se descuenta solo
- **Trazabilidad** — abre cualquier compra y ves qué cartas de ese lote siguen en stock y cuáles se han vendido, con el beneficio real de ese lote concreto. Abre cualquier venta y ves de qué compra vino esa carta
- **Añadir** — mete cartas nuevas al inventario en segundos
- **Exportar** — genera el CSV para el importador de Cardmarket ("List bulk items"), separado por colección e idioma, troceado en bloques de 100 si hace falta. Avisa si el código de un set no tiene el nombre completo registrado
- **Resumen** — vista de negocio completo: invertido, ingresos, beneficio realizado y stock por colección

## Fiabilidad

- **Una venta = un solo número**, con las cartas que quieras dentro. Ya no se crea un ID nuevo por cada carta de un mismo pedido
- **Stock siempre sincronizado**: vender, añadir una carta más a una venta existente, editar la cantidad de una línea o borrarla (línea suelta o el pedido entero) ajusta el stock del item de origen en todos los casos
- **Sin IDs duplicados**: los identificadores (P/C/V) se calculan siempre sobre el estado más reciente en el momento de guardar, incluso si añades varias cosas seguidas muy rápido
- **Sin dobles envíos**: los botones de guardar se bloquean mientras la petición a la base de datos está en marcha
- **25 tests automatizados** sobre la lógica de negocio (ver sección Tests)
