"use client";

import React, { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "../../store/authStore";
import Sidebar from "../../components/layout/Sidebar";
import TopBar from "../../components/layout/TopBar";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { ADMIN_MUTATED_EVENT } from "../../services/api";
import { DashboardStats } from "../../types";
import { useDesktopNotification } from "../../hooks/useDesktopNotification";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading, admin } = useAuthStore();
  const isCoach = admin?.role === "coach";

  // Mobile slide-in nav drawer (desktop keeps the fixed sidebar).
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close the drawer whenever the route changes (tapping a nav item navigates).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Redirect if not logged in
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  // A coach may only ever be on its own chats page — bounce it back from any
  // other route it tries to reach directly.
  useEffect(() => {
    if (!isLoading && isAuthenticated && isCoach && pathname !== "/coach-chats") {
      router.replace("/coach-chats");
    }
  }, [isAuthenticated, isLoading, isCoach, pathname, router]);

  // Fetch real-time pending notification counts for the sidebar badges
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats-badges"],
    queryFn: async () => {
      const response = await api.get("/analytics/stats");
      return response.data.data;
    },
    enabled: isAuthenticated && !isCoach,
    // 60s poll (was 10s — each poll runs ~18 Firestore count queries) plus an
    // immediate refresh whenever the admin returns to this tab. Polling pauses
    // while the tab is in the background (React Query default).
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });

  const { data: unreadSupport } = useQuery({
    queryKey: ["support-unread-count"],
    queryFn: async () => {
      const response = await api.get("/support/tickets/unread-count");
      return response.data.data.count;
    },
    enabled: isAuthenticated && !isCoach,
    // 60s poll (was 5s) + refresh on returning to the tab; the Support page
    // itself keeps its own faster live polling while it is open.
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });

  // Any successful admin write (approve, resolve, reply…) refreshes the badges
  // immediately, so the longer 60s poll never shows a stale count after an action.
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats-badges"] });
      queryClient.invalidateQueries({ queryKey: ["support-unread-count"] });
    };
    window.addEventListener(ADMIN_MUTATED_EVENT, refresh);
    return () => window.removeEventListener(ADMIN_MUTATED_EVENT, refresh);
  }, [queryClient]);

  const pendingCounts = {
    photos: stats?.pendingPhotos || 0,
    verifications: stats?.pendingVerifications || 0,
    reports: stats?.pendingReports || 0,
    rishtaPosts: stats?.pendingRishtaPosts || 0,
    communityPosts: stats?.pendingCommunityPosts || 0,
    support: unreadSupport || 0,
  };

  useDesktopNotification(unreadSupport || 0, "New Support Ticket", "You have unread candidate support inquiries.");

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <div className="relative w-12 h-12 mb-4">
          <div className="absolute inset-0 rounded-full border-3 border-indigo-100" />
          <div className="absolute inset-0 rounded-full border-3 border-transparent border-t-indigo-600 animate-spin" />
        </div>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          Securing Admin Session...
        </h2>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar Navigation — fixed on desktop, slide-in drawer on mobile */}
      <Sidebar
        pendingCounts={pendingCounts}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      {/* Mobile backdrop behind the open drawer */}
      {mobileNavOpen && (
        <div
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 bg-slate-900/40 z-30 md:hidden"
          aria-hidden="true"
        />
      )}

      {/* Main Content Pane */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top Header Controls */}
        <TopBar onMenuClick={() => setMobileNavOpen(true)} />

        {/* Dynamic Nested Page Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 custom-scrollbar">
          <div className="max-w-[1760px] mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
