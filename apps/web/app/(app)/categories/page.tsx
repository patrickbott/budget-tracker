import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { withFamilyContext } from "@budget-tracker/db/client";
import { category } from "@budget-tracker/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryForm } from "./_components/category-form";
import { CategoryRow } from "./_components/category-row";

export default async function CategoriesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const familyId = session.session.activeOrganizationId;
  if (!familyId) redirect("/onboarding");

  const db = getDb();
  const categories = await withFamilyContext(
    db,
    familyId,
    session.user.id,
    async (tx) => {
      return tx.select().from(category).orderBy(category.sortOrder);
    },
  );

  const expenseCategories = categories.filter(
    (c) => c.kind === "expense" && !c.isArchived,
  );
  const incomeCategories = categories.filter(
    (c) => c.kind === "income" && !c.isArchived,
  );
  const archivedCategories = categories.filter((c) => c.isArchived);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
        <CategoryForm
          mode="create"
          trigger={
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add category
            </Button>
          }
        />
      </div>

      {categories.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            No categories yet. Create one to start organizing your transactions.
          </p>
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Expenses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {expenseCategories.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No expense categories yet.
                </p>
              ) : (
                expenseCategories.map((c) => (
                  <CategoryRow key={c.id} category={c} />
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Income</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {incomeCategories.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No income categories yet.
                </p>
              ) : (
                incomeCategories.map((c) => (
                  <CategoryRow key={c.id} category={c} />
                ))
              )}
            </CardContent>
          </Card>

          {archivedCategories.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                Archived ({archivedCategories.length})
              </summary>
              <div className="mt-3 space-y-2">
                {archivedCategories.map((c) => (
                  <CategoryRow key={c.id} category={c} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
