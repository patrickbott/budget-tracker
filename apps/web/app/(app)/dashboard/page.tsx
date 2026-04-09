import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const cards = [
  { title: "Net worth", body: "Phase 1 — coming soon" },
  { title: "Cashflow (30 days)", body: "Phase 1 — coming soon" },
  { title: "Recent transactions", body: "Phase 1 — coming soon" },
] as const;

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader>
              <CardTitle>{card.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {card.body}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
