"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import api from "../../../services/api";
import UserAvatar from "../../../components/common/UserAvatar";
import DocReviewTab from "./DocReviewTab";
import { APP_NAME } from "../../../config/branding";
import {
  Check,
  X,
  Mic,
  Volume2,
  Play,
  Pause,
  Shield,
  ShieldCheck,
  Eye,
  ZoomIn,
  Calendar,
  Clock,
  MessageCircle,
  Phone,
  Mail,
  AlertTriangle,
  Users,
  User,
  CreditCard,
  Video,
  Send,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Briefcase,
  Home
} from "lucide-react";

interface VerificationRequest {
  requestId: string;
  userId: string;
  type: "identity" | "full";
  status: string;
  submittedAt: { seconds: number } | null;
  userName: string;
  userEmail: string;
  userPhone: string;
  userPhoto: string;
  userCreatedAt: { seconds: number } | null;
  cnicFrontUrl?: string;
  cnicBackUrl?: string;
  paymentStatus?: string;
  paymentAmount?: number;
  availability?: string[];
  availabilityNotes?: string;
  meetingDate?: string;
  meetingTime?: string;
  meetingLink?: string;
}

interface VoiceVerificationItem {
  uid: string;
  displayName: string;
  email: string;
  gender: string;
  city: string;
  profession: string;
  profileImage: string | null;
  voiceIntroUrl: string;
  voiceVerificationStatus: string;
  voiceRejectionReason?: string | null;
  genderVerified: boolean;
  isVerified: boolean;
  createdAt: any;
  submittedAt: any;
}

interface Stats {
  pendingIdentity: number;
  pendingFull: number;
  approvedToday: number;
  rejectedToday: number;
  totalIdentityVerified: number;
  totalVoiceVerified: number;
}

// A Firestore Timestamp serialized through the Admin SDK's JSON response
// comes back as { _seconds, _nanoseconds } (underscore-prefixed) — this read
// `ts.seconds` (no underscore), which is always undefined, producing
// `new Date(NaN)` → "Invalid Date" on every request, confirmed live in the
// admin panel. Accepts either shape so a raw `.toDate()`-converted value
// (a plain `{ seconds }`, if any caller ever passes one) still works too.
const formatDate = (ts: { seconds?: number; _seconds?: number } | null) => {
  const seconds = ts?._seconds ?? ts?.seconds;
  return typeof seconds === "number"
    ? new Date(seconds * 1000).toLocaleDateString("en-PK", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
};

// cnicFrontUrl/cnicBackUrl are never plain public URLs — the Flutter app
// (R2UploadService.uploadMedia) deliberately stores only an opaque R2 object
// key for verification documents, by design (there is no durable public URL
// for these at all). Rendering that key directly as an <img src> — the
// previous behavior — always shows a broken image. This resolves it into a
// short-lived signed GET via /api/verification/document-url first. A value
// that's already a URL (a legacy record, or a category with a public domain)
// is passed through unchanged.
function SecureCnicImage({
  reference,
  label,
  onOpen,
}: {
  reference: string;
  label: string;
  onOpen: (resolvedUrl: string) => void;
}) {
  const isDirectUrl = /^https?:\/\//.test(reference);
  const { data, isLoading, isError } = useQuery<{ data: { url: string } }>({
    queryKey: ["cnic-document-url", reference],
    queryFn: () => api.get("/verification/document-url", { params: { key: reference } }).then((r) => r.data),
    enabled: !isDirectUrl,
    staleTime: 4 * 60 * 1000, // signed URL is valid 5 minutes server-side
    retry: 1,
  });

  const resolvedUrl = isDirectUrl ? reference : data?.data?.url;

  return (
    <div
      onClick={resolvedUrl ? () => onOpen(resolvedUrl) : undefined}
      className={`relative group ${resolvedUrl ? "cursor-pointer" : ""} w-24 h-16 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shadow-xs flex-shrink-0`}
    >
      {resolvedUrl ? (
        <img src={resolvedUrl} alt={label} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[9px] text-slate-400 text-center px-1">
          {isLoading ? "Loading…" : isError ? "Failed to load" : "…"}
        </div>
      )}
      {resolvedUrl && (
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
          <ZoomIn className="w-5 h-5" />
        </div>
      )}
      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 text-[9px] font-bold text-white rounded">
        {label}
      </span>
    </div>
  );
}

export default function VerificationPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<
    "identity" | "full" | "voice" | "education" | "single" | "human" | "income" | "property"
  >("identity");
  const [selectedReq, setSelectedReq] = useState<VerificationRequest | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);
  const [schedulingReq, setSchedulingReq] = useState<VerificationRequest | null>(null);
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingTime, setMeetingTime] = useState("");
  const [meetingLink, setMeetingLink] = useState("");

  // Every mutation below previously had no onError at all — a failed
  // approve/reject/schedule request (permission error, network issue, bad
  // route) failed completely silently, which looks exactly like "nothing is
  // working" from the admin's side.
  const showMutationError = (action: string) => (error: any) => {
    console.error(`[Verification] ${action} failed:`, error?.response?.status, error?.response?.data, error);
    alert(
      error?.response?.data?.error ||
        error?.response?.data?.message ||
        `Failed to ${action} (${error?.response?.status || "network error"}).`
    );
  };

  // Stats
  const { data: statsData } = useQuery<{ data: Stats }>({
    queryKey: ["verification-stats"],
    queryFn: () => api.get("/verification/stats").then((r) => r.data),
    refetchInterval: 30000,
  });
  const stats = statsData?.data;

  // Identity Queue
  const { data: identityData, isLoading: identityLoading } = useQuery<{ data: VerificationRequest[] }>({
    queryKey: ["identity-queue"],
    queryFn: () => api.get("/verification/identity/queue").then((r) => r.data),
    refetchInterval: 15000,
  });


  // Voice Queue
  const [rejectingVoiceUid, setRejectingVoiceUid] = useState<string | null>(null);
  const [voiceRejectReason, setVoiceRejectReason] = useState("");
  // The backend returns pending + already-decided items together (sorted
  // pending-first) — previously they all rendered in one continuous list
  // forever, with Approve/Reject buttons still active on already-approved
  // items. This splits them into distinct Pending/Approved/Rejected views.
  const [voiceStatusFilter, setVoiceStatusFilter] = useState<"pending" | "approved" | "rejected">("pending");

  const { data: voiceData, isLoading: voiceLoading } = useQuery<{ data: VoiceVerificationItem[] }>({
    queryKey: ["voice-verification-queue"],
    queryFn: () => api.get("/verification/voice-queue").then((r) => r.data),
    refetchInterval: 15000,
  });
  const voiceQueue = voiceData?.data || [];
  const voiceQueueByStatus = {
    pending: voiceQueue.filter((v) => v.voiceVerificationStatus === "pending"),
    approved: voiceQueue.filter((v) => v.voiceVerificationStatus === "approved"),
    rejected: voiceQueue.filter((v) => v.voiceVerificationStatus === "rejected"),
  };
  const visibleVoiceQueue = voiceQueueByStatus[voiceStatusFilter];

  const approveVoiceMutation = useMutation({
    mutationFn: (uid: string) => api.patch(`/verification/${uid}/approve-voice`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voice-verification-queue"] });
      queryClient.invalidateQueries({ queryKey: ["verification-stats"] });
    },
    onError: showMutationError("approve voice verification"),
  });

  const rejectVoiceMutation = useMutation({
    mutationFn: ({ uid, reason }: { uid: string; reason: string }) =>
      api.patch(`/verification/${uid}/reject-voice`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voice-verification-queue"] });
      queryClient.invalidateQueries({ queryKey: ["verification-stats"] });
      setRejectingVoiceUid(null);
      setVoiceRejectReason("");
    },
    onError: showMutationError("reject voice verification"),
  });

  // Full Queue
  const { data: fullData, isLoading: fullLoading } = useQuery<{ data: VerificationRequest[] }>({
    queryKey: ["full-queue"],
    queryFn: () => api.get("/verification/full/queue").then((r) => r.data),
    refetchInterval: 15000,
  });

  // Document-review queue counts (Education / Confirmed Single / Human Video)
  // so each tab shows a live pending-count badge — the Identity/Full/Voice tabs
  // already did, these three didn't. Same queryKey as the DocReviewTab that
  // renders the list, so react-query shares one fetch (no duplicate request).
  const { data: educationData } = useQuery<{ data: any[] }>({
    queryKey: ["education-queue"],
    queryFn: () => api.get("/verification/education/queue").then((r) => r.data),
    refetchInterval: 15000,
  });
  const { data: singleData } = useQuery<{ data: any[] }>({
    queryKey: ["single-queue"],
    queryFn: () => api.get("/verification/single/queue").then((r) => r.data),
    refetchInterval: 15000,
  });
  const { data: humanData } = useQuery<{ data: any[] }>({
    queryKey: ["human-queue"],
    queryFn: () => api.get("/verification/human/queue").then((r) => r.data),
    refetchInterval: 15000,
  });
  const { data: incomeData } = useQuery<{ data: any[] }>({
    queryKey: ["income-queue"],
    queryFn: () => api.get("/verification/income/queue").then((r) => r.data),
    refetchInterval: 15000,
  });
  const { data: propertyData } = useQuery<{ data: any[] }>({
    queryKey: ["property-queue"],
    queryFn: () => api.get("/verification/property/queue").then((r) => r.data),
    refetchInterval: 15000,
  });
  const educationCount = educationData?.data?.length ?? 0;
  const singleCount = singleData?.data?.length ?? 0;
  const humanCount = humanData?.data?.length ?? 0;
  const incomeCount = incomeData?.data?.length ?? 0;
  const propertyCount = propertyData?.data?.length ?? 0;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["identity-queue"] });
    queryClient.invalidateQueries({ queryKey: ["full-queue"] });
    queryClient.invalidateQueries({ queryKey: ["verification-stats"] });
    setSelectedReq(null);
    setSchedulingReq(null);
    setRejectReason("");
    setIsRejecting(false);
  };

  const approveMutation = useMutation({
    mutationFn: ({ requestId, type }: { requestId: string; type: string }) =>
      api.patch(`/verification/${type}/${requestId}/approve`),
    onSuccess: invalidate,
    onError: showMutationError("approve verification"),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ requestId, type, reason }: { requestId: string; type: string; reason: string }) =>
      api.patch(`/verification/${type}/${requestId}/reject`, { reason }),
    onSuccess: invalidate,
    onError: showMutationError("reject verification"),
  });

  const scheduleMutation = useMutation({
    mutationFn: ({
      requestId,
      date,
      time,
      link,
    }: {
      requestId: string;
      date: string;
      time: string;
      link: string;
    }) =>
      api.patch(`/verification/full/${requestId}/schedule`, {
        meetingDate: date,
        meetingTime: time,
        meetingLink: link,
      }),
    onSuccess: invalidate,
    onError: showMutationError("schedule meeting"),
  });

  const confirmPaymentMutation = useMutation({
    mutationFn: (requestId: string) => api.patch(`/verification/full/${requestId}/confirm-payment`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["full-queue"] }),
    onError: showMutationError("confirm payment"),
  });

  const identityQueue = identityData?.data || [];
  const fullQueue = fullData?.data || [];

  const copyWhatsApp = (req: VerificationRequest) => {
    const msg = `Assalamu Alaikum ${req.userName},

Your ${APP_NAME} Full Verification interview has been scheduled:

📅 Date: ${req.meetingDate || meetingDate}
⏰ Time: ${req.meetingTime || meetingTime}
🔗 Video Link: ${req.meetingLink || meetingLink}

Please ensure you have your original CNIC and join on time. BarakAllahu Feek!

— ${APP_NAME} Verification Team`;
    navigator.clipboard.writeText(msg);
  };

  return (
    <div className="space-y-6">
      {/* 1. Metric Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          {
            label: "Pending Identity",
            value: stats?.pendingIdentity ?? "0",
            icon: Shield,
            color: "text-amber-600 bg-amber-50 border-amber-200",
          },
          {
            label: "Pending Full Interview",
            value: stats?.pendingFull ?? "0",
            icon: ShieldCheck,
            color: "text-indigo-600 bg-indigo-50 border-indigo-200",
          },
          {
            // Now includes identity + full + voice approvals from today,
            // not just identity/full — previously acting on the Voice tab
            // never moved this number at all.
            label: "Approved Today",
            value: stats?.approvedToday ?? "0",
            icon: Check,
            color: "text-emerald-600 bg-emerald-50 border-emerald-200",
          },
          {
            label: "Rejected Today",
            value: stats?.rejectedToday ?? "0",
            icon: X,
            color: "text-rose-600 bg-rose-50 border-rose-200",
          },
          {
            label: "Identity Verified",
            value: stats?.totalIdentityVerified ?? "—",
            icon: Users,
            color: "text-slate-700 bg-slate-100 border-slate-200",
          },
          {
            label: "Voice Verified",
            value: stats?.totalVoiceVerified ?? "—",
            icon: Mic,
            color: "text-purple-600 bg-purple-50 border-purple-200",
          },
        ].map((item, idx) => (
          <div
            key={idx}
            className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-xs flex items-center gap-3.5"
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border flex-shrink-0 ${item.color}`}>
              <item.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xl font-bold font-display text-slate-900 leading-tight">
                {item.value}
              </p>
              <p className="text-[11px] text-slate-400 font-semibold">{item.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* 2. Mode Selector Tabs — horizontally scrollable so all 8 queues stay
          reachable (and each stays single-line) on narrower screens. */}
      <div className="flex items-center gap-2 p-1.5 bg-slate-100/90 rounded-2xl border border-slate-200/80 overflow-x-auto max-w-full">
        <button
          onClick={() => setActiveTab("identity")}
          className={`flex-shrink-0 whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "identity"
              ? "bg-white text-indigo-600 shadow-xs"
              : "text-slate-500 hover:text-slate-900"
          }`}
        >
          <Shield className="w-4 h-4" />
          CNIC Identity Queue
          {identityQueue.length > 0 && (
            <span className="px-2 py-0.5 bg-amber-500 text-white rounded-full text-[10px] font-bold ml-1">
              {identityQueue.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("full")}
          className={`flex-shrink-0 whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "full"
              ? "bg-white text-indigo-600 shadow-xs"
              : "text-slate-500 hover:text-slate-900"
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          Full Video Verification
          {fullQueue.length > 0 && (
            <span className="px-2 py-0.5 bg-indigo-600 text-white rounded-full text-[10px] font-bold ml-1">
              {fullQueue.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("voice")}
          className={`flex-shrink-0 whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "voice"
              ? "bg-white text-indigo-600 shadow-xs"
              : "text-slate-500 hover:text-slate-900"
          }`}
        >
          <Mic className="w-4 h-4 text-purple-600" />
          Voice Gender Verification
          {voiceQueue.filter((v: any) => v.voiceVerificationStatus === "pending").length > 0 && (
            <span className="px-2 py-0.5 bg-purple-600 text-white rounded-full text-[10px] font-bold ml-1">
              {voiceQueue.filter((v: any) => v.voiceVerificationStatus === "pending").length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("education")}
          className={`flex-shrink-0 whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "education" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-500 hover:text-slate-900"
          }`}
        >
          <Shield className="w-4 h-4 text-indigo-600" />
          Education
          {educationCount > 0 && (
            <span className="px-2 py-0.5 bg-indigo-600 text-white rounded-full text-[10px] font-bold ml-1">
              {educationCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("single")}
          className={`flex-shrink-0 whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "single" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-500 hover:text-slate-900"
          }`}
        >
          <ShieldCheck className="w-4 h-4 text-pink-600" />
          Confirmed Single
          {singleCount > 0 && (
            <span className="px-2 py-0.5 bg-pink-600 text-white rounded-full text-[10px] font-bold ml-1">
              {singleCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("human")}
          className={`flex-shrink-0 whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "human" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-500 hover:text-slate-900"
          }`}
        >
          <Video className="w-4 h-4 text-teal-600" />
          Human Video
          {humanCount > 0 && (
            <span className="px-2 py-0.5 bg-teal-600 text-white rounded-full text-[10px] font-bold ml-1">
              {humanCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("income")}
          className={`flex-shrink-0 whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "income" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-500 hover:text-slate-900"
          }`}
        >
          <Briefcase className="w-4 h-4 text-amber-600" />
          Income
          {incomeCount > 0 && (
            <span className="px-2 py-0.5 bg-amber-600 text-white rounded-full text-[10px] font-bold ml-1">
              {incomeCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("property")}
          className={`flex-shrink-0 whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "property" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-500 hover:text-slate-900"
          }`}
        >
          <Home className="w-4 h-4 text-emerald-600" />
          Property
          {propertyCount > 0 && (
            <span className="px-2 py-0.5 bg-emerald-600 text-white rounded-full text-[10px] font-bold ml-1">
              {propertyCount}
            </span>
          )}
        </button>

      </div>

      {/* 3. Identity Verification Queue */}
      {activeTab === "identity" && (
        <div>
          {identityLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-28 bg-white rounded-2xl border border-slate-200/80 shimmer" />
              ))}
            </div>
          ) : identityQueue.length === 0 ? (
            <div className="py-20 text-center bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <ShieldCheck className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-900 font-display">
                Identity Queue is Clear!
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                All submitted CNIC identity verification documents have been audited.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence>
                {identityQueue.map((req) => (
                  <motion.div
                    key={req.requestId}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-xs hover:shadow-sm transition-all flex flex-col md:flex-row gap-5 items-start md:items-center justify-between"
                  >
                    {/* User info */}
                    <div className="flex items-center gap-4 min-w-0">
                      <UserAvatar
                        src={req.userPhoto}
                        name={req.userName}
                        className="w-12 h-12 rounded-xl shadow-xs flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <h4 className="font-bold text-slate-900 text-sm truncate">
                          {req.userName || "Unnamed Candidate"}
                        </h4>
                        <p className="text-xs text-slate-500 flex items-center gap-1.5 truncate mt-0.5">
                          <Mail className="w-3.5 h-3.5 text-slate-400" />
                          {req.userEmail || "No email"}
                        </p>
                        <p className="text-xs text-slate-500 flex items-center gap-1.5 truncate mt-0.5">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          {req.userPhone || "No phone number"}
                        </p>
                        <span className="text-[10px] text-slate-400 block mt-1">
                          Submitted: {formatDate(req.submittedAt)}
                        </span>
                      </div>
                    </div>

                    {/* CNIC Document Previews */}
                    <div className="flex items-center gap-3">
                      {[
                        { url: req.cnicFrontUrl, label: "CNIC Front" },
                        { url: req.cnicBackUrl, label: "CNIC Back" },
                      ].map(({ url, label }) =>
                        url ? (
                          <SecureCnicImage
                            key={label}
                            reference={url}
                            label={label}
                            onOpen={setZoomedImage}
                          />
                        ) : (
                          <div
                            key={label}
                            className="w-24 h-16 rounded-xl border border-dashed border-slate-200 flex items-center justify-center text-[10px] text-slate-400 bg-slate-50"
                          >
                            {label} N/A
                          </div>
                        )
                      )}
                    </div>

                    {/* Action Controls */}
                    <div className="flex items-center gap-2.5 flex-shrink-0 self-end md:self-auto">
                      <button
                        onClick={() =>
                          approveMutation.mutate({
                            requestId: req.requestId,
                            type: "identity",
                          })
                        }
                        disabled={approveMutation.isPending}
                        className="py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                      >
                        <Check className="w-4 h-4" />
                        Approve CNIC
                      </button>

                      <button
                        onClick={() => {
                          setSelectedReq(req);
                          setIsRejecting(true);
                        }}
                        className="py-2 px-3.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                        Reject
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* 4. Full Verification Queue */}
      {activeTab === "full" && (
        <div>
          {fullLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-32 bg-white rounded-2xl border border-slate-200/80 shimmer" />
              ))}
            </div>
          ) : fullQueue.length === 0 ? (
            <div className="py-20 text-center bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <ShieldCheck className="w-12 h-12 text-indigo-600 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-900 font-display">
                Full Verification Queue Clear
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                No candidate video interview requests currently pending scheduling.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {fullQueue.map((req) => (
                <div
                  key={req.requestId}
                  className="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-xs space-y-4"
                >
                  <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                    <div className="flex items-center gap-4">
                      <UserAvatar
                        src={req.userPhoto}
                        name={req.userName}
                        className="w-12 h-12 rounded-xl shadow-xs flex-shrink-0"
                      />
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">
                          {req.userName || "Unnamed Candidate"}
                        </h4>
                        <p className="text-xs text-slate-500">{req.userEmail}</p>
                        <p className="text-xs text-slate-500">{req.userPhone || "No phone"}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                          req.paymentStatus === "confirmed"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}
                      >
                        Payment: {req.paymentStatus === "confirmed" ? "Confirmed" : "Pending"}
                      </span>

                      <span className="px-3 py-1 rounded-full text-xs font-bold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {req.status.replace(/_/g, " ")}
                      </span>

                      {req.paymentStatus !== "confirmed" && (
                        <button
                          onClick={() => confirmPaymentMutation.mutate(req.requestId)}
                          className="py-1.5 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                        >
                          Confirm Payment
                        </button>
                      )}
                    </div>
                  </div>

                  {req.availabilityNotes && (
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                        Candidate Availability Notes
                      </span>
                      <p className="text-slate-700 italic">&ldquo;{req.availabilityNotes}&rdquo;</p>
                    </div>
                  )}

                  {req.meetingDate && (
                    <div className="p-3.5 bg-indigo-50/60 rounded-xl border border-indigo-100 text-xs space-y-1">
                      <p className="font-bold text-indigo-950 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                        Meeting: {req.meetingDate} at {req.meetingTime}
                      </p>
                      {req.meetingLink && (
                        <p className="truncate">
                          <span className="text-slate-500">Link: </span>
                          <a
                            href={req.meetingLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-600 underline font-semibold"
                          >
                            {req.meetingLink}
                          </a>
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2.5 pt-2 border-t border-slate-100">
                    {(req.status === "waiting_schedule" || req.status === "payment_pending") && (
                      <button
                        onClick={() => setSchedulingReq(req)}
                        className="py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        Schedule Video Meeting
                      </button>
                    )}

                    {(req.status === "scheduled" || req.status === "meeting_done") && (
                      <>
                        <button
                          onClick={() => copyWhatsApp(req)}
                          className="py-2 px-3.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          Copy WhatsApp Msg
                        </button>
                        <button
                          onClick={() =>
                            approveMutation.mutate({
                              requestId: req.requestId,
                              type: "full",
                            })
                          }
                          className="py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                          Approve Verification
                        </button>
                        <button
                          onClick={() => {
                            setSelectedReq(req);
                            setIsRejecting(true);
                          }}
                          className="py-2 px-3.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. Document Zoom Modal */}
      <AnimatePresence>
        {zoomedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 cursor-zoom-out"
            onClick={() => setZoomedImage(null)}
          >
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              src={zoomedImage}
              alt="Document Full View"
              className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 6. Rejection Modal */}
      <AnimatePresence>
        {selectedReq && isRejecting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl max-w-md w-full p-6 border border-slate-200 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-2 text-rose-600">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-bold text-slate-900 text-base">Reject Verification Request</h3>
              </div>

              <p className="text-xs text-slate-500">
                Candidate: <strong className="text-slate-800">{selectedReq.userName}</strong> ({selectedReq.type})
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Rejection Reason *
                </label>
                <textarea
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Explain why the verification was rejected (e.g. blurry image, expired document)..."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                />
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  onClick={() => {
                    setIsRejecting(false);
                    setSelectedReq(null);
                  }}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  disabled={!rejectReason || rejectMutation.isPending}
                  onClick={() =>
                    rejectMutation.mutate({
                      requestId: selectedReq.requestId,
                      type: selectedReq.type,
                      reason: rejectReason,
                    })
                  }
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  Confirm Rejection
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 7. Schedule Meeting Modal */}
      <AnimatePresence>
        {schedulingReq && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl max-w-md w-full p-6 border border-slate-200 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-2 text-indigo-600">
                <Calendar className="w-5 h-5" />
                <h3 className="font-bold text-slate-900 text-base">Schedule Full Verification Interview</h3>
              </div>

              <p className="text-xs text-slate-500">
                Candidate: <strong className="text-slate-800">{schedulingReq.userName}</strong>
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Interview Date</label>
                  <input
                    type="date"
                    value={meetingDate}
                    onChange={(e) => setMeetingDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Interview Time</label>
                  <input
                    type="time"
                    value={meetingTime}
                    onChange={(e) => setMeetingTime(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Google Meet / Zoom URL</label>
                  <input
                    type="url"
                    value={meetingLink}
                    onChange={(e) => setMeetingLink(e.target.value)}
                    placeholder="https://meet.google.com/..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  onClick={() => setSchedulingReq(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  disabled={!meetingDate || !meetingTime || scheduleMutation.isPending}
                  onClick={() =>
                    scheduleMutation.mutate({
                      requestId: schedulingReq.requestId,
                      date: meetingDate,
                      time: meetingTime,
                      link: meetingLink,
                    })
                  }
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  Save & Notify
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    
      {/* 5. Voice & Gender Verification Queue */}
      {activeTab === "voice" && (
        <div>
          {/* Pending / Approved / Rejected sub-filter */}
          <div className="flex items-center gap-1.5 mb-4 bg-white p-1 rounded-xl border border-slate-200/80 w-fit">
            {(["pending", "approved", "rejected"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setVoiceStatusFilter(s)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold capitalize transition-all cursor-pointer ${
                  voiceStatusFilter === s ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {s} ({voiceQueueByStatus[s].length})
              </button>
            ))}
          </div>

          {voiceLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-32 bg-white rounded-2xl border border-slate-200/80 shimmer" />
              ))}
            </div>
          ) : visibleVoiceQueue.length === 0 ? (
            <div className="py-20 text-center bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <Mic className="w-12 h-12 text-purple-500 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-900 font-display">
                {voiceStatusFilter === "pending"
                  ? "Voice Verification Queue is Clear!"
                  : `No ${voiceStatusFilter} voice verifications yet.`}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                No {voiceStatusFilter} voice recordings to show.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence>
                {visibleVoiceQueue.map((item) => {
                  const isApproved = item.voiceVerificationStatus === "approved";
                  const isRejected = item.voiceVerificationStatus === "rejected";

                  return (
                    <motion.div
                      key={item.uid}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      className="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-xs hover:shadow-sm transition-all flex flex-col lg:flex-row gap-5 items-start lg:items-center justify-between"
                    >
                      {/* User Info */}
                      <div className="flex items-center gap-4 min-w-0">
                        <UserAvatar
                          src={item.profileImage || undefined}
                          name={item.displayName}
                          gender={item.gender}
                          className="w-14 h-14 rounded-2xl shadow-xs flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900 truncate">
                              {item.displayName}
                            </h4>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                                item.gender?.toLowerCase() === "female"
                                  ? "bg-rose-50 text-rose-700 border border-rose-200"
                                  : "bg-blue-50 text-blue-700 border border-blue-200"
                              }`}
                            >
                              {item.gender}
                            </span>
                            {isApproved && (
                              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[10px] font-bold inline-flex items-center gap-1">
                                <Check className="w-3 h-3 text-emerald-600" />
                                Verified Badge Active
                              </span>
                            )}
                            {isRejected && (
                              <span className="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-md text-[10px] font-bold">
                                Rejected
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                            <span className="flex items-center gap-1">
                              <Mail className="w-3.5 h-3.5 text-slate-400" />
                              {item.email}
                            </span>
                            <span>•</span>
                            <span>{item.city}</span>
                            <span>•</span>
                            <span>{item.profession}</span>
                          </div>

                          {item.voiceRejectionReason && (
                            <p className="text-[11px] text-rose-600 mt-1 font-medium bg-rose-50 px-2 py-0.5 rounded-md inline-block">
                              Rejection Reason: {item.voiceRejectionReason}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Embedded Audio Player & Action Buttons */}
                      <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
                        {/* Audio Player */}
                        <div className="w-full sm:w-72 bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <audio
                              controls
                              src={item.voiceIntroUrl}
                              className="w-full h-8 outline-none"
                              preload="metadata"
                              onError={(e) => {
                                (e.currentTarget.nextElementSibling as HTMLElement)?.classList.remove("hidden");
                              }}
                            />
                          </div>
                          <p className="hidden text-[10px] text-rose-600 font-semibold">
                            This browser couldn&apos;t load the audio inline.{" "}
                            <a
                              href={item.voiceIntroUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline hover:text-rose-800"
                            >
                              Open the recording directly
                            </a>
                            {" "}to verify it plays.
                          </p>
                        </div>

                        {/* Actions — only meaningful while still pending;
                            approved/rejected items are shown read-only. */}
                        {!isApproved && !isRejected && (
                          <div className="flex items-center gap-2 w-full sm:w-auto">
                            <button
                              disabled={approveVoiceMutation.isPending}
                              onClick={() => approveVoiceMutation.mutate(item.uid)}
                              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Approve Voice & Badge
                            </button>

                            <button
                              disabled={rejectVoiceMutation.isPending}
                              onClick={() => {
                                setRejectingVoiceUid(item.uid);
                                setVoiceRejectReason("");
                              }}
                              className="flex-1 sm:flex-none px-3.5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              <X className="w-3.5 h-3.5" />
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {activeTab === "education" && (
        <DocReviewTab
          title="Education"
          queueKey="education-queue"
          queuePath="/verification/education/queue"
          approvePath={(uid) => `/verification/${uid}/approve-education`}
          rejectPath={(uid) => `/verification/${uid}/reject-education`}
          kind="doc"
        />
      )}
      {activeTab === "single" && (
        <DocReviewTab
          title="Confirmed Single"
          queueKey="single-queue"
          queuePath="/verification/single/queue"
          approvePath={(uid) => `/verification/${uid}/approve-single`}
          rejectPath={(uid) => `/verification/${uid}/reject-single`}
          kind="doc"
        />
      )}
      {activeTab === "human" && (
        <DocReviewTab
          title="Human Video"
          queueKey="human-queue"
          queuePath="/verification/human/queue"
          approvePath={(uid) => `/verification/${uid}/approve-human`}
          rejectPath={(uid) => `/verification/${uid}/reject-human`}
          meetingLinkPath={(uid) => `/verification/${uid}/human-meeting-link`}
          kind="human"
        />
      )}
      {activeTab === "income" && (
        <DocReviewTab
          title="Income"
          queueKey="income-queue"
          queuePath="/verification/income/queue"
          approvePath={(uid) => `/verification/${uid}/approve-income`}
          rejectPath={(uid) => `/verification/${uid}/reject-income`}
          kind="doc"
        />
      )}
      {activeTab === "property" && (
        <DocReviewTab
          title="Property"
          queueKey="property-queue"
          queuePath="/verification/property/queue"
          approvePath={(uid) => `/verification/${uid}/approve-property`}
          rejectPath={(uid) => `/verification/${uid}/reject-property`}
          kind="doc"
        />
      )}

      {/* Voice Rejection Modal */}
      <AnimatePresence>
        {rejectingVoiceUid && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl max-w-md w-full p-6 border border-slate-200 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-rose-600" />
                  Reject Voice Verification
                </h3>
                <button
                  onClick={() => setRejectingVoiceUid(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-700">
                  Select or Enter Rejection Reason
                </label>

                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Audio is inaudible or low volume",
                    "Gender voice mismatch with profile",
                    "Background noise / multiple speakers",
                    "Inappropriate language or background speech",
                    "Recording is too short",
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setVoiceRejectReason(chip)}
                      className="px-2.5 py-1 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors cursor-pointer"
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                <textarea
                  rows={3}
                  value={voiceRejectReason}
                  onChange={(e) => setVoiceRejectReason(e.target.value)}
                  placeholder="Provide detailed feedback for the candidate..."
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 resize-none"
                />

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setRejectingVoiceUid(null)}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (rejectingVoiceUid) {
                        rejectVoiceMutation.mutate({
                          uid: rejectingVoiceUid,
                          reason: voiceRejectReason || "Voice verification guidelines not met.",
                        });
                      }
                    }}
                    disabled={rejectVoiceMutation.isPending}
                    className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 shadow-xs"
                  >
                    {rejectVoiceMutation.isPending ? "Rejecting..." : "Confirm Rejection"}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

</div>
  );
}
