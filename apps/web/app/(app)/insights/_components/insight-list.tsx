"use client";

import { InsightCard } from "./insight-card";

export interface InsightRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  markdownBody: string;
  tokensUsed: string;
  costUsd: string;
  emailedAt: string | null;
}

interface InsightListProps {
  insights: InsightRow[];
}

export function InsightList({ insights }: InsightListProps) {
  if (insights.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground">
          No insights yet. Reports are generated automatically each week.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {insights.map((row) => (
        <InsightCard key={row.id} {...row} />
      ))}
    </div>
  );
}
