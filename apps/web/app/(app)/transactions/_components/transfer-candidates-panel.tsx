"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowRight, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";

import {
  confirmTransferCandidate,
  dismissTransferCandidate,
  listPendingTransferCandidates,
  type TransferCandidateRow,
} from "../_actions/transfer-candidates";

export function TransferCandidatesPanel() {
  const [candidates, setCandidates] = useState<TransferCandidateRow[] | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    listPendingTransferCandidates()
      .then((result: TransferCandidateRow[]) => {
        if (cancelled) return;
        setCandidates(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load candidates");
        setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed) return null;
  if (candidates === null) return null;
  if (candidates.length === 0) return null;

  function markPending(id: string, pending: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleConfirm(candidateId: string) {
    markPending(candidateId, true);
    setError(null);
    startTransition(async () => {
      const result = await confirmTransferCandidate(candidateId);
      markPending(candidateId, false);
      if (!result.success) {
        setError(result.error ?? "Failed to confirm transfer");
        return;
      }
      setCandidates((prev) =>
        prev ? prev.filter((c) => c.candidateId !== candidateId) : prev,
      );
    });
  }

  function handleDismiss(candidateId: string) {
    markPending(candidateId, true);
    setError(null);
    startTransition(async () => {
      const result = await dismissTransferCandidate(candidateId);
      markPending(candidateId, false);
      if (!result.success) {
        setError(result.error ?? "Failed to dismiss transfer");
        return;
      }
      setCandidates((prev) =>
        prev ? prev.filter((c) => c.candidateId !== candidateId) : prev,
      );
    });
  }

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          {candidates.length} potential transfer
          {candidates.length === 1 ? "" : "s"} detected
        </CardTitle>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setDismissed(true)}
          aria-label="Close transfer panel"
          title="Close"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {candidates.map((c) => {
          const busy = pendingIds.has(c.candidateId);
          return (
            <div
              key={c.candidateId}
              className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm md:flex-row md:items-center"
            >
              <EntrySide entry={c.entryA} />
              <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground md:px-2">
                <ArrowRight className="h-4 w-4" />
                <span>{Math.round(Number(c.confidence) * 100)}%</span>
              </div>
              <EntrySide entry={c.entryB} />
              <div className="flex shrink-0 gap-2 md:ml-auto">
                <Button
                  size="sm"
                  variant="default"
                  disabled={busy}
                  onClick={() => handleConfirm(c.candidateId)}
                >
                  <Check className="mr-1 h-3 w-3" />
                  Confirm transfer
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => handleDismiss(c.candidateId)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function EntrySide({
  entry,
}: {
  entry: TransferCandidateRow["entryA"];
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="truncate font-medium">{entry.description}</span>
      <span className="text-xs text-muted-foreground">
        {entry.date} · {entry.accountName} · {formatCurrency(entry.amount)}
      </span>
    </div>
  );
}
