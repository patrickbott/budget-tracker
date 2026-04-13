"use client";

import { useTransition } from "react";
import {
  AlertTriangle,
  Bell,
  Info,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dismissCoachingAlert } from "./coaching-alerts-actions";

interface CoachingAlertItem {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  body: string;
  generatedAt: Date;
}

interface CoachingAlertsWidgetProps {
  alerts: CoachingAlertItem[];
}

function severityIcon(severity: string) {
  switch (severity) {
    case "critical":
      return <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />;
    default:
      return <Info className="h-4 w-4 shrink-0 text-blue-500" />;
  }
}

function severityBadgeVariant(severity: string) {
  switch (severity) {
    case "critical":
      return "destructive" as const;
    case "warning":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function DismissButton({ alertId }: { alertId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover/alert:opacity-100"
      disabled={isPending}
      onClick={() =>
        startTransition(() => dismissCoachingAlert(alertId))
      }
    >
      <X className="h-3.5 w-3.5" />
      <span className="sr-only">Dismiss alert</span>
    </Button>
  );
}

export function CoachingAlertsWidget({ alerts }: CoachingAlertsWidgetProps) {
  if (alerts.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Coaching
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className="group/alert flex items-start gap-3 rounded-md border p-3"
          >
            {severityIcon(alert.severity)}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium leading-tight">
                  {alert.title}
                </span>
                <Badge
                  variant={severityBadgeVariant(alert.severity)}
                  className="text-[10px]"
                >
                  {alert.severity}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {alert.body}
              </p>
            </div>
            <DismissButton alertId={alert.id} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
