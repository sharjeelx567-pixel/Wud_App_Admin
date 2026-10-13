"use client";

import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import api from "../../../services/api";
import { AppSettings } from "../../../types";
import {
  Save,
  Sliders,
  Shield,
  CreditCard,
  Zap,
  CheckCircle,
  ToggleLeft,
  ToggleRight,
  Info,
  DollarSign,
  Compass
} from "lucide-react";

export default function SettingsPage() {
  const [successMsg, setSuccessMsg] = useState("");

  // Fetch configs
  const { data, isLoading } = useQuery<AppSettings>({
    queryKey: ["app-configs"],
    queryFn: async () => {
      const response = await api.get("/settings");
      return response.data.data;
    },
  });

  // Mutate configs
  const updateMutation = useMutation({
    mutationFn: async (payload: Partial<AppSettings>) => {
      const response = await api.patch("/settings", payload);
      return response.data;
    },
    onSuccess: () => {
      setSuccessMsg("Settings updated and synchronized across all Flutter devices.");
      setTimeout(() => setSuccessMsg(""), 4000);
    },
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="h-56 bg-white border border-slate-200/80 rounded-2xl shimmer" />
        <div className="h-56 bg-white border border-slate-200/80 rounded-2xl shimmer" />
      </div>
    );
  }

  const handleToggle = (key: keyof AppSettings) => {
    if (typeof data[key] === "boolean") {
      updateMutation.mutate({ [key]: !data[key] });
    }
  };

  const handleFlagToggle = (flagName: string) => {
    const updatedFlags = { ...data.featureFlags, [flagName]: !data.featureFlags[flagName] };
    updateMutation.mutate({ featureFlags: updatedFlags });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Real-time sync feedback notification */}
      {successMsg && (
        <div className="p-3.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-semibold flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* 1. Global Core Toggles */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-indigo-600" />
              Core Platform Controls
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Live runtime feature toggles read by client apps on launch.
            </p>
          </div>
          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full uppercase tracking-wider">
            Live Synchronized
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {[
            {
              key: "maintenanceMode" as const,
              label: "Maintenance Mode",
              desc: "Lock the mobile app and display a maintenance notice screen to all users.",
            },
            {
              key: "allowRegistration" as const,
              label: "New User Registrations",
              desc: "Allow new candidate accounts to register or temporarily freeze registrations.",
            },
            {
              key: "matchingEnabled" as const,
              label: "Match Recommendation Engine",
              desc: "Enable or freeze daily recommendation and discovery calculations.",
            },
            {
              key: "chatEnabled" as const,
              label: "Direct In-App Messaging",
              desc: "Allow matched users to exchange real-time text and media messages.",
            },
          ].map((toggle) => {
            const isActive = data[toggle.key];
            return (
              <div
                key={toggle.key}
                className="flex items-center justify-between py-4 first:pt-0 last:pb-0 gap-4"
              >
                <div>
                  <h4 className="font-bold text-slate-900 text-xs">{toggle.label}</h4>
                  <p className="text-xs text-slate-400 mt-0.5">{toggle.desc}</p>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggle(toggle.key)}
                  className={`transition-colors cursor-pointer flex-shrink-0 ${
                    isActive ? "text-indigo-600" : "text-slate-300 hover:text-slate-400"
                  }`}
                  title={isActive ? "Disable" : "Enable"}
                >
                  {isActive ? <ToggleRight className="w-10 h-10" /> : <ToggleLeft className="w-10 h-10" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Premium Pricing Configuration */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-6">
        <div className="pb-4 border-b border-slate-100">
          <h3 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-indigo-600" />
            Premium Subscription Package Rates
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure in-app purchase and direct payment pricing in PKR.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Monthly VIP Pass (PKR)
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 font-bold text-xs">
                Rs
              </span>
              <input
                type="number"
                step="1"
                defaultValue={data.premiumMonthlyPrice}
                onBlur={(e) => updateMutation.mutate({ premiumMonthlyPrice: Number(e.target.value) })}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Yearly VIP Pass (PKR)
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 font-bold text-xs">
                Rs
              </span>
              <input
                type="number"
                step="1"
                defaultValue={data.premiumYearlyPrice}
                onBlur={(e) => updateMutation.mutate({ premiumYearlyPrice: Number(e.target.value) })}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900"
              />
            </div>
          </div>
        </div>
      </div>

      {/* In-App Prices — read live by the app + payment engine (no app update needed) */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-6">
        <div className="pb-4 border-b border-slate-100">
          <h3 className="text-base font-bold font-display text-slate-900">App Prices (PKR)</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            These prices are read live by the app and the payment engine — changes apply instantly, no app update needed.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {([
            ["premium_monthly", "Premium (monthly)", 999],
            ["gold_family", "Gold / Family (monthly)", 2499],
            ["family_room", "Parents Web Room", 150],
            ["verification", "Full Verification", 200],
            ["human_video", "Human Video Verification", 500],
            ["confirmed_single", "Confirmed Single", 500],
            ["profile_boost", "Profile Boost", 200],
            ["rishta_boost", "Rishta Boost", 150],
            ["biodata_pdf", "Biodata PDF", 149],
            ["chat_archive", "Chat Archive", 99],
            ["chat_renewal", "Chat Renewal", 120],
          ] as [string, string, number][]).map(([key, label, def]) => (
            <div key={key}>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 font-bold text-xs">Rs</span>
                <input
                  type="number"
                  step="1"
                  defaultValue={(data as any).prices?.[key] ?? def}
                  onBlur={(e) => updateMutation.mutate({ prices: { [key]: Number(e.target.value) } })}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Matching Algorithm Parameters */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-6">
        <div className="pb-4 border-b border-slate-100">
          <h3 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
            <Compass className="w-4 h-4 text-indigo-600" />
            Matching & Geo-Proximity Rules
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure radius constraints and Islamic compatibility matching logic.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Maximum Match Distance Radius (KM)
            </label>
            <input
              type="number"
              step="1"
              defaultValue={data.maxMatchDistanceKm || 500}
              onBlur={(e) => updateMutation.mutate({ maxMatchDistanceKm: Number(e.target.value) })}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 max-w-sm"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Candidates further apart than this distance will not appear in discovery cards.
            </p>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
            <div>
              <h4 className="font-bold text-slate-900 text-xs">Strict Opposite Gender Matching</h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Ensure males only match with females and females with males.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                updateMutation.mutate({
                  enforceGenderMatching: !(data.enforceGenderMatching ?? true),
                })
              }
              className={`transition-colors cursor-pointer ${
                data.enforceGenderMatching ?? true
                  ? "text-indigo-600"
                  : "text-slate-300 hover:text-slate-400"
              }`}
            >
              {data.enforceGenderMatching ?? true ? (
                <ToggleRight className="w-10 h-10" />
              ) : (
                <ToggleLeft className="w-10 h-10" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 4. Extended Feature Flags */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-6">
        <div className="pb-4 border-b border-slate-100">
          <h3 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
            <Zap className="w-4 h-4 text-indigo-600" />
            Experimental & Beta Feature Flags
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Safely toggle emerging capabilities without releasing a new mobile build.
          </p>
        </div>

        <div className="divide-y divide-slate-100">
          {Object.keys(data.featureFlags).map((flag) => {
            const isEnabled = data.featureFlags[flag];
            return (
              <div
                key={flag}
                className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0 gap-4"
              >
                <div>
                  <h4 className="font-bold text-slate-900 text-xs">
                    {flag.replace(/_/g, " ").toUpperCase()}
                  </h4>
                  <span className="text-[11px] text-slate-400">Runtime Feature Flag</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleFlagToggle(flag)}
                  className={`transition-colors cursor-pointer ${
                    isEnabled ? "text-indigo-600" : "text-slate-300 hover:text-slate-400"
                  }`}
                >
                  {isEnabled ? <ToggleRight className="w-9 h-9" /> : <ToggleLeft className="w-9 h-9" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
