import request from "supertest";
import type express from "express";
import { createApp } from "../../src/app";
import { InMemoryStorage } from "../../src/services/storage";

let storage: InMemoryStorage;
let app: express.Express;

beforeEach(async () => {
  storage = new InMemoryStorage();
  app = await createApp({ mode: "memory", storage, disableRedis: true });
});

async function createTrip(overrides: Record<string, string> = {}) {
  const res = await request(app)
    .post("/api/v1/trips")
    .send({
      title: "History Trip",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body;
}

async function fetchHistory(tripId: string): Promise<unknown[]> {
  const res = await request(app).get(`/api/v1/trips/${tripId}`);
  expect(res.status).toBe(200);
  return res.body.history ?? [];
}

describe("Trip history audit log", () => {
  it("starts empty on a new trip", async () => {
    const trip = await createTrip();
    expect(trip.history).toEqual([]);
  });

  it("records a segment.create entry on POST /segments", async () => {
    const trip = await createTrip();
    await request(app)
      .post(`/api/v1/trips/${trip.id}/segments`)
      .send({
        date: "2026-06-02",
        type: "flight",
        title: "SEA → CDG",
        startTime: "10:00",
      })
      .expect(201);

    const history = await fetchHistory(trip.id);
    expect(history).toHaveLength(1);
    const entry = history[0] as { kind: string; summary: string; entityId: string };
    expect(entry.kind).toBe("segment.create");
    expect(entry.summary).toContain("SEA → CDG");
    expect(entry.entityId).toBeTruthy();
  });

  it("records a segment.update entry only when fields actually change", async () => {
    const trip = await createTrip();
    const segmentRes = await request(app)
      .post(`/api/v1/trips/${trip.id}/segments`)
      .send({
        date: "2026-06-02",
        type: "restaurant_dinner",
        title: "Le Comptoir",
        startTime: "19:00",
      });
    const segId = segmentRes.body.id;

    // Change just startTime — should record an update entry.
    await request(app)
      .put(`/api/v1/trips/${trip.id}/segments/${segId}`)
      .send({ startTime: "19:30" })
      .expect(200);

    const history = await fetchHistory(trip.id);
    expect(history).toHaveLength(2); // create + update
    const updateEntry = history[1] as { kind: string; details?: string };
    expect(updateEntry.kind).toBe("segment.update");
    expect(updateEntry.details).toContain("startTime");
  });

  it("records a segment.delete entry on DELETE /segments/:id", async () => {
    const trip = await createTrip();
    const segmentRes = await request(app)
      .post(`/api/v1/trips/${trip.id}/segments`)
      .send({
        date: "2026-06-02",
        type: "hotel",
        title: "Hotel Beaubourg",
      });
    const segId = segmentRes.body.id;

    await request(app)
      .delete(`/api/v1/trips/${trip.id}/segments/${segId}`)
      .expect(204);

    const history = await fetchHistory(trip.id);
    const lastEntry = history[history.length - 1] as { kind: string; summary: string };
    expect(lastEntry.kind).toBe("segment.delete");
    expect(lastEntry.summary).toContain("Hotel Beaubourg");
  });

  it("records a todo lifecycle: create → complete → delete", async () => {
    const trip = await createTrip();

    const createRes = await request(app)
      .post(`/api/v1/trips/${trip.id}/todos`)
      .send({ text: "Book transfer" });
    const todoId = createRes.body.id;

    await request(app)
      .put(`/api/v1/trips/${trip.id}/todos/${todoId}`)
      .send({ isCompleted: true })
      .expect(200);

    await request(app)
      .delete(`/api/v1/trips/${trip.id}/todos/${todoId}`)
      .expect(204);

    const history = await fetchHistory(trip.id);
    const kinds = (history as Array<{ kind: string }>).map((h) => h.kind);
    expect(kinds).toEqual(["todo.create", "todo.update", "todo.delete"]);
  });

  it("records a trip.update entry when title changes", async () => {
    const trip = await createTrip();
    await request(app)
      .put(`/api/v1/trips/${trip.id}`)
      .send({ title: "Renamed Trip" })
      .expect(200);

    const history = await fetchHistory(trip.id);
    expect(history).toHaveLength(1);
    const entry = history[0] as { kind: string; summary: string; details?: string };
    expect(entry.kind).toBe("trip.update");
    expect(entry.details).toContain("Renamed Trip");
  });

  it("does not record an entry when PUT trip is a no-op", async () => {
    const trip = await createTrip();
    await request(app)
      .put(`/api/v1/trips/${trip.id}`)
      .send({ title: trip.title })
      .expect(200);

    const history = await fetchHistory(trip.id);
    expect(history).toEqual([]);
  });
});
