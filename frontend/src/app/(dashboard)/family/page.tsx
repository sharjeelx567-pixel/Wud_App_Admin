"use client";

import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, ShieldCheck, Shield, UserCog, HeartHandshake, AlertOctagon, Search, Lock, X,
  ChevronLeft, ChevronRight, Ban, RotateCcw, Eye,
} from "lucide-react";
import StatCard from "../../../components/dashboard/StatCard";
import api from "../../../services/api";
import { useAuthStore } from "../../../store/authStore";

/* ───────────────────────────── types ───────────────────────────── */

interface Paged<T> { items: T[]; total: number; page: number; limit: number }

interface FamilyStats {
  groups: { total: number; suspended: number; active: number };
  access: Record<string, number>;
  candidates: Record<string, number>;
  groupInvites: Record<string, number>;
  chaperones: Record<string, number>;
  marital: { polySeekers: number; openPoly: number; remarriagePool: number; openRemarriage: number; previouslyMarried: number };
  chaperoneReportsOpen: number;
  rooms?: { active: number; total: number };
  chaperoneReadWrite?: number;
}

interface RoomRow {
  id: string; chatId: string | null; creatorId: string | null; creatorName: string; partnerId: string | null;
  viewerCount: number; status: string; createdAtMs: number | null; expiresAtMs: number | null; renewedAtMs: number | null;
}

interface GroupRow {
  id: string; name: string; ownerId: string; ownerName: string; memberCount: number;
  memberNames: string[]; status: string; suspendedReason: string | null; createdAtMs: number | null;
}

interface GroupDetail {
  id: string; name: string; ownerName: string; status: string; suspendedReason: string | null;
  members: { uid: string; name: string; isOwner: boolean }[];
  invitations: { id: string; inviteeName: string; status: string; createdAtMs: number | null; respondedAtMs: number | null }[];
}

interface LinkRow {
  id: string; kind: string; role: string; status: string; inviterName: string; inviteeName: string;
  inviterId: string; inviteeId: string; principalId: string; memberId: string;
  permissions: { profile: boolean; preferences: boolean; contact: boolean; editBasics: boolean; matchmaking?: boolean; viewChats?: boolean };
  consent: string; createdAtMs: number | null; respondedAtMs: number | null; endedAtMs: number | null;
  revokeReason: string | null;
}

interface ChaperoneRow {
  id: string; chatId: string; role: string; status: string; ownerName: string; partnerName: string;
  chaperoneName: string; partnerConsent: string; createdAtMs: number | null; respondedAtMs: number | null;
  endedAtMs: number | null;
  permission?: "read_only" | "read_write"; ownerAllowsWrite?: boolean; partnerAllowsWrite?: boolean;
}

interface MaritalRow {
  uid: string; displayName: string; username: string | null; gender: string; maritalStatus: string | null;
  flags: Record<string, boolean>; issue: string | null; accountStatus: string;
  pool?: "remarriage" | "first_marriage"; polygamyDisclosed?: boolean | null;
}

interface FlagRow {
  id: string; reason: string; chaperoneName: string; participants: { uid: string; displayName: string }[];
  messageContent: string; createdAt?: { _seconds?: number };
}

type Tab = "groups" | "access" | "chaperones" | "candidates" | "rooms" | "marital" | "reports";

/* ─────────────────────────── helpers ─────────────────────────── */

const fmt = (v: number | null | undefined) =>
  v ? new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

function Badge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    rejected: "bg-rose-50 text-rose-700 border-rose-200",
    revoked: "bg-rose-50 text-rose-700 border-rose-200",
    removed: "bg-slate-100 text-slate-600 border-slate-200",
    ended: "bg-slate-100 text-slate-600 border-slate-200",
    suspended: "bg-orange-50 text-orange-700 border-orange-200",
  };
  return (
    <span className={`px-2 py-0.5 border rounded-full text-[10px] font-bold uppercase whitespace-nowrap ${map[status] || map.removed}`}>
      {status}
    </span>
  );
}

function PermChips({ p, showEdit }: { p: LinkRow["permissions"]; showEdit?: boolean }) {
  const items: [string, boolean][] = [
    ["Profile", p.profile], ["Preferences", p.preferences], ["Contact", p.contact],
    ...(showEdit ? [
      ["Edit basics", p.editBasics] as [string, boolean],
      ["Matchmaking", p.matchmaking === true] as [string, boolean],
      ["Chats (read only)", p.viewChats === true] as [string, boolean],
    ] : []),
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(([label, on]) => (
        <span key={label} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${on ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-slate-50 text-slate-400 border-slate-200 line-through"}`}>
          {label}
        </span>
      ))}
    </div>
  );
}

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function Toolbar({ search, setSearch, status, setStatus, statuses, placeholder }: {
  search: string; setSearch: (s: string) => void; status: string; setStatus: (s: string) => void;
  statuses: string[]; placeholder: string;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-slate-100">
      <div className="relative flex-1">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold capitalize border transition ${status === s ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Pager({ page, total, limit, setPage }: { page: number; total: number; limit: number; setPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 text-[11px] text-slate-500">
      <span>{total.toLocaleString()} record(s) · page {page} of {pages}</span>
      <div className="flex gap-1.5">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="p-1.5 border border-slate-200 rounded-lg disabled:opacity-40"><ChevronLeft className="w-3.5 h-3.5" /></button>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="p-1.5 border border-slate-200 rounded-lg disabled:opacity-40"><ChevronRight className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-14 text-center text-xs font-semibold text-slate-400">{text}</div>;
}

function Loading() {
  return (
    <div className="p-6 space-y-3">
      {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-slate-50 rounded-xl shimmer" />)}
    </div>
  );
}

/** Reason-required confirmation for every sensitive action. */
function ReasonModal({ title, body, actionLabel, onConfirm, onClose, busy }: {
  title: string; body: string; actionLabel: string; busy: boolean;
  onConfirm: (reason: string) => void; onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex justify-between items-start">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-slate-400" /></button>
        </div>
        <p className="text-xs text-slate-500">{body}</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Reason (required — recorded in the audit log)"
          className="w-full text-xs border border-slate-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded-xl">Cancel</button>
          <button
            disabled={!reason.trim() || busy}
            onClick={() => onConfirm(reason.trim())}
            className="px-4 py-2 text-xs font-bold text-white bg-rose-600 rounded-xl disabled:opacity-40"
          >
            {busy ? "Working…" : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({ title, subtitle, icon: Icon, children }: { title: string; subtitle: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
      <div className="p-6 border-b border-slate-100">
        <h3 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
          <Icon className="w-4 h-4 text-indigo-600" /> {title}
        </h3>
        <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

const TH = "px-5 py-3";
const TD = "px-5 py-3.5 align-top";

/** Shared list state for a paged, searchable endpoint. */
function usePagedList<T>(key: string, url: string, extra: Record<string, string>, initialStatus: string) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  useEffect(() => setPage(1), [debounced, status]);
  const query = useQuery<Paged<T>>({
    queryKey: ["family-admin", key, debounced, status, page, extra],
    queryFn: () =>
      api.get(url, { params: { search: debounced, status, page, limit: 15, ...extra } }).then((r) => r.data.data),
  });
  return { search, setSearch, status, setStatus, page, setPage, query };
}

/* ──────────────────────────── sections ──────────────────────────── */

function GroupsSection({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { search, setSearch, status, setStatus, page, setPage, query } =
    usePagedList<GroupRow>("groups", "/family/groups", {}, "all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [action, setAction] = useState<{ id: string; suspend: boolean; name: string } | null>(null);

  const detail = useQuery<GroupDetail>({
    queryKey: ["family-admin", "group", openId],
    queryFn: () => api.get(`/family/groups/${openId}`).then((r) => r.data.data),
    enabled: !!openId,
  });

  const mutation = useMutation({
    mutationFn: ({ id, suspend, reason }: { id: string; suspend: boolean; reason: string }) =>
      api.post(`/family/groups/${id}/${suspend ? "suspend" : "unsuspend"}`, { reason }),
    onSuccess: () => { setAction(null); qc.invalidateQueries({ queryKey: ["family-admin"] }); },
  });

  const data = query.data;
  return (
    <Card title="Family Groups" subtitle="Groups created in the app. Members join only by accepting an invitation." icon={Users}>
      <Toolbar search={search} setSearch={setSearch} status={status} setStatus={setStatus}
        statuses={["all", "active", "suspended"]} placeholder="Search group, owner or member name…" />
      {query.isLoading ? <Loading /> : !data || data.items.length === 0 ? <Empty text="No family groups found." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-100">
              <tr><th className={TH}>Group</th><th className={TH}>Owner</th><th className={TH}>Members</th><th className={TH}>Status</th><th className={TH}>Created</th><th className={TH}></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((g) => (
                <React.Fragment key={g.id}>
                  <tr>
                    <td className={TD}><p className="font-bold text-slate-800">{g.name}</p><p className="text-[10px] text-slate-400 font-mono">{g.id}</p></td>
                    <td className={TD}>{g.ownerName}</td>
                    <td className={TD}><p className="font-semibold">{g.memberCount}</p><p className="text-[10px] text-slate-400 max-w-[220px] truncate">{g.memberNames.join(", ")}</p></td>
                    <td className={TD}><Badge status={g.status} />{g.suspendedReason && <p className="text-[10px] text-orange-600 mt-1">{g.suspendedReason}</p>}</td>
                    <td className={TD}>{fmt(g.createdAtMs)}</td>
                    <td className={`${TD} text-right whitespace-nowrap`}>
                      <button onClick={() => setOpenId(openId === g.id ? null : g.id)} className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-indigo-600 border border-indigo-200 rounded-lg mr-1.5">
                        <Eye className="w-3 h-3" /> {openId === g.id ? "Hide" : "Details"}
                      </button>
                      {canManage && (
                        <button onClick={() => setAction({ id: g.id, suspend: g.status !== "suspended", name: g.name })}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg border ${g.status === "suspended" ? "text-emerald-700 border-emerald-200" : "text-orange-700 border-orange-200"}`}>
                          {g.status === "suspended" ? <><RotateCcw className="w-3 h-3" /> Restore</> : <><Ban className="w-3 h-3" /> Suspend</>}
                        </button>
                      )}
                    </td>
                  </tr>
                  {openId === g.id && (
                    <tr><td colSpan={6} className="bg-slate-50/60 px-5 py-4">
                      {detail.isLoading || !detail.data ? <p className="text-xs text-slate-400">Loading…</p> : (
                        <div className="grid md:grid-cols-2 gap-6">
                          <div>
                            <p className="text-[11px] font-bold uppercase text-slate-500 mb-2">Members</p>
                            {detail.data.members.map((m) => (
                              <p key={m.uid} className="text-xs py-0.5">{m.name} {m.isOwner && <span className="text-[10px] text-indigo-600 font-bold">(owner)</span>}</p>
                            ))}
                          </div>
                          <div>
                            <p className="text-[11px] font-bold uppercase text-slate-500 mb-2">Invitation history</p>
                            {detail.data.invitations.length === 0 ? <p className="text-xs text-slate-400">No invitations.</p> :
                              detail.data.invitations.map((i) => (
                                <div key={i.id} className="flex items-center justify-between text-xs py-1 gap-3">
                                  <span>{i.inviteeName}</span>
                                  <span className="text-[10px] text-slate-400">{fmt(i.createdAtMs)}</span>
                                  <Badge status={i.status} />
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} limit={data.limit} setPage={setPage} />}
      {action && (
        <ReasonModal
          title={action.suspend ? `Suspend "${action.name}"?` : `Restore "${action.name}"?`}
          body={action.suspend
            ? "Members are notified. The group can't invite or accept new members until restored. No private data is opened."
            : "The group becomes active again and members are notified."}
          actionLabel={action.suspend ? "Suspend group" : "Restore group"}
          busy={mutation.isPending}
          onClose={() => setAction(null)}
          onConfirm={(reason) => mutation.mutate({ id: action.id, suspend: action.suspend, reason })}
        />
      )}
      {mutation.isError && <p className="px-6 pb-4 text-xs text-rose-600">Action failed. Check your permissions and try again.</p>}
    </Card>
  );
}

function LinksSection({ kind, canManage }: { kind: "access" | "candidate"; canManage: boolean }) {
  const qc = useQueryClient();
  const { search, setSearch, status, setStatus, page, setPage, query } =
    usePagedList<LinkRow>(`links-${kind}`, "/family/links", { kind }, "all");
  const [target, setTarget] = useState<LinkRow | null>(null);
  const mutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/family/links/${id}/revoke`, { reason }),
    onSuccess: () => { setTarget(null); qc.invalidateQueries({ queryKey: ["family-admin"] }); },
  });
  const data = query.data;
  const isAccess = kind === "access";

  return (
    <Card
      title={isAccess ? "Family / Wali Access" : "Family Candidates"}
      subtitle={isAccess
        ? "Who gave which family member / Wali access to their profile. Only the permissions are shown — never the shared data."
        : "Family members helping manage a candidate's profile. The candidate must accept and controls the permissions."}
      icon={isAccess ? ShieldCheck : UserCog}
    >
      <Toolbar search={search} setSearch={setSearch} status={status} setStatus={setStatus}
        statuses={["all", "active", "pending", "rejected", "revoked"]} placeholder="Search by name, user id or role…" />
      {query.isLoading ? <Loading /> : !data || data.items.length === 0 ? <Empty text="No records found." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-100">
              <tr>
                <th className={TH}>{isAccess ? "Profile owner" : "Candidate"}</th>
                <th className={TH}>{isAccess ? "Family / Wali" : "Manager"}</th>
                <th className={TH}>Role</th>
                <th className={TH}>Consent</th>
                <th className={TH}>Permissions</th>
                <th className={TH}>Status</th>
                <th className={TH}>Dates</th>
                <th className={TH}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((l) => {
                const owner = l.principalId === l.inviterId ? l.inviterName : l.inviteeName;
                const member = l.memberId === l.inviterId ? l.inviterName : l.inviteeName;
                const live = l.status === "active" || l.status === "pending";
                return (
                  <tr key={l.id}>
                    <td className={TD}><p className="font-bold text-slate-800">{owner}</p><p className="text-[10px] text-slate-400 font-mono">{l.principalId}</p></td>
                    <td className={TD}><p className="font-semibold">{member}</p><p className="text-[10px] text-slate-400 font-mono">{l.memberId}</p></td>
                    <td className={`${TD} capitalize`}>{l.role}</td>
                    <td className={TD}>
                      <span className={`text-[11px] font-semibold ${l.consent === "given" ? "text-emerald-700" : l.consent === "awaiting" ? "text-amber-700" : "text-rose-600"}`}>
                        {l.consent === "given" ? "✓ Accepted" : l.consent === "awaiting" ? "Awaiting acceptance" : l.consent === "refused" ? "Declined" : "Withdrawn"}
                      </span>
                      <p className="text-[10px] text-slate-400">by {l.inviteeName}</p>
                    </td>
                    <td className={TD}><PermChips p={l.permissions} showEdit={!isAccess} /></td>
                    <td className={TD}><Badge status={l.status} />{l.revokeReason && <p className="text-[10px] text-rose-600 mt-1 max-w-[160px]">{l.revokeReason}</p>}</td>
                    <td className={`${TD} text-[10px] text-slate-500 whitespace-nowrap`}>
                      <p>Invited {fmt(l.createdAtMs)}</p>
                      {l.respondedAtMs && <p>Answered {fmt(l.respondedAtMs)}</p>}
                      {l.endedAtMs && <p>Ended {fmt(l.endedAtMs)}</p>}
                    </td>
                    <td className={`${TD} text-right`}>
                      {canManage && live && (
                        <button onClick={() => setTarget(l)} className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-rose-600 border border-rose-200 rounded-lg whitespace-nowrap">
                          <Ban className="w-3 h-3" /> Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} limit={data.limit} setPage={setPage} />}
      {target && (
        <ReasonModal
          title="Revoke this access?"
          body={`Ends the link between ${target.inviterName} and ${target.inviteeName}${isAccess ? " and removes them from any chat they chaperone" : ""}. Both users are notified. Admins can never grant access — only the user can.`}
          actionLabel="Revoke access"
          busy={mutation.isPending}
          onClose={() => setTarget(null)}
          onConfirm={(reason) => mutation.mutate({ id: target.id, reason })}
        />
      )}
    </Card>
  );
}

function ChaperonesSection({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { search, setSearch, status, setStatus, page, setPage, query } =
    usePagedList<ChaperoneRow>("chaperones", "/family/chaperones", {}, "all");
  const [target, setTarget] = useState<ChaperoneRow | null>(null);
  const mutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/family/chaperones/${id}/revoke`, { reason }),
    onSuccess: () => { setTarget(null); qc.invalidateQueries({ queryKey: ["family-admin"] }); },
  });
  const data = query.data;
  return (
    <Card title="Chaperone / Wali in Chats" subtitle="A Wali joins a chat only after BOTH participants agree. Admins see the assignment — never the conversation." icon={Shield}>
      <Toolbar search={search} setSearch={setSearch} status={status} setStatus={setStatus}
        statuses={["all", "active", "pending", "rejected", "revoked"]} placeholder="Search by participant or chaperone…" />
      {query.isLoading ? <Loading /> : !data || data.items.length === 0 ? <Empty text="No chaperone assignments found." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-100">
              <tr><th className={TH}>Conversation</th><th className={TH}>Chaperone</th><th className={TH}>Consent</th><th className={TH}>Status</th><th className={TH}>Dates</th><th className={TH}></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((c) => (
                <tr key={c.id}>
                  <td className={TD}><p className="font-bold text-slate-800">{c.ownerName} &amp; {c.partnerName}</p><p className="text-[10px] text-slate-400 flex items-center gap-1"><Lock className="w-3 h-3" /> messages not visible to admins</p></td>
                  <td className={TD}><p className="font-semibold">{c.chaperoneName}</p><p className="text-[10px] text-slate-400 capitalize">{c.role} of {c.ownerName}</p></td>
                  <td className={TD}>
                    <p className="text-[11px] text-emerald-700 font-semibold">✓ {c.ownerName} requested</p>
                    <p className={`text-[11px] font-semibold ${c.partnerConsent === "approved" ? "text-emerald-700" : c.partnerConsent === "awaiting" ? "text-amber-700" : "text-rose-600"}`}>
                      {c.partnerConsent === "approved" ? "✓" : c.partnerConsent === "awaiting" ? "…" : "✗"} {c.partnerName} {c.partnerConsent}
                    </p>
                  </td>
                  <td className={TD}>
                    <Badge status={c.status} />
                    <p className={`mt-1 text-[10px] font-bold ${c.permission === "read_write" ? "text-orange-700" : "text-slate-500"}`}>
                      {c.permission === "read_write" ? "Read & Write" : "Read only"}
                    </p>
                    <p className="text-[10px] text-slate-400">write ok: {c.ownerName} {c.ownerAllowsWrite ? "✓" : "✗"} · {c.partnerName} {c.partnerAllowsWrite ? "✓" : "✗"}</p>
                  </td>
                  <td className={`${TD} text-[10px] text-slate-500 whitespace-nowrap`}>
                    <p>Requested {fmt(c.createdAtMs)}</p>
                    {c.respondedAtMs && <p>Answered {fmt(c.respondedAtMs)}</p>}
                    {c.endedAtMs && <p>Ended {fmt(c.endedAtMs)}</p>}
                  </td>
                  <td className={`${TD} text-right`}>
                    {canManage && (c.status === "active" || c.status === "pending") && (
                      <button onClick={() => setTarget(c)} className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-rose-600 border border-rose-200 rounded-lg whitespace-nowrap">
                        <Ban className="w-3 h-3" /> Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} limit={data.limit} setPage={setPage} />}
      {target && (
        <ReasonModal
          title={`Remove ${target.chaperoneName} from this chat?`}
          body="Their access to the conversation ends immediately and all three people are notified."
          actionLabel="Remove chaperone"
          busy={mutation.isPending}
          onClose={() => setTarget(null)}
          onConfirm={(reason) => mutation.mutate({ id: target.id, reason })}
        />
      )}
    </Card>
  );
}

function RoomsSection({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { search, setSearch, status, setStatus, page, setPage, query } =
    usePagedList<RoomRow>("rooms", "/family/rooms", {}, "all");
  const [target, setTarget] = useState<RoomRow | null>(null);
  const mutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/family/rooms/${id}/close`, { reason }),
    onSuccess: () => { setTarget(null); qc.invalidateQueries({ queryKey: ["family-admin"] }); },
  });
  const data = query.data;
  return (
    <Card title="Family Group Chat Rooms" subtitle="24-hour rooms family members join with a 6-digit code in the app. Admins see status only — never the code or the conversation." icon={Users}>
      <Toolbar search={search} setSearch={setSearch} status={status} setStatus={setStatus}
        statuses={["all", "active", "expired", "ended", "revoked"]} placeholder="Search by creator or user id…" />
      {query.isLoading ? <Loading /> : !data || data.items.length === 0 ? <Empty text="No family rooms found." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-100">
              <tr><th className={TH}>Creator</th><th className={TH}>Family joined</th><th className={TH}>Status</th><th className={TH}>Dates</th><th className={TH}></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td className={TD}><p className="font-bold text-slate-800">{r.creatorName}</p><p className="text-[10px] text-slate-400 flex items-center gap-1"><Lock className="w-3 h-3" /> code &amp; messages hidden</p></td>
                  <td className={TD}>{r.viewerCount}</td>
                  <td className={TD}><Badge status={r.status} /></td>
                  <td className={`${TD} text-[10px] text-slate-500 whitespace-nowrap`}>
                    <p>Opened {fmt(r.createdAtMs)}</p>
                    <p>Expires {fmt(r.expiresAtMs)}</p>
                    {r.renewedAtMs && <p>Renewed {fmt(r.renewedAtMs)}</p>}
                  </td>
                  <td className={`${TD} text-right`}>
                    {canManage && r.status === "active" && (
                      <button onClick={() => setTarget(r)} className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-rose-600 border border-rose-200 rounded-lg whitespace-nowrap">
                        <Ban className="w-3 h-3" /> Close
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} limit={data.limit} setPage={setPage} />}
      {target && (
        <ReasonModal
          title={`Close ${target.creatorName}'s Family Room?`}
          body="The code stops working immediately. The two chat participants and every family member who joined are notified."
          actionLabel="Close room"
          busy={mutation.isPending}
          onClose={() => setTarget(null)}
          onConfirm={(reason) => mutation.mutate({ id: target.id, reason })}
        />
      )}
    </Card>
  );
}

const MARITAL_FILTERS: [string, string][] = [
  ["isPolygamySeeker", "Seeking polygamy"],
  ["openToPolygamy", "Open to polygamy"],
  ["remarriageMatchingPool", "Remarriage-only pool"],
  ["openToRemarriage", "Open to remarriage"],
  ["previouslyMarried", "Previously married"],
  ["invalid", "Needs review"],
];

function MaritalSection({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("isPolygamySeeker");
  const { search, setSearch, page, setPage, query } =
    usePagedList<MaritalRow>(`marital-${filter}`, "/family/marital", { filter }, "all");
  const [target, setTarget] = useState<{ row: MaritalRow; field: string } | null>(null);
  const mutation = useMutation({
    mutationFn: ({ uid, field, reason }: { uid: string; field: string; reason: string }) =>
      api.post(`/family/marital/${uid}/reset`, { field, reason }),
    onSuccess: () => { setTarget(null); qc.invalidateQueries({ queryKey: ["family-admin"] }); },
  });
  const data = query.data;
  const flagField = filter === "invalid" ? "isPolygamySeeker" : filter;
  return (
    <Card title="Remarriage & Polygamy" subtitle="Matching preferences users set themselves. These drive who appears in Discover. Admins can only turn a flag OFF." icon={HeartHandshake}>
      <div className="flex flex-wrap gap-1.5 px-4 pt-4">
        {MARITAL_FILTERS.map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border ${filter === key ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="p-4 border-b border-slate-100">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, username or marital status…"
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl" />
        </div>
      </div>
      {query.isLoading ? <Loading /> : !data || data.items.length === 0 ? <Empty text="No users match this filter." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-100">
              <tr><th className={TH}>User</th><th className={TH}>Gender</th><th className={TH}>Marital status</th><th className={TH}>Preferences</th><th className={TH}>Account</th><th className={TH}></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((u) => (
                <tr key={u.uid}>
                  <td className={TD}><p className="font-bold text-slate-800">{u.displayName}</p><p className="text-[10px] text-slate-400">{u.username ? `@${u.username}` : u.uid}</p>{u.issue && <p className="text-[10px] text-orange-600 font-semibold mt-1">⚠ {u.issue}</p>}</td>
                  <td className={TD}>{u.gender || "—"}</td>
                  <td className={TD}>
                    {u.maritalStatus || "—"}
                    <p className="text-[10px] text-slate-400">{u.pool === "remarriage" ? "Remarriage pool" : "First-marriage pool"}</p>
                    {u.polygamyDisclosed === true && <p className="text-[10px] text-emerald-700 font-semibold">Marriage disclosed</p>}
                    {u.polygamyDisclosed === false && <p className="text-[10px] text-orange-600 font-semibold">No disclosure — hidden</p>}
                  </td>
                  <td className={TD}>
                    <div className="flex flex-wrap gap-1">
                      {MARITAL_FILTERS.slice(0, 5).map(([k, label]) => u.flags[k] && (
                        <span key={k} className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">{label}</span>
                      ))}
                    </div>
                  </td>
                  <td className={TD}><Badge status={u.accountStatus === "active" ? "active" : "suspended"} /></td>
                  <td className={`${TD} text-right`}>
                    {canManage && u.flags[flagField] && (
                      <button onClick={() => setTarget({ row: u, field: flagField })}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-orange-700 border border-orange-200 rounded-lg whitespace-nowrap">
                        <RotateCcw className="w-3 h-3" /> Turn off
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} limit={data.limit} setPage={setPage} />}
      {target && (
        <ReasonModal
          title={`Turn off "${MARITAL_FILTERS.find(([k]) => k === target.field)?.[1]}" for ${target.row.displayName}?`}
          body="The user is notified and can review the setting in the app. Use this for invalid or abusive preferences."
          actionLabel="Turn off"
          busy={mutation.isPending}
          onClose={() => setTarget(null)}
          onConfirm={(reason) => mutation.mutate({ uid: target.row.uid, field: target.field, reason })}
        />
      )}
    </Card>
  );
}

function ReportsSection({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<FlagRow[]>({
    queryKey: ["family-admin", "flags"],
    queryFn: () => api.get("/family/chaperone-flags").then((r) => r.data.data || []),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => api.patch(`/family/chaperone-flags/${id}/resolve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["family-admin"] }),
  });
  return (
    <Card title="Chaperone Reports" subtitle="Messages a chaperone explicitly reported. Only the reported message is shown — not the rest of the chat." icon={AlertOctagon}>
      {isLoading ? <Loading /> : !data || data.length === 0 ? <Empty text="No open chaperone reports." /> : (
        <div className="divide-y divide-slate-100">
          {data.map((f) => (
            <div key={f.id} className="p-5 flex flex-col md:flex-row md:items-start gap-4 justify-between">
              <div className="space-y-1">
                <p className="text-xs font-bold text-slate-800">Reported by {f.chaperoneName}</p>
                <p className="text-[11px] text-slate-500">Conversation: {f.participants.map((p) => p.displayName).join(" & ")}</p>
                <p className="text-[11px] text-rose-600 font-semibold">Reason: {f.reason}</p>
                <p className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 mt-1 max-w-xl">“{f.messageContent}”</p>
              </div>
              {canManage && (
                <button disabled={resolve.isPending} onClick={() => resolve.mutate(f.id)}
                  className="px-3 py-1.5 text-[11px] font-bold text-emerald-700 border border-emerald-200 rounded-lg self-start">
                  Mark reviewed
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ───────────────────────────── page ───────────────────────────── */

export default function FamilyManagementPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission("family.manage");
  const canViewReports = hasPermission("chat_moderation.view");
  const canManageReports = hasPermission("chat_moderation.manage");
  const [tab, setTab] = useState<Tab>("groups");

  const { data: stats, isLoading } = useQuery<FamilyStats>({
    queryKey: ["family-admin", "stats"],
    queryFn: () => api.get("/family/stats").then((r) => r.data.data),
    refetchInterval: 30000,
  });
  const v = (n?: number) => (isLoading || n === undefined ? "..." : n.toLocaleString());

  const tabs: [Tab, string][] = [
    ["groups", "Family Groups"],
    ["access", "Family / Wali Access"],
    ["chaperones", "Chaperone / Wali"],
    ["candidates", "Family Candidates"],
    ["rooms", "Family Rooms (24h)"],
    ["marital", "Remarriage & Polygamy"],
    ...(canViewReports ? [["reports", "Chaperone Reports"] as [Tab, string]] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-5">
        <StatCard title="Family Groups" value={v(stats?.groups.total)} icon={Users}
          description={`${v(stats?.groups.suspended)} suspended`} colorTheme="primary" />
        <StatCard title="Wali / Family Access" value={v(stats?.access?.active)} icon={ShieldCheck}
          description={`${v(stats?.access?.pending)} pending · ${v(stats?.access?.revoked)} revoked`} colorTheme="accent" />
        <StatCard title="Active Chaperones" value={v(stats?.chaperones?.active)} icon={Shield}
          description={`${v(stats?.chaperones?.pending)} awaiting consent · ${v(stats?.chaperoneReadWrite)} read & write · ${v(stats?.rooms?.active)} rooms live`} colorTheme="success" />
        <StatCard title="Managed Candidates" value={v(stats?.candidates?.active)} icon={UserCog}
          description={`${v(stats?.candidates?.pending)} awaiting consent`} colorTheme="secondary" />
        <StatCard title="Polygamy / Remarriage" value={v(stats?.marital.polySeekers)} icon={HeartHandshake}
          description={`seekers · ${v(stats?.marital.remarriagePool)} in remarriage pool`} colorTheme="warning" />
      </div>

      <div className="flex items-start gap-2 p-3 rounded-xl border border-indigo-100 bg-indigo-50/60 text-[11px] text-indigo-800">
        <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Privacy: this module shows relationships, consent and permission status only. Private chats, messages,
          contact details, CNIC and verification documents are never shown here, and admins cannot grant access on a
          user&apos;s behalf — only revoke or suspend. Every action requires a reason and is written to the Audit Log.
          {!canManage && " You have view-only access."}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-xl text-xs font-bold border transition ${tab === key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
            {label}
            {key === "reports" && (stats?.chaperoneReportsOpen ?? 0) > 0 && (
              <span className="ml-1.5 px-1.5 rounded-full bg-rose-500 text-white text-[10px]">{stats?.chaperoneReportsOpen}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "groups" && <GroupsSection canManage={canManage} />}
      {tab === "access" && <LinksSection key="access" kind="access" canManage={canManage} />}
      {tab === "chaperones" && <ChaperonesSection canManage={canManage} />}
      {tab === "candidates" && <LinksSection key="candidate" kind="candidate" canManage={canManage} />}
      {tab === "rooms" && <RoomsSection canManage={canManage} />}
      {tab === "marital" && <MaritalSection canManage={canManage} />}
      {tab === "reports" && canViewReports && <ReportsSection canManage={canManageReports} />}
    </div>
  );
}
