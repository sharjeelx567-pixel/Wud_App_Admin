"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import api from "../../../services/api";
import { NikkahUser } from "../../../types";
import UserAvatar from "../../../components/common/UserAvatar";
import {
  Search,
  Users,
  Ban,
  CheckCircle,
  ShieldCheck,
  Award,
  Sparkles,
  UserX,
  UserCheck,
  Mail,
  Phone,
  X,
  Filter,
  Eye,
  Calendar,
  MapPin,
  Briefcase,
  GraduationCap,
  Clock,
  ShieldAlert,
  Trash2
} from "lucide-react";

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<NikkahUser | null>(null);

  // Ban/Suspend prompt controls
  const [banReason, setBanReason] = useState("");
  const [suspendDays, setSuspendDays] = useState("7");
  const [isBanning, setIsBanning] = useState(false);
  const [isSuspending, setIsSuspending] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<"details" | "photos" | "actions">("details");

  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Delete-account confirmation controls — a plain window.confirm isn't
  // enough for an irreversible, cascading account deletion, so this requires
  // typing the literal word DELETE before the button even enables.
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Users are loaded through the authenticated admin API, not a direct
  // Firestore listener.
  //
  // The admin console authenticates with its own JWT against the `admins`
  // collection and never establishes a Firebase Auth session, so a client-side
  // onSnapshot on `users` only ever worked because the security rules had
  // `allow read: if true` — i.e. the whole user table was world-readable. That
  // rule is now `isSignedIn()`, so the listener would fail permission-denied.
  // The backend route runs under the Admin SDK and is permission-gated.
  const {
    data: users = [],
    isLoading,
  } = useQuery<NikkahUser[]>({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await api.get("/users", { params: { limit: 1000, page: 1 } });
      const payload = res.data?.data;
      const list: NikkahUser[] = Array.isArray(payload) ? payload : payload?.data ?? [];
      return [...list].sort((a, b) => {
        const t = (v: any) =>
          v?.toDate?.()?.getTime?.() ?? (v?.seconds ? v.seconds * 1000 : v ? Date.parse(v) || 0 : 0);
        return t(b.createdAt) - t(a.createdAt);
      });
    },
    refetchInterval: 30000,
  });

  // Local filtering and pagination
  const filteredUsers = useMemo(() => {
    let result = users;

    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(
        (u) =>
          u.displayName?.toLowerCase().includes(s) ||
          u.email?.toLowerCase().includes(s) ||
          u.city?.toLowerCase().includes(s) ||
          u.phoneNumber?.toLowerCase().includes(s)
      );
    }

    if (filter !== "all") {
      result = result.filter((u) => {
        switch (filter) {
          case "premium":
            return u.isPremium;
          case "banned":
            return u.isBanned;
          case "suspended":
            return u.isSuspended;
          case "pending_photo":
            return u.photoStatus === "pending";
          case "pending_verification":
            return u.verificationStatus === "pending";
          default:
            return true;
        }
      });
    }

    return result;
  }, [users, search, filter]);

  const itemsPerPage = 15;
  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage) || 1;
  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return filteredUsers.slice(start, start + itemsPerPage);
  }, [filteredUsers, page]);

  // Every moderation mutation must refresh the list and surface failures —
  // previously they closed the modal on success and swallowed errors entirely,
  // so a rejected request looked identical to a successful one.
  const onActionSuccess = () => {
    setActionError(null);
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    setSelectedUser(null);
  };
  const onActionError = (err: any) => {
    setActionError(
      err?.response?.data?.error || err?.message || "Action failed. Please try again."
    );
  };

  // Mutations
  const banMutation = useMutation({
    mutationFn: async ({ uid, reason }: { uid: string; reason: string }) => {
      await api.post(`/users/${uid}/ban`, { reason });
    },
    onSuccess: () => {
      setIsBanning(false);
      setBanReason("");
      onActionSuccess();
    },
    onError: onActionError,
  });

  const unbanMutation = useMutation({
    mutationFn: async (uid: string) => {
      await api.post(`/users/${uid}/unban`);
    },
    onSuccess: onActionSuccess,
    onError: onActionError,
  });

  const suspendMutation = useMutation({
    mutationFn: async ({ uid, reason, days }: { uid: string; reason: string; days: number }) => {
      await api.post(`/users/${uid}/suspend`, { reason, days });
    },
    onSuccess: () => {
      setIsSuspending(false);
      setBanReason("");
      onActionSuccess();
    },
    onError: onActionError,
  });

  const unsuspendMutation = useMutation({
    mutationFn: async (uid: string) => {
      await api.post(`/users/${uid}/unsuspend`);
    },
    onSuccess: onActionSuccess,
    onError: onActionError,
  });

  const premiumMutation = useMutation({
    mutationFn: async ({ uid, days }: { uid: string; days: number }) => {
      await api.post(`/users/${uid}/premium`, { expiresInDays: days });
    },
    onSuccess: onActionSuccess,
    onError: onActionError,
  });

  // Cascading, server-side, admin-only permanent deletion — DELETE
  // /api/users/:uid (users.controller.ts) requires { confirm: "DELETE" } in
  // the body as a second, server-enforced gate beyond this dialog, so the
  // deletion can't be triggered by a stray/replayed request either.
  const deleteMutation = useMutation({
    mutationFn: async (uid: string) => {
      await api.delete(`/users/${uid}`, { data: { confirm: "DELETE" } });
    },
    onSuccess: (_data, uid) => {
      setIsConfirmingDelete(false);
      setDeleteConfirmText("");
      setSuccessMessage(`Account ${uid.slice(0, 8)}… was permanently deleted.`);
      window.setTimeout(() => setSuccessMessage(null), 6000);
      onActionSuccess();
    },
    onError: onActionError,
  });

  const getStatusBadge = (user: NikkahUser) => {
    if (user.isBanned)
      return (
        <span className="px-2.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-full text-[11px] font-bold inline-flex items-center gap-1">
          <Ban className="w-3 h-3 text-rose-600" /> Banned
        </span>
      );
    if (user.isSuspended)
      return (
        <span className="px-2.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-[11px] font-bold inline-flex items-center gap-1">
          <Clock className="w-3 h-3 text-amber-600" /> Suspended
        </span>
      );
    return (
      <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[11px] font-bold inline-flex items-center gap-1">
        <CheckCircle className="w-3 h-3 text-emerald-600" /> Active
      </span>
    );
  };

  const formatDate = (raw: any) => {
    if (!raw) return "—";
    let d: Date;
    if (raw._seconds) d = new Date(raw._seconds * 1000);
    else if (raw.seconds) d = new Date(raw.seconds * 1000);
    else if (raw.toDate) d = raw.toDate();
    else if (typeof raw === "string" || typeof raw === "number") d = new Date(raw);
    else return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const filterTabs = [
    { id: "all", label: "All Candidates" },
    { id: "premium", label: "Premium Only" },
    { id: "pending_verification", label: "KYC Pending" },
    { id: "pending_photo", label: "Photo Review" },
    { id: "suspended", label: "Suspended" },
    { id: "banned", label: "Banned" },
  ];

  return (
    <div className="space-y-6">
      {/* 1. Header Toolbar: Search & Filter Pills */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row gap-3 justify-between items-stretch md:items-center">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search candidate by name, email, city, or phone..."
              className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 placeholder:text-slate-400 font-medium"
            />
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto text-xs text-slate-500 font-semibold">
            <span className="bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
              {filteredUsers.length} {filteredUsers.length === 1 ? "Profile" : "Profiles"} Found
            </span>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setFilter(tab.id);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                filter === tab.id
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {successMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-sm font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> {successMessage}
          </span>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-600 hover:text-emerald-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Main Users Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50/80 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">Candidate</th>
                <th className="px-6 py-4">Contact Info</th>
                <th className="px-6 py-4">Location & Details</th>
                <th className="px-6 py-4">ID Verification</th>
                <th className="px-6 py-4">Plan</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={7} className="px-6 py-5 bg-slate-50/30 h-16" />
                  </tr>
                ))
              ) : paginatedUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center text-slate-400">
                    <Users className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="text-sm font-semibold">No seeker profiles found matching your criteria.</p>
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((user) => (
                  <tr key={user.uid} className="hover:bg-slate-50/70 transition-colors">
                    {/* Candidate Name & Avatar */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <UserAvatar
                          src={user.profileImage || user.pendingProfileImage}
                          name={user.displayName}
                          gender={user.gender}
                          className="w-10 h-10 rounded-xl shadow-xs"
                        />
                        <div className="min-w-0">
                          <h4 className="font-bold text-slate-900 text-xs truncate">
                            {user.displayName || "Anonymous User"}
                          </h4>
                          <span className="text-[11px] text-slate-400 block truncate">
                            ID: {user.uid?.slice(0, 8)}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Contact Info */}
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-700 font-medium flex items-center gap-1.5 truncate">
                          <Mail className="w-3 h-3 text-slate-400 flex-shrink-0" />
                          {user.email || "No email"}
                        </span>
                        {user.phoneNumber && (
                          <span className="text-slate-400 text-[11px] flex items-center gap-1.5 truncate">
                            <Phone className="w-3 h-3 text-slate-400 flex-shrink-0" />
                            {user.phoneNumber}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Location & Details */}
                    <td className="px-6 py-4 text-slate-600">
                      <div>
                        <span>{[user.gender, user.city].filter(Boolean).join(" • ") || "—"}</span>
                        {user.profession && (
                          <span className="text-[11px] text-slate-400 block truncate mt-0.5">
                            {user.profession}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* ID Verification */}
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        {user.identityVerified ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1 w-fit">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                            CNIC Verified
                          </span>
                        ) : user.verificationStatus === "pending" ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1 w-fit">
                            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                            KYC Pending
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">Unverified</span>
                        )}
                        {/* Separate from identity/CNIC verification — approving
                            one does not imply the other. */}
                        {user.genderVerified && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200 flex items-center gap-1 w-fit">
                            <ShieldCheck className="w-3.5 h-3.5 text-sky-600" />
                            Voice Verified
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Plan */}
                    <td className="px-6 py-4">
                      {user.isPremium ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 inline-flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-amber-600 fill-amber-600" /> Premium
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs font-normal">Free Tier</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-6 py-4">{getStatusBadge(user)}</td>

                    {/* Action Button */}
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setActiveModalTab("details");
                        }}
                        className="py-1.5 px-3 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 border border-slate-200/80 shadow-2xs"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Audit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-semibold bg-slate-50/50">
            <span>
              Page {page} of {totalPages} ({filteredUsers.length} total users)
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-40 cursor-pointer transition-colors"
              >
                Previous
              </button>
              <button
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-40 cursor-pointer transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. User Detail & Moderation Modal */}
      <AnimatePresence>
        {selectedUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
            onClick={() => setSelectedUser(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl max-w-2xl w-full overflow-hidden shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <UserAvatar
                    src={selectedUser.profileImage || selectedUser.pendingProfileImage}
                    name={selectedUser.displayName}
                    gender={selectedUser.gender}
                    className="w-14 h-14 rounded-2xl shadow-sm"
                  />
                  <div>
                    <h3 className="text-lg font-bold font-display text-slate-900">
                      {selectedUser.displayName || "Anonymous User"}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                      <span>{selectedUser.email || "No email provided"}</span>
                      <span>•</span>
                      <span>{selectedUser.phoneNumber || "No phone"}</span>
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedUser(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-200/60 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Tabs */}
              <div className="flex border-b border-slate-100 px-6 bg-slate-50/30 gap-6 text-xs font-bold">
                <button
                  onClick={() => setActiveModalTab("details")}
                  className={`py-3 border-b-2 transition-colors cursor-pointer ${
                    activeModalTab === "details"
                      ? "border-indigo-600 text-indigo-600"
                      : "border-transparent text-slate-400 hover:text-slate-700"
                  }`}
                >
                  Profile Bio & Details
                </button>
                <button
                  onClick={() => setActiveModalTab("photos")}
                  className={`py-3 border-b-2 transition-colors cursor-pointer ${
                    activeModalTab === "photos"
                      ? "border-indigo-600 text-indigo-600"
                      : "border-transparent text-slate-400 hover:text-slate-700"
                  }`}
                >
                  Gallery ({selectedUser.galleryImages?.length || 0})
                </button>
                <button
                  onClick={() => setActiveModalTab("actions")}
                  className={`py-3 border-b-2 transition-colors cursor-pointer ${
                    activeModalTab === "actions"
                      ? "border-indigo-600 text-indigo-600"
                      : "border-transparent text-slate-400 hover:text-slate-700"
                  }`}
                >
                  Moderation & Actions
                </button>
              </div>

              {/* Modal Content Pane */}
              <div className="p-6 overflow-y-auto flex-1 space-y-4 text-xs">
                {activeModalTab === "details" && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Gender / Age
                      </span>
                      <p className="font-bold text-slate-900 mt-1">
                        {selectedUser.gender || "—"} / {selectedUser.age || "—"} yrs
                      </p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        City / Location
                      </span>
                      <p className="font-bold text-slate-900 mt-1">
                        {selectedUser.city || "Not specified"}
                      </p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Marital Status
                      </span>
                      <p className="font-bold text-slate-900 mt-1">
                        {selectedUser.maritalStatus || "Single"}
                      </p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Profession
                      </span>
                      <p className="font-bold text-slate-900 mt-1">
                        {selectedUser.profession || "Not listed"}
                      </p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Education
                      </span>
                      <p className="font-bold text-slate-900 mt-1">
                        {selectedUser.educationLevel || "Not specified"}
                      </p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Cast / Sect
                      </span>
                      <p className="font-bold text-slate-900 mt-1">
                        {selectedUser.sect || selectedUser.caste || "—"}
                      </p>
                    </div>
                    {selectedUser.bio && (
                      <div className="col-span-2 sm:col-span-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                          About Me
                        </span>
                        <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">
                          {selectedUser.bio}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {activeModalTab === "photos" && (
                  <div className="space-y-4">
                    {selectedUser.galleryImages && selectedUser.galleryImages.length > 0 ? (
                      <div className="grid grid-cols-3 gap-3">
                        {selectedUser.galleryImages.map((img, idx) => (
                          <div key={idx} className="aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                            <img src={img} alt="Gallery" className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-12 text-center text-slate-400">
                        No additional gallery photos uploaded by this candidate.
                      </div>
                    )}
                  </div>
                )}

                {activeModalTab === "actions" && (
                  <div className="space-y-4">
                    {/* Grant Premium */}
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-slate-900">Premium Membership</h4>
                        <p className="text-[11px] text-slate-400">Grant or renew 30-day VIP matching access</p>
                      </div>
                      <button
                        onClick={() => premiumMutation.mutate({ uid: selectedUser.uid, days: 30 })}
                        disabled={premiumMutation.isPending}
                        className="py-2 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold shadow-xs cursor-pointer"
                      >
                        Grant 30 Days Premium
                      </button>
                    </div>

                    {actionError && (
                      <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
                        {actionError}
                      </div>
                    )}

                    {/* Suspend or Ban Controls */}
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3">
                      <h4 className="font-bold text-slate-900">Account Safety & Enforcement</h4>

                      {selectedUser.isSuspended && !selectedUser.isBanned && (
                        <div className="flex items-center justify-between p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                          <span className="text-amber-700 font-bold text-xs">This user is currently suspended.</span>
                          <button
                            onClick={() => unsuspendMutation.mutate(selectedUser.uid)}
                            disabled={unsuspendMutation.isPending}
                            className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs cursor-pointer disabled:opacity-50"
                          >
                            Lift Suspension
                          </button>
                        </div>
                      )}

                      {selectedUser.isBanned ? (
                        <div className="flex items-center justify-between">
                          <span className="text-rose-600 font-bold">This user is currently permanently banned.</span>
                          <button
                            onClick={() => unbanMutation.mutate(selectedUser.uid)}
                            className="py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold cursor-pointer"
                          >
                            Unban Account
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <input
                            type="text"
                            placeholder="Reason for suspension or ban..."
                            value={banReason}
                            onChange={(e) => setBanReason(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                          />

                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                suspendMutation.mutate({
                                  uid: selectedUser.uid,
                                  reason: banReason || "Violation of community rules",
                                  days: parseInt(suspendDays),
                                })
                              }
                              disabled={suspendMutation.isPending}
                              className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold cursor-pointer"
                            >
                              Suspend (7 Days)
                            </button>
                            <button
                              onClick={() =>
                                banMutation.mutate({
                                  uid: selectedUser.uid,
                                  reason: banReason || "Severe policy violation",
                                })
                              }
                              disabled={banMutation.isPending}
                              className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold cursor-pointer"
                            >
                              Permanently Ban
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Danger Zone — permanent, cascading account deletion */}
                    <div className="p-4 bg-rose-50 rounded-2xl border border-rose-200 space-y-3">
                      <h4 className="font-bold text-rose-900 flex items-center gap-2">
                        <Trash2 className="w-4 h-4" /> Danger Zone
                      </h4>
                      <p className="text-[11px] text-rose-600 leading-relaxed">
                        Permanently deletes this account: Firebase Authentication, the full Firestore
                        record (profile, connections, interests, match requests, chats &amp; messages,
                        notifications, verification data, and every other record tied to this user), and
                        all uploaded photos/files in storage. This cannot be undone.
                      </p>
                      <button
                        onClick={() => {
                          setActionError(null);
                          setDeleteConfirmText("");
                          setIsConfirmingDelete(true);
                        }}
                        className="w-full py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-xl font-bold cursor-pointer"
                      >
                        Delete Account Permanently
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete-account confirmation dialog — layered above the details
          modal; requires typing DELETE before the destructive button
          enables, per the "strong confirmation" requirement for an
          irreversible, cascading deletion. */}
      <AnimatePresence>
        {isConfirmingDelete && selectedUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
                  <ShieldAlert className="w-5 h-5 text-rose-600" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Delete this account permanently?
                </h3>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                This action cannot be undone.{" "}
                <strong>
                  {selectedUser.displayName || selectedUser.email || selectedUser.uid}
                </strong>
                &apos;s account, profile, connections, interests, match requests, chats and
                messages, notifications, verification records, and uploaded photos/files will
                be permanently deleted from Firebase Authentication and Firestore.
              </p>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Type DELETE to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  autoFocus
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                />
              </div>
              {actionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
                  {actionError}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    setIsConfirmingDelete(false);
                    setDeleteConfirmText("");
                    setActionError(null);
                  }}
                  disabled={deleteMutation.isPending}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMutation.mutate(selectedUser.uid)}
                  disabled={deleteConfirmText !== "DELETE" || deleteMutation.isPending}
                  className="flex-1 py-2 bg-rose-700 hover:bg-rose-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-bold cursor-pointer"
                >
                  {deleteMutation.isPending ? "Deleting…" : "Delete Permanently"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

