"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, Calendar, Clock, User, Video, Send } from "lucide-react";
import api from "../../../services/api";

// Resolves an opaque R2 object key into a short-lived signed GET (same pattern
// as SecureCnicImage on the main verification page), for Education/Single docs.
function DocImage({ reference }: { reference: string }) {
  const isDirectUrl = /^https?:\/\//.test(reference);
  const { data, isLoading, isError } = useQuery<{ data: { url: string } }>({
    queryKey: ["doc-review-url", reference],
    queryFn: () =>
      api.get("/verification/document-url", { params: { key: reference } }).then((r) => r.data),
    enabled: !isDirectUrl,
    staleTime: 4 * 60 * 1000,
    retry: 1,
  });
  const url = isDirectUrl ? reference : data?.data?.url;
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer"
         className="block w-24 h-16 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex-shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="document" className="w-full h-full object-cover" />
      </a>
    );
  }
  return (
    <div className="w-24 h-16 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-[9px] text-slate-400 flex-shrink-0">
      {isLoading ? "Loading…" : isError ? "Failed" : "…"}
    </div>
  );
}

interface DocReviewTabProps {
  title: string;
  queueKey: string;
  queuePath: string;
  approvePath: (uid: string) => string;
  rejectPath: (uid: string) => string;
  kind: "doc" | "human";
  // When set (Human Video), each row gets a Google Meet / Zoom link field the
  // staff fills so the user receives the call link in-app.
  meetingLinkPath?: (uid: string) => string;
}

// Per-row meeting-link editor for the Human Video queue. Holds its own input
// state so typing in one row never touches another; prefills with whatever
// link was already sent.
function MeetingLinkRow({
  initial,
  path,
  queueKey,
}: {
  initial: string;
  path: string;
  queueKey: string;
}) {
  const qc = useQueryClient();
  const [link, setLink] = useState(initial || "");
  const [justSent, setJustSent] = useState(false);
  const mut = useMutation({
    mutationFn: () => api.patch(path, { meetingLink: link.trim() }),
    onSuccess: () => {
      setJustSent(true);
      qc.invalidateQueries({ queryKey: [queueKey] });
      setTimeout(() => setJustSent(false), 2500);
    },
    onError: (e: any) =>
      alert(e?.response?.data?.error || e?.response?.data?.message || "Failed to send meeting link."),
  });
  const valid = /^https?:\/\//i.test(link.trim());
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
        <Video className="w-3.5 h-3.5 text-teal-600" /> Google Meet / Zoom link (sent to the user)
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://meet.google.com/..."
          className="flex-1 min-w-0 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-500"
        />
        <button
          onClick={() => mut.mutate()}
          disabled={!valid || mut.isPending}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-1.5 flex-shrink-0"
        >
          <Send className="w-4 h-4" />
          {justSent ? "Sent ✓" : mut.isPending ? "Sending…" : initial ? "Update Link" : "Send Link"}
        </button>
      </div>
    </div>
  );
}

/// Reusable staff-review queue for the document-based verifications (Education
/// VER-06, Confirmed-Single VER-07) and the Human Video queue (VER-08).
export default function DocReviewTab({
  title,
  queueKey,
  queuePath,
  approvePath,
  rejectPath,
  kind,
  meetingLinkPath,
}: DocReviewTabProps) {
  const qc = useQueryClient();
  const [rejectingUid, setRejectingUid] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading } = useQuery<{ data: any[] }>({
    queryKey: [queueKey],
    queryFn: () => api.get(queuePath).then((r) => r.data),
  });
  const items: any[] = data?.data || [];

  const approve = useMutation({
    mutationFn: (uid: string) => api.patch(approvePath(uid)),
    onSuccess: () => qc.invalidateQueries({ queryKey: [queueKey] }),
  });
  const reject = useMutation({
    mutationFn: (p: { uid: string; reason: string }) =>
      api.patch(rejectPath(p.uid), { reason: p.reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queueKey] });
      setRejectingUid(null);
      setReason("");
    },
  });

  if (isLoading) {
    return <div className="p-10 text-center text-slate-400">Loading…</div>;
  }
  if (items.length === 0) {
    return <div className="p-10 text-center text-slate-400">No pending {title} requests.</div>;
  }

  return (
    <div className="space-y-4">
      {items.map((it) => (
        <div key={it.uid} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center flex-shrink-0">
              {it.profileImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.profileImage} alt="" className="w-full h-full object-cover" />
              ) : (
                <User className="w-5 h-5 text-slate-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-800 truncate">{it.displayName || "Unknown"}</p>
              <p className="text-xs text-slate-500 truncate">
                {[it.gender, it.city].filter(Boolean).join(" · ")}
              </p>
            </div>
            {kind === "doc" && it.documentUrl && <DocImage reference={it.documentUrl} />}
            {kind === "human" && (
              <div className="text-right text-xs text-slate-600 flex-shrink-0">
                <p className="flex items-center gap-1 justify-end">
                  <Calendar className="w-3 h-3" /> {it.date || "—"}
                </p>
                <p className="flex items-center gap-1 justify-end mt-1">
                  <Clock className="w-3 h-3" /> {it.timeSlot || "—"}
                </p>
              </div>
            )}
          </div>

          {kind === "human" && meetingLinkPath && (
            <MeetingLinkRow
              initial={it.meetingLink || ""}
              path={meetingLinkPath(it.uid)}
              queueKey={queueKey}
            />
          )}

          {rejectingUid === it.uid ? (
            <div className="mt-3 flex gap-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for rejection"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={() => reject.mutate({ uid: it.uid, reason })}
                disabled={reject.isPending}
                className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold"
              >
                Confirm
              </button>
              <button
                onClick={() => {
                  setRejectingUid(null);
                  setReason("");
                }}
                className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="mt-3 flex gap-2 justify-end">
              <button
                onClick={() => setRejectingUid(it.uid)}
                className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-semibold inline-flex items-center gap-1"
              >
                <X className="w-4 h-4" /> Reject
              </button>
              <button
                onClick={() => approve.mutate(it.uid)}
                disabled={approve.isPending}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-1"
              >
                <Check className="w-4 h-4" /> Approve
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
