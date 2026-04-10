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
import { createCategory, updateCategory } from "../actions";

const COLOR_PRESETS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#ec4899", "#f43f5e", "#78716c",
];

interface CategoryFormProps {
  mode: "create" | "edit";
  category?: {
    id: string;
    name: string;
    kind: "income" | "expense";
    color: string | null;
    icon: string | null;
  };
  trigger: React.ReactNode;
}

export function CategoryForm({ mode, category: cat, trigger }: CategoryFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(cat?.name ?? "");
  const [kind, setKind] = useState<"income" | "expense">(cat?.kind ?? "expense");
  const [color, setColor] = useState(cat?.color ?? COLOR_PRESETS[0]);
  const [icon, setIcon] = useState(cat?.icon ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setPending(true);
    setError(null);

    const data = { name: name.trim(), kind, color, icon: icon.trim() || undefined };
    const result =
      mode === "create"
        ? await createCategory(data)
        : await updateCategory(cat!.id, data);

    setPending(false);

    if (!result.success) {
      setError(result.error ?? "Something went wrong");
      return;
    }

    setOpen(false);
    if (mode === "create") {
      setName("");
      setKind("expense");
      setColor(COLOR_PRESETS[0]);
      setIcon("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create Category" : "Edit Category"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Groceries"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cat-kind">Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as "income" | "expense")}>
              <SelectTrigger id="cat-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="income">Income</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? "white" : "transparent",
                    boxShadow: color === c ? `0 0 0 2px ${c}` : "none",
                  }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#hex"
              className="mt-1 w-32 font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cat-icon">Icon (Lucide name, optional)</Label>
            <Input
              id="cat-icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="e.g. shopping-cart"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

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
