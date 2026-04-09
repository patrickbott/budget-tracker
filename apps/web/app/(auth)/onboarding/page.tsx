"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";

export default function OnboardingPage() {
  const router = useRouter();
  const [familyName, setFamilyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    // The Better Auth `organization` plugin is remapped to our `family`
    // table in `lib/auth/server.ts`. The client API is still named
    // `organization.*` though.
    const slug = familyName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const result = await authClient.organization.create({
      name: familyName.trim(),
      slug: slug || "household",
    });

    if (result.error) {
      setError(result.error.message ?? "Failed to create your household.");
      setPending(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Name your household</CardTitle>
        <CardDescription>
          Every account and budget lives inside a household. You can invite
          others later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="family-name">Household name</Label>
            <Input
              id="family-name"
              type="text"
              required
              placeholder="e.g. The Bott Family"
              value={familyName}
              onChange={(event) => setFamilyName(event.target.value)}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating household…" : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
