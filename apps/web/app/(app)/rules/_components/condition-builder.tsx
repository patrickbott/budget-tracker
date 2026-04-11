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
import type { RuleCondition } from "@budget-tracker/db/schema";

const FIELDS = [
  { value: "description", label: "Description" },
  { value: "amount", label: "Amount" },
  { value: "account", label: "Account" },
  { value: "date", label: "Date" },
  { value: "currency", label: "Currency" },
] as const;

const OPERATORS_BY_FIELD: Record<string, Array<{ value: string; label: string }>> = {
  description: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
    { value: "contains", label: "contains" },
    { value: "does_not_contain", label: "does not contain" },
    { value: "matches_regex", label: "matches regex" },
    { value: "one_of", label: "one of" },
  ],
  amount: [
    { value: "is", label: "equals" },
    { value: "greater_than", label: "greater than" },
    { value: "less_than", label: "less than" },
    { value: "between", label: "between" },
  ],
  account: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
    { value: "one_of", label: "one of" },
  ],
  date: [
    { value: "between", label: "between" },
    { value: "greater_than", label: "after" },
    { value: "less_than", label: "before" },
  ],
  currency: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
  ],
};

interface ConditionBuilderProps {
  conditions: RuleCondition[];
  onChange: (conditions: RuleCondition[]) => void;
}

export function ConditionBuilder({
  conditions,
  onChange,
}: ConditionBuilderProps) {
  function addCondition() {
    onChange([
      ...conditions,
      { field: "description", operator: "contains", value: "" },
    ]);
  }

  function removeCondition(index: number) {
    onChange(conditions.filter((_, i) => i !== index));
  }

  function updateCondition(index: number, updates: Partial<RuleCondition>) {
    const updated = [...conditions];
    const current = updated[index];
    if (!current) return;
    updated[index] = { ...current, ...updates };

    // Reset operator/value when field changes
    if (updates.field) {
      const ops = OPERATORS_BY_FIELD[updates.field] ?? [];
      updated[index]!.operator = (ops[0]?.value ?? "is") as RuleCondition["operator"];
      updated[index]!.value = updates.field === "amount" ? 0 : "";
    }

    onChange(updated);
  }

  function renderValueInput(condition: RuleCondition, index: number) {
    if (condition.operator === "between") {
      const arr = Array.isArray(condition.value) ? condition.value : [0, 0];
      return (
        <div className="flex items-center gap-1">
          <Input
            type={condition.field === "amount" ? "number" : "text"}
            value={String(arr[0] ?? "")}
            onChange={(e) =>
              updateCondition(index, {
                value: [
                  condition.field === "amount"
                    ? Number(e.target.value)
                    : e.target.value,
                  arr[1],
                ] as [number, number],
              })
            }
            placeholder="From"
            className="w-24"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type={condition.field === "amount" ? "number" : "text"}
            value={String(arr[1] ?? "")}
            onChange={(e) =>
              updateCondition(index, {
                value: [
                  arr[0],
                  condition.field === "amount"
                    ? Number(e.target.value)
                    : e.target.value,
                ] as [number, number],
              })
            }
            placeholder="To"
            className="w-24"
          />
        </div>
      );
    }

    if (condition.operator === "one_of") {
      const val = Array.isArray(condition.value)
        ? condition.value.join(", ")
        : String(condition.value);
      return (
        <Input
          value={val}
          onChange={(e) =>
            updateCondition(index, {
              value: e.target.value.split(",").map((s) => s.trim()),
            })
          }
          placeholder="value1, value2, ..."
          className="flex-1"
        />
      );
    }

    return (
      <Input
        type={
          condition.field === "amount" &&
          ["greater_than", "less_than", "is"].includes(condition.operator)
            ? "number"
            : "text"
        }
        value={String(condition.value)}
        onChange={(e) =>
          updateCondition(index, {
            value:
              condition.field === "amount"
                ? Number(e.target.value)
                : e.target.value,
          })
        }
        placeholder="Value"
        className="flex-1"
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Conditions (all must match)</span>
        <Button type="button" variant="outline" size="sm" onClick={addCondition}>
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>

      {conditions.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No conditions — rule will match all transactions.
        </p>
      )}

      {conditions.map((condition, i) => {
        const operators = OPERATORS_BY_FIELD[condition.field] ?? [];
        return (
          <div key={i} className="flex items-center gap-2">
            <Select
              value={condition.field}
              onValueChange={(v) =>
                updateCondition(i, {
                  field: v as RuleCondition["field"],
                })
              }
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELDS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={condition.operator}
              onValueChange={(v) =>
                updateCondition(i, {
                  operator: v as RuleCondition["operator"],
                })
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {operators.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {renderValueInput(condition, i)}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => removeCondition(i)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
