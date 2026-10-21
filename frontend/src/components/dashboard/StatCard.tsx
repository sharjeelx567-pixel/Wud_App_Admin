"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  trend?: {
    value: string;
    type: "up" | "down";
  };
  colorTheme?: "primary" | "secondary" | "accent" | "success" | "warning";
}

const AnimatedCounter = ({ endValue }: { endValue: number }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const duration = 900;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      setCount(Math.floor(progress * endValue));
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };

    window.requestAnimationFrame(step);
  }, [endValue]);

  return <>{count.toLocaleString()}</>;
};

export default function StatCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
  colorTheme = "primary",
}: StatCardProps) {
  const isNumeric = typeof value === "number";

  const getTheme = () => {
    switch (colorTheme) {
      case "secondary":
        return { grad: "from-pink-500 to-rose-500", shadow: "shadow-pink-500/30", glow: "rgba(236,72,153,0.20)" };
      case "accent":
      case "warning":
        return { grad: "from-amber-400 to-orange-500", shadow: "shadow-amber-500/30", glow: "rgba(245,158,11,0.20)" };
      case "success":
        return { grad: "from-emerald-500 to-teal-500", shadow: "shadow-emerald-500/30", glow: "rgba(16,185,129,0.20)" };
      default:
        return { grad: "from-indigo-500 to-violet-500", shadow: "shadow-indigo-500/30", glow: "rgba(99,102,241,0.20)" };
    }
  };

  const theme = getTheme();

  return (
    <div className="group relative overflow-hidden bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 flex flex-col justify-between">
      {/* Soft corner glow in the card's accent colour */}
      <div
        className="pointer-events-none absolute -top-12 -right-12 w-36 h-36 rounded-full blur-2xl opacity-70 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(circle, ${theme.glow}, transparent 70%)` }}
      />

      <div className="relative flex items-start justify-between">
        <div className="min-w-0">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            {title}
          </span>
          <h3 className="text-2xl font-bold font-display text-slate-900 mt-1.5 tracking-tight">
            {isNumeric ? <AnimatedCounter endValue={value as number} /> : value}
          </h3>
        </div>

        <div
          className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 text-white bg-gradient-to-br shadow-lg ${theme.grad} ${theme.shadow} transition-transform duration-300 group-hover:scale-105`}
        >
          <Icon className="w-5 h-5" />
        </div>
      </div>

      {(description || trend) && (
        <div className="relative flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 text-xs">
          {trend && (
            <span
              className={`font-bold px-1.5 py-0.5 rounded-md text-[10px] inline-flex items-center gap-0.5 ${
                trend.type === "up"
                  ? "text-emerald-700 bg-emerald-50"
                  : "text-rose-700 bg-rose-50"
              }`}
            >
              {trend.type === "up" ? "▲" : "▼"} {trend.value}
            </span>
          )}
          {description && (
            <span className="text-slate-400 text-xs font-medium">
              {description}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
