import React, { useState, useMemo } from 'react';
import { Package, Plus, Trash2, Upload, AlertTriangle, Search, Download } from 'lucide-react';
import { SectionCard, Button, EmptyState, Banner, Badge } from '../components/ui.jsx';
import { formatCurrency, parseMoney } from '../lib/format.js';

export default function ProductsView({ store, recon }) {
  const { products, upsertProduct, removeProduct, mergeProducts } = store;
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState({ sku: '', name: '', unitCost: '', category: '' });
  const [importMsg, setImportMsg] = useState('');

  const unmatched = new Set(recon.unmatchedSkus.map((s) => String(s).trim().toLowerCase()));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? products.filter(
          (p) =>
            String(p.sku).toLowerCase().includes(q) ||
            String(p.name || '').toLowerCase().includes(q)
        )
      : products;
    return [...list].sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
  }, [products, query]);

  const addDraft = () => {
    const sku = draft.sku.trim();
    if (!sku) return;
    upsertProduct({
      sku,
      name: draft.name.trim(),
      unitCost: parseMoney(draft.unitCost),
      category: draft.category.trim(),
    });
    setDraft({ sku: '', name: '', unitCost: '', category: '' });
  };

  // Import costs from CSV: columns sku,name,cost/unitCost,category (order-independent by header).
  const importCsv = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportMsg('');
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const pick = (row, names) => {
        const key = Object.keys(row).find((k) =>
          names.some((n) => k.trim().toLowerCase().includes(n))
        );
        return key ? row[key] : '';
      };
      const incoming = rows
        .map((r) => ({
          sku: String(pick(r, ['sku', 'รหัส'])).trim(),
          name: String(pick(r, ['name', 'ชื่อ'])).trim(),
          unitCost: parseMoney(pick(r, ['unitcost', 'unit cost', 'cost', 'ต้นทุน', 'ทุน'])),
          category: String(pick(r, ['category', 'หมวด'])).trim(),
        }))
        .filter((p) => p.sku);
      if (!incoming.length) {
        setImportMsg('ไม่พบคอลัมน์ SKU ในไฟล์');
        return;
      }
      const { added, updated } = mergeProducts(incoming);
      setImportMsg(`นำเข้าสำเร็จ: เพิ่ม ${added} · อัปเดต ${updated} รายการ`);
    } catch (err) {
      setImportMsg(`เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  };

  const exportCsv = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(
      products.map((p) => ({ sku: p.sku, name: p.name, unitCost: p.unitCost, category: p.category || '' }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'products');
    XLSX.writeFile(wb, 'products-cost.csv');
  };

  const missingCount = products.filter((p) => !p.unitCost).length;

  return (
    <div className="space-y-6">
      {unmatched.size > 0 && (
        <Banner tone="warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            มี <b>{unmatched.size} SKU</b> จากยอดขายที่ยังไม่มีในทะเบียนสินค้า:{' '}
            {recon.unmatchedSkus.slice(0, 8).map((s) => (
              <code key={s} className="bg-amber-100 px-1.5 py-0.5 rounded mx-0.5 text-xs">{s}</code>
            ))}
            {recon.unmatchedSkus.length > 8 && ` …และอีก ${recon.unmatchedSkus.length - 8}`}
          </span>
        </Banner>
      )}

      {/* Add / import */}
      <SectionCard
        title="เพิ่มสินค้า / ตั้งต้นทุน"
        icon={Package}
        action={
          <div className="flex gap-2">
            <label>
              <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={importCsv} />
              <span className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer font-medium">
                <Upload size={14} /> นำเข้าต้นทุน (CSV)
              </span>
            </label>
            <Button variant="secondary" size="sm" icon={Download} onClick={exportCsv} disabled={!products.length}>
              ส่งออก
            </Button>
          </div>
        }
      >
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <input value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} placeholder="SKU *" className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="ชื่อสินค้า" className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            <input value={draft.unitCost} onChange={(e) => setDraft({ ...draft, unitCost: e.target.value })} placeholder="ต้นทุน/หน่วย" inputMode="decimal" className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-right focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="หมวดหมู่" className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            <Button icon={Plus} onClick={addDraft} disabled={!draft.sku.trim()}>เพิ่ม/บันทึก</Button>
          </div>
          {importMsg && <p className="text-xs text-slate-500 mt-3">{importMsg}</p>}
          <p className="text-xs text-slate-400 mt-2">
            รูปแบบ CSV: มีคอลัมน์ <code>sku</code>, <code>name</code>, <code>unitCost</code> (หรือ <code>cost</code>/<code>ต้นทุน</code>), <code>category</code>
          </p>
        </div>
      </SectionCard>

      {/* Product table */}
      <SectionCard
        title={`ทะเบียนสินค้า (${products.length})`}
        icon={Package}
        action={
          <div className="flex items-center gap-2">
            {missingCount > 0 && <Badge color="amber">{missingCount} ยังไม่ตั้งต้นทุน</Badge>}
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหา SKU/ชื่อ" className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:outline-none" />
            </div>
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState icon={Package} title="ยังไม่มีสินค้า" hint="เพิ่มด้านบน หรือ นำเข้าต้นทุนจาก CSV" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-5 py-3">SKU</th>
                  <th className="px-5 py-3">ชื่อสินค้า</th>
                  <th className="px-5 py-3">หมวดหมู่</th>
                  <th className="px-5 py-3 text-right">ต้นทุน/หน่วย</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const isUnmatched = unmatched.has(String(p.sku).trim().toLowerCase());
                  return (
                    <tr key={p.sku} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono text-xs text-slate-700">
                        {p.sku} {isUnmatched && <Badge color="amber">ขายแต่ไม่มีต้นทุน</Badge>}
                      </td>
                      <td className="px-5 py-3 text-slate-700">{p.name || '-'}</td>
                      <td className="px-5 py-3 text-slate-500">{p.category || '-'}</td>
                      <td className="px-5 py-3 text-right">
                        <input
                          type="number"
                          value={p.unitCost || ''}
                          onChange={(e) => upsertProduct({ ...p, unitCost: parseMoney(e.target.value) })}
                          placeholder="0.00"
                          className={`w-28 text-right px-2 py-1 rounded-lg border focus:ring-2 focus:ring-blue-200 focus:outline-none ${p.unitCost ? 'border-slate-200' : 'border-amber-300 bg-amber-50'}`}
                        />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button onClick={() => removeProduct(p.sku)} className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50">
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
