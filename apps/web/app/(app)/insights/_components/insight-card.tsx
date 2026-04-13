"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface InsightCardProps {
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  markdownBody: string;
  tokensUsed: string;
  costUsd: string;
  emailedAt: string | null;
}

function formatPeriodLabel(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const yearOpts: Intl.DateTimeFormatOptions = {
    ...opts,
    year: "numeric",
  };
  const sStr = s.toLocaleDateString("en-US", opts);
  const eStr = e.toLocaleDateString("en-US", yearOpts);
  return `Week of ${sStr}\u2013${eStr}`;
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Minimal markdown-to-JSX for display. */
function renderMarkdown(md: string) {
  const lines = md.split("\n");
  const elements: React.ReactNode[] = [];
  let inList = false;
  let listItems: React.ReactNode[] = [];
  let key = 0;

  function flushList() {
    if (inList && listItems.length > 0) {
      elements.push(
        <ul key={key++} className="list-disc pl-5 space-y-0.5">
          {listItems}
        </ul>,
      );
      listItems = [];
      inList = false;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (
      inList &&
      !trimmed.startsWith("- ") &&
      !trimmed.startsWith("* ")
    ) {
      flushList();
    }

    if (trimmed === "") {
      elements.push(<br key={key++} />);
      continue;
    }

    const headerMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      flushList();
      const level = headerMatch[1]!.length;
      const text = inlineFormat(headerMatch[2]!);
      if (level === 1) {
        elements.push(
          <h3 key={key++} className="font-semibold text-base mt-2">
            {text}
          </h3>,
        );
      } else if (level === 2) {
        elements.push(
          <h4 key={key++} className="font-semibold text-sm mt-1.5">
            {text}
          </h4>,
        );
      } else {
        elements.push(
          <h5 key={key++} className="font-medium text-sm mt-1">
            {text}
          </h5>,
        );
      }
      continue;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      inList = true;
      listItems.push(
        <li key={key++} className="text-sm text-muted-foreground">
          {inlineFormat(trimmed.slice(2))}
        </li>,
      );
      continue;
    }

    elements.push(
      <p key={key++} className="text-sm text-muted-foreground">
        {inlineFormat(trimmed)}
      </p>,
    );
  }

  flushList();
  return elements;
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1");
}

export function InsightCard({
  periodStart,
  periodEnd,
  generatedAt,
  markdownBody,
  tokensUsed,
  costUsd,
  emailedAt,
}: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border p-4 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {formatPeriodLabel(periodStart, periodEnd)}
            </span>
            {emailedAt && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Mail className="h-3 w-3" />
                Emailed
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Generated {relativeTime(generatedAt)}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="space-y-1 pt-2 border-t">
          <div className="space-y-1">{renderMarkdown(markdownBody)}</div>
          <p className="text-xs text-muted-foreground/60 pt-2">
            {Number(tokensUsed).toLocaleString()} tokens &middot; $
            {Number(costUsd).toFixed(4)} cost
          </p>
        </div>
      )}
    </div>
  );
}
