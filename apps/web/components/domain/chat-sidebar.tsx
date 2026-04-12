"use client";

import { MessageSquarePlus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Conversation {
  id: string;
  title: string | null;
  updatedAt: Date;
}

interface ChatSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function ChatSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: ChatSidebarProps) {
  return (
    <div className="flex h-full w-64 flex-col border-r bg-muted/20">
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="text-sm font-semibold">Conversations</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onNew}
          aria-label="New chat"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            No conversations yet
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((conv) => (
              <li key={conv.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conv.id)}
                  className={cn(
                    "group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    activeId === conv.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <span className="truncate">
                    {conv.title ?? "Untitled"}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                    className="ml-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
