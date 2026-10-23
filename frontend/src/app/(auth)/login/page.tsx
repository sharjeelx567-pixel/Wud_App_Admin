"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore } from "../../../store/authStore";
import { APP_NAME } from "../../../config/branding";
import type { AdminRole } from "../../../types";
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  ShieldCheck,
  Sparkles,
  ShieldAlert,
  ChevronDown,
  CheckCircle2,
  Info,
  Heart
} from "lucide-react";

// Same 7 canonical roles as everywhere else in the console (backend
// AdminRole, Admin Settings -> Add Admin/Staff, role badges).
//
// This selection can only ever REJECT a login, never grant one: after the
// server authenticates the account and returns its real (DB-stored) role,
// we compare it to this selection. A mismatch signs the just-established
// session back out immediately and shows an error — it never changes what
// role the account actually gets. This is a client-side sanity check
// against picking the wrong account/expectation, not an authorization
// mechanism; the server remains the sole source of truth for the role
// actually used for every permission check afterward.
const ROLE_HINTS: { id: AdminRole; label: string }[] = [
  { id: "super_admin", label: "Super Admin" },
  { id: "admin", label: "Admin" },
  { id: "moderator", label: "Moderator" },
  { id: "verification_staff", label: "Verification Staff" },
  { id: "support_staff", label: "Support Staff" },
  { id: "content_moderator", label: "Content Moderator" },
  { id: "analyst", label: "Analyst" },
];

export default function LoginPage() {
  const router = useRouter();
  const { login, verifyTwoFactor, cancelTwoFactor, challengeToken, isLoading, error, clearError, admin, logout } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // See ROLE_HINTS above — this can reject a login but never grant a role.
  const [roleHint, setRoleHint] = useState<AdminRole>("super_admin");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [localError, setLocalError] = useState("");
  // Separate from localError/error on purpose: those are genuine failures
  // (wrong password, bad 2FA code) and stay styled as hard errors. A role
  // hint mismatch isn't that — the login itself succeeded — so it gets its
  // own softer, non-alarming presentation instead of the red error box.
  const [roleMismatchNotice, setRoleMismatchNotice] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");

  // Runs AFTER the server has already authenticated the account and a real
  // session/token exists — this can only discard that session, never
  // create or upgrade one. useAuthStore.getState() (not the destructured
  // `admin`) is used so we read the value the store was just set to in
  // this same tick, not a stale one from before the login/2FA call.
  //
  // The message deliberately does NOT reveal what the account's actual role
  // is — doing so would let someone who doesn't know it simply try every
  // option in the dropdown until the account confirms its own role back to
  // them, leaking that information for free. It's kept fully generic.
  const enforceRoleSelectionMatches = (): boolean => {
    const actualRole = useAuthStore.getState().admin?.role;
    if (actualRole && actualRole !== roleHint) {
      logout();
      setRoleMismatchNotice(
        "The selected role doesn't match this account. Select the correct role and sign in again."
      );
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (clearError) clearError();
    setLocalError("");
    setRoleMismatchNotice("");

    if (!email.trim() || !password) {
      setLocalError("Please provide both email and password.");
      return;
    }

    try {
      setIsProcessing(true);
      const result = await login(email.trim(), password, rememberMe);
      if (result.status === "success") {
        if (enforceRoleSelectionMatches()) {
          router.replace("/");
        }
      }
      // "2fa_required" falls through: the store now holds a challenge token and
      // the form below switches to the code step. No session exists yet.
    } catch (err: any) {
      // Handled in store
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerifyTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (clearError) clearError();
    setLocalError("");
    setRoleMismatchNotice("");

    const code = twoFactorCode.replace(/\s/g, "");
    if (code.length < 6) {
      setLocalError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    try {
      setIsProcessing(true);
      const ok = await verifyTwoFactor(code, rememberMe);
      if (ok) {
        setTwoFactorCode("");
        if (enforceRoleSelectionMatches()) {
          router.replace("/");
        }
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBackToPassword = () => {
    cancelTwoFactor();
    setTwoFactorCode("");
    setLocalError("");
    setRoleMismatchNotice("");
    setPassword("");
  };

  return (
    <div className="min-h-screen lg:flex bg-[#fbf7f4]">
      {/* LEFT — full wedding hero (desktop) */}
      <div
        className="hidden lg:flex lg:w-[56%] relative bg-cover bg-center items-end"
        style={{ backgroundImage: "url('/wedding-login.jpg')" }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-[#2b0c16]/92 via-[#2b0c16]/40 to-[#2b0c16]/15" />
        <div className="relative z-10 p-12 xl:p-16 text-white">
          <div className="flex items-center gap-2.5 mb-10">
            <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center border border-white/25">
              <Sparkles className="w-5 h-5" />
            </div>
            <span className="font-serif text-xl font-semibold tracking-wide">{APP_NAME}</span>
          </div>

          {/* Gold eyebrow */}
          <div className="flex items-center gap-3 mb-5">
            <span className="h-px w-10 bg-[#D4AF37]" />
            <span className="text-[#EBCB72] text-[11px] font-semibold uppercase tracking-[0.22em]">
              Nikah, with trust
            </span>
          </div>

          <h2 className="font-serif text-4xl xl:text-[3.3rem] font-semibold leading-[1.12] max-w-lg">
            Where meaningful{" "}
            <span className="italic text-[#F3D573]">nikahs</span> begin.
          </h2>
          <p className="text-white/75 text-sm mt-5 max-w-sm leading-relaxed">
            The administration &amp; safety console — guiding every profile, match and
            verification with care, dignity and a family-first heart.
          </p>

          {/* Trust row */}
          <div className="flex items-center gap-6 mt-12 text-white/70 text-xs font-medium">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#EBCB72]" /> Verified profiles
            </span>
            <span className="flex items-center gap-1.5">
              <Heart className="w-4 h-4 text-[#EBCB72]" /> Family-first
            </span>
          </div>
        </div>
      </div>

      {/* RIGHT — form panel (wedding backdrop on mobile) */}
      <div className="relative flex-1 flex items-center justify-center p-5 sm:p-8 min-h-screen lg:min-h-0">
        {/* Mobile-only wedding backdrop */}
        <div
          className="lg:hidden absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/wedding-login.jpg')" }}
        />
        <div className="lg:hidden absolute inset-0 bg-[#2b0c16]/65" />

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-md relative z-10"
        >
          {/* Brand Header */}
          <div className="text-center mb-7">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-tr from-[#8C1C3F] to-[#A63255] flex items-center justify-center text-white shadow-lg shadow-[#8C1C3F]/30">
              <Sparkles className="w-7 h-7" />
            </div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-white lg:text-slate-900">
              {APP_NAME}
            </h1>
            <p className="text-xs font-medium mt-1.5 text-white/70 lg:text-slate-500">
              Enterprise Administration &amp; Safety Console
            </p>
          </div>

          {/* Login Card */}
          <div className="bg-white/95 backdrop-blur-sm rounded-3xl p-8 shadow-2xl shadow-[#2b0c16]/20 border border-white/70">
          <form onSubmit={challengeToken ? handleVerifyTwoFactor : handleSubmit} className="space-y-4">
            <AnimatePresence mode="wait">
              {(error || localError) && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2.5 p-3.5 bg-rose-50 text-rose-700 rounded-2xl text-xs border border-rose-200 font-medium"
                >
                  <ShieldAlert className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <span>{localError || error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {roleMismatchNotice && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2.5 p-3.5 bg-slate-50 text-slate-600 rounded-2xl text-xs border border-slate-200 font-medium"
                >
                  <Info className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span>{roleMismatchNotice}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {!challengeToken && (
              <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Staff Role
                </label>
                <div className="relative">
                  <select
                    value={roleHint}
                    onChange={(e) => setRoleHint(e.target.value as AdminRole)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 appearance-none cursor-pointer"
                  >
                    {ROLE_HINTS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                  Must match the role assigned to this account in Admin Settings, or sign-in will be rejected.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Work Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@nikkahconnect.com"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              </>
            )}

            {challengeToken && (
              <div className="space-y-3">
                <div className="flex items-start gap-2.5 p-3.5 bg-indigo-50 text-indigo-800 rounded-2xl text-xs border border-indigo-200">
                  <ShieldCheck className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
                  <span>
                    Password accepted. Enter the 6-digit code from your authenticator app to
                    finish signing in. You can also use one of your backup codes.
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5 uppercase tracking-wide">
                    Authentication Code
                  </label>
                  <input
                    type="text"
                    inputMode="text"
                    autoFocus
                    autoComplete="one-time-code"
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value)}
                    placeholder="123456"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-center text-lg font-bold tracking-[0.4em] text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleBackToPassword}
                  className="w-full text-[11px] font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
                >
                  Use a different account
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || isProcessing}
              className="w-full py-3 mt-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoading || isProcessing ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : challengeToken ? (
                "Verify & Continue"
              ) : (
                "Authenticate & Sign In"
              )}
            </button>
          </form>
          </div>

          <p className="text-center text-xs font-medium mt-6 text-white/70 lg:text-slate-500">
            Encrypted 256-Bit SSL Administrative Access
          </p>
        </motion.div>
      </div>
    </div>
  );
}

