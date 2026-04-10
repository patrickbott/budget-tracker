"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryForm } from "./category-form";
import { deleteCategory, toggleArchiveCategory } from "../actions";

interface CategoryRowProps {
  category: {
    id: string;
    name: string;
    kind: "income" | "expense" | "transfer" | "equity";
    color: string | null;
    icon: string | null;
    isArchived: boolean;
  };
}

export function CategoryRow({ category: cat }: CategoryRowProps) {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const result = await deleteCategory(cat.id);
    if (!result.success) {
      setError(result.error ?? "Failed to delete");
      setConfirming(false);
    }
  }

  async function handleToggleArchive() {
    const result = await toggleArchiveCategory(cat.id);
    if (!result.success) {
      setError(result.error ?? "Failed to toggle archive");
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-md border px-4 py-3">
      {/* Color chip */}
      <div
        className="h-4 w-4 shrink-0 rounded-full"
        style={{ backgroundColor: cat.color ?? "#9ca3af" }}
      />

      {/* Name + icon */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cat.isArchived ? "text-muted-foreground line-through" : ""}>
          {cat.name}
        </span>
        {cat.icon && (
          <span className="text-xs text-muted-foreground">{cat.icon}</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <CategoryForm
          mode="edit"
          category={{
            id: cat.id,
            name: cat.name,
            kind: cat.kind as "income" | "expense",
            color: cat.color,
            icon: cat.icon,
          }}
          trigger={
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleToggleArchive}
          title={cat.isArchived ? "Unarchive" : "Archive"}
        >
          {cat.isArchived ? (
            <ArchiveRestore className="h-4 w-4" />
          ) : (
            <Archive className="h-4 w-4" />
          )}
        </Button>

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

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
