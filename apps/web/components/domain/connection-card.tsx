"use client";

import { useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { triggerManualSync, deleteConnection } from "@/app/(app)/connections/actions";

type ConnectionStatus = "active" | "needs_reauth" | "disabled";

interface ConnectionCardProps {
  connection: {
    id: string;
    nickname: string | null;
    status: ConnectionStatus;
    lastSyncedAt: Date | null;
    lastError: string | null;
  };
}

const STATUS_STYLES: Record<ConnectionStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  needs_reauth: { label: "Needs Re-auth", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  disabled: { label: "Disabled", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function ConnectionCard({ connection: conn }: ConnectionCardProps) {
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const status = STATUS_STYLES[conn.status];

  async function handleSync() {
    setSyncing(true);
    await triggerManualSync(conn.id);
    setSyncing(false);
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    await deleteConnection(conn.id);
  }

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {conn.nickname ?? "Unnamed Connection"}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
            >
              {status.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {conn.lastSyncedAt
              ? `Last synced ${formatRelativeTime(conn.lastSyncedAt)}`
              : "Never synced"}
          </p>
          {conn.lastError && (
            <p className="text-xs text-destructive">{conn.lastError}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw
              className={`mr-1 h-3 w-3 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "Syncing..." : "Sync now"}
          </Button>
          <Button
            variant={confirmDelete ? "destructive" : "ghost"}
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            {confirmDelete ? "Confirm" : "Delete"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
