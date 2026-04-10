"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exchangeAndStoreConnection } from "../actions";

export default function NewConnectionPage() {
  const router = useRouter();
  const [setupToken, setSetupToken] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await exchangeAndStoreConnection(
        setupToken.trim(),
        nickname.trim(),
      );
      if (result.success) {
        router.push("/connections");
      } else {
        setError(result.error ?? "Failed to add connection");
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>Add SimpleFIN Connection</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="setup-token">Setup Token</Label>
              <textarea
                id="setup-token"
                className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Paste your SimpleFIN Setup Token here..."
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Get this from{" "}
                <a
                  href="https://beta-bridge.simplefin.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  SimpleFIN Bridge
                </a>
                . The token is one-time-use.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="nickname">Nickname (optional)</Label>
              <Input
                id="nickname"
                placeholder='e.g. "Chase + Amex"'
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Connecting..." : "Add Connection"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
