import { useState, useEffect, useCallback } from "react";
import { TimelineItem } from "../../shared/utils/timeline";

export interface Capture {
  id: string;
  type: string;
  rawPayload: string;
  originalFilename: string | null;
  processingStatus: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
}

export function useDashboardPolling(intervalMs = 4000) {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [capRes, itemRes] = await Promise.all([
        fetch("/api/v1/captures"),
        fetch("/api/v1/items"),
      ]);

      if (capRes.ok) {
        const data = await capRes.json();
        setCaptures(data.captures || []);
      }
      if (itemRes.ok) {
        const data = await itemRes.json();
        const rawItems = (data.items || []).map((i: any) => ({
          ...i,
          dueDate: i.dueDate ? new Date(i.dueDate).toISOString() : null,
          snoozedUntil: i.snoozedUntil ? new Date(i.snoozedUntil).toISOString() : null,
          completedAt: i.completedAt ? new Date(i.completedAt).toISOString() : null,
          createdAt: new Date(i.createdAt).toISOString(),
        }));
        setItems(rawItems);
      }
      setError(null);
    } catch (e) {
      console.error("Failed to load dashboard data:", e);
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, intervalMs);
    return () => clearInterval(interval);
  }, [fetchData, intervalMs]);

  return { captures, setCaptures, items, setItems, loading, error, refetch: fetchData };
}
