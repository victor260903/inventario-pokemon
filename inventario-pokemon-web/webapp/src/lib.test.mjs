import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  eur, setLabel, isUnknownSet, itemValue, itemCostTotal, nextId,
  ventaCalc, computeStats, buildCardmarketCSV, chunk,
  applyStockDelta, restockOnDelete, orderCalc, rarityTone,
  pendingQty, pendingBySet, buildBackup, buildInventoryCSV, checkStock,
} from "./lib.js";

describe("eur", () => {
  const nbsp = "\u00A0"; // Intl.NumberFormat usa espacio no separable antes del €
  test("formatea euros con coma decimal española", () => {
    assert.equal(eur(4.5), `4,50${nbsp}€`);
    assert.equal(eur(0), `0,00${nbsp}€`);
  });
  test("trata null/undefined como 0", () => {
    assert.equal(eur(null), `0,00${nbsp}€`);
    assert.equal(eur(undefined), `0,00${nbsp}€`);
  });
});

describe("setLabel / isUnknownSet", () => {
  test("añade el nombre completo cuando el set es conocido", () => {
    assert.equal(setLabel("TEF"), "TEF — Temporal Forces");
    assert.equal(isUnknownSet("TEF"), false);
  });
  test("devuelve solo el código cuando el set no está en el registro", () => {
    assert.equal(setLabel("XXXX"), "XXXX");
    assert.equal(isUnknownSet("XXXX"), true);
  });
});

describe("itemValue / itemCostTotal", () => {
  test("multiplica cantidad por precio/coste", () => {
    const it = { qty: 3, price: 2.5, cost: 0.5 };
    assert.equal(itemValue(it), 7.5);
    assert.equal(itemCostTotal(it), 1.5);
  });
  test("cantidad 0 o ausente da 0", () => {
    assert.equal(itemValue({ price: 5 }), 0);
    assert.equal(itemValue({ qty: 0, price: 5 }), 0);
  });
});

describe("nextId — el punto que fallaba antes", () => {
  test("genera el siguiente ID con padding correcto", () => {
    const list = [{ id: "P000001" }, { id: "P000002" }, { id: "P000010" }];
    assert.equal(nextId(list, "P", 6), "P000011");
  });
  test("lista vacía empieza en 1", () => {
    assert.equal(nextId([], "C", 6), "C000001");
  });
  test("ignora IDs de otro prefijo", () => {
    const list = [{ id: "P000005" }, { id: "C000009" }];
    assert.equal(nextId(list, "P", 6), "P000006");
    assert.equal(nextId(list, "C", 6), "C000010");
  });
  test("dos llamadas consecutivas con la MISMA lista producen el mismo ID (por eso hay que llamarla dentro del updater funcional, no con un closure viejo)", () => {
    const list = [{ id: "P000005" }];
    const first = nextId(list, "P", 6);
    const second = nextId(list, "P", 6);
    assert.equal(first, second, "si esto fuese distinto en la app real, tendríamos IDs duplicados");
  });
  test("con la lista YA actualizada tras el primer alta, el segundo ID no choca", () => {
    const list = [{ id: "P000005" }];
    const firstId = nextId(list, "P", 6);
    const listAfterFirstInsert = [...list, { id: firstId }];
    const secondId = nextId(listAfterFirstInsert, "P", 6);
    assert.notEqual(firstId, secondId);
  });
});

describe("ventaCalc", () => {
  test("calcula bruto, neto y beneficio", () => {
    const v = { qty: 2, priceUnit: 10, commission: 1, shipping: 2, costUnit: 3 };
    const r = ventaCalc(v);
    assert.equal(r.gross, 20);
    assert.equal(r.net, 17);
    assert.equal(r.costTotal, 6);
    assert.equal(r.profit, 11);
  });
  test("beneficio negativo si se vende por debajo de coste", () => {
    const v = { qty: 1, priceUnit: 1, commission: 0, shipping: 0, costUnit: 5 };
    assert.equal(ventaCalc(v).profit, -4);
  });
});

describe("computeStats", () => {
  test("solo cuenta cartas con estado En stock y cantidad > 0", () => {
    const items = [
      { qty: 2, price: 1, cost: 0.5, status: "En stock" },
      { qty: 5, price: 2, cost: 1, status: "Vendida" },   // no cuenta
      { qty: 0, price: 3, cost: 1, status: "En stock" },  // no cuenta, qty 0
      { qty: 1, price: 4, cost: 2 },                       // sin status = En stock
    ];
    const s = computeStats(items);
    assert.equal(s.cards, 3);
    assert.equal(s.valueStock, 6);
    assert.equal(s.costStock, 3);
    assert.equal(s.profit, 3);
    assert.equal(s.refs, 2);
  });
});

describe("buildCardmarketCSV", () => {
  test("genera cabecera y filas en el formato esperado", () => {
    const rows = [{ name: "Pikachu", set: "TEF", num: 51, lang: "ES", cond: "NM", qty: 2, price: 0.05 }];
    const csv = buildCardmarketCSV(rows);
    const lines = csv.split("\n");
    assert.equal(lines[0], "Product,Expansion,Number,Language,Condition,Amount,Price,Comment");
    assert.equal(lines[1], "Pikachu,Temporal Forces,51,ES,NM,2,0.05,");
  });
  test("entrecomilla nombres que llevan coma", () => {
    const rows = [{ name: "Hero's Cape, Special", set: "XXXX", num: 1, lang: "ES", cond: "NM", qty: 1, price: 1 }];
    const csv = buildCardmarketCSV(rows);
    assert.match(csv, /"Hero's Cape, Special"/);
  });
  test("si el set no tiene nombre conocido, usa el código tal cual", () => {
    const rows = [{ name: "Carta rara", set: "ZZZ", num: 9, lang: "EN", cond: "NM", qty: 1, price: 1 }];
    const csv = buildCardmarketCSV(rows);
    assert.match(csv, /Carta rara,ZZZ,9/);
  });
});

describe("chunk — límite de 100 filas de Cardmarket", () => {
  test("divide en bloques del tamaño pedido", () => {
    const list = Array.from({ length: 250 }, (_, i) => i);
    const chunks = chunk(list, 100);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, 100);
    assert.equal(chunks[1].length, 100);
    assert.equal(chunks[2].length, 50);
  });
  test("lista más pequeña que el tamaño da un único bloque", () => {
    assert.equal(chunk([1, 2, 3], 100).length, 1);
  });
});

describe("applyStockDelta — vender resta stock", () => {
  test("vender más unidades resta del stock disponible", () => {
    const item = { qty: 10, status: "En stock" };
    const r = applyStockDelta(item, 0, 3); // nueva venta de 3 uds
    assert.equal(r.qty, 7);
    assert.equal(r.status, "En stock");
  });
  test("vender todo el stock marca el item como Vendida", () => {
    const item = { qty: 3, status: "En stock" };
    const r = applyStockDelta(item, 0, 3);
    assert.equal(r.qty, 0);
    assert.equal(r.status, "Vendida");
  });
  test("editar una venta para vender MENOS unidades devuelve stock", () => {
    const item = { qty: 0, status: "Vendida" };
    // antes se vendieron 3 uds de este item (qty ya está a 0 y Vendida);
    // el usuario corrige la venta a solo 1 unidad
    const r = applyStockDelta(item, 3, 1);
    assert.equal(r.qty, 2);
    assert.equal(r.status, "En stock", "si vuelve a haber stock, ya no debería seguir marcada Vendida");
  });
  test("nunca baja de 0 aunque los números no cuadren", () => {
    const item = { qty: 1, status: "En stock" };
    const r = applyStockDelta(item, 0, 99);
    assert.equal(r.qty, 0);
  });
});

describe("restockOnDelete — borrar una venta devuelve el stock", () => {
  test("devuelve la cantidad vendida al stock", () => {
    const item = { qty: 0, status: "Vendida" };
    const r = restockOnDelete(item, 5);
    assert.equal(r.qty, 5);
    assert.equal(r.status, "En stock");
  });
  test("si el item ya tenía stock, simplemente suma", () => {
    const item = { qty: 2, status: "En stock" };
    const r = restockOnDelete(item, 3);
    assert.equal(r.qty, 5);
    assert.equal(r.status, "En stock");
  });
});

describe("rarityTone — color de acento por variante", () => {
  test("las variantes premium van a dorado", () => {
    assert.equal(rarityTone("EX"), "gold");
    assert.equal(rarityTone("Illustration Rare"), "gold");
    assert.equal(rarityTone("Hyper Rare"), "gold");
  });
  test("holo y reverse van a agua", () => {
    assert.equal(rarityTone("Holo"), "water");
    assert.equal(rarityTone("Holo/reverse"), "water");
  });
  test("promos y bolas especiales van a fuego", () => {
    assert.equal(rarityTone("Promo"), "fire");
    assert.equal(rarityTone("Master Ball"), "fire");
  });
  test("normal (y cualquier cosa no reconocida) va a hoja por defecto", () => {
    assert.equal(rarityTone("Normal"), "leaf");
    assert.equal(rarityTone("Algo raro sin catalogar"), "leaf");
  });
});

describe("orderCalc — una venta con varias cartas dentro", () => {
  test("suma bruto y coste de todas las cartas del pedido", () => {
    const order = { commission: 1, shipping: 2 };
    const items = [
      { qty: 1, priceUnit: 10, costUnit: 2 },
      { qty: 2, priceUnit: 5, costUnit: 1 },
    ];
    const r = orderCalc(order, items);
    assert.equal(r.gross, 20);       // 1*10 + 2*5
    assert.equal(r.costTotal, 4);    // 1*2 + 2*1
    assert.equal(r.net, 17);         // 20 - 1 - 2
    assert.equal(r.profit, 13);      // 17 - 4
    assert.equal(r.itemCount, 2);
    assert.equal(r.cardCount, 3);    // 1 + 2 unidades
  });
  test("la comisión y el envío se cobran una sola vez, no por carta", () => {
    const order = { commission: 3, shipping: 1 };
    const items = [{ qty: 5, priceUnit: 1, costUnit: 0.2 }];
    const r = orderCalc(order, items);
    assert.equal(r.gross, 5);
    assert.equal(r.net, 1); // 5 - 3 - 1, no 5 - (3+1)*5
  });
  test("pedido sin cartas da todo a 0 sin explotar", () => {
    const r = orderCalc({ commission: 0, shipping: 0 }, []);
    assert.equal(r.gross, 0);
    assert.equal(r.profit, 0);
    assert.equal(r.itemCount, 0);
  });
});

describe("listedQty — unidades ya subidas a Cardmarket", () => {
  test("vender una unidad baja también el contador de subidas", () => {
    const item = { qty: 2, status: "En stock", listedQty: 2 };
    const r = applyStockDelta(item, 0, 1);
    assert.equal(r.qty, 1);
    assert.equal(r.listedQty, 1, "la vendida ya no está en Cardmarket");
  });
  test("vender una carta que no estaba subida no toca el contador", () => {
    const item = { qty: 3, status: "En stock", listedQty: 0 };
    const r = applyStockDelta(item, 0, 1);
    assert.equal(r.listedQty, 0);
  });
  test("vender de una parcialmente subida no baja de 0", () => {
    const item = { qty: 3, status: "En stock", listedQty: 1 };
    const r = applyStockDelta(item, 0, 3);
    assert.equal(r.qty, 0);
    assert.equal(r.listedQty, 0);
  });
  test("el contador nunca supera el stock restante", () => {
    const item = { qty: 5, status: "En stock", listedQty: 5 };
    const r = applyStockDelta(item, 0, 4);
    assert.equal(r.qty, 1);
    assert.equal(r.listedQty, 1);
  });
  test("corregir una venta a la baja no re-sube unidades a Cardmarket", () => {
    const item = { qty: 0, status: "Vendida", listedQty: 0 };
    const r = applyStockDelta(item, 3, 1); // devuelve 2 al stock
    assert.equal(r.qty, 2);
    assert.equal(r.listedQty, 0, "las que vuelven quedan pendientes de subir");
  });
  test("borrar una venta devuelve stock como pendiente de subir", () => {
    const item = { qty: 1, status: "En stock", listedQty: 1 };
    const r = restockOnDelete(item, 2);
    assert.equal(r.qty, 3);
    assert.equal(r.listedQty, 1, "solo sigue subida la que ya lo estaba");
  });
});

describe("pendingQty / pendingBySet — qué falta por subir", () => {
  test("stock menos subidas", () => {
    assert.equal(pendingQty({ qty: 3, listedQty: 1 }), 2);
    assert.equal(pendingQty({ qty: 2, listedQty: 2 }), 0);
    assert.equal(pendingQty({ qty: 1 }), 1, "sin contador, todo pendiente");
  });
  test("nunca negativo aunque los datos estén descuadrados", () => {
    assert.equal(pendingQty({ qty: 1, listedQty: 5 }), 0);
  });
  test("agrupa por set y ordena de más a menos", () => {
    const items = [
      { set: "TEF", qty: 2, listedQty: 0, status: "En stock" },
      { set: "TEF", qty: 1, listedQty: 1, status: "En stock" },
      { set: "SFA", qty: 5, listedQty: 0, status: "En stock" },
      { set: "MEW", qty: 3, listedQty: 0, status: "Vendida" },
    ];
    const r = pendingBySet(items);
    assert.equal(r.length, 2, "las vendidas no cuentan");
    assert.equal(r[0][0], "SFA");
    assert.equal(r[0][1].qty, 5);
    assert.equal(r[1][1].qty, 2);
  });
});

describe("checkStock — aviso de vender más de lo que hay", () => {
  test("no avisa si hay stock de sobra", () => {
    assert.equal(checkStock({ qty: 5, name: "Pikachu" }, 2), null);
  });
  test("no avisa al vender justo lo que queda", () => {
    assert.equal(checkStock({ qty: 2, name: "Pikachu" }, 2), null);
  });
  test("avisa al pedir más de lo disponible", () => {
    const r = checkStock({ qty: 1, name: "Pikachu" }, 3);
    assert.equal(r.available, 1);
    assert.equal(r.wanted, 3);
  });
  test("cuenta lo que ya va en el carrito de la misma carta", () => {
    const r = checkStock({ qty: 3, name: "Pikachu" }, 2, 2);
    assert.equal(r.available, 1, "ya había 2 en el carrito");
  });
});

describe("copias de seguridad", () => {
  const datos = {
    items: [{ id: "P000001", set: "TEF", num: 13, name: "Sinistcha", lang: "ES", variant: "Normal", cond: "NM", qty: 2, listedQty: 1, cost: 0.5, price: 1.5, status: "En stock" }],
    compras: [{ id: "C000001", totalCost: 10 }],
    ventas: [{ id: "V000001" }],
    ventaItems: [{ id: "VI000001" }],
  };
  test("el JSON se puede volver a leer entero", () => {
    const parsed = JSON.parse(buildBackup(datos));
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.totales.cartas, 2);
    assert.equal(parsed.items[0].name, "Sinistcha");
  });
  test("el CSV lleva cabecera y una fila por carta", () => {
    const csv = buildInventoryCSV(datos.items);
    const filas = csv.split("\n");
    assert.equal(filas.length, 2);
    assert.ok(filas[0].startsWith("ID,Set,Numero"));
    assert.ok(filas[1].includes("Sinistcha"));
  });
  test("el CSV entrecomilla nombres con coma", () => {
    const csv = buildInventoryCSV([{ ...datos.items[0], name: "Mr. Mime, EX" }]);
    assert.ok(csv.includes('"Mr. Mime, EX"'));
  });
});
