"use client";

import React, { useState, useEffect } from "react";
import { useAuthStore } from "../../../store/authStore";
import {
  ShieldCheck,
  Key,
  Save,
  AlertCircle,
  CheckCircle2,
  Smartphone,
  Copy,
} from "lucide-react";
import { auth } from "../../../config/firebase";
import {
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import api from "../../../services/api";

export default function ProfilePage() {
  const { admin } = useAuthStore();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ── Two-factor authentication ──────────────────────────────────────────
  const [twoFA, setTwoFA] = useState<{ enabled: boolean; backupCodesRemaining: number } | null>(null);
  const [setupData, setSetupData] = useState<{ otpauth: string; secret: string; qrDataUrl: string } | null>(null);
  const [twoFACode, setTwoFACode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [twoFALoading, setTwoFALoading] = useState(false);
  const [twoFAError, setTwoFAError] = useState("");
  const [disabling, setDisabling] = useState(false);

  useEffect(() => {
    loadTwoFactorStatus();
  }, []);

  const loadTwoFactorStatus = async () => {
    try {
      const r = await api.get("/auth/2fa/status");
      setTwoFA(r.data?.data || null);
    } catch {
      /* non-fatal */
    }
  };

  const startSetup = async () => {
    setTwoFAError("");
    setTwoFALoading(true);
    try {
      const r = await api.post("/auth/2fa/setup");
      setSetupData(r.data?.data || null);
      setBackupCodes(null);
    } catch (e: any) {
      setTwoFAError(e?.response?.data?.error || "Could not start two-factor setup.");
    } finally {
      setTwoFALoading(false);
    }
  };

  const confirmEnable = async () => {
    setTwoFAError("");
    setTwoFALoading(true);
    try {
      const r = await api.post("/auth/2fa/enable", { code: twoFACode.trim() });
      setBackupCodes(r.data?.data?.backupCodes || []);
      setSetupData(null);
      setTwoFACode("");
      await loadTwoFactorStatus();
    } catch (e: any) {
      setTwoFAError(e?.response?.data?.error || "Invalid verification code.");
    } finally {
      setTwoFALoading(false);
    }
  };

  const disableTwoFactor = async () => {
    setTwoFAError("");
    setTwoFALoading(true);
    try {
      await api.post("/auth/2fa/disable", { code: twoFACode.trim() });
      setTwoFACode("");
      setBackupCodes(null);
      setDisabling(false);
      await loadTwoFactorStatus();
    } catch (e: any) {
      setTwoFAError(e?.response?.data?.error || "A valid current code is required.");
    } finally {
      setTwoFALoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters long.");
      return;
    }

    setIsLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error("Not authenticated");

      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);

      setSuccess("Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(
        err.code === "auth/invalid-credential"
          ? "Incorrect current password."
          : err.message || "Failed to change password."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass =
    "w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Profile Card (1 col) */}
        <div className="md:col-span-1">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs flex flex-col items-center text-center space-y-3">
            <div className="w-20 h-20 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-2xl shadow-xs">
              {admin?.displayName?.charAt(0) || "A"}
            </div>

            <div>
              <h2 className="text-base font-bold font-display text-slate-900">
                {admin?.displayName || "Admin User"}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">{admin?.email}</p>
            </div>

            <div className="flex items-center gap-1.5 py-1 px-3 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full text-xs font-bold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{admin?.role?.replace(/_/g, " ").toUpperCase() || "MODERATOR"}</span>
            </div>

            {twoFA && (
              <div
                className={`flex items-center gap-1.5 py-1 px-3 rounded-full text-xs font-bold border ${
                  twoFA.enabled
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>{twoFA.enabled ? "2FA ON" : "2FA OFF"}</span>
              </div>
            )}
          </div>
        </div>

        {/* Change Password Form (2 cols) */}
        <div className="md:col-span-2">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold font-display text-slate-900">Change Password</h3>
                <p className="text-xs text-slate-400">Update your console access credentials</p>
              </div>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-4">
              {error && (
                <div className="p-3 bg-rose-50 text-rose-700 rounded-xl text-xs border border-rose-200 flex items-center gap-2 font-medium">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div className="p-3 bg-emerald-50 text-emerald-700 rounded-xl text-xs border border-emerald-200 flex items-center gap-2 font-medium">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>{success}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Current Password
                </label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    New Password
                  </label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isLoading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save New Password
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Two-Factor Authentication */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold font-display text-slate-900">Two-Factor Authentication</h3>
            <p className="text-xs text-slate-400">
              Add a second step at login using an authenticator app (Google Authenticator, Authy…)
            </p>
          </div>
        </div>

        {twoFAError && (
          <div className="p-3 bg-rose-50 text-rose-700 rounded-xl text-xs border border-rose-200 flex items-center gap-2 font-medium">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{twoFAError}</span>
          </div>
        )}

        {/* One-time backup codes after enabling */}
        {backupCodes && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
            <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm">
              <CheckCircle2 className="w-4 h-4" /> Two-factor authentication is on.
            </div>
            <p className="text-xs text-emerald-800">
              Save these backup codes somewhere safe — each works once if you lose your authenticator.
              They are shown only now.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {backupCodes.map((c) => (
                <code key={c} className="px-2 py-1.5 bg-white border border-emerald-200 rounded-lg text-xs font-mono text-slate-800 text-center">
                  {c}
                </code>
              ))}
            </div>
            <button
              onClick={() => navigator.clipboard?.writeText(backupCodes.join("\n"))}
              className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-900"
            >
              <Copy className="w-3.5 h-3.5" /> Copy all codes
            </button>
          </div>
        )}

        {/* Setup in progress: QR + verify */}
        {setupData && !backupCodes && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-5 items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setupData.qrDataUrl} alt="2FA QR code" className="w-40 h-40 rounded-xl border border-slate-200" />
              <div className="space-y-2 text-xs text-slate-600">
                <p>1. Scan this QR code with your authenticator app.</p>
                <p>2. Or enter this key manually:</p>
                <code className="inline-block px-2 py-1 bg-slate-100 border border-slate-200 rounded-lg font-mono text-slate-800 break-all">
                  {setupData.secret}
                </code>
                <p>3. Enter the 6-digit code it shows to finish.</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Verification code</label>
                <input
                  value={twoFACode}
                  onChange={(e) => setTwoFACode(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  className={inputClass}
                />
              </div>
              <button
                onClick={confirmEnable}
                disabled={twoFALoading || twoFACode.trim().length < 6}
                className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {twoFALoading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                Enable 2FA
              </button>
              <button
                onClick={() => {
                  setSetupData(null);
                  setTwoFACode("");
                  setTwoFAError("");
                }}
                className="py-2.5 px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Idle state */}
        {!setupData && !backupCodes && twoFA && (
          <>
            {!twoFA.enabled ? (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  Two-factor authentication is <span className="font-bold text-amber-600">off</span>. Turn it on to
                  protect your admin account.
                </p>
                <button
                  onClick={startSetup}
                  disabled={twoFALoading}
                  className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {twoFALoading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Smartphone className="w-4 h-4" />
                  )}
                  Enable 2FA
                </button>
              </div>
            ) : !disabling ? (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  Two-factor authentication is <span className="font-bold text-emerald-600">on</span>.
                  {" "}
                  {twoFA.backupCodesRemaining} backup code{twoFA.backupCodesRemaining === 1 ? "" : "s"} remaining.
                </p>
                <button
                  onClick={() => {
                    setDisabling(true);
                    setTwoFAError("");
                  }}
                  className="py-2.5 px-5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl font-bold text-xs transition-colors cursor-pointer"
                >
                  Disable 2FA
                </button>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Enter a current code to disable
                  </label>
                  <input
                    value={twoFACode}
                    onChange={(e) => setTwoFACode(e.target.value)}
                    inputMode="numeric"
                    placeholder="123456 or a backup code"
                    className={inputClass}
                  />
                </div>
                <button
                  onClick={disableTwoFactor}
                  disabled={twoFALoading || !twoFACode.trim()}
                  className="py-2.5 px-5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {twoFALoading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : null}
                  Confirm Disable
                </button>
                <button
                  onClick={() => {
                    setDisabling(false);
                    setTwoFACode("");
                    setTwoFAError("");
                  }}
                  className="py-2.5 px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
