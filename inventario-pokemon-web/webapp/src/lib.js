// Funciones puras de negocio, separadas de React para poder testearlas
// directamente con Node (src/lib.test.mjs) sin necesitar navegador ni Supabase.

export const SET_NAMES = {
  BS: "Base Set", JU: "Jungle", FO: "Fossil", TR: "Team Rocket", NDE: "Neo Destiny",
  NDI: "Neo Discovery", AR: "Platinum Arceus", EVO: "Evolutions", PAR: "Paradox Rift",
  SV: "Supreme Victors", SWSH: "SWSH Promos", LOR: "Lost Origin", GRI: "Guardians Rising",
  BST: "Battle Styles", HIF: "Hidden Fates", VIV: "Vivid Voltage", PRE: "Prismatic Evolutions",
  CSV7C: "Chino (pendiente)", CBB1c: "Chino (pendiente)", CBB4C: "Chino (pendiente)",
  PFL: "Phantasmal Flames", TEF: "Temporal Forces", MEW: "Pokémon Card 151",
  SCR: "Stellar Crown", TEU: "Team Up", OBF: "Obsidian Flames", POR: "Perfect Order",
  CRI: "Chaos Rising",
};

export const LANGS = ["ES", "EN", "JP", "KR", "CHS", "CHT", "IT", "FR", "DE", "PT"];
export const VARIANTS = ["Normal", "Reverse", "Holo", "Holo/reverse", "EX", "ACE SPEC", "Illustration Rare", "Ultra Rare", "Special Illustration Rare", "Hyper Rare", "Master Ball", "Poke Ball", "Promo"];
export const CONDITIONS = ["NM", "EX", "GD", "LP", "PL", "PO"];
export const STATUSES = ["En stock", "Reservada", "Vendida", "Perdida"];
export const PLATFORMS = ["Cardmarket", "Vinted", "Wallapop", "Mano a mano", "Otra"];

export function eur(n) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
}

export function setLabel(code) {
  return SET_NAMES[code] ? `${code} — ${SET_NAMES[code]}` : code;
}

/** true si el código de set no tiene nombre conocido (aviso para exportación) */
export function isUnknownSet(code) {
  return !SET_NAMES[code];
}

export function itemValue(it) {
  return (it.qty || 0) * (it.price || 0);
}
export function itemCostTotal(it) {
  return (it.qty || 0) * (it.cost || 0);
}

/**
 * Siguiente ID libre para una lista, basado en el sufijo numérico más alto.
 * Determinista y sin colisiones si siempre se llama con la lista más reciente
 * (por eso en la app se invoca dentro del updater funcional de setState,
 * nunca desde un valor de estado capturado por closure).
 */
export function nextId(list, prefix, width) {
  let max = 0;
  for (const x of list) {
    if (typeof x.id === "string" && x.id.startsWith(prefix)) {
      const n = parseInt(x.id.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return prefix + String(max + 1).padStart(width, "0");
}

export function ventaCalc(v) {
  const gross = (v.qty || 0) * (v.priceUnit || 0);
  const net = gross - (v.commission || 0) - (v.shipping || 0);
  const costTotal = (v.qty || 0) * (v.costUnit || 0);
  return { ...v, gross, net, costTotal, profit: net - costTotal };
}

export function computeStats(items) {
  let cards = 0, valueStock = 0, costStock = 0, refs = 0, pending = 0, pendingRefs = 0;
  for (const it of items) {
    if ((it.status || "En stock") === "En stock" && it.qty > 0) {
      cards += it.qty;
      valueStock += itemValue(it);
      costStock += itemCostTotal(it);
      refs += 1;
      const p = pendingQty(it);
      if (p > 0) { pending += p; pendingRefs += 1; }
    }
  }
  return { cards, valueStock, costStock, profit: valueStock - costStock, refs, pending, pendingRefs };
}

/** Unidades en stock que todavía NO están subidas a Cardmarket */
export function pendingQty(it) {
  return Math.max(0, (it.qty || 0) - (it.listedQty || 0));
}

/** Pendientes de subir agrupados por colección, de más a menos */
export function pendingBySet(items) {
  const map = {};
  for (const it of items) {
    if ((it.status || "En stock") !== "En stock") continue;
    const p = pendingQty(it);
    if (p <= 0) continue;
    if (!map[it.set]) map[it.set] = { qty: 0, refs: 0 };
    map[it.set].qty += p;
    map[it.set].refs += 1;
  }
  return Object.entries(map).sort((a, b) => b[1].qty - a[1].qty);
}

/**
 * Copia de seguridad completa del negocio en JSON. Incluye todo lo necesario
 * para reconstruir la base de datos si Supabase falla o se borra algo.
 */
export function buildBackup({ items, compras, ventas, ventaItems }) {
  return JSON.stringify({
    formato: "inventario-pokemon-backup",
    version: 1,
    fecha: new Date().toISOString(),
    totales: {
      referencias: items.length,
      cartas: items.reduce((a, it) => a + (it.qty || 0), 0),
      compras: compras.length,
      ventas: ventas.length,
    },
    items, compras, ventas, ventaItems,
  }, null, 2);
}

/** Inventario completo en CSV, legible en cualquier hoja de cálculo */
export function buildInventoryCSV(items) {
  const header = "ID,Set,Numero,Nombre,Idioma,Variante,Condicion,Cantidad,SubidasCM,Pendientes,CosteUd,PrecioUd,ValorStock,CosteStock,Compra,Ubicacion,Plataforma,Estado";
  const lines = items.map((it) => [
    it.id, it.set, it.num, csvEscape(it.name), it.lang, it.variant, it.cond,
    it.qty || 0, it.listedQty || 0, pendingQty(it),
    (it.cost || 0).toFixed(2), (it.price || 0).toFixed(2),
    itemValue(it).toFixed(2), itemCostTotal(it).toFixed(2),
    it.purchase || "", csvEscape(it.loc || ""), it.platform || "", it.status || "En stock",
  ].join(","));
  return [header, ...lines].join("\n");
}

/**
 * Comprueba si una línea de venta pide más unidades de las que hay en stock.
 * Devuelve null si todo correcto, o un aviso con los números.
 */
export function checkStock(item, qtyWanted, qtyAlreadyInCart = 0) {
  const available = (item.qty || 0) - qtyAlreadyInCart;
  if (qtyWanted <= available) return null;
  return { available: Math.max(0, available), wanted: qtyWanted, name: item.name };
}

function csvEscape(name) {
  const clean = (name || "").replace(/"/g, '""');
  return clean.includes(",") ? `"${clean}"` : clean;
}

export function buildCardmarketCSV(rows) {
  const header = "Product,Expansion,Number,Language,Condition,Amount,Price,Comment";
  const lines = rows.map((it) => {
    const expansion = (setLabel(it.set).split(" — ")[1]) || it.set;
    return [csvEscape(it.name), expansion, it.num, it.lang, it.cond, it.qty, (it.price || 0).toFixed(2), ""].join(",");
  });
  return [header, ...lines].join("\n");
}

/** Divide una lista en bloques de máximo `size` (límite de Cardmarket = 100) */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Calcula cómo debe quedar el stock de un item tras cambiar la cantidad
 * vendida de qtyBefore -> qtyAfter. Positivo = se vende más, resta stock.
 */
export function applyStockDelta(item, qtyBefore, qtyAfter) {
  const delta = qtyAfter - qtyBefore; // +2 = 2 unidades más vendidas ahora
  const newQty = Math.max(0, (item.qty || 0) - delta);
  let status = item.status;
  if (newQty === 0) status = "Vendida";
  else if (item.status === "Vendida" && newQty > 0) status = "En stock";
  // La unidad vendida en Cardmarket también desaparece de aquel listado,
  // así que el contador de "ya subidas" baja con ella. Nunca por encima
  // del stock real ni por debajo de 0.
  const listedQty = Math.max(0, Math.min((item.listedQty || 0) - Math.max(0, delta), newQty));
  return { qty: newQty, status, listedQty };
}

/** Al borrar una venta, la cantidad vendida vuelve al stock del item origen */
export function restockOnDelete(item, ventaQty) {
  const newQty = (item.qty || 0) + (ventaQty || 0);
  const status = item.status === "Vendida" && newQty > 0 ? "En stock" : item.status;
  // Las unidades que vuelven al stock NO se dan por subidas a Cardmarket:
  // se quedan como pendientes para que salgan en el próximo CSV.
  const listedQty = Math.max(0, Math.min(item.listedQty || 0, newQty));
  return { qty: newQty, status, listedQty };
}

/** Color de acento por variante, para la barra/insignia de la carta. */
export function rarityTone(variant) {
  const gold = ["EX", "Illustration Rare", "Ultra Rare", "Special Illustration Rare", "Hyper Rare", "ACE SPEC"];
  const water = ["Reverse", "Holo", "Holo/reverse"];
  const fire = ["Master Ball", "Poke Ball", "Promo"];
  if (gold.includes(variant)) return "gold";
  if (water.includes(variant)) return "water";
  if (fire.includes(variant)) return "fire";
  return "leaf";
}

/**
 * Un pedido de venta puede llevar varias cartas (items). La comisión y el
 * envío se cobran una vez por pedido, no por carta.
 * order: { commission, shipping }
 * items: [{ qty, priceUnit, costUnit }, ...]
 */
export function orderCalc(order, items) {
  const gross = items.reduce((a, it) => a + (it.qty || 0) * (it.priceUnit || 0), 0);
  const costTotal = items.reduce((a, it) => a + (it.qty || 0) * (it.costUnit || 0), 0);
  const net = gross - (order.commission || 0) - (order.shipping || 0);
  const profit = net - costTotal;
  return { gross, costTotal, net, profit, itemCount: items.length, cardCount: items.reduce((a, it) => a + (it.qty || 0), 0) };
}
