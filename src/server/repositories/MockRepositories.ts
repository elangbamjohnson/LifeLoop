import { Capture, Item } from "../../shared/types/domain";

// Mock Repositories for Phase 0

export class MockCaptureRepository {
  private captures: Capture[] = [];

  async create(data: Omit<Capture, "id" | "createdAt" | "status">): Promise<Capture> {
    const capture: Capture = {
      ...data,
      id: crypto.randomUUID(),
      status: "pending",
      createdAt: new Date(),
    };
    this.captures.push(capture);
    return capture;
  }

  async findByUserId(userId: string): Promise<Capture[]> {
    return this.captures.filter(c => c.userId === userId);
  }
}

export class MockItemRepository {
  private items: Item[] = [];

  async create(data: Omit<Item, "id" | "createdAt" | "updatedAt">): Promise<Item> {
    const item: Item = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.items.push(item);
    return item;
  }

  async findByUserId(userId: string): Promise<Item[]> {
    return this.items.filter(i => i.userId === userId);
  }
}

// Instantiate mocks
export const captureRepo = new MockCaptureRepository();
export const itemRepo = new MockItemRepository();
