"use client";

import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Light / dark toggle. The initial class is set pre-paint by the inline script
 * in the root layout; this component only reflects + flips it, persisting the
 * choice to localStorage under `wud-theme`.
 */
export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("wud-theme", next ? "dark" : "light");
    } catch {
      /* ignore private-mode storage errors */
    }
    setIsDark(next);
  };

  return (
    <button
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle theme"
      className="relative p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50/70 rounded-xl border border-slate-200/80 transition-colors cursor-pointer"
    >
      {/* Render a stable icon until mounted to avoid hydration mismatch. */}
      {mounted && isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
