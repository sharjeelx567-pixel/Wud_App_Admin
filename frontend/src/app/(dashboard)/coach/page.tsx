"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, CalendarCheck, Wallet, Save, UserPlus, Users } from "lucide-react";
import StatCard from "../../../components/dashboard/StatCard";
import api from "../../../services/api";

interface Coach {
  uid: string;
  displayName: string;
  email: string;
  isActive: boolean;
}

interface CoachSession {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  topic?: string;
  date?: string;
  timeSlot?: string;
  amountPkr?: number;
  platformFeePkr?: number;
  coachPayoutPkr?: number;
  coachId?: string | null;
  coachName?: string | null;
  meetingLink?: string | null;
  adminNote?: string | null;
  status?: "booked" | "confirmed" | "completed" | "cancelled" | string;
  createdAtMs?: number;
}

const STATUSES = ["booked", "confirmed", "completed", "cancelled"];

function statusBadge(status: string) {
  const s = (status || "booked").toLowerCase();
  const map: Record<string, string> = {
    booked: "bg-amber-50 text-amber-700 border-amber-200",
    confirmed: "bg-indigo-50 text-indigo-700 border-indigo-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    cancelled: "bg-rose-50 text-rose-700 border-rose-200",
  };
  return (
    <span className={`px-2 py-0.5 border rounded-full text-[10px] font-bold uppercase ${map[s] || map.booked}`}>
      {s}
    </span>
  );
}

function CoachRow({ session, coaches }: { session: CoachSession; coaches: Coach[] }) {
  const queryClient = useQueryClient();
  const [coachId, setCoachId] = useState(session.coachId || "");
  const [status, setStatus] = useState(session.status || "booked");

  const mutation = useMutation({
    mutationFn: async () =>
      api.patch(`/coach/sessions/${session.id}`, { coachId, status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["coach-sessions"] }),
    onError: (error: any) =>
      alert(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          `Failed to update session (${error?.response?.status || "network error"}).`
      ),
  });

  const dirty =
    coachId !== (session.coachId || "") ||
    status !== (session.status || "booked");

  return (
    <tr className="hover:bg-slate-50/60 transition-colors align-top">
      <td className="px-6 py-4">
        <p className="font-bold text-slate-900">{session.userName || "Unknown"}</p>
        <p className="text-[11px] text-slate-400">{session.userEmail || session.userId}</p>
        {session.userPhone && <p className="text-[11px] text-slate-400">{session.userPhone}</p>}
      </td>
      <td className="px-6 py-4">
        <p className="font-semibold text-slate-800">{session.topic || "—"}</p>
        <p className="text-[11px] text-slate-500">
          {session.date || "—"}
          {session.timeSlot ? ` · ${session.timeSlot}` : ""}
        </p>
      </td>
      <td className="px-6 py-4">
        <p className="font-bold text-slate-900">PKR {(session.amountPkr || 0).toLocaleString()}</p>
        <p className="text-[11px] text-slate-400">Coach gets PKR {(session.coachPayoutPkr || 0).toLocaleString()}</p>
      </td>
      <td className="px-6 py-4">
        <div className="space-y-2 min-w-[230px]">
          <select
            value={coachId}
            onChange={(e) => setCoachId(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-semibold outline-none focus:border-indigo-500 text-slate-900"
          >
            <option value="">— Assign a coach —</option>
            {coaches.map((c) => (
              <option key={c.uid} value={c.uid}>
                {c.displayName}{c.isActive ? "" : " (disabled)"}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="flex-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-semibold outline-none focus:border-indigo-500 text-slate-900 capitalize"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button
              onClick={() => mutation.mutate()}
              disabled={!dirty || mutation.isPending}
              className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Save className="w-3 h-3" />
              Save
            </button>
          </div>
        </div>
      </td>
      <td className="px-6 py-4">{statusBadge(session.status || "booked")}</td>
    </tr>
  );
}

function CoachesPanel({ coaches, isLoading }: { coaches: Coach[]; isLoading: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // Users only ever see "Coach Manager" in the app, so new coaches default to
  // that brand name (editable if staff want to tell coaches apart internally).
  const [displayName, setDisplayName] = useState("Coach Manager");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const register = useMutation({
    mutationFn: async () =>
      api.post("/coach/coaches", { displayName, email, password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coaches"] });
      setDisplayName("Coach Manager");
      setEmail("");
      setPassword("");
      setOpen(false);
      alert("Coach registered. They can now log in at this panel with their email + password and will see only their chats.");
    },
    onError: (error: any) =>
      alert(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          `Failed to register coach (${error?.response?.status || "network error"}).`
      ),
  });

  const canSubmit = displayName.trim() && /\S+@\S+\.\S+/.test(email) && password.length >= 6;

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
      <div className="flex justify-between items-center p-6 border-b border-slate-100">
        <div>
          <h3 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-600" />
            Coaches
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">Register coaches, then assign them to bookings below.</p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1.5"
        >
          <UserPlus className="w-3.5 h-3.5" />
          {open ? "Close" : "Add Coach"}
        </button>
      </div>

      {open && (
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Coach full name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500 text-slate-900"
            />
            <input
              type="email"
              placeholder="Login email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500 text-slate-900"
            />
            <input
              type="text"
              placeholder="Temp password (min 6)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500 text-slate-900"
            />
          </div>
          <button
            onClick={() => register.mutate()}
            disabled={!canSubmit || register.isPending}
            className="mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {register.isPending ? "Registering..." : "Register Coach"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="p-6 text-xs text-slate-400">Loading coaches…</div>
      ) : coaches.length === 0 ? (
        <div className="p-6 text-xs text-slate-400">No coaches registered yet. Click “Add Coach”.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {coaches.map((c) => (
            <div key={c.uid} className="flex items-center justify-between px-6 py-3">
              <div>
                <p className="text-xs font-bold text-slate-900">{c.displayName}</p>
                <p className="text-[11px] text-slate-400">{c.email}</p>
              </div>
              <span className={`px-2 py-0.5 border rounded-full text-[10px] font-bold uppercase ${c.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                {c.isActive ? "Active" : "Disabled"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CoachPage() {
  const { data, isLoading } = useQuery<{ data: CoachSession[] }>({
    queryKey: ["coach-sessions"],
    queryFn: () => api.get("/coach/sessions").then((r) => r.data),
    refetchInterval: 20000,
  });
  const sessions = data?.data || [];

  const { data: coachData, isLoading: coachesLoading } = useQuery<{ data: Coach[] }>({
    queryKey: ["coaches"],
    queryFn: () => api.get("/coach/coaches").then((r) => r.data),
  });
  const coaches = coachData?.data || [];

  const awaiting = sessions.filter((s) => (s.status || "booked") === "booked").length;
  const payoutsDue = sessions
    .filter((s) => (s.status || "booked") !== "cancelled")
    .reduce((sum, s) => sum + (s.coachPayoutPkr || 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard
          title="Total Bookings"
          value={isLoading ? "..." : sessions.length.toLocaleString()}
          icon={GraduationCap}
          description="Paid Marriage Coach sessions"
          colorTheme="accent"
        />
        <StatCard
          title="Awaiting Coach / Link"
          value={isLoading ? "..." : awaiting.toLocaleString()}
          icon={CalendarCheck}
          description="New bookings not yet confirmed"
          colorTheme="primary"
        />
        <StatCard
          title="Coach Payouts Due"
          value={isLoading ? "..." : `PKR ${payoutsDue.toLocaleString()}`}
          icon={Wallet}
          description="70% share across active sessions"
          colorTheme="success"
        />
      </div>

      <CoachesPanel coaches={coaches} isLoading={coachesLoading} />

      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="flex justify-between items-center p-6 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-indigo-600" />
              Marriage Coach Bookings
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Assign a coach and set the status — the user is notified, and the coach can then chat with them from their panel.
            </p>
          </div>
          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px] rounded-full uppercase tracking-wider">
            Auto-refreshing
          </span>
        </div>

        {isLoading ? (
          <div className="p-8 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 bg-slate-50 rounded-xl shimmer" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <GraduationCap className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <p className="text-xs font-semibold">No coach sessions booked yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-100">
                <tr>
                  <th className="px-6 py-3.5">User</th>
                  <th className="px-6 py-3.5">Topic & Time</th>
                  <th className="px-6 py-3.5">Fee</th>
                  <th className="px-6 py-3.5">Manage (Coach · Status)</th>
                  <th className="px-6 py-3.5">Current</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {sessions.map((s) => (
                  <CoachRow key={s.id} session={s} coaches={coaches} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
