"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RuleAction } from "@budget-tracker/db/schema";

const ACTION_TYPES = [
  { value: "set_category", label: "Set category" },
  { value: "set_description", label: "Set description" },
  { value: "set_memo", label: "Set memo" },
  { value: "add_tag", label: "Add tag" },
  { value: "mark_as_transfer", label: "Mark as transfer" },
  { value: "skip", label: "Skip (exclude from rules)" },
] as const;

const NO_VALUE_TYPES = new Set(["mark_as_transfer", "skip"]);

interface ActionBuilderProps {
  actions: RuleAction[];
  onChange: (actions: RuleAction[]) => void;
  categories: Array<{ id: string; name: string; color: string | null }>;
}

export function ActionBuilder({
  actions,
  onChange,
  categories,
}: ActionBuilderProps) {
  function addAction() {
    onChange([...actions, { type: "set_category", value: "" }]);
  }

  function removeAction(index: number) {
    onChange(actions.filter((_, i) => i !== index));
  }

  function updateAction(index: number, updates: Partial<RuleAction>) {
    const updated = [...actions];
    const current = updated[index];
    if (!current) return;
    updated[index] = { ...current, ...updates };

    // Clear value when switching to a no-value type
    if (updates.type && NO_VALUE_TYPES.has(updates.type)) {
      updated[index]!.value = undefined;
    }

    onChange(updated);
  }

  function renderValueInput(action: RuleAction, index: number) {
    if (NO_VALUE_TYPES.has(action.type)) {
      return null;
    }

    if (action.type === "set_category") {
      return (
        <Select
          value={action.value ?? ""}
          onValueChange={(v) => updateAction(index, { value: v })}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: c.color ?? "#9ca3af" }}
                  />
                  {c.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    return (
      <Input
        value={action.value ?? ""}
        onChange={(e) => updateAction(index, { value: e.target.value })}
        placeholder={
          action.type === "set_description"
            ? "New description"
            : action.type === "set_memo"
              ? "Memo text"
              : "Tag name"
        }
        className="flex-1"
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Actions</span>
        <Button type="button" variant="outline" size="sm" onClick={addAction}>
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>

      {actions.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No actions — add at least one action for this rule to do anything.
        </p>
      )}

      {actions.map((action, i) => (
        <div key={i} className="flex items-center gap-2">
          <Select
            value={action.type}
            onValueChange={(v) =>
              updateAction(i, { type: v as RuleAction["type"] })
            }
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {renderValueInput(action, i)}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => removeAction(i)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
