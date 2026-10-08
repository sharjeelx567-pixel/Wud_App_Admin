"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import api from "../../../services/api";
import UserAvatar from "../../../components/common/UserAvatar";
import {
  ShieldCheck,
  CheckCircle2,
  EyeOff,
  Eye,
  Trash2,
  Clock,
  Flag,
  Heart,
} from "lucide-react";

interface AdminPost {
  id: string;
  authorUid: string;
  author: { name?: string; email?: string } | null;
  displayName: string;
  age: number;
  city: string;
  photoUrl: string | null;
  aboutMe: string;
  status: "pending" | "active" | "hidden" | "removed";
  moderationReason: string | null;
  likeCount: number;
  reportCount: number;
  createdAt: any;
}

export default function PostsPage() {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const { data, isLoading } = useQuery<{ data: { data: AdminPost[] } }>({
    queryKey: ["posts-list", filterStatus],
    queryFn: async () => {
      const param = filterStatus !== "all" ? `?status=${filterStatus}` : "";
      const response = await api.get(`/posts${param}`);
      return response.data;
    },
    refetchInterval: 15000,
  });

  const posts = data?.data?.data || [];

  const moderate = (id: string, action: "approve" | "hide" | "unhide" | "remove") =>
    api.patch(`/posts/${id}/${action}`, { reason: action === "hide" ? "Moderator review" : undefined });

  const moderateMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "hide" | "unhide" | "remove" }) => moderate(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts-list"] });
    },
  });

  const formatDate = (raw: any) => {
    if (!raw) return "";
    const d = raw._seconds ? new Date(raw._seconds * 1000) : new Date(raw);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const statusBadge = (status: string) => {
    if (status === "pending") {
      return <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full text-xs font-bold">Pending Approval</span>;
    }
    if (status === "hidden") {
      return <span className="px-2.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-xs font-bold">Hidden</span>;
    }
    if (status === "removed") {
      return <span className="px-2.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-full text-xs font-bold">Removed</span>;
    }
    return <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold">Active</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 border border-slate-200/80 rounded-2xl shadow-xs">
        <div>
          <h2 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
            <Flag className="w-4 h-4 text-indigo-600" />
            Rishta Posts
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Review and moderate user-submitted rishta posts.
          </p>
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
        >
          <option value="all">All Posts</option>
          <option value="pending">Pending Approval</option>
          <option value="active">Active</option>
          <option value="hidden">Hidden</option>
          <option value="removed">Removed</option>
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 bg-white rounded-2xl border border-slate-200/80 shimmer" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white border border-slate-200/80 rounded-2xl text-center shadow-xs">
          <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 mb-3 border border-emerald-100">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold font-display text-slate-900">No Posts Found</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm">No rishta posts match the selected filter.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <AnimatePresence>
            {posts.map((post) => (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                key={post.id}
                className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-sm transition-all flex flex-col gap-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <UserAvatar src={post.photoUrl || undefined} name={post.displayName} className="w-10 h-10 rounded-xl shadow-xs" />
                    <div>
                      <h4 className="font-bold text-sm text-slate-900">{post.displayName}, {post.age}</h4>
                      <p className="text-[11px] text-slate-500">{post.city} · by {post.author?.name || post.authorUid}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{formatDate(post.createdAt)}</span>
                    {statusBadge(post.status)}
                  </div>
                </div>

                {post.aboutMe && (
                  <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100 line-clamp-3">{post.aboutMe}</p>
                )}

                {post.moderationReason && (
                  <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                    Moderation reason: {post.moderationReason}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{post.likeCount}</span>
                    {post.reportCount > 0 && (
                      <span className="flex items-center gap-1 text-rose-600 font-semibold"><Flag className="w-3.5 h-3.5" />{post.reportCount} report{post.reportCount === 1 ? "" : "s"}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {post.status === "pending" && (
                      <button
                        onClick={() => moderateMutation.mutate({ id: post.id, action: "approve" })}
                        disabled={moderateMutation.isPending}
                        className="py-2 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                      </button>
                    )}
                    {post.status === "active" && (
                      <button
                        onClick={() => moderateMutation.mutate({ id: post.id, action: "hide" })}
                        disabled={moderateMutation.isPending}
                        className="py-2 px-3.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <EyeOff className="w-3.5 h-3.5" /> Hide
                      </button>
                    )}
                    {(post.status === "hidden" || post.status === "removed") && (
                      <button
                        onClick={() => moderateMutation.mutate({ id: post.id, action: "unhide" })}
                        disabled={moderateMutation.isPending}
                        className="py-2 px-3.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" /> Restore
                      </button>
                    )}
                    {post.status !== "removed" && (
                      <button
                        onClick={() => moderateMutation.mutate({ id: post.id, action: "remove" })}
                        disabled={moderateMutation.isPending}
                        className="py-2 px-3.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> {post.status === "pending" ? "Reject" : "Remove"}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
