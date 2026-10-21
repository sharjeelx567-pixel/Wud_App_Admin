"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "../../store/authStore";
import { APP_NAME } from "../../config/branding";
import type { AdminPermission } from "../../types";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  LifeBuoy,
  CreditCard,
  Bell,
  Settings,
  Shield,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  AlertTriangle,
  ImageIcon,
  MessageSquare,
  Activity,
  HeartHandshake,
  Radio,
  FileText,
  X
} from "lucide-react";

interface SidebarProps {
  pendingCounts?: {
    photos?: number;
    verifications?: number;
    reports?: number;
    rishtaPosts?: number;
    communityPosts?: number;
    support?: number;
  };
  /** Mobile drawer state — on desktop the sidebar is always visible. */
  mobileOpen?: boolean;
  onClose?: () => void;
}

interface MenuItem {
  name: string;
  href: string;
  icon: any;
  badgeKey?: "photos" | "verifications" | "reports" | "rishtaPosts" | "communityPosts" | "support";
  // The permission that page's underlying data actually requires
  // server-side (see the requirePermission(...) call on that route's main
  // GET endpoint in nikkah_connect_admin/backend/src/routes). Omit only for
  // pages every signed-in admin can use regardless of role (just Dashboard).
  // super_admin bypasses this automatically via hasPermission().
  permission?: AdminPermission;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

export default function Sidebar({ pendingCounts, mobileOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { admin, logout, hasPermission } = useAuthStore();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const toggleCollapse = () => setIsCollapsed(!isCollapsed);

  const menuSections: MenuSection[] = [
    {
      title: "Core",
      items: [
        { name: "Dashboard", href: "/", icon: LayoutDashboard },
        { name: "Users", href: "/users", icon: Users, permission: "users.view" },
      ],
    },
    {
      title: "Moderation & Safety",
      items: [
        { name: "Photo Moderation", href: "/photos", icon: ImageIcon, badgeKey: "photos", permission: "photos.view" },
        { name: "Verification", href: "/verification", icon: ShieldCheck, badgeKey: "verifications", permission: "verification.view" },
        { name: "Reports Center", href: "/reports", icon: AlertTriangle, badgeKey: "reports", permission: "reports.view" },
        { name: "Rishta Posts", href: "/posts", icon: HeartHandshake, badgeKey: "rishtaPosts", permission: "posts.view" },
        { name: "Community", href: "/community-posts", icon: MessageSquare, badgeKey: "communityPosts", permission: "posts.view" },
        { name: "Support Helpdesk", href: "/support", icon: LifeBuoy, badgeKey: "support", permission: "support.view" },
      ],
    },
    {
      title: "Operations",
      items: [
        { name: "Connections", href: "/connections", icon: HeartHandshake, permission: "connections.view" },
        { name: "Chat Moderation", href: "/chats", icon: MessageSquare, permission: "chat_moderation.view" },
        { name: "Premium Plans", href: "/premium", icon: CreditCard, permission: "subscriptions.view" },
        { name: "Notifications", href: "/notifications", icon: Bell, permission: "notifications.view" },
        { name: "App Content", href: "/content", icon: FileText, permission: "content.view" },
      ],
    },
    {
      title: "Administration",
      items: [
        { name: "Audit Logs", href: "/audit-logs", icon: Activity, permission: "audit_logs.view" },
        { name: "System Health", href: "/monitoring", icon: Radio, permission: "audit_logs.view" },
        { name: "Admin Team", href: "/admins", icon: Shield, permission: "admins.view" },
        { name: "Settings", href: "/settings", icon: Settings, permission: "settings.view" },
      ],
    },
  ];

  return (
    <motion.aside
      animate={{ width: isCollapsed ? 80 : 270 }}
      transition={{ type: "spring", stiffness: 350, damping: 32 }}
      className={`border-r border-slate-200/80 bg-white flex flex-col h-screen flex-shrink-0 shadow-xs
        fixed md:sticky top-0 left-0 z-40
        transition-transform duration-300 ease-out md:transition-none
        ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
    >
      {/* Brand Header */}
      <div className="h-18 px-5 border-b border-slate-100 flex items-center justify-between">
        {!isCollapsed ? (
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center text-white shadow-sm shadow-indigo-200 flex-shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="font-extrabold font-display tracking-tight text-slate-900 text-base leading-tight block">
                {APP_NAME}
              </span>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block -mt-0.5">
                Admin Console
              </span>
            </div>
          </Link>
        ) : (
          <Link href="/" className="mx-auto">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center text-white shadow-sm">
              <Sparkles className="w-5 h-5" />
            </div>
          </Link>
        )}

        {/* Mobile: close the drawer */}
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors flex md:hidden items-center justify-center"
          title="Close menu"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Desktop: collapse/expand */}
        <button
          onClick={toggleCollapse}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors hidden md:flex items-center justify-center"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-5 custom-scrollbar">
        {menuSections.map((section, sIdx) => {
          const visibleItems = section.items.filter((item) => {
            if (!item.permission) return true;
            return hasPermission(item.permission);
          });

          if (visibleItems.length === 0) return null;

          return (
            <div key={sIdx} className="space-y-1">
              {!isCollapsed && (
                <p className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  {section.title}
                </p>
              )}

              {visibleItems.map((item) => {
                const isActive = pathname === item.href;
                const count = (pendingCounts && item.badgeKey && pendingCounts[item.badgeKey]) ? (pendingCounts[item.badgeKey] as number) : 0;
                const IconComponent = item.icon;

                return (
                  <Link key={item.href} href={item.href} onClick={() => onClose?.()} className="relative block group">
                    <span
                      className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                        isActive
                          ? "bg-indigo-50/90 text-indigo-600 font-bold shadow-xs"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <IconComponent
                          className={`w-4 h-4 flex-shrink-0 transition-colors ${
                            isActive ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-700"
                          }`}
                        />
                        {!isCollapsed && (
                          <span className="truncate">{item.name}</span>
                        )}
                      </div>

                      {count > 0 && (
                        <span
                          className={`flex items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-xs ${
                            isCollapsed ? "w-2 h-2 p-0" : "px-2 py-0.5 min-w-[20px]"
                          }`}
                        >
                          {!isCollapsed && count}
                        </span>
                      )}
                    </span>

                    {/* Tooltip for collapsed mode */}
                    {isCollapsed && (
                      <div className="absolute left-16 top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 bg-slate-900 text-white text-xs font-medium rounded-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-md whitespace-nowrap">
                        {item.name}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Footer Profile & Logout */}
      <div className="p-3 border-t border-slate-100 bg-slate-50/50 space-y-2">
        {!isCollapsed && (
          <div className="flex items-center gap-3 p-2 bg-white rounded-xl border border-slate-200/70 shadow-xs">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs flex-shrink-0">
              {admin?.displayName?.charAt(0) || "A"}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-bold text-slate-800 truncate">
                {admin?.displayName || "Admin User"}
              </h4>
              <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wider block">
                {admin?.role?.replace("_", " ") || "Administrator"}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={logout}
          className={`flex items-center gap-2.5 py-2 px-3 text-xs font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50/80 rounded-xl transition-all w-full cursor-pointer ${
            isCollapsed ? "justify-center" : ""
          }`}
          title="Sign Out"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!isCollapsed && <span>Sign Out</span>}
        </button>
      </div>
    </motion.aside>
  );
}

