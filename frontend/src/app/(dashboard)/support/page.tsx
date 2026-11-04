"use client";

import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import api from "../../../services/api";
import {
  Search,
  MessageSquare,
  User,
  Clock,
  CheckCircle,
  Send,
  Paperclip,
  Check,
  CheckCheck,
  Smile,
  X,
  ImageIcon,
  ExternalLink,
  LifeBuoy,
  ShieldCheck
} from "lucide-react";

const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });

interface Ticket {
  id: string;
  userId: string;
  userDisplayName: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  updatedAt: { _seconds: number; _nanoseconds: number };
  unreadCountAdmin: number;
}

interface Message {
  id: string;
  senderType: "user" | "admin";
  content: string;
  type: string;
  mediaUrl?: string;
  timestamp: { _seconds: number; _nanoseconds: number };
  isRead: boolean;
  delivered: boolean;
}

export default function SupportPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const ticketParam = searchParams.get("ticketId");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(ticketParam);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [replyText, setReplyText] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [previewModalImg, setPreviewModalImg] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (filePreview && filePreview.startsWith("blob:")) {
        URL.revokeObjectURL(filePreview);
      }
    };
  }, [filePreview]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    }
    if (showEmojiPicker) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEmojiPicker]);

  // Fetch Tickets
  const { data: ticketsData, isLoading: isLoadingTickets } = useQuery({
    queryKey: ["supportTickets"],
    queryFn: async () => {
      const res = await api.get(`/support/tickets?limit=200`);
      return res.data.data.tickets as Ticket[];
    },
    refetchInterval: 5000,
  });

  // The sidebar unread badge now polls every 60s; while this page is open,
  // refresh it whenever the ticket list changes (opening a ticket marks it
  // read) so it stays as current as it was with the old 5s poll.
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["support-unread-count"] });
  }, [ticketsData, queryClient]);

  const filteredTickets = React.useMemo(() => {
    if (!ticketsData) return [];
    return ticketsData.filter((ticket) => {
      const matchesStatus = filterStatus
        ? ticket.status.toLowerCase() === filterStatus.toLowerCase()
        : true;
      const matchesSearch = searchTerm
        ? ticket.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (ticket.userDisplayName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
          ticket.id.toLowerCase().includes(searchTerm.replace("#", "").toLowerCase())
        : true;
      return matchesStatus && matchesSearch;
    });
  }, [ticketsData, filterStatus, searchTerm]);

  // Fetch Active Ticket Details
  const { data: activeTicketData, isLoading: isLoadingChat } = useQuery({
    queryKey: ["supportTicket", selectedTicketId],
    queryFn: async () => {
      if (!selectedTicketId) return null;
      const res = await api.get(`/support/tickets/${selectedTicketId}`);
      return res.data.data as { ticket: Ticket; messages: Message[] };
    },
    enabled: !!selectedTicketId,
    refetchInterval: 3000,
  });

  // Opening a ticket marks it read server-side — refresh the badge then too.
  useEffect(() => {
    if (activeTicketData) queryClient.invalidateQueries({ queryKey: ["support-unread-count"] });
  }, [activeTicketData?.ticket?.id, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  // Send Reply Mutation
  const replyMutation = useMutation({
    mutationFn: async ({
      content,
      mediaUrl,
      type,
    }: {
      content: string;
      mediaUrl?: string | null;
      type: string;
    }) => {
      await api.post(`/support/tickets/${selectedTicketId}/reply`, { content, mediaUrl, type });
    },
    onSuccess: () => {
      setReplyText("");
      clearSelectedFile();
      queryClient.invalidateQueries({ queryKey: ["supportTicket", selectedTicketId] });
      queryClient.invalidateQueries({ queryKey: ["supportTickets"] });
    },
  });

  // Change Status Mutation
  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      await api.put(`/support/tickets/${selectedTicketId}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supportTicket", selectedTicketId] });
      queryClient.invalidateQueries({ queryKey: ["supportTickets"] });
    },
  });

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeTicketData?.messages]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        alert("Please select an image file.");
        return;
      }
      setSelectedFile(file);
      setFilePreview(URL.createObjectURL(file));
    }
  };

  const clearSelectedFile = () => {
    if (filePreview && filePreview.startsWith("blob:")) {
      URL.revokeObjectURL(filePreview);
    }
    setSelectedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicketId) return;
    if (!replyText.trim() && !selectedFile) return;

    setShowEmojiPicker(false);

    try {
      let uploadedMediaUrl: string | null = null;
      let msgType = "text";

      if (selectedFile) {
        setIsUploading(true);
        const formData = new FormData();
        formData.append("file", selectedFile);

        const uploadRes = await api.post("/support/upload", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });

        if (uploadRes.data?.data?.url) {
          uploadedMediaUrl = uploadRes.data.data.url;
          msgType = "image";
        }
      }

      await replyMutation.mutateAsync({
        content: replyText.trim(),
        mediaUrl: uploadedMediaUrl,
        type: msgType,
      });
    } catch (err: any) {
      console.error("Failed to send message:", err);
      alert(err.response?.data?.message || "Failed to send message/photo. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleEmojiClick = (emojiData: { emoji: string }) => {
    const emoji = emojiData.emoji;
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart ?? replyText.length;
      const end = textarea.selectionEnd ?? replyText.length;
      const newText = replyText.slice(0, start) + emoji + replyText.slice(end);
      setReplyText(newText);
      setTimeout(() => {
        textarea.focus();
        textarea.selectionStart = start + emoji.length;
        textarea.selectionEnd = start + emoji.length;
      }, 0);
    } else {
      setReplyText((prev) => prev + emoji);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "open":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "pending":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "waiting for user":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "resolved":
      case "closed":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  const formatTime = (ts: { _seconds: number }) => {
    if (!ts) return "";
    const date = new Date(ts._seconds * 1000);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const getUserName = (ticket: Ticket) => ticket.userDisplayName?.trim() || "Candidate";

  return (
    <div className="flex bg-slate-50 overflow-hidden -m-8 h-[calc(100vh-72px)] border-t border-slate-200/80">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept="image/*"
        className="hidden"
      />

      {/* Lightbox Image Preview Modal */}
      {previewModalImg && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewModalImg(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <button
              onClick={() => setPreviewModalImg(null)}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={previewModalImg}
              alt="Preview"
              className="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* Left Sidebar - Ticket List */}
      <div className="w-80 md:w-96 border-r border-slate-200/80 bg-white flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
              <LifeBuoy className="w-4 h-4 text-indigo-600" />
              Support Helpdesk
            </h2>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {filteredTickets.length} Tickets
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search inquiries..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
              />
            </div>
            <select
              className="border border-slate-200 rounded-xl text-xs px-2.5 py-1.5 outline-none bg-slate-50 text-slate-700 font-semibold cursor-pointer"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">All Status</option>
              <option value="Open">Open</option>
              <option value="Pending">Pending</option>
              <option value="Waiting for User">Waiting</option>
              <option value="Resolved">Resolved</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 custom-scrollbar">
          {isLoadingTickets ? (
            <div className="flex justify-center items-center h-40">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              <CheckCircle className="w-10 h-10 mx-auto mb-2 text-slate-300" />
              <p className="font-semibold">Inbox zero! No active tickets.</p>
            </div>
          ) : (
            filteredTickets.map((ticket) => (
              <div
                key={ticket.id}
                onClick={() => {
                  setSelectedTicketId(ticket.id);
                  clearSelectedFile();
                }}
                className={`p-4 cursor-pointer transition-colors hover:bg-slate-50 border-l-4 ${
                  selectedTicketId === ticket.id
                    ? "border-indigo-600 bg-indigo-50/50"
                    : "border-transparent"
                } ${ticket.unreadCountAdmin > 0 ? "bg-indigo-50/30 font-bold" : ""}`}
              >
                <div className="flex justify-between items-start mb-1">
                  <h3 className="text-xs font-bold text-slate-900 truncate pr-2">
                    {ticket.subject}
                  </h3>
                  {ticket.unreadCountAdmin > 0 && (
                    <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                      {ticket.unreadCountAdmin}
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center text-xs text-slate-500 mt-2">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="flex items-center font-semibold text-slate-700 truncate">
                      <User className="w-3 h-3 mr-1 text-indigo-400 flex-shrink-0" />
                      {getUserName(ticket)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      #{ticket.id.slice(0, 8)}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${getStatusColor(ticket.status)}`}>
                    {ticket.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Content - Active Chat Pane */}
      <div className="flex-1 flex flex-col bg-slate-50">
        {!selectedTicketId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <MessageSquare className="w-12 h-12 mb-3 opacity-30 text-indigo-600" />
            <p className="text-sm font-semibold">Select a support ticket from the list to start live chat</p>
          </div>
        ) : isLoadingChat ? (
          <div className="flex-1 flex justify-center items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : activeTicketData ? (
          <>
            {/* Chat Header */}
            <div className="bg-white px-6 py-3.5 border-b border-slate-200/80 flex justify-between items-center shadow-xs z-10">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 truncate">
                  {activeTicketData.ticket.subject}
                </h3>
                <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                  <span className="font-semibold text-indigo-600 flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {getUserName(activeTicketData.ticket)}
                  </span>
                  <span>•</span>
                  <span className="font-mono text-slate-400 text-[11px]">
                    ID: {activeTicketData.ticket.userId}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <select
                  value={activeTicketData.ticket.status}
                  onChange={(e) => statusMutation.mutate(e.target.value)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl border outline-none cursor-pointer ${getStatusColor(
                    activeTicketData.ticket.status
                  )}`}
                >
                  <option value="Open">Status: Open</option>
                  <option value="Pending">Status: Pending</option>
                  <option value="Waiting for User">Status: Waiting</option>
                  <option value="Resolved">Status: Resolved</option>
                </select>
              </div>
            </div>

            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
              {activeTicketData.messages.length === 0 ? (
                <div className="text-center text-slate-400 py-12 text-xs">
                  No messages exchanged in this inquiry yet.
                </div>
              ) : (
                activeTicketData.messages.map((msg) => {
                  const isAdmin = msg.senderType === "admin";

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isAdmin ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-2xl p-4 text-xs ${
                          isAdmin
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "bg-white border border-slate-200/80 text-slate-800 shadow-xs"
                        }`}
                      >
                        {msg.mediaUrl && (
                          <div
                            className="mb-2 rounded-xl overflow-hidden cursor-pointer relative group"
                            onClick={() => setPreviewModalImg(msg.mediaUrl!)}
                          >
                            <img
                              src={msg.mediaUrl}
                              alt="Attachment"
                              className="max-h-60 rounded-xl object-cover"
                            />
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                              <ExternalLink className="w-5 h-5" />
                            </div>
                          </div>
                        )}

                        {msg.content && <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>}

                        <div
                          className={`flex items-center justify-end gap-1 text-[10px] mt-2 ${
                            isAdmin ? "text-indigo-200" : "text-slate-400"
                          }`}
                        >
                          <span>{formatTime(msg.timestamp)}</span>
                          {isAdmin && (
                            msg.isRead ? <CheckCheck className="w-3.5 h-3.5 text-emerald-300" /> : <Check className="w-3.5 h-3.5" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Bottom Message Input Bar */}
            <div className="bg-white p-4 border-t border-slate-200/80 relative">
              {/* Emoji Picker Popover */}
              {showEmojiPicker && (
                <div
                  ref={emojiPickerRef}
                  className="absolute bottom-20 left-4 z-50 shadow-2xl rounded-2xl overflow-hidden border border-slate-200"
                >
                  <EmojiPicker onEmojiClick={handleEmojiClick} lazyLoadEmojis={true} />
                </div>
              )}

              {/* Attachment Preview Chip */}
              {filePreview && (
                <div className="mb-3 flex items-center gap-3 p-2 bg-slate-50 border border-slate-200 rounded-xl max-w-sm">
                  <img src={filePreview} alt="Preview" className="w-12 h-12 object-cover rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 truncate">{selectedFile?.name}</p>
                    <span className="text-[10px] text-slate-400">
                      {(selectedFile?.size ? (selectedFile.size / 1024).toFixed(0) : 0)} KB • Ready to send
                    </span>
                  </div>
                  <button
                    onClick={clearSelectedFile}
                    className="p-1 hover:bg-slate-200 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <form onSubmit={handleSend} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="p-2 text-slate-400 hover:text-indigo-600 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                  title="Insert Emoji"
                >
                  <Smile className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 text-slate-400 hover:text-indigo-600 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                  title="Attach Photo"
                >
                  <Paperclip className="w-5 h-5" />
                </button>

                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend(e);
                    }
                  }}
                  placeholder="Type an official response to candidate (Press Enter to send)..."
                  className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none font-medium text-slate-900"
                />

                <button
                  type="submit"
                  disabled={isUploading || replyMutation.isPending || (!replyText.trim() && !selectedFile)}
                  className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isUploading || replyMutation.isPending ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" /> Send
                    </>
                  )}
                </button>
              </form>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
