import { useState, useEffect, useCallback } from 'react';

const KEYS = {
  products: 'ptr_products_v1',
  sales: 'ptr_sales_v1',
  fees: 'ptr_fees_v1',
  mappings: 'ptr_mappings_v1',
};

const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — ignore */
  }
};

// Central data store, persisted to localStorage. Every mutation auto-saves.
export function useStore() {
  const [products, setProducts] = useState(() => load(KEYS.products, []));
  const [sales, setSales] = useState(() => load(KEYS.sales, []));
  const [fees, setFees] = useState(() => load(KEYS.fees, []));
  const [mappings, setMappings] = useState(() => load(KEYS.mappings, {}));

  useEffect(() => save(KEYS.products, products), [products]);
  useEffect(() => save(KEYS.sales, sales), [sales]);
  useEffect(() => save(KEYS.fees, fees), [fees]);
  useEffect(() => save(KEYS.mappings, mappings), [mappings]);

  // --- Products (SKU cost master) ---
  const upsertProduct = useCallback((product) => {
    setProducts((prev) => {
      const key = String(product.sku).trim().toLowerCase();
      const idx = prev.findIndex((p) => String(p.sku).trim().toLowerCase() === key);
      if (idx === -1) return [...prev, product];
      const next = [...prev];
      next[idx] = { ...next[idx], ...product };
      return next;
    });
  }, []);

  const removeProduct = useCallback((sku) => {
    const key = String(sku).trim().toLowerCase();
    setProducts((prev) => prev.filter((p) => String(p.sku).trim().toLowerCase() !== key));
  }, []);

  // Merge products by SKU (used by CSV cost import). Returns count added/updated.
  const mergeProducts = useCallback((incoming) => {
    let added = 0;
    let updated = 0;
    setProducts((prev) => {
      const map = new Map(prev.map((p) => [String(p.sku).trim().toLowerCase(), p]));
      incoming.forEach((p) => {
        const key = String(p.sku).trim().toLowerCase();
        if (!key) return;
        if (map.has(key)) {
          map.set(key, { ...map.get(key), ...p });
          updated += 1;
        } else {
          map.set(key, p);
          added += 1;
        }
      });
      return [...map.values()];
    });
    return { added, updated };
  }, []);

  // --- Sales (dedupe by record id) ---
  const addSales = useCallback((records) => {
    let added = 0;
    setSales((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const fresh = records.filter((r) => !seen.has(r.id));
      added = fresh.length;
      return [...prev, ...fresh];
    });
    return added;
  }, []);

  // --- Fees (dedupe by document id) ---
  const addFees = useCallback((records) => {
    let added = 0;
    setFees((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const fresh = records.filter((r) => r.id && !seen.has(r.id));
      added = fresh.length;
      return [...prev, ...fresh];
    });
    return added;
  }, []);

  // Insert-or-replace fee records by id (used by settlement re-imports, so
  // re-uploading the same month's report overwrites rather than skips).
  const upsertFees = useCallback((records) => {
    setFees((prev) => {
      const ids = new Set(records.map((r) => r.id));
      const kept = prev.filter((r) => !ids.has(r.id));
      return [...kept, ...records];
    });
    return records.length;
  }, []);

  const clearAll = useCallback(() => {
    setProducts([]);
    setSales([]);
    setFees([]);
    setMappings({});
  }, []);

  const importAll = useCallback((snapshot) => {
    if (snapshot.products) setProducts(snapshot.products);
    if (snapshot.sales) setSales(snapshot.sales);
    if (snapshot.fees) setFees(snapshot.fees);
    if (snapshot.mappings) setMappings(snapshot.mappings);
  }, []);

  return {
    products, sales, fees, mappings,
    setProducts, setSales, setFees, setMappings,
    upsertProduct, removeProduct, mergeProducts,
    addSales, addFees, upsertFees, clearAll, importAll,
  };
}
