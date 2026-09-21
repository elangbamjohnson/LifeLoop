import type { Response } from 'express';

export interface SyncEvent {
  type: 'changed';
  entity: 'item' | 'capture' | 'reminder' | 'relation';
  id?: string;
  at: string;
  origin?: string;
}

export interface EventBusInterface {
  publish(userId: string, event: SyncEvent): void;
  subscribe(userId: string, res: Response): void;
  unsubscribe(userId: string, res: Response): void;
  getConnectionCount(userId?: string): number;
}

const MAX_CONNECTIONS_PER_USER = 10;

export class InMemoryEventBus implements EventBusInterface {
  // Map of userId -> Set of Response objects
  // Set preserves insertion order, so the first element is the oldest connection
  private connections: Map<string, Set<Response>> = new Map();

  publish(userId: string, event: SyncEvent): void {
    const userStreams = this.connections.get(userId);
    if (!userStreams || userStreams.size === 0) {
      return;
    }

    const payload = `data: ${JSON.stringify(event)}\n\n`;

    for (const res of Array.from(userStreams)) {
      try {
        res.write(payload);
      } catch (err) {
        this.unsubscribe(userId, res);
      }
    }
  }

  subscribe(userId: string, res: Response): void {
    let userStreams = this.connections.get(userId);
    if (!userStreams) {
      userStreams = new Set();
      this.connections.set(userId, userStreams);
    }

    // Cap at MAX_CONNECTIONS_PER_USER streams per user.
    // If cap reached, drop oldest stream.
    if (userStreams.size >= MAX_CONNECTIONS_PER_USER) {
      const oldest = userStreams.values().next().value;
      if (oldest) {
        try {
          oldest.write('event: replaced\ndata: {}\n\n');
          oldest.end();
        } catch (_) {
          // ignore
        }
        userStreams.delete(oldest);
      }
    }

    userStreams.add(res);
  }

  unsubscribe(userId: string, res: Response): void {
    const userStreams = this.connections.get(userId);
    if (!userStreams) {
      return;
    }

    userStreams.delete(res);
    if (userStreams.size === 0) {
      this.connections.delete(userId);
    }
  }

  getConnectionCount(userId?: string): number {
    if (userId) {
      return this.connections.get(userId)?.size ?? 0;
    }

    let total = 0;
    for (const streams of this.connections.values()) {
      total += streams.size;
    }
    return total;
  }
}

export const eventBus = new InMemoryEventBus();
