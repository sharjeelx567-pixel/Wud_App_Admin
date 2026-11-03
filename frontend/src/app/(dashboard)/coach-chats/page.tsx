"use client";

import React, { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send, GraduationCap, CheckCheck } from "lucide-react";
import api from "../../../services/api";

interface Thread {
  id: string;
  userId: string;
  userName?: string;
  topic?: string;
  date?: string;
  timeSlot?: string;
  status?: string;
  coachName?: string;
  lastMessage?: string;
  lastMessageAt?: number;
  unreadCount?: number;
}

interface Message {
  id: string;
  senderType: "user" | "coach";
  text: string;
  isRead?: boolean;
  timestamp: number;
}

function timeLabel(ms?: number) {
  if (!ms) return "";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ChatPane({ thread }: { thread: Thread }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<{ data: { messages: Message[] } }>({
    queryKey: ["coach-messages", thread.id],
    queryFn: () => api.get(`/coach/sessions/${thread.id}/messages`).then((r) => r.data),
    refetchInterval: 5000,
  });
  const messages = data?.data?.messages || [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  // Opening/refetching a thread marks its user messages read on the server;
  // refresh the list so the unread badge clears.
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["coach-threads"] });
  }, [messages.length, queryClient]);

  const send = useMutation({
    mutationFn: async (body: string) =>
      api.post(`/coach/sessions/${thread.id}/messages`, { text: body }),
    onSuccess: () => {
      setText("");
      queryClient.invalidateQueries({ queryKey: ["coach-messages", thread.id] });
      queryClient.invalidateQueries({ queryKey: ["coach-threads"] });
    },
    onError: (error: any) =>
      alert(error?.response?.data?.error || "Failed to send message."),
  });

  const submit = () => {
    const t = text.trim();
    if (t) send.mutate(t);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100">
        <p className="text-sm font-bold text-slate-900">{thread.userName || "User"}</p>
        <p className="text-[11px] text-slate-400">
          {thread.topic || "Session"}
          {thread.date ? ` · ${thread.date}` : ""}
          {thread.timeSlot ? ` · ${thread.timeSlot}` : ""}
        </p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50/50">
        {isLoading ? (
          <p className="text-xs text-slate-400">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-slate-400 text-center mt-8">
            No messages yet. Say salaam to start the conversation.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderType === "coach";
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-xs ${
                    mine
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  <div className={`flex items-center gap-1 mt-1 ${mine ? "justify-end" : ""}`}>
                    <span className={`text-[9px] ${mine ? "text-indigo-200" : "text-slate-400"}`}>
                      {timeLabel(m.timestamp)}
                    </span>
                    {mine && (
                      <CheckCheck className={`w-3 h-3 ${m.isRead ? "text-sky-300" : "text-indigo-200"}`} />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div className="p-3 border-t border-slate-100 flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Type a message…"
          className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-full text-xs outline-none focus:border-indigo-500 text-slate-900"
        />
        <button
          onClick={submit}
          disabled={!text.trim() || send.isPending}
          className="w-10 h-10 flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function CoachChatsPage() {
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ data: Thread[] }>({
    queryKey: ["coach-threads"],
    queryFn: () => api.get("/coach/my-threads").then((r) => r.data),
    refetchInterval: 8000,
  });
  const threads = data?.data || [];
  const active = threads.find((t) => t.id === selected) || null;

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden h-[calc(100vh-10rem)] flex">
      {/* Threads list */}
      <div className="w-full sm:w-80 border-r border-slate-100 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-indigo-600" />
            My Chats
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Users assigned to you</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="p-5 text-xs text-slate-400">Loading…</p>
          ) : threads.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p className="text-xs font-semibold">No assigned chats yet.</p>
              <p className="text-[11px] mt-1">An admin assigns you to a booking, then it appears here.</p>
            </div>
          ) : (
            threads.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelected(t.id)}
                className={`w-full text-left px-5 py-3.5 border-b border-slate-50 transition-colors cursor-pointer ${
                  selected === t.id ? "bg-indigo-50/70" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-900 truncate">{t.userName || "User"}</p>
                  {(t.unreadCount || 0) > 0 && (
                    <span className="ml-2 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-rose-500 text-white text-[10px] font-bold rounded-full">
                      {t.unreadCount}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 truncate">{t.topic || "Session"}</p>
                {t.coachName && (
                  <p className="text-[10px] text-indigo-500 font-semibold truncate">Coach: {t.coachName}</p>
                )}
                {t.lastMessage ? (
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">{t.lastMessage}</p>
                ) : (
                  <p className="text-[11px] text-slate-300 italic mt-0.5">No messages yet</p>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat pane */}
      <div className="hidden sm:flex flex-1 flex-col">
        {active ? (
          <ChatPane thread={active} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <MessageSquare className="w-10 h-10 mb-2 text-slate-300" />
            <p className="text-xs font-semibold">Select a chat to start messaging</p>
          </div>
        )}
      </div>

      {/* Mobile: full-screen chat overlay when a thread is open */}
      {active && (
        <div className="sm:hidden fixed inset-0 z-40 bg-white flex flex-col">
          <button
            onClick={() => setSelected(null)}
            className="px-5 py-3 text-left text-xs font-bold text-indigo-600 border-b border-slate-100"
          >
            ← Back to chats
          </button>
          <div className="flex-1 min-h-0">
            <ChatPane thread={active} />
          </div>
        </div>
      )}
    </div>
  );
}
