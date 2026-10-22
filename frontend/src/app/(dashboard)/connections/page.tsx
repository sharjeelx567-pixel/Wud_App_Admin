"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../../../services/api";
import {
  HeartHandshake,
  Users,
  Sparkles,
  UserX,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  BarChart2
} from "lucide-react";

// Firestore Timestamps serialize over the API as {_seconds, _nanoseconds},
// not an ISO string — new Date(raw) on that shape silently produces
// "Invalid Date" instead of a real value.
function formatFirestoreDate(raw: any, fallback: string = "Recent") {
  if (!raw) return fallback;
  const ms = typeof raw === "object" && "_seconds" in raw ? raw._seconds * 1000 : raw;
  const date = new Date(ms);
  return isNaN(date.getTime()) ? fallback : date.toLocaleDateString();
}

export default function ConnectionsPage() {
  const [activeTab, setActiveTab] = useState<"requests" | "matches" | "compatibility" | "dormant">("requests");

  // Fetch Connection Requests (interests + connection requests, merged)
  const { data: requestsData, isLoading: isLoadingReqs } = useQuery({
    queryKey: ["admin-connection-requests"],
    queryFn: async () => {
      const res = await api.get("/matching/connections");
      return res.data?.data || [];
    },
    enabled: activeTab === "requests",
    refetchInterval: 30000,
  });

  // Fetch Mutual Matches
  const { data: matchesData, isLoading: isLoadingMatches } = useQuery({
    queryKey: ["admin-mutual-matches"],
    queryFn: async () => {
      const res = await api.get("/matching/matches");
      return res.data?.data || [];
    },
    enabled: activeTab === "matches",
    refetchInterval: 30000,
  });
  const mutualMatches = Array.isArray(matchesData) ? matchesData : [];

  // Fetch Compatibility Stats
  const { data: compatData, isLoading: isLoadingCompat } = useQuery({
    queryKey: ["admin-compatibility-stats"],
    queryFn: async () => {
      const res = await api.get("/matching/compatibility");
      return res.data?.data;
    },
    enabled: activeTab === "compatibility",
    refetchInterval: 30000,
  });

  // Fetch Dormant Profiles
  const { data: dormantData, isLoading: isLoadingDormant } = useQuery({
    queryKey: ["admin-dormant-profiles"],
    queryFn: async () => {
      const res = await api.get("/matching/dormant-profiles");
      return res.data?.data || [];
    },
    enabled: activeTab === "dormant",
    refetchInterval: 30000,
  });

  const connectionRequests = Array.isArray(requestsData) ? requestsData : [];
  const dormantProfiles = Array.isArray(dormantData) ? dormantData : [];

  const getStatusPill = (status: string) => {
    const s = (status || "pending").toLowerCase();
    if (s === "accepted") {
      return (
        <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-bold uppercase inline-flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> Accepted
        </span>
      );
    }
    if (s === "rejected" || s === "declined") {
      return (
        <span className="px-2.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-full text-[10px] font-bold uppercase inline-flex items-center gap-1">
          <XCircle className="w-3 h-3" /> Rejected
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-[10px] font-bold uppercase inline-flex items-center gap-1">
        <Clock className="w-3 h-3" /> Pending
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 border border-slate-200/80 rounded-2xl shadow-xs">
        <div>
          <h2 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
            <HeartHandshake className="w-4 h-4 text-indigo-600" />
            Candidate Connection & Match Intelligence
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Monitor seeker connection requests, compatibility metrics, and dormant profile states.
          </p>
        </div>
      </div>

      {/* 2. Tabs Switcher */}
      <div className="flex gap-2 p-1.5 bg-slate-100/90 rounded-2xl w-fit border border-slate-200/80">
        {[
          { id: "requests" as const, name: "Interests & Requests", icon: HeartHandshake },
          { id: "matches" as const, name: "Mutual Matches", icon: Sparkles },
          { id: "compatibility" as const, name: "Compatibility Distribution", icon: BarChart2 },
          { id: "dormant" as const, name: "Dormant Profiles (>90d)", icon: UserX },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === tab.id
                ? "bg-white text-indigo-600 shadow-xs"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.name}
          </button>
        ))}
      </div>

      {/* 3. Tab Contents */}
      {activeTab === "requests" && (
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Requester Candidate</th>
                  <th className="py-3 px-4">Direction</th>
                  <th className="py-3 px-4">Recipient Candidate</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Initiated Date</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {isLoadingReqs ? (
                  [...Array(4)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={6} className="py-4 px-4">
                        <div className="h-6 bg-slate-100 rounded-lg" />
                      </td>
                    </tr>
                  ))
                ) : connectionRequests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      No interests or connection requests recorded yet.
                    </td>
                  </tr>
                ) : (
                  connectionRequests.map((req: any) => (
                    <tr key={req.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {req.senderName || req.senderId || "Candidate A"}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        <ArrowRight className="w-4 h-4" />
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {req.recipientName || req.recipientId || "Candidate B"}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                            req.kind === "Connection"
                              ? "bg-violet-50 text-violet-700 border-violet-200"
                              : "bg-indigo-50 text-indigo-700 border-indigo-200"
                          }`}
                        >
                          {req.kind || "Interest"}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 font-mono text-[11px]">
                        {formatFirestoreDate(req.createdAt)}
                      </td>
                      <td className="py-3.5 px-4 text-right">{getStatusPill(req.status)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "matches" && (
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Candidate A</th>
                  <th className="py-3 px-4 text-center">Matched</th>
                  <th className="py-3 px-4">Candidate B</th>
                  <th className="py-3 px-4 text-right">Matched Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {isLoadingMatches ? (
                  [...Array(4)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={4} className="py-4 px-4">
                        <div className="h-6 bg-slate-100 rounded-lg" />
                      </td>
                    </tr>
                  ))
                ) : mutualMatches.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-400">
                      No mutual matches recorded yet.
                    </td>
                  </tr>
                ) : (
                  mutualMatches.map((m: any) => (
                    <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {m.userAName || m.userA || "Candidate A"}
                      </td>
                      <td className="py-3.5 px-4 text-center text-rose-500">
                        <HeartHandshake className="w-4 h-4 inline" />
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {m.userBName || m.userB || "Candidate B"}
                      </td>
                      <td className="py-3.5 px-4 text-right text-slate-500 font-mono text-[11px]">
                        {formatFirestoreDate(m.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "compatibility" && (
        isLoadingCompat ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="h-40 bg-white rounded-2xl border border-slate-200/80 shimmer" />
            <div className="md:col-span-2 h-40 bg-white rounded-2xl border border-slate-200/80 shimmer" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs flex flex-col justify-center items-center text-center space-y-2">
              <TrendingUp className="w-8 h-8 text-indigo-600" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Average Compatibility Score
              </span>
              <span className="text-4xl font-extrabold text-slate-900 font-display">
                {compatData?.averageScore ?? "—"}
                {compatData?.averageScore != null ? "%" : ""}
              </span>
              <span className="text-xs text-slate-400">
                Across {compatData?.completedAssessments || 0} completed candidate surveys
              </span>
            </div>

            <div className="md:col-span-2 bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-slate-900 font-display">
                Compatibility Score Distribution Ranges
              </h3>
              {!compatData?.distribution || Object.values(compatData.distribution).every((c: any) => c === 0) ? (
                <p className="text-xs text-slate-400 py-6 text-center">
                  No scored matches recorded yet — this fills in once matching_scores documents exist.
                </p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(compatData.distribution).map(([range, count]: [string, any]) => (
                    <div key={range} className="space-y-1">
                      <div className="flex justify-between text-xs font-medium">
                        <span className="text-slate-700">{range}</span>
                        <span className="text-slate-500 font-bold">{count} matches</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-600 rounded-full"
                          style={{ width: `${Math.min(100, (count / 50) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      )}

      {activeTab === "dormant" && (
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Dormant Candidate</th>
                  <th className="py-3 px-4">Contact Email</th>
                  <th className="py-3 px-4">Last Activity</th>
                  <th className="py-3 px-4">Tier</th>
                  <th className="py-3 px-4 text-right">Visibility State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {isLoadingDormant ? (
                  [...Array(3)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={5} className="py-4 px-4">
                        <div className="h-6 bg-slate-100 rounded-lg" />
                      </td>
                    </tr>
                  ))
                ) : dormantProfiles.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      Zero dormant candidate profiles (&gt;90 days inactive). Platform activity is healthy.
                    </td>
                  </tr>
                ) : (
                  dormantProfiles.map((p: any) => (
                    <tr key={p.uid} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">{p.displayName || "Candidate"}</td>
                      <td className="py-3.5 px-4 text-slate-500">{p.email || "—"}</td>
                      <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">
                        {formatFirestoreDate(p.lastActiveAt, "> 90 days ago")}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10px] font-bold">
                          {p.isPremium ? "PREMIUM" : "FREE"}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 rounded-full text-[10px] font-bold uppercase">
                          Hidden from Feed
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

