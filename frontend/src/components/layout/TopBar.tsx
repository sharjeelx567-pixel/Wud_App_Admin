"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShieldCheck, Bell, Sparkles, Menu } from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import api from "../../services/api";
import { APP_NAME } from "../../config/branding";

export default function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { admin } = useAuthStore();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const res = await api.get("/admin-alerts/unread-count");
        if (res.data?.count !== undefined) {
          setUnreadCount(res.data.count);
        }
      } catch (err) {}
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, []);

  const getPageInfo = () => {
    switch (pathname) {
      case "/":
        return { title: "Dashboard Overview", subtitle: "Real-time metrics, analytics, and platform health" };
      case "/users":
        return { title: "User Management", subtitle: "Browse, filter, and audit registered seeker accounts" };
      case "/photos":
        return { title: "Photo Moderation", subtitle: "Verify user profile avatars and gallery photos" };
      case "/verification":
        return { title: "Verification Center", subtitle: "Identity & document verification queue" };
      case "/chats":
        return { title: "Chat Moderation", subtitle: "Monitor active conversation safety and flags" };
      case "/reports":
        return { title: "Reports Center", subtitle: "Investigate flagged user complaints and profile harassment" };
      case "/support":
        return { title: "Support Helpdesk", subtitle: "Live 2-way customer inquiries and issue resolution" };
      case "/premium":
        return { title: "Premium Management", subtitle: "Subscription packages and payment transactions" };
      case "/notifications":
        return { title: "Push Notifications", subtitle: "Broadcast notifications and system announcements" };
      case "/admin-alerts":
        return { title: "Admin Alerts", subtitle: "Security logs, critical warnings, and triggers" };
      case "/admins":
        return { title: "Admin Team", subtitle: "Manage staff permissions and console roles" };
      case "/settings":
        return { title: "App Settings", subtitle: "System configurations, pricing, and matching parameters" };
      default:
        return { title: "Console", subtitle: `${APP_NAME} Enterprise Administration` };
    }
  };

  const { title, subtitle } = getPageInfo();

  const getTodayDate = () => {
    return new Date().toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <header className="h-18 border-b border-slate-200/80 bg-white/90 backdrop-blur-md flex items-center justify-between px-4 md:px-8 sticky top-0 z-20 shadow-xs gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {/* Mobile: open the nav drawer */}
        <button
          onClick={onMenuClick}
          className="md:hidden p-2 -ml-1 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50/70 rounded-lg transition-colors flex-shrink-0 cursor-pointer"
          title="Open menu"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-base md:text-lg font-bold font-display text-slate-900 tracking-tight truncate">
            {title}
          </h1>
          <p className="text-xs text-slate-400 font-medium truncate hidden sm:block">
            {subtitle}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
        <span className="text-xs text-slate-500 font-medium bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200/70 hidden sm:inline-block">
          {getTodayDate()}
        </span>

        {/* Notifications Bell */}
        <button
          onClick={() => router.push("/admin-alerts")}
          className="relative p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50/70 rounded-xl border border-slate-200/80 transition-colors cursor-pointer"
          title="Admin Alerts"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center border-2 border-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {/* Status Badge */}
        <div className="flex items-center gap-1.5 py-1.5 px-3 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-xl text-xs font-bold shadow-xs">
          <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
          <span>{admin?.role === "super_admin" ? "SUPER ADMIN" : "STAFF"}</span>
        </div>
      </div>
    </header>
  );
}
