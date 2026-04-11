import request from "supertest";
import { createApp } from "../../src/app";
import { InMemoryStorage } from "../../src/services/storage";

let storage: InMemoryStorage;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  storage = new InMemoryStorage();
  app = createApp({ mode: "memory", storage });
});

describe("GET /health", () => {
  it("returns ok status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

describe("Trip CRUD", () => {
  describe("POST /api/v1/trips", () => {
    it("creates a trip with auto-generated days", async () => {
      const res = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Christmas 2025",
          startDate: "2025-12-19",
          endDate: "2025-12-21",
        });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Christmas 2025");
      expect(res.body.id).toBeTruthy();
      expect(res.body.status).toBe("planning");
      expect(res.body.days).toHaveLength(3);
      expect(res.body.days[0].date).toBe("2025-12-19");
      expect(res.body.days[0].dayOfWeek).toBe("Fri");
      expect(res.body.days[1].date).toBe("2025-12-20");
      expect(res.body.days[2].date).toBe("2025-12-21");
    });

    it("rejects invalid input", async () => {
      const res = await request(app)
        .post("/api/v1/trips")
        .send({ title: "" });
      expect(res.status).toBe(400);
    });

    it("rejects when endDate before startDate", async () => {
      const res = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Bad Trip",
          startDate: "2025-12-30",
          endDate: "2025-12-19",
        });
      expect(res.status).toBe(400);
    });

    it("rejects trip with overlapping dates", async () => {
      await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Italy Trip",
          startDate: "2026-06-15",
          endDate: "2026-06-25",
        });

      const res = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "France Trip",
          startDate: "2026-06-20",
          endDate: "2026-07-05",
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Date range overlaps with an existing trip");
      expect(res.body.overlappingTrips).toHaveLength(1);
      expect(res.body.overlappingTrips[0].title).toBe("Italy Trip");
    });

    it("allows non-overlapping trips", async () => {
      await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Italy Trip",
          startDate: "2026-06-15",
          endDate: "2026-06-25",
        });

      const res = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Japan Trip",
          startDate: "2026-09-01",
          endDate: "2026-09-14",
        });

      expect(res.status).toBe(201);
    });

    it("allows adjacent trips (back-to-back)", async () => {
      await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Italy Trip",
          startDate: "2026-06-15",
          endDate: "2026-06-25",
        });

      const res = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "France Trip",
          startDate: "2026-06-26",
          endDate: "2026-07-05",
        });

      expect(res.status).toBe(201);
    });
  });

  describe("GET /api/v1/trips", () => {
    it("returns empty list initially", async () => {
      const res = await request(app).get("/api/v1/trips");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns trip summaries", async () => {
      await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Trip A",
          startDate: "2025-06-01",
          endDate: "2025-06-03",
        });

      const res = await request(app).get("/api/v1/trips");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe("Trip A");
      expect(res.body[0].dayCount).toBe(3);
      // Summaries should not include full days array
      expect(res.body[0].days).toBeUndefined();
    });
  });

  describe("GET /api/v1/trips/:tripId", () => {
    it("returns full trip with days", async () => {
      const createRes = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Trip A",
          startDate: "2025-06-01",
          endDate: "2025-06-02",
        });

      const res = await request(app).get(
        `/api/v1/trips/${createRes.body.id}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.days).toHaveLength(2);
    });

    it("returns 404 for non-existent trip", async () => {
      const res = await request(app).get("/api/v1/trips/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/v1/trips/:tripId", () => {
    it("updates trip title", async () => {
      const createRes = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Old Title",
          startDate: "2025-06-01",
          endDate: "2025-06-02",
        });

      const res = await request(app)
        .put(`/api/v1/trips/${createRes.body.id}`)
        .send({ title: "New Title" });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("New Title");
    });

    it("updates trip status", async () => {
      const createRes = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Trip",
          startDate: "2025-06-01",
          endDate: "2025-06-02",
        });

      const res = await request(app)
        .put(`/api/v1/trips/${createRes.body.id}`)
        .send({ status: "active" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("active");
    });

    it("rejects date update that would overlap another trip", async () => {
      const trip1 = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Italy Trip",
          startDate: "2026-06-15",
          endDate: "2026-06-25",
        });

      const trip2 = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Japan Trip",
          startDate: "2026-09-01",
          endDate: "2026-09-14",
        });

      // Try to extend Japan trip dates to overlap with Italy
      const res = await request(app)
        .put(`/api/v1/trips/${trip2.body.id}`)
        .send({ startDate: "2026-06-20" });

      expect(res.status).toBe(409);
      expect(res.body.overlappingTrips).toHaveLength(1);
      expect(res.body.overlappingTrips[0].title).toBe("Italy Trip");
    });

    it("allows updating own dates without self-overlap", async () => {
      const trip = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Italy Trip",
          startDate: "2026-06-15",
          endDate: "2026-06-25",
        });

      // Extend the same trip — should not conflict with itself
      const res = await request(app)
        .put(`/api/v1/trips/${trip.body.id}`)
        .send({ endDate: "2026-06-30" });

      expect(res.status).toBe(200);
      expect(res.body.endDate).toBe("2026-06-30");
    });

    it("regenerates days array when dates change", async () => {
      const trip = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Short Trip",
          startDate: "2026-06-15",
          endDate: "2026-06-17",
        });

      expect(trip.body.days).toHaveLength(3);

      // Extend by 2 days
      const res = await request(app)
        .put(`/api/v1/trips/${trip.body.id}`)
        .send({ endDate: "2026-06-19" });

      expect(res.status).toBe(200);
      expect(res.body.days).toHaveLength(5);
      // Original days preserved
      expect(res.body.days[0].date).toBe("2026-06-15");
      // New days added
      expect(res.body.days[4].date).toBe("2026-06-19");
    });

    it("preserves existing segments when dates change", async () => {
      const trip = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Trip",
          startDate: "2026-06-15",
          endDate: "2026-06-18",
        });

      // Add a segment on June 16
      await request(app)
        .post(`/api/v1/trips/${trip.body.id}/segments`)
        .send({
          date: "2026-06-16",
          type: "flight",
          title: "SFO → FCO",
          startTime: "10:00",
        });

      // Shrink start date (removes June 15), extend end date
      const res = await request(app)
        .put(`/api/v1/trips/${trip.body.id}`)
        .send({ startDate: "2026-06-16", endDate: "2026-06-20" });

      expect(res.status).toBe(200);
      expect(res.body.days).toHaveLength(5);
      // June 16 segment preserved
      const june16 = res.body.days.find((d: { date: string }) => d.date === "2026-06-16");
      expect(june16.segments).toHaveLength(1);
      expect(june16.segments[0].title).toBe("SFO → FCO");
    });
  });

  describe("DELETE /api/v1/trips/:tripId", () => {
    it("deletes a trip", async () => {
      const createRes = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Trip",
          startDate: "2025-06-01",
          endDate: "2025-06-02",
        });

      const delRes = await request(app).delete(
        `/api/v1/trips/${createRes.body.id}`,
      );
      expect(delRes.status).toBe(204);

      const getRes = await request(app).get(
        `/api/v1/trips/${createRes.body.id}`,
      );
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for non-existent trip", async () => {
      const res = await request(app).delete("/api/v1/trips/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});

describe("Day routes", () => {
  let tripId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post("/api/v1/trips")
      .send({
        title: "Test Trip",
        startDate: "2025-12-19",
        endDate: "2025-12-21",
      });
    tripId = res.body.id;
  });

  it("GET /days returns all days", async () => {
    const res = await request(app).get(`/api/v1/trips/${tripId}/days`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it("PUT /days/:date updates city", async () => {
    const res = await request(app)
      .put(`/api/v1/trips/${tripId}/days/2025-12-19`)
      .send({ city: "Prague" });
    expect(res.status).toBe(200);
    expect(res.body.city).toBe("Prague");
  });
});

describe("Segment routes", () => {
  let tripId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post("/api/v1/trips")
      .send({
        title: "Test Trip",
        startDate: "2025-12-19",
        endDate: "2025-12-21",
      });
    tripId = res.body.id;
  });

  it("creates a segment on a specific day", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({
        date: "2025-12-19",
        type: "flight",
        title: "BA52 SEA-LHR",
        startTime: "13:35",
        endTime: "07:10",
        departureCity: "Seattle",
        arrivalCity: "London",
        carrier: "BA",
        routeCode: "52",
        confirmationCode: "XTWLTR",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.type).toBe("flight");
    expect(res.body.source).toBe("manual");
    expect(res.body.needsReview).toBe(false);
  });

  it("lists all segments for a trip", async () => {
    await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({ date: "2025-12-19", type: "flight", title: "Flight 1" });
    await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({
        date: "2025-12-20",
        type: "hotel",
        title: "Hotel Prague",
      });

    const res = await request(app).get(
      `/api/v1/trips/${tripId}/segments`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("filters segments by type", async () => {
    await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({ date: "2025-12-19", type: "flight", title: "Flight" });
    await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({ date: "2025-12-20", type: "hotel", title: "Hotel" });

    const res = await request(app).get(
      `/api/v1/trips/${tripId}/segments?type=flight`,
    );
    expect(res.body).toHaveLength(1);
    expect(res.body[0].type).toBe("flight");
  });

  it("updates a segment", async () => {
    const createRes = await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({ date: "2025-12-19", type: "flight", title: "Old Title" });

    const res = await request(app)
      .put(`/api/v1/trips/${tripId}/segments/${createRes.body.id}`)
      .send({ title: "New Title" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("New Title");
  });

  it("updates multiple segment fields at once", async () => {
    const createRes = await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({ date: "2025-12-19", type: "flight", title: "SEA-NRT" });

    const res = await request(app)
      .put(`/api/v1/trips/${tripId}/segments/${createRes.body.id}`)
      .send({
        title: "AS 101 SEA-NRT",
        startTime: "13:35",
        carrier: "AS",
        routeCode: "101",
        cabinClass: "Premium Economy",
        seatNumber: "12A, 12B",
        cost: { amount: 1200, currency: "USD", details: "2 passengers" },
      });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("AS 101 SEA-NRT");
    expect(res.body.startTime).toBe("13:35");
    expect(res.body.carrier).toBe("AS");
    expect(res.body.cabinClass).toBe("Premium Economy");
    expect(res.body.seatNumber).toBe("12A, 12B");
    expect(res.body.cost.amount).toBe(1200);
  });

  it("relocates a segment to a different day when date is updated", async () => {
    const createRes = await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({ date: "2025-12-19", type: "hotel", title: "Hotel" });

    const segId = createRes.body.id;

    const moveRes = await request(app)
      .put(`/api/v1/trips/${tripId}/segments/${segId}`)
      .send({ date: "2025-12-20" });

    expect(moveRes.status).toBe(200);

    const tripRes = await request(app).get(`/api/v1/trips/${tripId}`);
    const day19 = tripRes.body.days.find(
      (d: { date: string }) => d.date === "2025-12-19",
    );
    const day20 = tripRes.body.days.find(
      (d: { date: string }) => d.date === "2025-12-20",
    );
    expect(day19.segments.find((s: { id: string }) => s.id === segId)).toBeUndefined();
    expect(day20.segments.find((s: { id: string }) => s.id === segId)).toBeTruthy();
  });

  it("rejects relocating a segment to a date outside the trip range", async () => {
    const createRes = await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({ date: "2025-12-19", type: "hotel", title: "Hotel" });

    const res = await request(app)
      .put(`/api/v1/trips/${tripId}/segments/${createRes.body.id}`)
      .send({ date: "2026-01-15" });

    expect(res.status).toBe(400);
  });

  it("rejects segment update with invalid time format", async () => {
    const createRes = await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({ date: "2025-12-19", type: "hotel", title: "Hilton" });

    const res = await request(app)
      .put(`/api/v1/trips/${tripId}/segments/${createRes.body.id}`)
      .send({ startTime: "1:35PM" });

    expect(res.status).toBe(400);
  });

  it("does not allow updating immutable fields via update endpoint", async () => {
    const createRes = await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({ date: "2025-12-19", type: "hotel", title: "Hotel" });

    // These fields are not in updateSegmentSchema, so they'll be stripped
    const res = await request(app)
      .put(`/api/v1/trips/${tripId}/segments/${createRes.body.id}`)
      .send({ title: "Updated Hotel" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Updated Hotel");
    // source should remain unchanged from creation
    expect(res.body.source).toBe("manual");
  });

  it("deletes a segment", async () => {
    const createRes = await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({ date: "2025-12-19", type: "flight", title: "Flight" });

    const delRes = await request(app).delete(
      `/api/v1/trips/${tripId}/segments/${createRes.body.id}`,
    );
    expect(delRes.status).toBe(204);

    const listRes = await request(app).get(
      `/api/v1/trips/${tripId}/segments`,
    );
    expect(listRes.body).toHaveLength(0);
  });

  it("confirms an auto-parsed segment", async () => {
    const createRes = await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({ date: "2025-12-19", type: "flight", title: "Flight" });

    // Manually set needsReview to true (simulating email parse)
    await request(app)
      .put(`/api/v1/trips/${tripId}/segments/${createRes.body.id}`)
      .send({ needsReview: true });

    const confirmRes = await request(app).post(
      `/api/v1/trips/${tripId}/segments/${createRes.body.id}/confirm`,
    );

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.needsReview).toBe(false);
    expect(confirmRes.body.source).toBe("email_confirmed");
  });

  it("rejects segment without date", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({ type: "flight", title: "No Date" });
    expect(res.status).toBe(400);
  });
});

describe("Cost Summary", () => {
  let tripId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post("/api/v1/trips")
      .send({
        title: "Test Trip",
        startDate: "2025-12-19",
        endDate: "2025-12-20",
      });
    tripId = res.body.id;
  });

  it("aggregates costs across segments", async () => {
    await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({
        date: "2025-12-19",
        type: "flight",
        title: "Flight to Europe",
        cost: { amount: 4704.05, currency: "USD" },
      });
    await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({
        date: "2025-12-20",
        type: "hotel",
        title: "Hotel Prague",
        cost: {
          amount: 649.9,
          currency: "USD",
          details: "Queen Guest Room",
        },
      });

    const res = await request(app).get(
      `/api/v1/trips/${tripId}/costs`,
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.totalsByCurrency.USD).toBeCloseTo(5353.95);
  });

  it("handles multiple currencies", async () => {
    await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({
        date: "2025-12-19",
        type: "flight",
        title: "Flight",
        cost: { amount: 4704.05, currency: "USD" },
      });
    await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({
        date: "2025-12-20",
        type: "train",
        title: "Train to Dresden",
        cost: { amount: 74.97, currency: "EUR" },
      });

    const res = await request(app).get(
      `/api/v1/trips/${tripId}/costs`,
    );
    expect(res.body.totalsByCurrency.USD).toBeCloseTo(4704.05);
    expect(res.body.totalsByCurrency.EUR).toBeCloseTo(74.97);
  });
});

describe("Todo routes", () => {
  let tripId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post("/api/v1/trips")
      .send({
        title: "Test Trip",
        startDate: "2025-12-19",
        endDate: "2025-12-20",
      });
    tripId = res.body.id;
  });

  it("creates a todo", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/todos`)
      .send({ text: "Book Paris dinner", category: "meals" });

    expect(res.status).toBe(201);
    expect(res.body.text).toBe("Book Paris dinner");
    expect(res.body.isCompleted).toBe(false);
    expect(res.body.category).toBe("meals");
  });

  it("lists todos", async () => {
    await request(app)
      .post(`/api/v1/trips/${tripId}/todos`)
      .send({ text: "Todo 1" });
    await request(app)
      .post(`/api/v1/trips/${tripId}/todos`)
      .send({ text: "Todo 2" });

    const res = await request(app).get(
      `/api/v1/trips/${tripId}/todos`,
    );
    expect(res.body).toHaveLength(2);
  });

  it("marks a todo as completed", async () => {
    const createRes = await request(app)
      .post(`/api/v1/trips/${tripId}/todos`)
      .send({ text: "Todo 1" });

    const res = await request(app)
      .put(`/api/v1/trips/${tripId}/todos/${createRes.body.id}`)
      .send({ isCompleted: true });

    expect(res.status).toBe(200);
    expect(res.body.isCompleted).toBe(true);
  });

  it("deletes a todo", async () => {
    const createRes = await request(app)
      .post(`/api/v1/trips/${tripId}/todos`)
      .send({ text: "Todo 1" });

    const delRes = await request(app).delete(
      `/api/v1/trips/${tripId}/todos/${createRes.body.id}`,
    );
    expect(delRes.status).toBe(204);
  });
});

describe("Share routes", () => {
  let tripId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post("/api/v1/trips")
      .send({
        title: "Test Trip",
        startDate: "2025-12-19",
        endDate: "2025-12-20",
      });
    tripId = res.body.id;
  });

  it("creates a share link", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/share`)
      .send({ permission: "view", showCosts: false, showTodos: false });

    expect(res.status).toBe(201);
    expect(res.body.shareToken).toBeTruthy();
    expect(res.body.permission).toBe("view");
    expect(res.body.showCosts).toBe(false);
  });

  it("accesses shared trip via token", async () => {
    // Add a segment with cost
    await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({
        date: "2025-12-19",
        type: "flight",
        title: "Flight",
        cost: { amount: 100, currency: "USD" },
      });

    // Add a todo
    await request(app)
      .post(`/api/v1/trips/${tripId}/todos`)
      .send({ text: "Book dinner" });

    // Create share without costs/todos
    const shareRes = await request(app)
      .post(`/api/v1/trips/${tripId}/share`)
      .send({ permission: "view", showCosts: false, showTodos: false });

    const sharedRes = await request(app).get(
      `/api/v1/shared/${shareRes.body.shareToken}`,
    );

    expect(sharedRes.status).toBe(200);
    expect(sharedRes.body.title).toBe("Test Trip");
    // Cost should be hidden
    expect(sharedRes.body.days[0].segments[0].cost).toBeUndefined();
    // Todos should be hidden
    expect(sharedRes.body.todos).toEqual([]);
  });

  it("shows costs when share permits it", async () => {
    await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({
        date: "2025-12-19",
        type: "hotel",
        title: "Hotel",
        cost: { amount: 200, currency: "EUR" },
      });

    const shareRes = await request(app)
      .post(`/api/v1/trips/${tripId}/share`)
      .send({ permission: "view", showCosts: true, showTodos: true });

    const sharedRes = await request(app).get(
      `/api/v1/shared/${shareRes.body.shareToken}`,
    );

    expect(sharedRes.body.days[0].segments[0].cost.amount).toBe(200);
  });

  it("returns 404 for invalid token", async () => {
    const res = await request(app).get("/api/v1/shared/invalid-token");
    expect(res.status).toBe(404);
  });

  it("deletes a share", async () => {
    const shareRes = await request(app)
      .post(`/api/v1/trips/${tripId}/share`)
      .send({ permission: "view", showCosts: false, showTodos: false });

    const delRes = await request(app).delete(
      `/api/v1/trips/${tripId}/shares/${shareRes.body.id}`,
    );
    expect(delRes.status).toBe(204);

    // Token should no longer work
    const sharedRes = await request(app).get(
      `/api/v1/shared/${shareRes.body.shareToken}`,
    );
    expect(sharedRes.status).toBe(404);
  });
});

describe("Export routes", () => {
  let tripId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post("/api/v1/trips")
      .send({
        title: "Christmas 2025",
        startDate: "2025-12-19",
        endDate: "2025-12-20",
      });
    tripId = res.body.id;

    await request(app)
      .put(`/api/v1/trips/${tripId}/days/2025-12-19`)
      .send({ city: "Seattle" });

    await request(app)
      .post(`/api/v1/trips/${tripId}/segments`)
      .send({
        date: "2025-12-19",
        type: "flight",
        title: "BA52 SEA-LHR",
        cost: { amount: 4704.05, currency: "USD" },
      });
  });

  it("exports to markdown", async () => {
    const res = await request(app).get(
      `/api/v1/trips/${tripId}/export/markdown`,
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.text).toContain("# Christmas 2025");
    expect(res.text).toContain("BA52 SEA-LHR");
    expect(res.text).toContain("$4,704.05");
  });

  it("exports markdown without costs", async () => {
    const res = await request(app).get(
      `/api/v1/trips/${tripId}/export/markdown?exclude=costs`,
    );
    expect(res.text).toContain("# Christmas 2025");
    expect(res.text).not.toContain("Cost Summary");
  });

  it("exports to OneNote HTML", async () => {
    const res = await request(app).get(
      `/api/v1/trips/${tripId}/export/onenote`,
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("<!DOCTYPE html>");
    expect(res.text).toContain("<h1>Christmas 2025</h1>");
    expect(res.text).toContain("BA52 SEA-LHR");
    expect(res.text).toContain("$4,704.05");
  });

  it("exports OneNote HTML without costs", async () => {
    const res = await request(app).get(
      `/api/v1/trips/${tripId}/export/onenote?exclude=costs`,
    );
    expect(res.text).toContain("<h1>Christmas 2025</h1>");
    expect(res.text).not.toContain("Cost Summary");
  });

  it("exports to PDF", async () => {
    const res = await request(app).get(
      `/api/v1/trips/${tripId}/export/pdf`,
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("Christmas 2025.pdf");
    // PDF files start with the %PDF magic bytes
    expect(res.body.toString().startsWith("%PDF") || res.text.startsWith("%PDF")).toBe(true);
  });

  it("exports PDF without costs", async () => {
    const res = await request(app).get(
      `/api/v1/trips/${tripId}/export/pdf?exclude=costs`,
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
  });

  it("exports PDF without todos", async () => {
    const res = await request(app).get(
      `/api/v1/trips/${tripId}/export/pdf?exclude=todos`,
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
  });

  it("returns 404 for PDF export of non-existent trip", async () => {
    const res = await request(app).get(
      `/api/v1/trips/does-not-exist/export/pdf`,
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/trips/import-xlsx", () => {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");

  const loadFixture = (name: string): string =>
    fs
      .readFileSync(
        path.join(__dirname, "..", "fixtures", name),
      )
      .toString("base64");

  it("rejects a payload with no fileBase64", async () => {
    const res = await request(app)
      .post("/api/v1/trips/import-xlsx")
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects a payload with invalid base64 / non-xlsx content", async () => {
    const res = await request(app)
      .post("/api/v1/trips/import-xlsx")
      .send({ fileBase64: Buffer.from("not a real xlsx").toString("base64") });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parse|xlsx/i);
  });

  it("creates a full trip from the Christmas 2025 fixture", async () => {
    const res = await request(app)
      .post("/api/v1/trips/import-xlsx")
      .send({
        fileBase64: loadFixture("christmas-2025.xlsx"),
        filename: "Christmas 2025.xlsx",
      });

    expect(res.status).toBe(201);
    expect(res.body.trip).toBeDefined();
    expect(res.body.trip.title).toBe("Christmas 2025");
    expect(res.body.trip.startDate).toBe("2025-12-19");
    expect(res.body.trip.endDate).toBe("2025-12-30");
    expect(res.body.trip.days).toHaveLength(12);
    expect(res.body.trip.status).toBe("planning");

    // Day 1 — Seattle, outbound flight, PNR "XTWLTR"
    const day1 = res.body.trip.days[0];
    expect(day1.city).toMatch(/Seattle/i);
    const flight = day1.segments.find((s: { type: string }) => s.type === "flight");
    expect(flight).toBeDefined();
    expect(flight.confirmationCode).toBe("XTWLTR");

    // Every imported segment should have needsReview=true so the user can
    // review and confirm after import.
    for (const day of res.body.trip.days) {
      for (const seg of day.segments) {
        expect(seg.needsReview).toBe(true);
      }
    }
  });

  it("creates a full trip from the Summer 2025 fixture", async () => {
    const res = await request(app)
      .post("/api/v1/trips/import-xlsx")
      .send({
        fileBase64: loadFixture("summer-2025.xlsx"),
        filename: "Summer 2025.xlsx",
      });

    expect(res.status).toBe(201);
    expect(res.body.trip.title).toBe("Summer 2025");
    expect(res.body.trip.startDate).toBe("2025-06-10");
    expect(res.body.trip.endDate).toBe("2025-06-27");
    expect(res.body.trip.days).toHaveLength(18);
  });

  it("honors an explicit title override", async () => {
    const res = await request(app)
      .post("/api/v1/trips/import-xlsx")
      .send({
        fileBase64: loadFixture("christmas-2025.xlsx"),
        filename: "whatever.xlsx",
        title: "Holiday Europe Trip",
      });
    expect(res.status).toBe(201);
    expect(res.body.trip.title).toBe("Holiday Europe Trip");
  });

  it("persists the imported trip so it's retrievable via GET /trips/:id", async () => {
    const createRes = await request(app)
      .post("/api/v1/trips/import-xlsx")
      .send({
        fileBase64: loadFixture("christmas-2025.xlsx"),
        filename: "Christmas 2025.xlsx",
      });
    expect(createRes.status).toBe(201);
    const tripId = createRes.body.trip.id;

    const getRes = await request(app).get(`/api/v1/trips/${tripId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(tripId);
    expect(getRes.body.days).toHaveLength(12);
  });

  it("returns 409 when the imported date range overlaps an existing trip", async () => {
    // Pre-create a trip that overlaps with the Christmas 2025 fixture
    await request(app).post("/api/v1/trips").send({
      title: "Existing",
      startDate: "2025-12-20",
      endDate: "2025-12-22",
    });

    const res = await request(app)
      .post("/api/v1/trips/import-xlsx")
      .send({
        fileBase64: loadFixture("christmas-2025.xlsx"),
        filename: "Christmas 2025.xlsx",
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/overlap/i);
  });
});
