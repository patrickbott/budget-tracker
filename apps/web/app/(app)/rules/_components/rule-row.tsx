"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { RuleCondition, RuleAction } from "@budget-tracker/db/schema";
import { deleteRule, toggleRuleEnabled } from "../actions";
import { RuleForm } from "./rule-form";

interface RuleRowProps {
  rule: {
    id: string;
    name: string;
    stage: "pre" | "default" | "post";
    enabled: boolean;
    specificityScore: number;
    conditionsJson: RuleCondition[];
    actionsJson: RuleAction[];
  };
  categories: Array<{ id: string; name: string; color: string | null }>;
  categoryMap: Map<string, { id: string; name: string; color: string | null }>;
}

function summarizeActions(
  actions: RuleAction[],
  categoryMap: Map<string, { id: string; name: string; color: string | null }>,
): string {
  return actions
    .map((a) => {
      switch (a.type) {
        case "set_category": {
          const cat = a.value ? categoryMap.get(a.value) : null;
          return `→ ${cat?.name ?? "category"}`;
        }
        case "set_description":
          return `→ rename "${a.value}"`;
        case "set_memo":
          return `→ memo`;
        case "add_tag":
          return `→ tag "${a.value}"`;
        case "mark_as_transfer":
          return "→ transfer";
        case "skip":
          return "→ skip";
        default:
          return "";
      }
    })
    .join(", ");
}

export function RuleRow({ rule: r, categories, categoryMap }: RuleRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    const result = await toggleRuleEnabled(r.id);
    if (!result.success) {
      setError(result.error ?? "Failed to toggle");
    }
  }

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const result = await deleteRule(r.id);
    if (!result.success) {
      setError(result.error ?? "Failed to delete");
      setConfirming(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-md border px-4 py-3">
      {/* Enable/disable toggle */}
      <button
        type="button"
        onClick={handleToggle}
        className={`h-4 w-4 shrink-0 rounded-sm border-2 transition-colors ${
          r.enabled
            ? "border-green-500 bg-green-500"
            : "border-muted-foreground bg-transparent"
        }`}
        title={r.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
        aria-label={r.enabled ? "Disable rule" : "Enable rule"}
      />

      {/* Name + badges */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={r.enabled ? "" : "text-muted-foreground line-through"}>
          {r.name}
        </span>
        <Badge variant="secondary" className="text-xs">
          {r.conditionsJson.length} condition{r.conditionsJson.length !== 1 ? "s" : ""}
        </Badge>
        <span className="truncate text-xs text-muted-foreground">
          {summarizeActions(r.actionsJson, categoryMap)}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <RuleForm
          mode="edit"
          rule={r}
          categories={categories}
          trigger={
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />
        <Button
          variant={confirming ? "destructive" : "ghost"}
          size="icon"
          className="h-8 w-8"
          onClick={handleDelete}
          onBlur={() => setConfirming(false)}
          title={confirming ? "Click again to confirm" : "Delete"}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
