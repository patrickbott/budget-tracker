"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import type { RecurringCandidate } from "@budget-tracker/core/recurring";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";

import { promoteRecurringCandidate } from "../_actions/candidates";

/**
 * Client-side list of detected recurring candidates. Mirrors the
 * optimistic-dismissal pattern from
 * `transactions/_components/transfer-candidates-panel.tsx`: a
 * `useTransition` wraps the server action, `pendingKeys` tracks which
 * rows are mid-flight, and a successful promote removes the row from
 * local state so it doesn't flicker back on the next render.
 *
 * Keyed on `descriptionPattern+cadence` because candidates don't have
 * a DB id yet — they're computed on the fly. That pair is stable for
 * the lifetime of the page load.
 */
export function RecurringCandidatesList({
  initialCandidates,
}: {
  initialCandidates: RecurringCandidate[];
}) {
  const [candidates, setCandidates] =
    useState<RecurringCandidate[]>(initialCandidates);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function candidateKey(c: RecurringCandidate): string {
    return `${c.descriptionPattern}::${c.cadence}`;
  }

  function markPending(key: string, pending: boolean) {
    setPendingKeys((prev) => {
      const next = new Set(prev);
      if (pending) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function handlePromote(candidate: RecurringCandidate) {
    const key = candidateKey(candidate);
    markPending(key, true);
    setError(null);
    startTransition(async () => {
      const result = await promoteRecurringCandidate({
        descriptionPattern: candidate.descriptionPattern,
        expectedAmount: candidate.expectedAmount,
        cadence: candidate.cadence,
      });
      markPending(key, false);
      if (!result.success) {
        setError(result.error ?? "Failed to promote candidate");
        return;
      }
      setCandidates((prev) => prev.filter((c) => candidateKey(c) !== key));
    });
  }

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No recurring patterns detected in the last 180 days.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead>Cadence</TableHead>
            <TableHead className="text-right">Expected amount</TableHead>
            <TableHead className="text-right">Confidence</TableHead>
            <TableHead className="w-32" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((c) => {
            const key = candidateKey(c);
            const busy = pendingKeys.has(key);
            return (
              <TableRow key={key}>
                <TableCell className="font-medium">
                  {c.descriptionPattern}
                </TableCell>
                <TableCell className="capitalize">{c.cadence}</TableCell>
                <TableCell className="text-right">
                  {formatCurrency(c.expectedAmount)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {(c.confidence * 100).toFixed(1)}%
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={busy}
                    onClick={() => handlePromote(c)}
                  >
                    <Check className="mr-1 h-3 w-3" />
                    Promote
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
