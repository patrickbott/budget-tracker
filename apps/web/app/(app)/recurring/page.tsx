import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";

import {
  listPersistedRecurring,
  listRecurringCandidates,
} from "./_actions/candidates";
import { RecurringCandidatesList } from "./_components/recurring-candidates-list";

/**
 * `/recurring` dashboard.
 *
 * Two stacked sections:
 *
 *   1. "Detected candidates" — the ephemeral output of
 *      `detectRecurringCandidatesForFamily`, one row per
 *      (normalized-description, cadence) group with a Promote button.
 *   2. "Tracked recurring" — the persisted `recurring` rows the user
 *      has already promoted.
 *
 * Empty state for both lists collapses to a single guidance message.
 */
export default async function RecurringPage() {
  const [candidates, persisted] = await Promise.all([
    listRecurringCandidates(),
    listPersistedRecurring(),
  ]);

  const bothEmpty = candidates.length === 0 && persisted.length === 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Recurring</h1>

      {bothEmpty ? (
        <p className="text-muted-foreground">
          No recurring patterns detected yet — sync some transactions first.
        </p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Detected candidates</CardTitle>
            </CardHeader>
            <CardContent>
              <RecurringCandidatesList initialCandidates={candidates} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tracked recurring</CardTitle>
            </CardHeader>
            <CardContent>
              {persisted.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No recurring series have been promoted yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Cadence</TableHead>
                      <TableHead className="text-right">
                        Expected amount
                      </TableHead>
                      <TableHead>Last matched</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {persisted.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="capitalize">
                          {row.cadenceInterval === 1
                            ? row.cadence
                            : `every ${row.cadenceInterval} ${row.cadence}`}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(row.expectedAmount)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.lastMatchedDate ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
