import React, { useState, useRef, useEffect } from "react";
import { Send, Loader2, Bot, Sparkles, User, Info } from "lucide-react";
import { ItemCard } from "./ItemCard";
import { TimelineItem } from "../../../shared/utils/timeline";

interface ChatMessage {
  id: string;
  role: "user" | "ai";
  text: string;
  citations?: TimelineItem[];
}

interface AskViewProps {
  onEditItem: (item: TimelineItem) => void;
  onToggleComplete: (id: string, completed: boolean) => void;
  onSnooze: (id: string, days: number) => void;
  onDelete: (id: string) => void;
}

export function AskView({ onEditItem, onToggleComplete, onSnooze, onDelete }: AskViewProps) {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: "welcome",
    role: "ai",
    text: "Hello! I'm LifeLoop. You can ask me questions about your bills, renewals, waiting items, and any documents you've captured. I'll search your records and answer you securely."
  }]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleAsk = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim() || loading) return;

    const currentQuery = query;
    setQuery("");
    
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "user", text: currentQuery }]);
    setLoading(true);

    try {
      const res = await fetch("/api/v1/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: currentQuery })
      });
      
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || "Failed to get answer");

      const parsedCitations = (data.citations || []).map((i: any) => ({
        ...i,
        dueDate: i.dueDate ? new Date(i.dueDate).toISOString() : null,
        snoozedUntil: i.snoozedUntil ? new Date(i.snoozedUntil).toISOString() : null,
        completedAt: i.completedAt ? new Date(i.completedAt).toISOString() : null,
        createdAt: new Date(i.createdAt).toISOString(),
      }));

      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "ai",
        text: data.answer || "I couldn't find that in your LifeLoop.",
        citations: parsedCitations
      }]);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "ai",
        text: "I'm sorry, I ran into an issue searching your LifeLoop. Please try again."
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] sm:h-[calc(100vh-160px)] max-h-[800px] bg-stone-50 dark:bg-[#1C1917]/50 rounded-3xl border border-[#E7E5E4] dark:border-[#383330] overflow-hidden relative shadow-sm">
      
      {/* Header */}
      <div className="px-6 py-4 border-b border-[#E7E5E4] dark:border-[#383330] bg-white/50 dark:bg-[#23201E]/50 flex items-center justify-between z-10 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-100 dark:bg-blue-900/40 rounded-lg text-blue-600 dark:text-blue-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-[#1C1917] dark:text-[#FDFBF7]">Ask My Life</h2>
            <p className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">Private & Secure Retrieval</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`flex gap-3 max-w-[90%] sm:max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
              {/* Avatar */}
              <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${
                msg.role === "user" 
                  ? "bg-stone-200 dark:bg-stone-800 border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300"
                  : "bg-blue-100 dark:bg-blue-900/40 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400"
              }`}>
                {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              
              {/* Message Content */}
              <div className={`flex flex-col gap-3 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed shadow-sm ${
                  msg.role === "user"
                    ? "bg-[#1C1917] dark:bg-[#FDFBF7] text-[#FDFBF7] dark:text-[#1C1917] rounded-tr-none"
                    : "bg-white dark:bg-[#23201E] border border-[#E7E5E4] dark:border-[#383330] text-[#1C1917] dark:text-[#FDFBF7] rounded-tl-none"
                }`}>
                  {msg.text}
                </div>
                
                {/* Citations block */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="w-full flex flex-col gap-2 mt-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#A8A29E] uppercase tracking-wider pl-1">
                       <Info className="w-3 h-3" />
                       Reference Sources ({msg.citations.length})
                    </div>
                    <div className="space-y-2.5 w-full">
                      {msg.citations.map((citedItem) => (
                        <ItemCard 
                          key={citedItem.id}
                          item={citedItem}
                          onToggleComplete={onToggleComplete}
                          onSnooze={onSnooze}
                          onEdit={onEditItem}
                          onDelete={onDelete}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
             <div className="flex gap-3 max-w-[85%]">
               <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-blue-100 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400">
                 <Bot className="w-4 h-4" />
               </div>
               <div className="px-4 py-3 rounded-2xl bg-white dark:bg-[#23201E] border border-[#E7E5E4] dark:border-[#383330] rounded-tl-none shadow-sm flex items-center gap-2">
                 <Loader2 className="w-3.5 h-3.5 animate-spin text-[#A8A29E]" />
                 <span className="text-[12px] text-[#A8A29E] animate-pulse">Searching your LifeLoop...</span>
               </div>
             </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 bg-white dark:bg-[#23201E] border-t border-[#E7E5E4] dark:border-[#383330]">
        <form onSubmit={handleAsk} className="relative flex items-center">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={loading}
            placeholder="Ask about bills, reminders, waiting items..."
            className="w-full pl-4 pr-12 py-3 bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-[#1C1917] dark:text-[#FDFBF7] transition-all disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="absolute right-2 p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
