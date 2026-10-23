"use client";

import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import api from "../../services/api";
import { useAuthStore } from "../../store/authStore";
import { DashboardStats, AuditLog, NikkahUser } from "../../types";
import StatCard from "../../components/dashboard/StatCard";
import GrowthChart from "../../components/dashboard/GrowthChart";
import ActivityFeed from "../../components/dashboard/ActivityFeed";
import UserAvatar from "../../components/common/UserAvatar";
import { APP_NAME } from "../../config/branding";
import {
  Users,
  Image as ImageIcon,
  TrendingUp,
  Activity,
  DollarSign,
  ShieldCheck,
  Radio,
  Send,
  ArrowRight,
  Sparkles,
  AlertTriangle,
  LifeBuoy
} from "lucide-react";

export default function DashboardPage() {
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");

  // Every widget below needs a specific permission its backend endpoint
  // actually requires. Without this, a role lacking e.g. analytics.view
  // would fire the query anyway, get a 403, and (depending on
  // TanStack Query's retry timing) sit showing "..." for anywhere from a
  // few seconds to what looks like forever — not because anything is
  // broken, but because the widget can never succeed for that role.
  // Gating on `enabled` stops the doomed request before it starts, and the
  // JSX below hides the section entirely instead of showing a stuck loader.
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const admin = useAuthStore((s) => s.admin);
  const firstName = admin?.displayName?.trim()?.split(/\s+/)[0] || "Admin";
  const canViewAnalytics = hasPermission("analytics.view");
  const canViewUsers = hasPermission("users.view");
  const canViewAuditLogs = hasPermission("audit_logs.view");
  const canSendNotifications = hasPermission("notifications.send");
  const hasAnyDashboardWidget = canViewAnalytics || canViewUsers || canViewAuditLogs || canSendNotifications;

  // Fetch Dashboard Stats
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      try {
        const response = await api.get("/analytics/stats");
        return response.data.data;
      } catch {
        const fallback = await api.get("/analytics/dashboard");
        return fallback.data.data;
      }
    },
    enabled: canViewAnalytics,
    refetchInterval: 15000,
  });

  // Fetch User Growth Chart Data
  const { data: growthData, isLoading: growthLoading } = useQuery({
    queryKey: ["dashboard-growth"],
    queryFn: async () => {
      const response = await api.get("/analytics/growth");
      return response.data.data;
    },
    enabled: canViewAnalytics,
  });

  // Fetch Recent Staff Activity (the "Staff Activity Log" panel reads
  // stats?.recentActivity, but getDashboardStats never returns that field —
  // it has its own endpoint, /analytics/activity, that was simply never called)
  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: async () => {
      const response = await api.get("/analytics/activity");
      return response.data.data;
    },
    enabled: canViewAuditLogs,
    refetchInterval: 20000,
  });

  // Fetch recent users for Recent Signups list
  const { data: recentUsersData, isLoading: usersLoading } = useQuery<{ data: { data: NikkahUser[] } }>({
    queryKey: ["recent-signups-dashboard"],
    queryFn: async () => {
      const response = await api.get("/users", { params: { limit: 6, sortBy: "createdAt" } });
      return response.data;
    },
    enabled: canViewUsers,
  });

  const recentUsers = recentUsersData?.data?.data || [];

  // Broadcast Notification Mutation
  const broadcastMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await api.post("/notifications/send", payload);
      return res.data;
    },
    onSuccess: (data: any) => {
      setBroadcastTitle("");
      setBroadcastBody("");
      const total = data?.data?.totalTargets ?? data?.data?.successCount ?? "";
      setBroadcastMessage(total ? `Announcement dispatched successfully to ${total} user(s)!` : "Announcement dispatched successfully!");
      setTimeout(() => setBroadcastMessage(""), 5000);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error || err.message || "Failed to dispatch notification";
      setBroadcastMessage(`Error: ${msg}`);
      setTimeout(() => setBroadcastMessage(""), 5000);
    },
  });

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle || !broadcastBody) return;
    broadcastMutation.mutate({
      title: broadcastTitle,
      body: broadcastBody,
      audience: "all",
      target: "all",
    });
  };

  const formatDate = (raw: any) => {
    if (!raw) return "";
    let d: Date;
    if (raw._seconds) d = new Date(raw._seconds * 1000);
    else if (typeof raw === "string" || typeof raw === "number") d = new Date(raw);
    else return "";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  if (!hasAnyDashboardWidget) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-24 px-6">
        <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
          <Sparkles className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold font-display text-slate-900">Welcome back</h2>
        <p className="text-xs text-slate-400 mt-1.5 max-w-xs">
          Your role doesn&apos;t have a dashboard overview to show — use the sidebar to go straight to the areas you can work in.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* 0. Elegant wedding hero banner */}
      <div
        className="relative overflow-hidden rounded-3xl border border-slate-200/70 shadow-sm min-h-[190px] sm:min-h-[230px] flex items-center bg-cover bg-center"
        style={{ backgroundImage: "url('/wedding-hero.jpg')" }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-[#2b0c16]/95 via-[#2b0c16]/72 to-[#2b0c16]/20" />
        <div className="relative z-10 p-8 sm:p-12 text-white">
          <div className="flex items-center gap-3 mb-3.5">
            <span className="h-px w-10 bg-[#D4AF37]" />
            <p className="text-[#EBCB72] text-xs font-bold uppercase tracking-[0.2em]">
              {APP_NAME} · Admin Console
            </p>
          </div>
          <h1 className="font-serif text-4xl sm:text-5xl font-semibold leading-[1.1] max-w-2xl">
            Welcome back, <span className="italic text-[#F3D573]">{firstName}</span>
          </h1>
          <p className="text-white/80 text-base mt-3 max-w-lg">
            Guiding meaningful nikahs today — profiles, matches, verifications and platform
            health, all at a glance.
          </p>
        </div>
      </div>

      {/* 1. Stat Cards Metric Grid */}
      {canViewAnalytics && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          title="Total Registered Seekers"
          value={statsLoading ? "..." : (stats?.totalUsers ?? 0)}
          icon={Users}
          trend={{ value: "+14.2%", type: "up" }}
          description="vs last month"
          colorTheme="primary"
        />
        <StatCard
          title="Pending Photo Moderation"
          value={statsLoading ? "..." : (stats?.pendingPhotos ?? 0)}
          icon={ImageIcon}
          description="Requires admin audit"
          colorTheme="warning"
        />
        <StatCard
          title="Identity Verifications"
          value={statsLoading ? "..." : (stats?.pendingVerifications ?? 0)}
          icon={ShieldCheck}
          description="Pending KYC review"
          colorTheme="secondary"
        />
        <StatCard
          title="Revenue Generated"
          value={`PKR ${(stats?.totalRevenue ?? 0).toLocaleString()}`}
          icon={DollarSign}
          trend={{ value: "+18.5%", type: "up" }}
          description="Platform earnings"
          colorTheme="success"
        />
      </div>
      )}

      {/* 2. Charts & Broadcast Grid */}
      {(canViewAnalytics || canSendNotifications) && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Growth Chart (2 columns, or full width if Broadcast is hidden) */}
        {canViewAnalytics && (
        <div className={`${canSendNotifications ? "lg:col-span-2" : "lg:col-span-3"} bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs flex flex-col justify-between`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-indigo-600" />
                User Acquisition Growth
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Daily new seeker profile registrations
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg self-start sm:self-auto">
              Real-time Analytics
            </span>
          </div>

          <GrowthChart data={growthData} />
        </div>
        )}

        {/* Global Broadcast Card (1 column, or full width if Growth Chart is hidden) */}
        {canSendNotifications && (
        <div className={`${canViewAnalytics ? "" : "lg:col-span-3"} bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs flex flex-col justify-between`}>
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h2 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
                <Radio className="w-4 h-4 text-rose-500 animate-pulse" />
                Push Broadcast
              </h2>
              <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
                All Users
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-3 mb-4">
              Dispatch an immediate push notification to all active seeker devices.
            </p>

            <form onSubmit={handleBroadcast} className="space-y-3">
              <div>
                <input
                  type="text"
                  placeholder="Notification Title..."
                  value={broadcastTitle}
                  onChange={(e) => setBroadcastTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 placeholder:text-slate-400 font-medium"
                />
              </div>
              <div>
                <textarea
                  rows={3}
                  placeholder="Notification message body..."
                  value={broadcastBody}
                  onChange={(e) => setBroadcastBody(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 placeholder:text-slate-400 resize-none font-medium"
                />
              </div>

              {broadcastMessage && (
                <p className="text-xs font-semibold text-emerald-600 bg-emerald-50 p-2 rounded-xl border border-emerald-100">
                  {broadcastMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={!broadcastTitle || !broadcastBody || broadcastMutation.isPending}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {broadcastMutation.isPending ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    Dispatch Announcement
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
        )}
      </div>
      )}

      {/* 3. Recent Signups Table & System Activity Feed */}
      {(canViewUsers || canViewAuditLogs) && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Registrations (2 columns, or full width if Activity Log is hidden) */}
        {canViewUsers && (
        <div className={`${canViewAuditLogs ? "lg:col-span-2" : "lg:col-span-3"} bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden`}>
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                Recent Seeker Registrations
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Newly created candidate profiles
              </p>
            </div>
            <Link
              href="/users"
              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 hover:underline"
            >
              View All <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-100">
                <tr>
                  <th className="px-6 py-3.5">Candidate</th>
                  <th className="px-6 py-3.5">Gender & City</th>
                  <th className="px-6 py-3.5">Verification</th>
                  <th className="px-6 py-3.5">Registered</th>
                  <th className="px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {usersLoading ? (
                  [...Array(4)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={5} className="px-6 py-4 h-14 bg-slate-50/30" />
                    </tr>
                  ))
                ) : recentUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-400 text-xs">
                      No candidate profiles registered yet.
                    </td>
                  </tr>
                ) : (
                  recentUsers.map((user) => (
                    <tr key={user.uid} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            src={user.profileImage}
                            name={user.displayName}
                            gender={user.gender}
                            className="w-9 h-9 rounded-xl shadow-xs"
                          />
                          <div className="min-w-0">
                            <span className="font-bold text-slate-900 block truncate">
                              {user.displayName || "Anonymous Candidate"}
                            </span>
                            <span className="text-[11px] text-slate-400 block truncate">
                              {user.email || "No email"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-3.5 text-slate-600">
                        {[user.gender, user.city].filter(Boolean).join(" • ") || "—"}
                      </td>
                      <td className="px-6 py-3.5">
                        {user.isVerified ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1 w-fit">
                            <ShieldCheck className="w-3 h-3 text-emerald-600" />
                            Verified
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 w-fit block">
                            Unverified
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3.5 text-slate-400 text-[11px]">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <Link
                          href={`/users?search=${encodeURIComponent(user.displayName || "")}`}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors inline-block"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* System Activity Timeline (1 column, or full width if Recent Registrations is hidden) */}
        {canViewAuditLogs && (
        <div className={`${canViewUsers ? "" : "lg:col-span-3"} bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs flex flex-col justify-between`}>
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h2 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-600" />
                Staff Activity Log
              </h2>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Audit Trail
              </span>
            </div>
            <div className="mt-4 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
              {activityLoading ? (
                <div className="space-y-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-12 bg-slate-50 rounded-xl shimmer" />
                  ))}
                </div>
              ) : (
                <ActivityFeed logs={activityData} />
              )}
            </div>
          </div>
        </div>
        )}
      </div>
      )}
    </div>
  );
}
