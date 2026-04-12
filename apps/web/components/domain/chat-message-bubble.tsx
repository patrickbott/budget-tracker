"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";

interface ToolCall {
  tool_name?: string;
  [key: string]: unknown;
}

interface ChatMessageBubbleProps {
  role: string;
  content: string;
  toolCalls?: ToolCall[] | null;
}

export function ChatMessageBubble({
  role,
  content,
  toolCalls,
}: ChatMessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        <div className="whitespace-pre-wrap break-words">{content}</div>
        {toolCalls && toolCalls.length > 0 && (
          <ToolCallIndicators toolCalls={toolCalls} />
        )}
      </div>
    </div>
  );
}

function ToolCallIndicators({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 border-t border-foreground/10 pt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Wrench className="h-3 w-3" />
        <span>
          Used {toolCalls.length} tool{toolCalls.length > 1 ? "s" : ""}
        </span>
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </button>
      {expanded && (
        <ul className="mt-1 space-y-0.5">
          {toolCalls.map((tc, i) => (
            <li key={i} className="text-xs text-muted-foreground pl-4">
              {String(tc.tool_name ?? "unknown")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
