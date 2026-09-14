import { useState, useEffect, useMemo, useCallback, useId, isValidElement, cloneElement } from "react";
import { supabase } from "./supabaseClient";
import {
  Search, Plus, Download, LayoutGrid, X, ChevronDown, Check, TrendingUp,
  Package, AlertCircle, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight,
  Link2, ExternalLink, RefreshCw, DatabaseZap,
} from "lucide-react";
import {
  SET_NAMES, LANGS, VARIANTS, CONDITIONS, STATUSES, PLATFORMS,
  eur, setLabel, isUnknownSet, itemValue, itemCostTotal, nextId,
  computeStats, buildCardmarketCSV, chunk,
  applyStockDelta, restockOnDelete, orderCalc, rarityTone,
  pendingQty, pendingBySet, buildBackup, buildInventoryCSV, checkStock,
} from "./lib";

/* ---------- mapeo DB (snake_case) <-> app (camelCase) ---------- */
const rowToItem = (r) => ({
  id: r.id, set: r.set_code, num: r.num, name: r.name, lang: r.lang, variant: r.variant,
  cond: r.cond, qty: r.qty, cost: Number(r.cost) || 0, price: Number(r.price) || 0,
  purchase: r.purchase_id, loc: r.loc, platform: r.platform, status: r.status,
  listedQty: Number(r.listed_qty) || 0,
});
const itemToRow = (it) => ({
  id: it.id, set_code: it.set, num: it.num, name: it.name, lang: it.lang, variant: it.variant,
  cond: it.cond, qty: it.qty, cost: it.cost, price: it.price, purchase_id: it.purchase || null,
  loc: it.loc || null, platform: it.platform || null, status: it.status,
  listed_qty: Number(it.listedQty) || 0,
});
const rowToCompra = (r) => ({
  id: r.id, date: r.date, seller: r.seller, desc: r.description,
  cardCount: r.card_count, totalCost: Number(r.total_cost) || 0, notes: r.notes,
});
const compraToRow = (c) => ({
  id: c.id, date: c.date || null, seller: c.seller, description: c.desc,
  card_count: c.cardCount, total_cost: c.totalCost, notes: c.notes || null,
});
const rowToVentaOrder = (r) => ({
  id: r.id, date: r.date, platform: r.platform, buyer: r.buyer,
  commission: Number(r.commission) || 0, shipping: Number(r.shipping) || 0, notes: r.notes,
});
const ventaOrderToRow = (v) => ({
  id: v.id, date: v.date || null, platform: v.platform || null, buyer: v.buyer || null,
  commission: v.commission, shipping: v.shipping, notes: v.notes || null,
});
const rowToVentaItem = (r) => ({
  id: r.id, ventaId: r.venta_id, itemId: r.item_id, itemLabel: r.item_label, purchaseId: r.purchase_id,
  qty: r.qty, priceUnit: Number(r.price_unit) || 0, costUnit: Number(r.cost_unit) || 0,
});
const ventaItemToRow = (v) => ({
  id: v.id, venta_id: v.ventaId, item_id: v.itemId || null, item_label: v.itemLabel,
  purchase_id: v.purchaseId || null, qty: v.qty, price_unit: v.priceUnit, cost_unit: v.costUnit,
});

export default function App() {
  const [items, setItems] = useState(null);
  const [compras, setCompras] = useState(null);
  const [ventas, setVentas] = useState(null);
  const [ventaItems, setVentaItems] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState("inventario");
  const [query, setQuery] = useState("");
  const [setFilter, setSetFilter] = useState("");
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [i, c, v, vi] = await Promise.all([
        supabase.from("items").select("*").order("id"),
        supabase.from("compras").select("*").order("id"),
        supabase.from("ventas").select("*").order("id"),
        supabase.from("venta_items").select("*").order("id"),
      ]);
      if (i.error) throw i.error;
      if (c.error) throw c.error;
      if (v.error) throw v.error;
      if (vi.error) throw vi.error;
      setItems(i.data.map(rowToItem));
      setCompras(c.data.map(rowToCompra));
      setVentas(v.data.map(rowToVentaOrder));
      setVentaItems(vi.data.map(rowToVentaItem));
    } catch (e) {
      setLoadError(e.message || String(e));
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  async function updateItem(id, patch) {
    const merged = { ...(items.find((x) => x.id === id) || {}), ...patch, id };
    // Nunca más unidades "subidas a Cardmarket" que stock real
    const full = { ...merged, listedQty: Math.max(0, Math.min(merged.listedQty || 0, merged.qty || 0)) };
    patch = { ...patch, listedQty: full.listedQty };
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    const { error } = await supabase.from("items").update(itemToRow(full)).eq("id", id);
    if (error) showToast("Error al guardar: " + error.message);
  }

  async function addItem(newItemPartial) {
    let record;
    setItems((prev) => {
      const id = nextId(prev, "P", 6);
      record = { id, ...newItemPartial };
      return [record, ...prev];
    });
    const { error } = await supabase.from("items").insert(itemToRow(record));
    if (error) showToast("Error al guardar: " + error.message);
    else showToast("Carta añadida");
  }

  async function deleteItem(id) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setEditing(null);
    const { error } = await supabase.from("items").delete().eq("id", id);
    if (error) showToast("Error al eliminar: " + error.message);
    else showToast("Eliminada");
  }

  async function markListed(ids) {
    if (!ids || ids.length === 0) return;
    // Cada carta pasa a tener TODAS sus unidades marcadas como subidas
    const targets = items.filter((it) => ids.includes(it.id));
    setItems((prev) => prev.map((it) => (ids.includes(it.id) ? { ...it, listedQty: it.qty || 0 } : it)));
    const results = await Promise.all(
      targets.map((it) => supabase.from("items").update({ listed_qty: it.qty || 0 }).eq("id", it.id))
    );
    const failed = results.find((r) => r.error);
    if (failed) showToast("Error: " + failed.error.message);
    else showToast(`${ids.length} marcadas como subidas`);
  }

  async function addCompra(c) {
    let record;
    setCompras((prev) => {
      const id = nextId(prev, "C", 6);
      record = { id, ...c };
      return [record, ...prev];
    });
    const { error } = await supabase.from("compras").insert(compraToRow(record));
    if (error) showToast("Error: " + error.message);
    else showToast("Compra registrada");
  }
  async function updateCompra(id, patch) {
    setCompras((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const full = { ...(compras.find((c) => c.id === id) || {}), ...patch, id };
    const { error } = await supabase.from("compras").update(compraToRow(full)).eq("id", id);
    if (error) showToast("Error: " + error.message);
  }
  async function deleteCompra(id) {
    setCompras((prev) => prev.filter((c) => c.id !== id));
    // La base de datos desvincula sola (ON DELETE SET NULL), pero el estado
    // local hay que limpiarlo a mano para que no queden referencias colgando.
    setItems((prev) => prev.map((it) => (it.purchase === id ? { ...it, purchase: null } : it)));
    const { error } = await supabase.from("compras").delete().eq("id", id);
    if (error) showToast("Error: " + error.message);
    else showToast("Compra eliminada");
  }

  // Crea un pedido de venta con una o varias cartas dentro (carrito).
  // cartLines: [{ itemId, itemLabel, purchaseId, qty, priceUnit, costUnit }, ...]
  async function addVentaOrder(header, cartLines) {
    if (!cartLines || cartLines.length === 0) return;
    const orderId = nextId(ventas, "V", 6);
    const order = { id: orderId, ...header };
    const newLines = [];
    setVentaItems((prev) => {
      let n = prev.length;
      const created = cartLines.map((line) => {
        n += 1;
        return { id: "VI" + String(n).padStart(6, "0"), ventaId: orderId, ...line };
      });
      newLines.push(...created);
      return [...created, ...prev];
    });
    setVentas((prev) => [order, ...prev]);

    const { error: e1 } = await supabase.from("ventas").insert(ventaOrderToRow(order));
    if (e1) { showToast("Error: " + e1.message); return; }
    const { error: e2 } = await supabase.from("venta_items").insert(newLines.map(ventaItemToRow));
    if (e2) { showToast("Error: " + e2.message); return; }

    // descuenta stock de cada carta vendida
    for (const line of newLines) {
      if (!line.itemId) continue;
      const srcItem = items.find((it) => it.id === line.itemId);
      if (!srcItem) continue;
      const stockPatch = applyStockDelta(srcItem, 0, line.qty);
      setItems((prev) => prev.map((it) => (it.id === line.itemId ? { ...it, ...stockPatch } : it)));
      await supabase.from("items").update(itemToRow({ ...srcItem, ...stockPatch })).eq("id", line.itemId);
    }
    showToast(`Venta registrada (${newLines.length} ${newLines.length === 1 ? "carta" : "cartas"})`);
  }

  async function updateVentaHeader(id, patch) {
    setVentas((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    const full = { ...(ventas.find((v) => v.id === id) || {}), ...patch, id };
    const { error } = await supabase.from("ventas").update(ventaOrderToRow(full)).eq("id", id);
    if (error) showToast("Error: " + error.message);
  }

  // Añade una carta más a un pedido de venta ya existente.
  async function addLineToOrder(ventaId, line) {
    const newId = "VI" + String(ventaItems.length + 1).padStart(6, "0");
    const record = { id: newId, ventaId, ...line };
    setVentaItems((prev) => [record, ...prev]);
    const { error } = await supabase.from("venta_items").insert(ventaItemToRow(record));
    if (error) { showToast("Error: " + error.message); return; }
    if (line.itemId) {
      const srcItem = items.find((it) => it.id === line.itemId);
      if (srcItem) {
        const stockPatch = applyStockDelta(srcItem, 0, line.qty);
        setItems((prev) => prev.map((it) => (it.id === line.itemId ? { ...it, ...stockPatch } : it)));
        await supabase.from("items").update(itemToRow({ ...srcItem, ...stockPatch })).eq("id", line.itemId);
      }
    }
    showToast("Carta añadida a la venta");
  }

  // Cambia la cantidad/precio de una línea ya guardada, reajustando stock.
  async function updateVentaLine(lineId, patch) {
    const oldLine = ventaItems.find((l) => l.id === lineId);
    setVentaItems((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));
    const full = { ...(oldLine || {}), ...patch, id: lineId };
    const { error } = await supabase.from("venta_items").update(ventaItemToRow(full)).eq("id", lineId);
    if (error) { showToast("Error: " + error.message); return; }
    if (oldLine && oldLine.itemId && typeof patch.qty === "number" && patch.qty !== oldLine.qty) {
      const srcItem = items.find((it) => it.id === oldLine.itemId);
      if (srcItem) {
        const stockPatch = applyStockDelta(srcItem, oldLine.qty, patch.qty);
        setItems((prev) => prev.map((it) => (it.id === oldLine.itemId ? { ...it, ...stockPatch } : it)));
        await supabase.from("items").update(itemToRow({ ...srcItem, ...stockPatch })).eq("id", oldLine.itemId);
      }
    }
  }

  // Quita una carta de un pedido (la venta en sí puede seguir con otras líneas).
  async function deleteVentaLine(lineId) {
    const oldLine = ventaItems.find((l) => l.id === lineId);
    setVentaItems((prev) => prev.filter((l) => l.id !== lineId));
    const { error } = await supabase.from("venta_items").delete().eq("id", lineId);
    if (error) { showToast("Error: " + error.message); return; }
    if (oldLine && oldLine.itemId) {
      const srcItem = items.find((it) => it.id === oldLine.itemId);
      if (srcItem) {
        const stockPatch = restockOnDelete(srcItem, oldLine.qty);
        setItems((prev) => prev.map((it) => (it.id === oldLine.itemId ? { ...it, ...stockPatch } : it)));
        await supabase.from("items").update(itemToRow({ ...srcItem, ...stockPatch })).eq("id", oldLine.itemId);
      }
    }
  }

  // Borra el pedido entero: todas sus líneas devuelven stock, y desaparece.
  async function deleteVentaOrder(id) {
    const lines = ventaItems.filter((l) => l.ventaId === id);
    for (const line of lines) {
      if (!line.itemId) continue;
      const srcItem = items.find((it) => it.id === line.itemId);
      if (srcItem) {
        const stockPatch = restockOnDelete(srcItem, line.qty);
        setItems((prev) => prev.map((it) => (it.id === line.itemId ? { ...it, ...stockPatch } : it)));
        await supabase.from("items").update(itemToRow({ ...srcItem, ...stockPatch })).eq("id", line.itemId);
      }
    }
    setVentaItems((prev) => prev.filter((l) => l.ventaId !== id));
    setVentas((prev) => prev.filter((v) => v.id !== id));
    const { error } = await supabase.from("ventas").delete().eq("id", id); // cascada borra las líneas en la BD
    if (error) showToast("Error: " + error.message);
    else showToast("Venta eliminada");
  }

  const sets = useMemo(() => {
    if (!items) return [];
    return [...new Set(items.map((i) => i.set))].filter(Boolean).sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items
      .filter((it) => {
        if (setFilter && it.set !== setFilter) return false;
        if (!q) return true;
        return (
          (it.name || "").toLowerCase().includes(q) ||
          (it.set || "").toLowerCase().includes(q) ||
          String(it.num || "").includes(q) ||
          (it.id || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.qty > 0) - (a.qty > 0) || a.set.localeCompare(b.set) || a.num - b.num);
  }, [items, query, setFilter]);

  const stats = useMemo(() => {
    if (!items) return null;
    return { ...computeStats(items), sets: sets.length };
  }, [items, sets]);

  if (loadError) {
    return (
      <div style={styles.loadingWrap}>
        <Style />
        <AlertCircle size={26} color="var(--neg)" />
        <p style={{ color: "var(--text)", fontFamily: "var(--sans)", fontSize: 14, marginTop: 12, textAlign: "center", maxWidth: 320, lineHeight: 1.5 }}>
          No se pudo conectar con la base de datos.<br />
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{loadError}</span>
        </p>
        <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 10, textAlign: "center", maxWidth: 320 }}>
          Comprueba que VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY están bien puestas, y que ejecutaste el script SQL en Supabase.
        </p>
        <button onClick={loadAll} style={{ ...styles.primaryBtn, width: "auto", marginTop: 18, padding: "10px 20px" }}>
          <RefreshCw size={15} /> Reintentar
        </button>
      </div>
    );
  }

  if (items === null || compras === null || ventas === null || ventaItems === null) {
    return (
      <div style={styles.loadingWrap}>
        <Style />
        <div style={styles.loadingSpinner} />
        <p style={{ color: "var(--muted)", fontFamily: "var(--sans)", fontSize: 14, marginTop: 12 }}>Cargando inventario…</p>
      </div>
    );
  }

  if (items.length === 0 && compras.length === 0 && ventas.length === 0) {
    return (
      <div style={styles.loadingWrap}>
        <Style />
        <DatabaseZap size={26} color="var(--accent)" />
        <p style={{ color: "var(--text)", fontFamily: "var(--sans)", fontSize: 15, fontWeight: 600, marginTop: 14, textAlign: "center" }}>
          Conectado, pero la base de datos está vacía
        </p>
        <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 8, textAlign: "center", maxWidth: 320, lineHeight: 1.5 }}>
          Ve a Supabase → SQL Editor, pega el contenido de <code>supabase_setup_completo.sql</code> y dale a Run.
          Eso crea las tablas y mete tus cartas, compras y ventas. Luego recarga esta página.
        </p>
        <button onClick={loadAll} style={{ ...styles.primaryBtn, width: "auto", marginTop: 18, padding: "10px 20px" }}>
          <RefreshCw size={15} /> Recargar
        </button>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <Style />
      <Header stats={stats} />

      {tab === "inventario" && (
        <InventoryTab
          items={filtered} allCount={items.length} query={query} setQuery={setQuery}
          sets={sets} setFilter={setFilter} setSetFilter={setSetFilter} onEdit={setEditing}
        />
      )}
      {tab === "anadir" && <AddTab onAdd={addItem} sets={sets} compras={compras} />}
      {tab === "movimientos" && (
        <MovimientosTab
          items={items} compras={compras} ventas={ventas} ventaItems={ventaItems}
          onAddCompra={addCompra} onUpdateCompra={updateCompra} onDeleteCompra={deleteCompra}
          onAddVentaOrder={addVentaOrder} onUpdateVentaHeader={updateVentaHeader}
          onAddLineToOrder={addLineToOrder} onUpdateVentaLine={updateVentaLine}
          onDeleteVentaLine={deleteVentaLine} onDeleteVentaOrder={deleteVentaOrder}
        />
      )}
      {tab === "exportar" && <ExportTab items={items} sets={sets} onMarkListed={markListed} />}
      {tab === "resumen" && <SummaryTab items={items} sets={sets} compras={compras} ventas={ventas} ventaItems={ventaItems} />}

      <BottomNav tab={tab} setTab={setTab} />

      {editing && (
        <EditSheet
          item={editing} compras={compras}
          onClose={() => setEditing(null)}
          onSave={(patch) => { updateItem(editing.id, patch); setEditing(null); showToast("Guardado"); }}
          onDelete={() => deleteItem(editing.id)}
        />
      )}
      {toast && <Toast msg={toast} />}
    </div>
  );
}

function Header({ stats }) {
  return (
    <div style={styles.header}>
      <div style={styles.headerTop}>
        <div>
          <div style={styles.brandRow}>
            <div style={styles.brandMark}>V</div>
            <span style={styles.brandName}>Victor0629</span>
          </div>
          <h1 style={styles.title}>Inventario</h1>
        </div>
        {stats && (
          <div style={styles.headerStat}>
            <span style={styles.headerStatValue}>{eur(stats.valueStock)}</span>
            <span style={styles.headerStatLabel}>valor en stock</span>
          </div>
        )}
      </div>
      {stats && (
        <div style={styles.headerChips}>
          <Chip icon={<Package size={13} />} label={`${stats.cards} cartas`} />
          <Chip icon={<LayoutGrid size={13} />} label={`${stats.sets} sets`} />
          <Chip icon={<TrendingUp size={13} />} label={`${eur(stats.profit)} beneficio`} tone={stats.profit >= 0 ? "pos" : "neg"} />
          {stats.pending > 0 && (
            <Chip icon={<ArrowUpFromLine size={13} />} label={`${stats.pending} sin subir`} tone="warn" />
          )}
        </div>
      )}
    </div>
  );
}
function Chip({ icon, label, tone }) {
  const toneStyle = tone === "pos" ? styles.chipPos : tone === "neg" ? styles.chipNeg : tone === "warn" ? styles.chipWarn : {};
  return (
    <div style={{ ...styles.chip, ...toneStyle }}>
      {icon}<span>{label}</span>
    </div>
  );
}

function InventoryTab({ items, allCount, query, setQuery, sets, setFilter, setSetFilter, onEdit }) {
  return (
    <div style={styles.tabBody}>
      <div style={styles.searchBar}>
        <Search size={17} color="var(--muted)" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busca por nombre, set o número…" style={styles.searchInput} />
        {query && <button onClick={() => setQuery("")} style={styles.clearBtn}><X size={15} /></button>}
      </div>
      <div style={styles.setScroll}>
        <button onClick={() => setSetFilter("")} style={{ ...styles.setPill, ...(setFilter === "" ? styles.setPillActive : {}) }}>Todos</button>
        {sets.map((s) => (
          <button key={s} onClick={() => setSetFilter(s === setFilter ? "" : s)} style={{ ...styles.setPill, ...(setFilter === s ? styles.setPillActive : {}) }}>{s}</button>
        ))}
      </div>
      <div style={styles.resultCount}>{items.length} de {allCount} referencias</div>
      <div style={styles.list}>
        {items.length === 0 && (
          <div style={styles.emptyState}><AlertCircle size={22} color="var(--muted)" /><p>No hay ninguna carta que coincida con la búsqueda.</p></div>
        )}
        {items.slice(0, 200).map((it) => <ItemRow key={it.id} item={it} onClick={() => onEdit(it)} />)}
        {items.length > 200 && <div style={styles.moreHint}>Afina la búsqueda para ver más resultados ({items.length - 200} ocultos)</div>}
      </div>
    </div>
  );
}

const TONE_COLORS = {
  gold: "linear-gradient(180deg, var(--gold), var(--gold-deep))",
  water: "linear-gradient(180deg, var(--water), var(--water-deep))",
  fire: "linear-gradient(180deg, var(--fire), var(--fire-deep))",
  leaf: "linear-gradient(180deg, var(--leaf), var(--leaf-deep))",
};

function ItemRow({ item, onClick }) {
  const hasStock = item.qty > 0 && (item.status || "En stock") === "En stock";
  const tone = rarityTone(item.variant);
  return (
    <button onClick={onClick} style={styles.itemRow}>
      <div style={{ ...styles.itemAccentBar, background: TONE_COLORS[tone] }} />
      <div style={styles.itemMain}>
        <div style={styles.itemTop}>
          <span style={styles.itemName}>{item.name || "Sin nombre"}</span>
          <span style={styles.itemNum}>#{String(item.num).padStart(3, "0")}</span>
        </div>
        <div style={styles.itemMeta}>
          <span style={styles.setTag}>{item.set}</span>
          <span style={styles.metaDot}>·</span><span>{item.lang}</span>
          <span style={styles.metaDot}>·</span><span>{item.variant}</span>
          {item.status && item.status !== "En stock" && (<><span style={styles.metaDot}>·</span><span style={styles.statusTag}>{item.status}</span></>)}
          {(item.listedQty || 0) > 0 && (<><span style={styles.metaDot}>·</span><span style={styles.listedTag}>✓ {item.listedQty} en Cardmarket</span></>)}
          {Math.max(0, (item.qty || 0) - (item.listedQty || 0)) > 0 && (item.listedQty || 0) > 0 && (<><span style={styles.metaDot}>·</span><span style={styles.pendingTag}>{Math.max(0, (item.qty || 0) - (item.listedQty || 0))} pendiente{Math.max(0, (item.qty || 0) - (item.listedQty || 0)) === 1 ? "" : "s"}</span></>)}
        </div>
      </div>
      <div style={styles.itemRight}>
        <span style={{ ...styles.itemQty, color: hasStock ? "var(--ink)" : "var(--ink-soft)" }}>×{item.qty || 0}</span>
        <span style={styles.itemPrice}>{eur(item.price)}</span>
      </div>
    </button>
  );
}

function EditSheet({ item, compras, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({ ...item });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = () => { if (busy) return; setBusy(true); onSave(form); };
  const del = () => { if (busy) return; setBusy(true); onDelete(); };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={styles.sheetHandle} />
        <div style={styles.sheetHeader}>
          <div>
            <div style={styles.sheetSetTag}>{form.set} · #{String(form.num).padStart(3, "0")}</div>
            <div style={styles.sheetTitle}>{form.name || "Sin nombre"}</div>
          </div>
          <button onClick={onClose} style={styles.iconBtn}><X size={18} /></button>
        </div>
        <div style={styles.sheetBody}>
          <Field label="Compra de origen">
            <select value={form.purchase || ""} onChange={(e) => set("purchase", e.target.value || null)} style={styles.select}>
              <option value="">Sin compra vinculada</option>
              {compras.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.seller}</option>)}
            </select>
          </Field>
          <Field label="Unidades ya subidas a Cardmarket">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="number" min="0" max={form.qty || 0}
                style={{ ...styles.input, flex: 1 }}
                value={form.listedQty ?? 0}
                onChange={(e) => set("listedQty", Math.max(0, Math.min(parseInt(e.target.value) || 0, form.qty || 0)))}
              />
              <button
                onClick={() => set("listedQty", form.qty || 0)}
                style={{ ...styles.toggleBtn, whiteSpace: "nowrap" }}
              >Todas</button>
              <button
                onClick={() => set("listedQty", 0)}
                style={{ ...styles.toggleBtn, whiteSpace: "nowrap" }}
              >Ninguna</button>
            </div>
          </Field>
          <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: -8, marginBottom: 14 }}>
            Tienes {form.qty || 0} en stock · {Math.max(0, (form.qty || 0) - (form.listedQty || 0))} sin subir todavía
          </p>
          <Field label="Nombre de la carta"><input style={styles.input} value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <div style={styles.fieldRow}>
            <Field label="Cantidad" half><input type="number" min="0" style={styles.input} value={form.qty} onChange={(e) => set("qty", parseInt(e.target.value) || 0)} /></Field>
            <Field label="Condición" half><Select value={form.cond} onChange={(v) => set("cond", v)} options={CONDITIONS} /></Field>
          </div>
          <div style={styles.fieldRow}>
            <Field label="Coste unidad (€)" half><input type="number" step="0.01" min="0" style={styles.input} value={form.cost} onChange={(e) => set("cost", parseFloat(e.target.value) || 0)} /></Field>
            <Field label="Precio venta (€)" half><input type="number" step="0.01" min="0" style={styles.input} value={form.price} onChange={(e) => set("price", parseFloat(e.target.value) || 0)} /></Field>
          </div>
          <div style={styles.fieldRow}>
            <Field label="Idioma" half><Select value={form.lang} onChange={(v) => set("lang", v)} options={LANGS} /></Field>
            <Field label="Variante" half><Select value={form.variant} onChange={(v) => set("variant", v)} options={VARIANTS} /></Field>
          </div>
          <div style={styles.fieldRow}>
            <Field label="Estado" half><Select value={form.status} onChange={(v) => set("status", v)} options={STATUSES} /></Field>
            <Field label="Plataforma" half><Select value={form.platform || ""} onChange={(v) => set("platform", v)} options={["", ...PLATFORMS]} /></Field>
          </div>
          <Field label="Ubicación"><input style={styles.input} value={form.loc || ""} onChange={(e) => set("loc", e.target.value)} placeholder="Caja 2, carpeta A…" /></Field>
          <div style={styles.valueSummary}>
            <div><span style={styles.valueSummaryLabel}>Valor stock</span><span style={styles.valueSummaryNum}>{eur((form.qty||0)*(form.price||0))}</span></div>
            <div><span style={styles.valueSummaryLabel}>Beneficio</span><span style={{...styles.valueSummaryNum, color: ((form.qty||0)*(form.price||0) - (form.qty||0)*(form.cost||0)) >= 0 ? "var(--pos)" : "var(--neg)"}}>{eur((form.qty||0)*(form.price||0) - (form.qty||0)*(form.cost||0))}</span></div>
          </div>
        </div>
        <div style={styles.sheetActions}>
          <button style={styles.deleteBtn} onClick={del} disabled={busy}>Eliminar</button>
          <button style={styles.saveBtn} onClick={save} disabled={busy}><Check size={16} /> {busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, half }) {
  const id = useId();
  // Solo asociamos el id si el hijo directo es un <input>/<select>/<textarea>
  // reales (no componentes propios como <Select>), para no romper nada.
  const linkable = isValidElement(children) && typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type);
  return (
    <div style={{ ...styles.field, ...(half ? { flex: 1 } : {}) }}>
      <label htmlFor={linkable ? id : undefined} style={styles.fieldLabel}>{label}</label>
      {linkable ? cloneElement(children, { id }) : children}
    </div>
  );
}
function Select({ value, onChange, options }) {
  return (
    <div style={styles.selectWrap}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={styles.select}>
        {options.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
      </select>
      <ChevronDown size={14} color="var(--muted)" style={styles.selectChevron} />
    </div>
  );
}

function AddTab({ onAdd, sets, compras }) {
  const [form, setForm] = useState({ set: sets[0] || "", num: "", name: "", lang: "ES", variant: "Normal", cond: "NM", qty: 1, cost: 0.02, price: 0.05, purchase: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (busy || !form.set || !form.num || !form.name.trim()) return;
    setBusy(true);
    await onAdd({
      set: form.set.toUpperCase(), num: parseInt(form.num) || 0, name: form.name.trim(),
      lang: form.lang, variant: form.variant, cond: form.cond,
      qty: parseInt(form.qty) || 0, cost: parseFloat(form.cost) || 0, price: parseFloat(form.price) || 0,
      purchase: form.purchase || null, loc: null, platform: null, status: "En stock",
    });
    setForm((f) => ({ ...f, num: "", name: "", qty: 1 }));
    setBusy(false);
  }

  const compraOptions = ["", ...compras.map((c) => c.id)];
  const compraLabel = (id) => {
    if (!id) return "Sin compra vinculada";
    const c = compras.find((x) => x.id === id);
    return c ? `${c.id} — ${c.seller}` : id;
  };

  return (
    <div style={styles.tabBody}>
      <h2 style={styles.sectionTitle}>Añadir carta</h2>
      <p style={styles.sectionSub}>Rellena lo justo — puedes editar el resto luego desde el inventario.</p>
      <div style={{ marginTop: 20 }}>
        <div style={styles.fieldRow}>
          <Field label="Set" half><input style={styles.input} value={form.set} onChange={(e) => set("set", e.target.value)} placeholder="TEF" list="sets-list" /><datalist id="sets-list">{sets.map((s) => <option key={s} value={s} />)}</datalist></Field>
          <Field label="Número" half><input type="number" style={styles.input} value={form.num} onChange={(e) => set("num", e.target.value)} placeholder="042" /></Field>
        </div>
        <Field label="Nombre de la carta"><input style={styles.input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Pikachu ex" /></Field>
        <div style={styles.fieldRow}>
          <Field label="Idioma" half><Select value={form.lang} onChange={(v) => set("lang", v)} options={LANGS} /></Field>
          <Field label="Variante" half><Select value={form.variant} onChange={(v) => set("variant", v)} options={VARIANTS} /></Field>
        </div>
        <div style={styles.fieldRow}>
          <Field label="Condición" half><Select value={form.cond} onChange={(v) => set("cond", v)} options={CONDITIONS} /></Field>
          <Field label="Cantidad" half><input type="number" min="0" style={styles.input} value={form.qty} onChange={(e) => set("qty", e.target.value)} /></Field>
        </div>
        <div style={styles.fieldRow}>
          <Field label="Coste unidad (€)" half><input type="number" step="0.01" style={styles.input} value={form.cost} onChange={(e) => set("cost", e.target.value)} /></Field>
          <Field label="Precio venta (€)" half><input type="number" step="0.01" style={styles.input} value={form.price} onChange={(e) => set("price", e.target.value)} /></Field>
        </div>
        <Field label="Compra de origen">
          <select value={form.purchase} onChange={(e) => set("purchase", e.target.value)} style={styles.select}>
            {compraOptions.map((id) => <option key={id || "none"} value={id}>{compraLabel(id)}</option>)}
          </select>
        </Field>
        <button style={styles.primaryBtn} onClick={submit} disabled={busy}><Plus size={17} /> {busy ? "Añadiendo…" : "Añadir al inventario"}</button>
      </div>
    </div>
  );
}

function ExportTab({ items, sets, onMarkListed }) {
  const [set, setSet] = useState(sets[0] || "");
  const [lang, setLang] = useState("ES");
  const [onlyStock, setOnlyStock] = useState(true);
  const [onlyUnlisted, setOnlyUnlisted] = useState(true);
  const [justDownloaded, setJustDownloaded] = useState(null);

  const matching = useMemo(() => items
    .filter((it) => {
      if (it.set !== set) return false;
      if (it.lang !== lang) return false;
      if (onlyStock && (!(it.qty > 0) || (it.status || "En stock") !== "En stock")) return false;
      return true;
    })
    // Exportamos SOLO las unidades que aún no están en Cardmarket
    .map((it) => ({ ...it, pendingQty: Math.max(0, (it.qty || 0) - (it.listedQty || 0)) }))
    .filter((it) => (onlyUnlisted ? it.pendingQty > 0 : (it.qty || 0) > 0))
    .map((it) => ({ ...it, qty: onlyUnlisted ? it.pendingQty : it.qty })),
  [items, set, lang, onlyStock, onlyUnlisted]);

  function download() {
    if (matching.length === 0) return;
    chunk(matching, 100).forEach((rows, idx, all) => {
      const csv = buildCardmarketCSV(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${set}_${lang}${all.length > 1 ? `_parte${idx + 1}` : ""}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
    setJustDownloaded(matching.map((it) => it.id));
  }

  return (
    <div style={styles.tabBody}>
      <h2 style={styles.sectionTitle}>Exportar a Cardmarket</h2>
      <p style={styles.sectionSub}>Genera el CSV para "List bulk items". Exporta solo las unidades que aún no están en Cardmarket.</p>
      <div style={{ marginTop: 20 }}>
        <Field label="Colección"><Select value={set} onChange={(v) => { setSet(v); setJustDownloaded(null); }} options={sets} /></Field>
        {isUnknownSet(set) && (
          <p style={styles.exportWarn}>
            No tengo el nombre completo de "{set}" en el registro. El CSV llevará el código tal cual — compruébalo en el desplegable de expansión de Cardmarket antes de importar.
          </p>
        )}
        <div style={styles.fieldRow}>
          <Field label="Idioma" half><Select value={lang} onChange={(v) => { setLang(v); setJustDownloaded(null); }} options={LANGS} /></Field>
          <Field label="Filtro" half><button onClick={() => setOnlyStock((v) => !v)} style={{ ...styles.toggleBtn, ...(onlyStock ? styles.toggleBtnActive : {}) }}>{onlyStock ? <Check size={14} /> : null} Solo con stock</button></Field>
        </div>
        <button onClick={() => setOnlyUnlisted((v) => !v)} style={{ ...styles.toggleBtn, marginTop: 10, ...(onlyUnlisted ? styles.toggleBtnActive : {}) }}>
          {onlyUnlisted ? <Check size={14} /> : null} Solo unidades sin subir a Cardmarket
        </button>
      </div>
      <div style={styles.exportPreview}>
        <div style={styles.exportPreviewTop}>
          <span style={styles.exportCount}>{matching.length}</span>
          <span style={styles.exportCountLabel}>referencias · {matching.reduce((a,b)=>a+b.qty,0)} cartas</span>
        </div>
        {matching.length > 100 && <p style={styles.exportWarn}>Se dividirá en {Math.ceil(matching.length / 100)} archivos de hasta 100 filas.</p>}
        <div style={styles.exportList}>
          {matching.slice(0, 6).map((it) => (
            <div key={it.id} style={styles.exportRow}><span>#{String(it.num).padStart(3,"0")} {it.name}</span><span style={styles.exportRowMeta}>×{it.qty} · {eur(it.price)}</span></div>
          ))}
          {matching.length > 6 && <div style={styles.exportMore}>+{matching.length - 6} más</div>}
        </div>
      </div>
      <button style={styles.primaryBtn} onClick={download} disabled={matching.length === 0}><Download size={17} /> Descargar CSV</button>

      {justDownloaded && (
        <div style={styles.exportPreview}>
          <p style={{ fontSize: 13, color: "var(--text)", marginBottom: 10 }}>
            Cuando ya lo hayas subido a Cardmarket, marca estas {justDownloaded.length} cartas — sus unidades pasarán a contar como subidas y no volverán a salir en el próximo CSV.
          </p>
          <button
            style={{ ...styles.toggleBtn, ...styles.toggleBtnActive }}
            onClick={() => { onMarkListed(justDownloaded); setJustDownloaded(null); }}
          >
            <Check size={14} /> Marcar sus unidades como subidas
          </button>
        </div>
      )}
    </div>
  );
}

function MovimientosTab({ items, compras, ventas, ventaItems, onAddCompra, onUpdateCompra, onDeleteCompra, onAddVentaOrder, onUpdateVentaHeader, onAddLineToOrder, onUpdateVentaLine, onDeleteVentaLine, onDeleteVentaOrder }) {
  const [sub, setSub] = useState("ventas");
  const [showAdd, setShowAdd] = useState(false);
  const [editingC, setEditingC] = useState(null);
  const [editingV, setEditingV] = useState(null);

  const pendientes = useMemo(() => pendingBySet(items), [items]);
  const pendientesTotal = useMemo(() => pendientes.reduce((a, [, d]) => a + d.qty, 0), [pendientes]);

  function descargar(contenido, nombre, tipo) {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  const hoy = () => new Date().toISOString().slice(0, 10);
  const bajarBackup = () => descargar(
    buildBackup({ items, compras, ventas, ventaItems }),
    `backup_inventario_${hoy()}.json`, "application/json"
  );
  const bajarCSV = () => descargar(
    buildInventoryCSV(items), `inventario_${hoy()}.csv`, "text/csv;charset=utf-8;"
  );

  const totalCompras = useMemo(() => compras.reduce((a, c) => a + (c.totalCost || 0), 0), [compras]);
  const totalCartasCompradas = useMemo(() => compras.reduce((a, c) => a + (c.cardCount || 0), 0), [compras]);

  // agrupa las líneas por pedido de venta
  const ordersCalc = useMemo(() => ventas.map((v) => {
    const lines = ventaItems.filter((l) => l.ventaId === v.id);
    return { ...v, lines, ...orderCalc(v, lines) };
  }), [ventas, ventaItems]);

  const totalNeto = useMemo(() => ordersCalc.reduce((a, o) => a + o.net, 0), [ordersCalc]);
  const totalBeneficio = useMemo(() => ordersCalc.reduce((a, o) => a + o.profit, 0), [ordersCalc]);
  const totalCartasVendidas = useMemo(() => ordersCalc.reduce((a, o) => a + o.cardCount, 0), [ordersCalc]);

  return (
    <div style={styles.tabBody}>
      <h2 style={styles.sectionTitle}>Movimientos</h2>
      <p style={styles.sectionSub}>Compras y ventas, ligadas a tu inventario.</p>

      <div style={styles.subToggle}>
        <button onClick={() => setSub("ventas")} style={{ ...styles.subToggleBtn, ...(sub === "ventas" ? styles.subToggleBtnActive : {}) }}><ArrowUpFromLine size={14} /> Ventas</button>
        <button onClick={() => setSub("compras")} style={{ ...styles.subToggleBtn, ...(sub === "compras" ? styles.subToggleBtnActive : {}) }}><ArrowDownToLine size={14} /> Compras</button>
      </div>

      {sub === "ventas" ? (
        <>
          <div style={styles.movStats}>
            <div style={styles.movStat}><span style={styles.movStatVal}>{totalCartasVendidas}</span><span style={styles.movStatLabel}>cartas vendidas</span></div>
            <div style={styles.movStat}><span style={styles.movStatVal}>{eur(totalNeto)}</span><span style={styles.movStatLabel}>ingreso neto</span></div>
            <div style={styles.movStat}><span style={{ ...styles.movStatVal, color: totalBeneficio >= 0 ? "var(--pos)" : "var(--neg)" }}>{eur(totalBeneficio)}</span><span style={styles.movStatLabel}>beneficio</span></div>
          </div>
          <div style={styles.list}>
            {ordersCalc.length === 0 && <div style={styles.emptyState}><AlertCircle size={20} color="var(--muted)" /><p>Aún no has registrado ninguna venta.</p></div>}
            {ordersCalc.map((o) => (
              <button key={o.id} onClick={() => setEditingV(o)} style={styles.movRow}>
                <div style={styles.itemMain}>
                  <div style={styles.itemTop}>
                    <span style={styles.itemName}>
                      {o.lines[0]?.itemLabel || "Venta"}{o.itemCount > 1 ? ` +${o.itemCount - 1} más` : ""}
                    </span>
                  </div>
                  <div style={styles.itemMeta}>
                    <span>{o.date || "sin fecha"}</span>
                    {o.platform && <><span style={styles.metaDot}>·</span><span>{o.platform}</span></>}
                    <span style={styles.metaDot}>·</span><span>×{o.cardCount}</span>
                  </div>
                </div>
                <div style={styles.itemRight}>
                  <span style={styles.itemQty}>{eur(o.net)}</span>
                  <span style={{ ...styles.itemPrice, color: o.profit >= 0 ? "var(--pos)" : "var(--neg)" }}>{o.profit >= 0 ? "+" : ""}{eur(o.profit)}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={styles.movStats}>
            <div style={styles.movStat}><span style={styles.movStatVal}>{totalCartasCompradas}</span><span style={styles.movStatLabel}>cartas compradas</span></div>
            <div style={styles.movStat}><span style={styles.movStatVal}>{eur(totalCompras)}</span><span style={styles.movStatLabel}>invertido</span></div>
            <div style={styles.movStat}><span style={styles.movStatVal}>{compras.length}</span><span style={styles.movStatLabel}>lotes</span></div>
          </div>
          <div style={styles.list}>
            {compras.map((c) => (
              <button key={c.id} onClick={() => setEditingC(c)} style={styles.movRow}>
                <div style={styles.itemMain}>
                  <div style={styles.itemTop}><span style={styles.itemName}>{c.seller || "Sin vendedor"}</span></div>
                  <div style={styles.itemMeta}><span>{c.date || "sin fecha"}</span><span style={styles.metaDot}>·</span><span>{c.cardCount} cartas</span></div>
                </div>
                <div style={styles.itemRight}><span style={styles.itemQty}>{eur(c.totalCost)}</span><span style={styles.itemPrice}>{c.id}</span></div>
              </button>
            ))}
          </div>
        </>
      )}

      <button style={styles.primaryBtn} onClick={() => setShowAdd(true)}><Plus size={17} /> {sub === "ventas" ? "Registrar venta" : "Registrar compra"}</button>

      {showAdd && sub === "ventas" && (
        <VentaOrderSheet items={items} onClose={() => setShowAdd(false)}
          onSave={(header, cart) => { onAddVentaOrder(header, cart); setShowAdd(false); }} />
      )}
      {showAdd && sub === "compras" && <CompraSheet onClose={() => setShowAdd(false)} onSave={(c) => { onAddCompra(c); setShowAdd(false); }} />}
      {editingV && (
        <VentaOrderSheet items={items} existing={editingV} onClose={() => setEditingV(null)}
          onSaveHeader={(patch) => onUpdateVentaHeader(editingV.id, patch)}
          onAddLine={(line) => onAddLineToOrder(editingV.id, line)}
          onUpdateLine={onUpdateVentaLine}
          onDeleteLine={onDeleteVentaLine}
          onDeleteOrder={() => { onDeleteVentaOrder(editingV.id); setEditingV(null); }}
        />
      )}
      {editingC && <CompraSheet existing={editingC} items={items} ventaItems={ventaItems} onClose={() => setEditingC(null)} onSave={(c) => { onUpdateCompra(editingC.id, c); setEditingC(null); }} onDelete={() => { onDeleteCompra(editingC.id); setEditingC(null); }} />}
    </div>
  );
}

function CompraSheet({ existing, items, ventaItems, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(existing || { date: "", seller: "", desc: "", cardCount: "", totalCost: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const linkedItems = useMemo(() => {
    if (!existing || !items) return [];
    return items.filter((it) => it.purchase === existing.id);
  }, [existing, items]);
  const linkedVentaLines = useMemo(() => {
    if (!existing || !ventaItems) return [];
    return ventaItems.filter((l) => l.purchaseId === existing.id);
  }, [existing, ventaItems]);
  const soldFromHere = linkedVentaLines.reduce((a, l) => a + (l.qty || 0), 0);
  const remainingFromHere = linkedItems.reduce((a, it) => a + (it.qty || 0), 0);

  function submit() {
    if (busy || !form.seller.trim()) return;
    setBusy(true);
    onSave({ date: form.date, seller: form.seller.trim(), desc: form.desc || "", cardCount: parseInt(form.cardCount) || 0, totalCost: parseFloat(form.totalCost) || 0, notes: form.notes || "" });
  }
  const del = () => { if (busy) return; setBusy(true); onDelete(); };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={styles.sheetHandle} />
        <div style={styles.sheetHeader}>
          <div><div style={styles.sheetSetTag}>{existing ? existing.id : "Nueva compra"}</div><div style={styles.sheetTitle}>{existing ? "Editar compra" : "Registrar compra"}</div></div>
          <button onClick={onClose} style={styles.iconBtn}><X size={18} /></button>
        </div>
        <div style={styles.sheetBody}>
          {existing && (linkedItems.length > 0 || linkedVentaLines.length > 0) && (
            <div style={styles.traceBox}>
              <div style={styles.traceRow}><span>Cartas en inventario de este lote</span><b>{linkedItems.length} ref · {remainingFromHere} uds</b></div>
              <div style={styles.traceRow}><span>Vendidas de este lote</span><b style={{ color: "var(--pos)" }}>{soldFromHere} uds</b></div>
              {linkedVentaLines.length > 0 && (
                <div style={styles.traceList}>
                  {linkedVentaLines.slice(0, 5).map((l) => (
                    <div key={l.id} style={styles.traceItem}><ExternalLink size={11} color="var(--muted)" /><span>{l.itemLabel} · ×{l.qty} · {eur(l.priceUnit * l.qty)}</span></div>
                  ))}
                  {linkedVentaLines.length > 5 && <div style={styles.traceMore}>+{linkedVentaLines.length - 5} ventas más de este lote</div>}
                </div>
              )}
            </div>
          )}
          <div style={styles.fieldRow}>
            <Field label="Fecha" half><input type="date" style={styles.input} value={form.date || ""} onChange={(e) => set("date", e.target.value)} /></Field>
            <Field label="Vendedor" half><input style={styles.input} value={form.seller} onChange={(e) => set("seller", e.target.value)} placeholder="Usuario o tienda" /></Field>
          </div>
          <Field label="Descripción"><input style={styles.input} value={form.desc} onChange={(e) => set("desc", e.target.value)} placeholder="Lote de bulk, singles sueltos…" /></Field>
          <div style={styles.fieldRow}>
            <Field label="Cartas" half><input type="number" min="0" style={styles.input} value={form.cardCount} onChange={(e) => set("cardCount", e.target.value)} /></Field>
            <Field label="Coste total (€)" half><input type="number" step="0.01" min="0" style={styles.input} value={form.totalCost} onChange={(e) => set("totalCost", e.target.value)} /></Field>
          </div>
          <Field label="Notas"><input style={styles.input} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </div>
        <div style={styles.sheetActions}>
          {existing && <button style={styles.deleteBtn} onClick={del} disabled={busy}>Eliminar</button>}
          <button style={styles.saveBtn} onClick={submit} disabled={busy}><Check size={16} /> {busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

// Ficha de venta con carrito: una cabecera (fecha/plataforma/comprador/
// comisión/envío) y varias cartas dentro. Sirve tanto para crear un pedido
// nuevo (cart en memoria, se guarda todo junto) como para editar uno ya
// existente (cada línea se guarda al momento).
function VentaOrderSheet({ items, existing, onClose, onSave, onSaveHeader, onAddLine, onUpdateLine, onDeleteLine, onDeleteOrder }) {
  const isEdit = !!existing;
  const [header, setHeader] = useState(existing
    ? { date: existing.date, platform: existing.platform, buyer: existing.buyer, commission: existing.commission, shipping: existing.shipping, notes: existing.notes }
    : { date: "", platform: "", buyer: "", commission: "", shipping: "", notes: "" });
  const [cart, setCart] = useState(existing ? existing.lines : []);
  const [search, setSearch] = useState("");
  const [lineQty, setLineQty] = useState(1);
  const [linePrice, setLinePrice] = useState("");
  const [pickedItem, setPickedItem] = useState(null);
  const [busy, setBusy] = useState(false);
  const setH = (k, v) => setHeader((f) => ({ ...f, [k]: v }));

  const matches = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    const alreadyInCart = new Set(cart.map((l) => l.itemId));
    return items.filter((it) => it.qty > 0 && !alreadyInCart.has(it.id) && (it.name || "").toLowerCase().includes(q)).slice(0, 6);
  }, [search, items, cart]);

  function pickItem(it) {
    setPickedItem(it);
    setLinePrice(String(it.price));
    setLineQty(1);
    setSearch("");
  }

  function addLineToCart() {
    if (!pickedItem) return;
    const qty = parseInt(lineQty) || 1;
    // Cuántas unidades de esta misma carta ya van en el carrito
    const already = cart.filter((l) => l.itemId === pickedItem.id).reduce((a, l) => a + (l.qty || 0), 0);
    const warn = checkStock(pickedItem, qty, already);
    if (warn) {
      const ok = window.confirm(
        `Solo tienes ${warn.available} unidad${warn.available === 1 ? "" : "es"} de ${warn.name} y estás vendiendo ${warn.wanted}.\n\n` +
        `Si continúas, el stock se quedará en 0 y el descuadre no se registrará en ningún sitio.\n\n¿Seguir de todas formas?`
      );
      if (!ok) return;
    }
    const newLine = {
      itemId: pickedItem.id,
      itemLabel: `${pickedItem.name} (${pickedItem.set} #${String(pickedItem.num).padStart(3, "0")})`,
      purchaseId: pickedItem.purchase || null,
      qty, priceUnit: parseFloat(linePrice) || 0, costUnit: pickedItem.cost,
    };
    if (isEdit) {
      onAddLine(newLine);
    } else {
      setCart((prev) => [...prev, newLine]);
    }
    setPickedItem(null); setLinePrice(""); setLineQty(1);
  }

  function removeLine(line, idx) {
    if (isEdit) onDeleteLine(line.id);
    else setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  const calc = useMemo(() => orderCalc(
    { commission: parseFloat(header.commission) || 0, shipping: parseFloat(header.shipping) || 0 },
    cart
  ), [header.commission, header.shipping, cart]);

  function submit() {
    if (busy) return;
    if (!isEdit) {
      if (cart.length === 0) return;
      setBusy(true);
      onSave({
        date: header.date, platform: header.platform, buyer: header.buyer,
        commission: parseFloat(header.commission) || 0, shipping: parseFloat(header.shipping) || 0,
        notes: header.notes,
      }, cart);
    } else {
      setBusy(true);
      onSaveHeader({
        date: header.date, platform: header.platform, buyer: header.buyer,
        commission: parseFloat(header.commission) || 0, shipping: parseFloat(header.shipping) || 0,
        notes: header.notes,
      });
      onClose();
    }
  }
  const del = () => { if (busy) return; setBusy(true); onDeleteOrder(); };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={styles.sheetHandle} />
        <div style={styles.sheetHeader}>
          <div><div style={styles.sheetSetTag}>{existing ? existing.id : "Nueva venta"}</div><div style={styles.sheetTitle}>{existing ? "Editar venta" : "Registrar venta"}</div></div>
          <button onClick={onClose} style={styles.iconBtn}><X size={18} /></button>
        </div>
        <div style={styles.sheetBody}>

          <Field label={`Cartas en esta venta (${cart.length})`}>
            <div style={styles.cartList}>
              {cart.length === 0 && <div style={styles.cartEmpty}>Aún no has añadido ninguna carta.</div>}
              {cart.map((line, idx) => (
                <div key={line.id || idx} style={styles.cartLine}>
                  <div style={styles.cartLineMain}>
                    <span style={styles.cartLineName}>{line.itemLabel}</span>
                    <span style={styles.cartLineMeta}>×{line.qty} · {eur(line.priceUnit)}/ud</span>
                  </div>
                  <button onClick={() => removeLine(line, idx)} style={styles.unlinkBtn}><X size={14} /></button>
                </div>
              ))}
            </div>

            {!pickedItem ? (
              <>
                <input style={{ ...styles.input, marginTop: 8 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Busca una carta para añadir…" />
                {matches.length > 0 && (
                  <div style={styles.matchList}>
                    {matches.map((it) => (<button key={it.id} style={styles.matchRow} onClick={() => pickItem(it)}><span>{it.name}</span><span style={styles.exportRowMeta}>{it.set} · ×{it.qty}</span></button>))}
                  </div>
                )}
              </>
            ) : (
              <div style={styles.pickedBox}>
                <div style={styles.linkedItem}><Link2 size={14} color="var(--accent)" /><span>{pickedItem.name}</span><button onClick={() => setPickedItem(null)} style={styles.unlinkBtn}><X size={13} /></button></div>
                <div style={styles.fieldRow}>
                  <Field label="Cantidad" half><input type="number" min="1" style={styles.input} value={lineQty} onChange={(e) => setLineQty(e.target.value)} /></Field>
                  <Field label="Precio/ud (€)" half><input type="number" step="0.01" style={styles.input} value={linePrice} onChange={(e) => setLinePrice(e.target.value)} /></Field>
                </div>
                <button style={styles.addLineBtn} onClick={addLineToCart}><Plus size={15} /> Añadir a la venta</button>
              </div>
            )}
          </Field>

          <div style={styles.fieldRow}>
            <Field label="Fecha" half><input type="date" style={styles.input} value={header.date || ""} onChange={(e) => setH("date", e.target.value)} /></Field>
            <Field label="Plataforma" half><Select value={header.platform || ""} onChange={(v) => setH("platform", v)} options={["", ...PLATFORMS]} /></Field>
          </div>
          <div style={styles.fieldRow}>
            <Field label="Comisión total (€)" half><input type="number" step="0.01" style={styles.input} value={header.commission} onChange={(e) => setH("commission", e.target.value)} /></Field>
            <Field label="Envío total (€)" half><input type="number" step="0.01" style={styles.input} value={header.shipping} onChange={(e) => setH("shipping", e.target.value)} /></Field>
          </div>
          <Field label="Comprador"><input style={styles.input} value={header.buyer || ""} onChange={(e) => setH("buyer", e.target.value)} /></Field>

          <div style={styles.valueSummary}>
            <div><span style={styles.valueSummaryLabel}>Ingreso neto</span><span style={styles.valueSummaryNum}>{eur(calc.net)}</span></div>
            <div><span style={styles.valueSummaryLabel}>Beneficio</span><span style={{ ...styles.valueSummaryNum, color: calc.profit >= 0 ? "var(--pos)" : "var(--neg)" }}>{eur(calc.profit)}</span></div>
          </div>
        </div>
        <div style={styles.sheetActions}>
          {existing && <button style={styles.deleteBtn} onClick={del} disabled={busy}>Eliminar venta</button>}
          <button style={styles.saveBtn} onClick={submit} disabled={busy || (!isEdit && cart.length === 0)}>
            <Check size={16} /> {busy ? "Guardando…" : isEdit ? "Guardar cambios" : `Registrar venta (${cart.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryTab({ items, sets, compras, ventas, ventaItems }) {
  const bySet = useMemo(() => {
    const map = {};
    for (const it of items) {
      if ((it.status || "En stock") !== "En stock" || !(it.qty > 0)) continue;
      if (!map[it.set]) map[it.set] = { qty: 0, value: 0, cost: 0, refs: 0 };
      map[it.set].qty += it.qty; map[it.set].value += itemValue(it); map[it.set].cost += itemCostTotal(it); map[it.set].refs += 1;
    }
    return Object.entries(map).sort((a, b) => b[1].value - a[1].value);
  }, [items]);
  const maxValue = bySet.length ? bySet[0][1].value : 1;

  const pendientes = useMemo(() => pendingBySet(items), [items]);
  const pendientesTotal = useMemo(() => pendientes.reduce((a, [, d]) => a + d.qty, 0), [pendientes]);

  function descargar(contenido, nombre, tipo) {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  const hoy = () => new Date().toISOString().slice(0, 10);
  const bajarBackup = () => descargar(
    buildBackup({ items, compras, ventas, ventaItems }),
    `backup_inventario_${hoy()}.json`, "application/json"
  );
  const bajarCSV = () => descargar(
    buildInventoryCSV(items), `inventario_${hoy()}.csv`, "text/csv;charset=utf-8;"
  );

  const totalCompras = useMemo(() => compras.reduce((a, c) => a + (c.totalCost || 0), 0), [compras]);
  const ordersCalc = useMemo(() => ventas.map((v) => orderCalc(v, ventaItems.filter((l) => l.ventaId === v.id))), [ventas, ventaItems]);
  const totalVentaNeta = useMemo(() => ordersCalc.reduce((a, o) => a + o.net, 0), [ordersCalc]);
  const totalVentaBeneficio = useMemo(() => ordersCalc.reduce((a, o) => a + o.profit, 0), [ordersCalc]);

  return (
    <div style={styles.tabBody}>
      <h2 style={styles.sectionTitle}>Resumen</h2>
      <p style={styles.sectionSub}>Negocio completo: stock, compras y ventas.</p>
      <div style={styles.summaryTop}>
        <div style={styles.summaryTopCard}><span style={styles.summaryTopLabel}>Invertido en compras</span><span style={styles.summaryTopVal}>{eur(totalCompras)}</span></div>
        <div style={styles.summaryTopCard}><span style={styles.summaryTopLabel}>Ingreso neto ventas</span><span style={styles.summaryTopVal}>{eur(totalVentaNeta)}</span></div>
        <div style={styles.summaryTopCard}><span style={styles.summaryTopLabel}>Beneficio realizado</span><span style={{ ...styles.summaryTopVal, color: totalVentaBeneficio >= 0 ? "var(--pos)" : "var(--neg)" }}>{eur(totalVentaBeneficio)}</span></div>
      </div>
      <h3 style={styles.subheading}>Pendiente de subir a Cardmarket</h3>
      {pendientesTotal === 0 ? (
        <p style={styles.sectionSub}>Todo tu stock está subido. No tienes nada pendiente.</p>
      ) : (
        <>
          <p style={styles.sectionSub}>{pendientesTotal} cartas esperando a que las subas, en {pendientes.length} {pendientes.length === 1 ? "colección" : "colecciones"}.</p>
          <div style={{ marginTop: 14 }}>
            {pendientes.map(([code, d]) => (
              <div key={code} style={styles.exportRow}>
                <span>{setLabel(code)}</span>
                <span style={styles.exportRowMeta}>{d.qty} cartas · {d.refs} ref.</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 style={styles.subheading}>Copia de seguridad</h3>
      <p style={styles.sectionSub}>Guárdate una copia de vez en cuando. Si Supabase falla o borras algo sin querer, esto es lo único que te salva.</p>
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button onClick={bajarBackup} style={{ ...styles.toggleBtn, flex: 1, minWidth: 150 }}>
          <ArrowDownToLine size={14} /> Copia completa (JSON)
        </button>
        <button onClick={bajarCSV} style={{ ...styles.toggleBtn, flex: 1, minWidth: 150 }}>
          <Download size={14} /> Inventario (CSV)
        </button>
      </div>

      <h3 style={styles.subheading}>Stock por colección</h3>
      <p style={styles.sectionSub}>Solo cartas en stock. Ordenado por valor.</p>
      <div style={{ marginTop: 20 }}>
        {bySet.map(([code, d]) => (
          <div key={code} style={styles.summaryRow}>
            <div style={styles.summaryRowTop}><span style={styles.summarySetName}>{setLabel(code)}</span><span style={styles.summaryValue}>{eur(d.value)}</span></div>
            <div style={styles.summaryBarTrack}><div style={{ ...styles.summaryBarFill, width: `${(d.value / maxValue) * 100}%` }} /></div>
            <div style={styles.summaryRowBottom}><span>{d.refs} referencias · {d.qty} cartas</span><span style={{ color: d.value - d.cost >= 0 ? "var(--pos)" : "var(--neg)" }}>{eur(d.value - d.cost)} beneficio</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BottomNav({ tab, setTab }) {
  const items = [
    { id: "inventario", label: "Inventario", icon: Search },
    { id: "movimientos", label: "Movim.", icon: ArrowLeftRight },
    { id: "anadir", label: "Añadir", icon: Plus, fab: true },
    { id: "exportar", label: "Exportar", icon: Download },
    { id: "resumen", label: "Resumen", icon: LayoutGrid },
  ];
  return (
    <div style={styles.bottomNav}>
      {items.map(({ id, label, icon: Icon, fab }) =>
        fab ? (
          <button key={id} onClick={() => setTab(id)} style={styles.navBtn} aria-label={label}>
            <div style={styles.navFab}><Icon size={20} color="#2a1200" strokeWidth={2.5} /></div>
          </button>
        ) : (
          <button key={id} onClick={() => setTab(id)} style={styles.navBtn}>
            <Icon size={19} color={tab === id ? "var(--gold)" : "rgba(255,255,255,0.4)"} />
            <span style={{ color: tab === id ? "var(--gold)" : "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: 700 }}>{label}</span>
          </button>
        )
      )}
    </div>
  );
}
function Toast({ msg }) { return <div style={styles.toast}>{msg}</div>; }

function Style() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap');
      :root {
        --night-1: #161233; --night-2: #241a4a; --night-3: #2f1f5c;
        --bg: #1c1640;
        --surface: rgba(255,255,255,0.07); --surface2: rgba(255,255,255,0.12);
        --border: rgba(255,255,255,0.14);
        --card: #FFF9F0; --card-line: #EDE3D0; --ink: #241a3d; --ink-soft: #6b6180;
        --text: #F5F3FF; --muted: rgba(245,243,255,0.55);
        --accent: #F0B429; --accent2: #E8483C; --pos: #3FA772; --neg: #E8483C;
        --gold: #F0B429; --gold-deep: #B8790F; --fire: #E8483C; --fire-deep: #B8301F;
        --water: #3F6FE0; --water-deep: #2748A8; --leaf: #3FA772; --leaf-deep: #256B48;
        --sans: 'Manrope', -apple-system, sans-serif; --mono: 'Manrope', sans-serif;
        --display: 'Baloo 2', 'Manrope', sans-serif;
      }
      * { box-sizing: border-box; }
      body {
        background:
          radial-gradient(circle at 15% 8%, rgba(255,255,255,0.10) 0, transparent 2px),
          radial-gradient(circle at 68% 4%, rgba(255,255,255,0.08) 0, transparent 2px),
          radial-gradient(circle at 85% 14%, rgba(255,255,255,0.09) 0, transparent 2px),
          radial-gradient(circle at 40% 20%, rgba(255,255,255,0.07) 0, transparent 2px),
          radial-gradient(circle at 90% 45%, rgba(255,255,255,0.06) 0, transparent 2px),
          radial-gradient(circle at 8% 50%, rgba(255,255,255,0.08) 0, transparent 2px),
          radial-gradient(circle at 55% 70%, rgba(255,255,255,0.05) 0, transparent 2px),
          linear-gradient(180deg, var(--night-1) 0%, var(--night-2) 45%, var(--night-3) 100%);
        background-attachment: fixed;
      }
      input:focus, select:focus, button:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
      input::placeholder { color: var(--muted); }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes shine { 0%,100% { background-position: 15% 25%; } 50% { background-position: 85% 75%; } }
      @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
    `}</style>
  );
}

const styles = {
  app: { minHeight: "100vh", background: "transparent", fontFamily: "var(--sans)", color: "var(--text)", paddingBottom: 100, position: "relative", maxWidth: 520, margin: "0 auto" },
  loadingWrap: { minHeight: "100vh", background: "linear-gradient(180deg, #161233 0%, #241a4a 45%, #2f1f5c 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 },
  loadingSpinner: { width: 28, height: 28, border: "2.5px solid rgba(255,255,255,0.15)", borderTopColor: "#F0B429", borderRadius: "50%", animation: "spin 0.8s linear infinite" },

  header: { padding: "24px 18px 16px", borderBottom: "1px solid var(--border)" },
  headerTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-end" },
  brandRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  brandMark: { width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg, var(--gold), var(--fire))", color: "#2a1200", fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--display)" },
  brandName: { fontSize: 12.5, color: "rgba(255,255,255,0.6)", fontFamily: "var(--sans)", fontWeight: 700, letterSpacing: 0.3 },
  title: { fontSize: 40, fontWeight: 800, margin: 0, letterSpacing: -0.5, fontFamily: "var(--display)", color: "#fff", lineHeight: 1 },
  headerStat: { display: "flex", flexDirection: "column", alignItems: "flex-end" },
  headerStatValue: { fontFamily: "var(--display)", fontSize: 20, fontWeight: 700, color: "var(--gold)" },
  headerStatLabel: { fontSize: 10.5, color: "var(--muted)", fontWeight: 600 },
  headerChips: { display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" },
  chip: { display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, fontSize: 12.5, fontFamily: "var(--sans)", fontWeight: 600, color: "var(--text)" },
  chipPos: { color: "#a6f0c6" },
  chipWarn: { color: "#ffd8a8" },
  chipNeg: { color: "#f7b8b3" },

  tabBody: { padding: "16px 18px 24px" },
  searchBar: { display: "flex", alignItems: "center", gap: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "13px 16px" },
  searchInput: { flex: 1, background: "transparent", border: "none", color: "var(--text)", fontSize: 15, fontFamily: "var(--sans)" },
  clearBtn: { background: "none", border: "none", color: "var(--muted)", display: "flex", padding: 2, cursor: "pointer" },
  setScroll: { display: "flex", gap: 8, overflowX: "auto", marginTop: 14, paddingBottom: 2 },
  setPill: { flexShrink: 0, padding: "7px 14px", borderRadius: 20, background: "var(--surface)", border: "1px solid var(--border)", color: "rgba(255,255,255,0.6)", fontSize: 12.5, fontFamily: "var(--sans)", fontWeight: 700, cursor: "pointer" },
  setPillActive: { background: "var(--gold)", color: "#3a2400", borderColor: "var(--gold)", fontWeight: 700 },
  resultCount: { fontSize: 12, color: "var(--muted)", marginTop: 16, marginBottom: 10, fontFamily: "var(--sans)", fontWeight: 600 },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "40px 20px", color: "var(--muted)", textAlign: "center", fontSize: 13.5 },
  moreHint: { textAlign: "center", padding: 14, color: "var(--muted)", fontSize: 12 },

  itemRow: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "var(--card)", border: "1px solid var(--card-line)", borderRadius: 14, padding: "12px 14px 12px 16px", cursor: "pointer", textAlign: "left", position: "relative", overflow: "hidden", boxShadow: "0 4px 14px rgba(10,5,30,0.22)" },
  itemAccentBar: { position: "absolute", top: 0, left: 0, bottom: 0, width: 5 },
  itemMain: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 },
  itemTop: { display: "flex", alignItems: "baseline", gap: 6 },
  itemName: { fontSize: 14.5, fontWeight: 800, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  itemNum: { fontSize: 11, color: "var(--ink-soft)", fontFamily: "var(--sans)", fontWeight: 700, flexShrink: 0 },
  itemMeta: { display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 600, flexWrap: "wrap" },
  setTag: { fontFamily: "var(--sans)", fontWeight: 800, color: "var(--fire-deep)" },
  metaDot: { color: "var(--card-line)" },
  statusTag: { color: "var(--fire-deep)" },
  listedTag: { color: "var(--leaf-deep)", fontWeight: 800 },
  pendingTag: { color: "var(--flame, #d97706)", fontWeight: 800 },
  originTag: { display: "inline-flex", alignItems: "center", gap: 3, color: "var(--water-deep)" },
  itemRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, marginLeft: 10, flexShrink: 0 },
  itemQty: { fontFamily: "var(--display)", fontSize: 15, fontWeight: 700, color: "var(--ink)" },
  itemPrice: { fontFamily: "var(--sans)", fontSize: 12, fontWeight: 700, color: "var(--ink-soft)" },

  overlay: { position: "fixed", inset: 0, background: "rgba(10,5,30,0.65)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 },
  sheet: { width: "100%", maxWidth: 520, maxHeight: "88vh", overflowY: "auto", background: "linear-gradient(180deg, #241a4a, #1c1640)", borderTop: "1px solid var(--border)", borderRadius: "22px 22px 0 0", display: "flex", flexDirection: "column" },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, background: "var(--border)", margin: "10px auto 0" },
  sheetHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "14px 18px 4px" },
  sheetSetTag: { fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--accent)", marginBottom: 3 },
  sheetTitle: { fontSize: 19, fontWeight: 700, fontFamily: "var(--display)" },
  iconBtn: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 7, color: "var(--muted)", cursor: "pointer", display: "flex" },
  sheetBody: { padding: "10px 18px 4px" },

  originBadge: { display: "flex", alignItems: "center", gap: 7, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 9, padding: "9px 11px", fontSize: 12.5, marginBottom: 14, color: "var(--text)" },
  traceBox: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 16 },
  traceRow: { display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 },
  traceList: { marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 },
  traceItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--muted)" },
  traceMore: { fontSize: 11, color: "var(--muted)", textAlign: "center" },

  field: { marginBottom: 14 },
  fieldRow: { display: "flex", gap: 10 },
  fieldLabel: { display: "block", fontSize: 11.5, color: "var(--muted)", marginBottom: 6, fontFamily: "var(--mono)" },
  input: { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, padding: "10px 12px", color: "var(--text)", fontSize: 14.5, fontFamily: "var(--sans)" },
  selectWrap: { position: "relative" },
  select: { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, padding: "10px 30px 10px 12px", color: "var(--text)", fontSize: 14.5, fontFamily: "var(--sans)", appearance: "none" },
  selectChevron: { position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" },

  valueSummary: { display: "flex", gap: 10, marginTop: 6, marginBottom: 16 },
  valueSummaryLabel: { display: "block", fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" },
  valueSummaryNum: { display: "block", fontSize: 18, fontWeight: 600, fontFamily: "var(--mono)", marginTop: 2 },

  sheetActions: { display: "flex", gap: 10, padding: "14px 18px 22px", borderTop: "1px solid var(--border)" },
  deleteBtn: { padding: "12px 18px", background: "transparent", border: "1px solid var(--fire)", color: "#f7b8b3", borderRadius: 12, fontSize: 14, fontWeight: 700, fontFamily: "var(--sans)", cursor: "pointer" },
  saveBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "13px 18px", background: "linear-gradient(135deg, var(--gold), var(--fire))", border: "none", color: "#2a1200", borderRadius: 12, fontSize: 14.5, fontWeight: 800, fontFamily: "var(--sans)", cursor: "pointer" },

  sectionTitle: { fontSize: 24, fontWeight: 700, margin: "4px 0 4px", fontFamily: "var(--display)" },
  sectionSub: { fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.5 },
  primaryBtn: { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 22, padding: "14px", background: "linear-gradient(135deg, var(--gold), var(--fire))", border: "none", color: "#2a1200", borderRadius: 14, fontSize: 15, fontWeight: 800, fontFamily: "var(--sans)", cursor: "pointer", boxShadow: "0 8px 20px rgba(232,72,60,0.3)" },
  toggleBtn: { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, color: "var(--muted)", fontSize: 13, fontFamily: "var(--sans)", cursor: "pointer" },
  toggleBtnActive: { color: "var(--gold)", borderColor: "var(--gold)" },

  exportPreview: { marginTop: 20, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 },
  exportPreviewTop: { display: "flex", alignItems: "baseline", gap: 8 },
  exportCount: { fontSize: 30, fontWeight: 800, fontFamily: "var(--display)", color: "var(--gold)" },
  exportCountLabel: { fontSize: 12.5, color: "var(--muted)" },
  exportWarn: { fontSize: 12, color: "var(--neg)", marginTop: 6 },
  exportList: { marginTop: 12, display: "flex", flexDirection: "column", gap: 7, borderTop: "1px solid var(--border)", paddingTop: 12 },
  exportRow: { display: "flex", justifyContent: "space-between", fontSize: 12.5 },
  exportRowMeta: { color: "var(--muted)", fontFamily: "var(--mono)" },
  exportMore: { fontSize: 12, color: "var(--muted)", textAlign: "center", marginTop: 2 },

  subToggle: { display: "flex", gap: 8, marginTop: 18, marginBottom: 4 },
  subToggleBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--muted)", fontSize: 13.5, fontFamily: "var(--sans)", cursor: "pointer" },
  subToggleBtnActive: { color: "#2a1200", background: "linear-gradient(135deg, var(--gold), var(--fire))", borderColor: "var(--gold)", fontWeight: 700 },
  movStats: { display: "flex", gap: 8, marginTop: 16, marginBottom: 16 },
  movStat: { flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 6px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  movStatVal: { fontFamily: "var(--mono)", fontSize: 14.5, fontWeight: 600 },
  movStatLabel: { fontSize: 10, color: "var(--muted)", textAlign: "center" },
  movRow: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 13px", cursor: "pointer", textAlign: "left" },

  linkedItem: { display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)", border: "1px solid var(--accent)", borderRadius: 9, padding: "9px 11px", fontSize: 13.5 },
  cartList: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 },
  cartEmpty: { fontSize: 12.5, color: "var(--muted)", padding: "8px 2px" },
  cartLine: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, padding: "8px 10px" },
  cartLineMain: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  cartLineName: { fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cartLineMeta: { fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" },
  pickedBox: { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginTop: 8 },
  addLineBtn: { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4, padding: "9px", background: "var(--accent)", border: "none", color: "#14161A", borderRadius: 9, fontSize: 13, fontWeight: 600, fontFamily: "var(--sans)", cursor: "pointer" },
  unlinkBtn: { marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", display: "flex" },
  matchList: { marginTop: 6, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" },
  matchRow: { display: "flex", justifyContent: "space-between", width: "100%", padding: "9px 11px", background: "none", border: "none", borderBottom: "1px solid var(--border)", color: "var(--text)", fontSize: 13, cursor: "pointer", textAlign: "left" },

  summaryTop: { display: "flex", gap: 8, marginTop: 18, marginBottom: 22 },
  summaryTopCard: { flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 11, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 4 },
  summaryTopLabel: { fontSize: 10, color: "var(--muted)", lineHeight: 1.3 },
  summaryTopVal: { fontFamily: "var(--mono)", fontSize: 15, fontWeight: 600 },
  subheading: { fontSize: 17, fontWeight: 700, margin: "4px 0 2px", fontFamily: "var(--display)" },
  summaryRow: { marginBottom: 18 },
  summaryRowTop: { display: "flex", justifyContent: "space-between", marginBottom: 6 },
  summarySetName: { fontSize: 13.5, fontWeight: 500 },
  summaryValue: { fontSize: 13.5, fontFamily: "var(--mono)", color: "var(--accent)" },
  summaryBarTrack: { height: 5, background: "var(--surface)", borderRadius: 3, overflow: "hidden" },
  summaryBarFill: { height: "100%", background: "var(--accent)", borderRadius: 3 },
  summaryRowBottom: { display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--mono)" },

  bottomNav: { position: "fixed", bottom: 14, left: "50%", transform: "translateX(-50%)", width: "calc(100% - 28px)", maxWidth: 492, display: "flex", justifyContent: "space-around", alignItems: "center", background: "rgba(22,18,51,0.92)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 22, padding: "8px 6px calc(8px + env(safe-area-inset-bottom))", boxShadow: "0 12px 30px rgba(0,0,0,0.4)" },
  navBtn: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", padding: "4px 0", cursor: "pointer" },
  navFab: { width: 42, height: 42, borderRadius: "50%", marginTop: -22, background: "linear-gradient(135deg, var(--gold), var(--fire))", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 16px rgba(232,72,60,0.45)" },
  toast: { position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)", background: "rgba(36,26,74,0.96)", border: "1px solid rgba(255,255,255,0.15)", color: "var(--text)", padding: "10px 18px", borderRadius: 12, fontSize: 13, fontWeight: 600, zIndex: 60, fontFamily: "var(--sans)", boxShadow: "0 8px 20px rgba(0,0,0,0.35)" },
};
