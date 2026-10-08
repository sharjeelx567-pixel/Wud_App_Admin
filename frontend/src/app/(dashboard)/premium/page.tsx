"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, DollarSign, TrendingUp, CreditCard, RotateCcw } from "lucide-react";
import StatCard from "../../../components/dashboard/StatCard";
import api from "../../../services/api";

interface Transaction {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  amount: number;
  paymentMethod?: string;
  planId?: string;
  type?: string;
  status: "completed" | "refunded" | "failed" | string;
  isRenewal?: boolean;
  // Development/test payments (written by the app's Test Payment method).
  // Shown in the ledger with a TEST badge but excluded from real revenue.
  isTestPayment?: boolean;
  timestamp?: { _seconds: number; _nanoseconds: number } | string;
}

interface SubscriptionMetrics {
  activePremiumCount: number;
  monthlyRevenue: number;
}

function formatDate(raw: Transaction["timestamp"]) {
  if (!raw) return "—";
  const ms = typeof raw === "object" && "_seconds" in raw ? raw._seconds * 1000 : raw;
  const d = new Date(ms as any);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function getStatusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "completed") {
    return (
      <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-bold uppercase">
        Completed
      </span>
    );
  }
  if (s === "refunded") {
    return (
      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-full text-[10px] font-bold uppercase">
        Refunded
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-full text-[10px] font-bold uppercase">
      {status || "Unknown"}
    </span>
  );
}

export default function PremiumPage() {
  const queryClient = useQueryClient();
  const [refundReason, setRefundReason] = useState<Record<string, string>>({});

  const { data: metrics, isLoading: metricsLoading } = useQuery<{ data: SubscriptionMetrics }>({
    queryKey: ["subscription-metrics"],
    queryFn: () => api.get("/payments/subscriptions").then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: txData, isLoading: txLoading } = useQuery<{ data: Transaction[] }>({
    queryKey: ["transactions"],
    queryFn: () => api.get("/payments/transactions?limit=100").then((r) => r.data),
    refetchInterval: 20000,
  });
  const transactions = txData?.data || [];

  const totalRevenue = transactions
    .filter((t) => t.status === "completed" && !t.isTestPayment)
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const refundMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/payments/${id}/refund`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["subscription-metrics"] });
    },
    onError: (error: any) => {
      alert(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          `Failed to refund transaction (${error?.response?.status || "network error"}).`
      );
    },
  });

  const handleRefund = (tx: Transaction) => {
    const reason = refundReason[tx.id] || "";
    if (!confirm(`Refund PKR ${tx.amount.toLocaleString()} to ${tx.userName || tx.userId}? This also removes their premium status.`)) {
      return;
    }
    refundMutation.mutate({ id: tx.id, reason: reason || "Admin requested" });
  };

  return (
    <div className="space-y-6">
      {/* 1. Revenue Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard
          title="Total Completed Revenue"
          value={metricsLoading || txLoading ? "..." : `PKR ${totalRevenue.toLocaleString()}`}
          icon={DollarSign}
          description="Sum of all completed transactions"
          colorTheme="success"
        />
        <StatCard
          title="Active Premium Subscribers"
          value={metricsLoading ? "..." : (metrics?.data?.activePremiumCount ?? 0).toLocaleString()}
          icon={Sparkles}
          description="Users with isPremium currently true"
          colorTheme="accent"
        />
        <StatCard
          title="Revenue (Last 30 Days)"
          value={metricsLoading ? "..." : `PKR ${Math.round(metrics?.data?.monthlyRevenue ?? 0).toLocaleString()}`}
          icon={TrendingUp}
          description="Completed transactions in the trailing 30 days"
          colorTheme="primary"
        />
      </div>

      {/* 2. Transactions Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="flex justify-between items-center p-6 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-indigo-600" />
              Transaction Ledger
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Every subscription payment recorded in Firestore</p>
          </div>
          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px] rounded-full uppercase tracking-wider">
            Auto-refreshing
          </span>
        </div>

        {txLoading ? (
          <div className="p-8 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 bg-slate-50 rounded-xl shimmer" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <CreditCard className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <p className="text-xs font-semibold">No transactions recorded yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-100">
                <tr>
                  <th className="px-6 py-3.5">User</th>
                  <th className="px-6 py-3.5">Plan</th>
                  <th className="px-6 py-3.5">Amount</th>
                  <th className="px-6 py-3.5">Method</th>
                  <th className="px-6 py-3.5">Date</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-bold text-slate-900">{tx.userName || "Unknown"}</p>
                      <p className="text-[11px] text-slate-400">{tx.userEmail || tx.userId}</p>
                    </td>
                    <td className="px-6 py-4 capitalize">{tx.planId || "—"}</td>
                    <td className="px-6 py-4 font-bold text-slate-900">PKR {(tx.amount || 0).toLocaleString()}</td>
                    <td className="px-6 py-4 capitalize text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <span>{tx.paymentMethod || "—"}</span>
                        {tx.isTestPayment && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded text-[9px] font-bold uppercase tracking-wide not-italic">
                            Test
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500 font-mono text-[11px]">{formatDate(tx.timestamp)}</td>
                    <td className="px-6 py-4">{getStatusBadge(tx.status)}</td>
                    <td className="px-6 py-4 text-right">
                      {tx.status === "completed" ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            type="text"
                            placeholder="Reason (optional)"
                            value={refundReason[tx.id] || ""}
                            onChange={(e) => setRefundReason((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                            className="w-32 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[11px] outline-none focus:border-indigo-500"
                          />
                          <button
                            onClick={() => handleRefund(tx)}
                            disabled={refundMutation.isPending}
                            className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Refund
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-300 text-[11px]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
