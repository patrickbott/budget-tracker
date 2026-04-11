"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RuleCondition, RuleAction } from "@budget-tracker/db/schema";
import { createRule, updateRule } from "../actions";
import { ConditionBuilder } from "./condition-builder";
import { ActionBuilder } from "./action-builder";

interface RuleFormProps {
  mode: "create" | "edit";
  rule?: {
    id: string;
    name: string;
    stage: "pre" | "default" | "post";
    conditionsJson: RuleCondition[];
    actionsJson: RuleAction[];
  };
  categories: Array<{ id: string; name: string; color: string | null }>;
  trigger: React.ReactNode;
}

export function RuleForm({
  mode,
  rule: r,
  categories,
  trigger,
}: RuleFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(r?.name ?? "");
  const [stage, setStage] = useState<"pre" | "default" | "post">(
    r?.stage ?? "default",
  );
  const [conditions, setConditions] = useState<RuleCondition[]>(
    r?.conditionsJson ?? [],
  );
  const [actions, setActions] = useState<RuleAction[]>(r?.actionsJson ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (actions.length === 0) {
      setError("At least one action is required");
      return;
    }

    setPending(true);
    setError(null);

    const result =
      mode === "create"
        ? await createRule({
            name: name.trim(),
            stage,
            conditionsJson: conditions,
            actionsJson: actions,
          })
        : await updateRule(r!.id, {
            name: name.trim(),
            stage,
            conditionsJson: conditions,
            actionsJson: actions,
          });

    setPending(false);

    if (!result.success) {
      setError(result.error ?? "Something went wrong");
      return;
    }

    setOpen(false);
    if (mode === "create") {
      setName("");
      setStage("default");
      setConditions([]);
      setActions([]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create Rule" : "Edit Rule"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rule-name">Name</Label>
              <Input
                id="rule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Grocery stores"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rule-stage">Stage</Label>
              <Select
                value={stage}
                onValueChange={(v) =>
                  setStage(v as "pre" | "default" | "post")
                }
              >
                <SelectTrigger id="rule-stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pre">Pre (preprocessing)</SelectItem>
                  <SelectItem value="default">
                    Default (main rules)
                  </SelectItem>
                  <SelectItem value="post">Post (catch-all)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <hr className="border-border" />
          <ConditionBuilder
            conditions={conditions}
            onChange={setConditions}
          />

          <hr className="border-border" />
          <ActionBuilder
            actions={actions}
            onChange={setActions}
            categories={categories}
          />

          <hr className="border-border" />
          <div>
            <Button type="button" variant="outline" size="sm" disabled>
              Apply to past transactions
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              Coming soon — will apply this rule to all existing transactions.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : mode === "create" ? "Create" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
