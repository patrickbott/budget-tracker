"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  DollarSign,
  TrendingUp,
  CreditCard,
  Menu,
  AlertTriangle,
  Ban,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ChatMessageBubble } from "@/components/domain/chat-message-bubble";
import { ChatInput } from "@/components/domain/chat-input";
import { ChatSidebar } from "@/components/domain/chat-sidebar";
import {
  sendMessage,
  getConversations,
  getMessages,
  deleteConversation,
} from "./actions";

interface Message {
  id: string;
  role: string;
  content: string;
  toolCallsJson: Array<Record<string, unknown>> | null;
  createdAt: Date;
}

interface Conversation {
  id: string;
  title: string | null;
  updatedAt: Date;
}

const EXAMPLE_PROMPTS = [
  {
    text: "How much did I spend on dining last month?",
    icon: DollarSign,
  },
  {
    text: "What's my net worth?",
    icon: TrendingUp,
  },
  {
    text: "Show my subscriptions",
    icon: CreditCard,
  },
];

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [spendCap, setSpendCap] = useState<{
    percentUsed: number;
    warning: boolean;
    blocked: boolean;
    message?: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function loadConversations() {
    const result = await getConversations();
    if (result.success && result.data) {
      setConversations(result.data);
    }
  }

  async function selectConversation(convId: string) {
    setActiveConvId(convId);
    setSidebarOpen(false);
    const result = await getMessages(convId);
    if (result.success && result.data) {
      setMessages(result.data);
    }
  }

  function startNewChat() {
    setActiveConvId(null);
    setMessages([]);
    setInput("");
    setSidebarOpen(false);
  }

  async function handleDelete(convId: string) {
    const result = await deleteConversation(convId);
    if (result.success) {
      if (activeConvId === convId) {
        setActiveConvId(null);
        setMessages([]);
      }
      await loadConversations();
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    // Optimistic UI: add user message immediately
    const optimisticMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      toolCallsJson: null,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setInput("");
    setSending(true);

    try {
      const result = await sendMessage(activeConvId, text);
      if (result.success && result.data) {
        // Update conversation ID (may be newly created)
        setActiveConvId(result.data.conversationId);

        // Update spend-cap state from response
        if (result.data.spendCap) {
          const sc = result.data.spendCap;
          const blocked = sc.percentUsed >= 100;
          setSpendCap({
            percentUsed: sc.percentUsed,
            warning: sc.warning,
            blocked,
            message: sc.message,
          });

          // Blocked pre-check: request never reached Anthropic
          if (blocked && !result.data.assistantMessage) {
            setMessages((prev) =>
              prev.filter((m) => m.id !== optimisticMsg.id),
            );
            return;
          }
        } else {
          setSpendCap(null);
        }

        // Add assistant message
        const assistantMsg: Message = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: result.data.assistantMessage,
          toolCallsJson: result.data.toolCalls ?? null,
          createdAt: new Date(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

        // Refresh conversation list
        await loadConversations();
      } else {
        // Show error as assistant message
        const errMsg: Message = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Sorry, something went wrong: ${result.error ?? "Unknown error"}`,
          toolCallsJson: null,
          createdAt: new Date(),
        };
        setMessages((prev) => [...prev, errMsg]);
      }
    } finally {
      setSending(false);
    }
  }

  const sidebarContent = (
    <ChatSidebar
      conversations={conversations}
      activeId={activeConvId}
      onSelect={selectConversation}
      onNew={startNewChat}
      onDelete={handleDelete}
    />
  );

  return (
    <div className="flex h-[calc(100vh-3rem)] overflow-hidden rounded-lg border">
      {/* Desktop sidebar */}
      <div className="hidden md:block">{sidebarContent}</div>

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          {/* Mobile sidebar trigger */}
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                aria-label="Open conversations"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Conversations</SheetTitle>
              {sidebarContent}
            </SheetContent>
          </Sheet>
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Chat</h1>
        </div>

        {/* Spend-cap banners */}
        {spendCap?.blocked && (
          <div className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            <Ban className="h-4 w-4 shrink-0" />
            <span>
              Monthly AI budget reached. Chat will resume next month.
            </span>
          </div>
        )}
        {spendCap?.warning && !spendCap.blocked && (
          <div className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {spendCap.message ??
                `You've used ${Math.round(spendCap.percentUsed)}% of your monthly AI budget.`}
            </span>
          </div>
        )}

        {/* Messages or empty state */}
        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 && !sending ? (
            <EmptyState onPromptClick={(text) => { setInput(text); }} />
          ) : (
            <div className="mx-auto max-w-2xl space-y-4">
              {messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  toolCalls={msg.toolCallsJson}
                />
              ))}
              {sending && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <ChatInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
          disabled={sending || !!spendCap?.blocked}
        />
      </div>
    </div>
  );
}

function EmptyState({
  onPromptClick,
}: {
  onPromptClick: (text: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="text-center">
        <MessageSquare className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
        <h2 className="text-lg font-semibold">Ask about your finances</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          I can help you understand your spending, track your net worth, and
          more.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt.text}
            type="button"
            onClick={() => onPromptClick(prompt.text)}
            className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2.5 text-sm text-left transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <prompt.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            {prompt.text}
          </button>
        ))}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl bg-muted px-4 py-3">
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}
