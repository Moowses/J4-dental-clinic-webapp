"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import ReportShell from "./ReportShell";

import { getInventoryReport } from "@/app/actions/inventory-actions";

type InventoryRow = {
  id: string;
  name: string;
  itemCode?: string;
  category?: string;
  tag?: string;
  qtyOnHand: number;
  reorderLevel?: number;
  unit?: string;
  costPerUnit?: number;
  expirationDate?: string;
  updatedAt?: string;
};

type InventoryReportResponse = {
  rows: InventoryRow[];
  summary: {
    totalItems: number;
    lowStockCount: number;
    outOfStockCount: number;
  };
};

export default function InventoryReportPanel() {
  const [data, setData] = useState<InventoryReportResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onPrint() {
    window.open("/admin-dashboard/reports/print?type=inventory", "_blank", "noopener,noreferrer");
  }

  useEffect(() => {
    let cancelled = false;
    setErr(null);

    startTransition(async () => {
      try {
        const res = (await getInventoryReport()) as InventoryReportResponse;
        if (!cancelled) setData(res);
      } catch (e: any) {
        console.error("InventoryReportPanel load error:", e);
        if (!cancelled) setErr(e?.message ?? "Failed to load inventory report.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <ReportShell
        reportName="Inventory Report"
        subtitle="Current stock overview"
        empty={{ title: "Error loading report", description: err }}
      >
        <div />
      </ReportShell>
    );
  }

  const empty =
    !data || data.rows.length === 0
      ? {
          title: !data || pending ? "Loading report..." : "No inventory items found",
          description:
            pending || !data ? "Loading the default inventory report..." : "Add items to inventory to generate this report.",
        }
      : undefined;

  const reorderRecommendations = useMemo(() => {
    if (!data?.rows?.length) return [];
    return data.rows
      .map((r) => {
        const min = typeof r.reorderLevel === "number" ? r.reorderLevel : 0;
        const current = Number(r.qtyOnHand || 0);
        const needsReorder = min > 0 && current <= min;
        const suggestedQty = needsReorder ? Math.max(0, min * 2 - current) : 0;
        const estimatedCost =
          typeof r.costPerUnit === "number" && Number.isFinite(r.costPerUnit)
            ? suggestedQty * r.costPerUnit
            : null;
        return { ...r, min, current, needsReorder, suggestedQty, estimatedCost };
      })
      .filter((r) => r.needsReorder)
      .sort((a, b) => a.current - b.current || a.min - b.min)
      .slice(0, 12);
  }, [data]);

  const reorderSummary = useMemo(() => {
    const totalSuggestedUnits = reorderRecommendations.reduce((sum, r) => sum + r.suggestedQty, 0);
    const totalEstimatedCost = reorderRecommendations.reduce(
      (sum, r) => sum + (typeof r.estimatedCost === "number" ? r.estimatedCost : 0),
      0
    );
    return { totalSuggestedUnits, totalEstimatedCost };
  }, [reorderRecommendations]);

  return (
    <ReportShell reportName="Inventory Report" subtitle="Current stock overview" empty={empty}>
      {!data ? null : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={onPrint}
              className="rounded-full px-4 py-2 text-sm font-extrabold bg-slate-900 text-white hover:bg-slate-800"
            >
              Print
            </button>
          </div>
          {pending ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Generating report...
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Summary label="Total Items" value={data.summary.totalItems} />
            <Summary label="Low Stock" value={data.summary.lowStockCount} />
            <Summary label="Out of Stock" value={data.summary.outOfStockCount} />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Summary label="Reorder Items" value={reorderRecommendations.length} />
            <Summary label="Suggested Units" value={reorderSummary.totalSuggestedUnits} />
            <Summary
              label="Est. Reorder Cost"
              value={reorderSummary.totalEstimatedCost.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            />
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Inventory usage trend is not available yet because stock adjustments are not stored as movement history.
            This report currently provides reorder recommendations from current stock vs threshold.
          </div>

          {reorderRecommendations.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-extrabold text-slate-900">Reorder Recommendations</p>
              <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-slate-600">
                      <th className="px-4 py-3 font-bold">Item</th>
                      <th className="px-4 py-3 font-bold">Current</th>
                      <th className="px-4 py-3 font-bold">Min Threshold</th>
                      <th className="px-4 py-3 font-bold">Suggested Order</th>
                      <th className="px-4 py-3 font-bold">Unit</th>
                      <th className="px-4 py-3 font-bold">Est. Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reorderRecommendations.map((r) => (
                      <tr key={`${r.id}-reorder`} className="border-t border-slate-200">
                        <td className="px-4 py-3 font-semibold text-slate-900">{r.name}</td>
                        <td className="px-4 py-3 text-slate-700">{r.current}</td>
                        <td className="px-4 py-3 text-slate-700">{r.min}</td>
                        <td className="px-4 py-3 text-slate-700">{r.suggestedQty}</td>
                        <td className="px-4 py-3 text-slate-700">{r.unit ?? "--"}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {typeof r.estimatedCost === "number"
                            ? r.estimatedCost.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                            : "--"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-slate-600">
                  <th className="px-4 py-3 font-bold">Item ID</th>
                  <th className="px-4 py-3 font-bold">Item Name</th>
                  <th className="px-4 py-3 font-bold">Category</th>
                  <th className="px-4 py-3 font-bold">Stock Qty</th>
                  <th className="px-4 py-3 font-bold">Unit</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 font-bold">Expiry Date</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const low =
                    typeof r.reorderLevel === "number" && r.qtyOnHand <= r.reorderLevel;
                  const oos = r.qtyOnHand <= 0;
                  const status = oos ? "Out of stock" : low ? "Low stock" : "In stock";

                  return (
                    <tr key={r.id} className="border-t border-slate-200">
                      <td className="px-4 py-3 font-semibold text-slate-900">{r.itemCode ?? "--"}</td>
                      <td className="px-4 py-3 text-slate-700">{r.name}</td>
                      <td className="px-4 py-3 text-slate-700">{r.category ?? "--"}</td>
                      <td className="px-4 py-3 text-slate-700">{r.qtyOnHand}</td>
                      <td className="px-4 py-3 text-slate-700">{r.unit ?? "--"}</td>
                      <td className="px-4 py-3 text-slate-700">
                        <span
                          className={[
                            "inline-flex items-center rounded-full px-2 py-1 text-xs font-bold",
                            oos
                              ? "bg-rose-50 text-rose-700"
                              : low
                              ? "bg-amber-50 text-amber-700"
                              : "bg-emerald-50 text-emerald-700",
                          ].join(" ")}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{r.expirationDate ?? "--"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ReportShell>
  );
}

function Summary({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-extrabold text-slate-900">{value}</p>
    </div>
  );
}
