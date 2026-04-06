import {
  createTripSchema,
  updateTripSchema,
  segmentSchema,
  createSegmentSchema,
  tripDaySchema,
  todoSchema,
  createTodoSchema,
  updateTodoSchema,
  tripShareSchema,
  createShareSchema,
  segmentCostSchema,
  tripSchema,
  userSettingsSchema,
} from "../src/validators/trip";

describe("segmentCostSchema", () => {
  it("validates a valid cost", () => {
    const result = segmentCostSchema.safeParse({
      amount: 649.9,
      currency: "USD",
      details: "2 rooms Queen Guest Room",
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative amount", () => {
    const result = segmentCostSchema.safeParse({
      amount: -100,
      currency: "USD",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty currency", () => {
    const result = segmentCostSchema.safeParse({
      amount: 100,
      currency: "",
    });
    expect(result.success).toBe(false);
  });

  it("allows points as currency", () => {
    const result = segmentCostSchema.safeParse({
      amount: 318500,
      currency: "points",
    });
    expect(result.success).toBe(true);
  });
});

describe("segmentSchema", () => {
  const validSegment = {
    id: "seg-1",
    type: "flight" as const,
    title: "BA52 SEA-LHR",
    startTime: "13:35",
    endTime: "07:10",
    departureCity: "Seattle",
    arrivalCity: "London",
    carrier: "BA",
    routeCode: "52",
    confirmationCode: "XTWLTR",
    source: "manual" as const,
    needsReview: false,
    sortOrder: 0,
  };

  it("validates a valid flight segment", () => {
    const result = segmentSchema.safeParse(validSegment);
    expect(result.success).toBe(true);
  });

  it("validates a hotel segment with cost", () => {
    const result = segmentSchema.safeParse({
      id: "seg-2",
      type: "hotel",
      title: "Hilton Prague Old Town",
      venueName: "Hilton Prague Old Town",
      address: "V Celnici 2079/7, 110 00 Nové Město, Czechia",
      confirmationCode: "3330467896",
      cost: { amount: 649.9, currency: "USD", details: "Queen Guest Room" },
      source: "email_confirmed",
      needsReview: false,
      sortOrder: 0,
    });
    expect(result.success).toBe(true);
  });

  it("validates a restaurant segment with party size and CC hold", () => {
    const result = segmentSchema.safeParse({
      id: "seg-3",
      type: "restaurant_dinner",
      title: "Chutney Mary",
      venueName: "Chutney Mary",
      startTime: "20:00",
      partySize: 4,
      creditCardHold: true,
      source: "manual",
      needsReview: false,
      sortOrder: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid segment type", () => {
    const result = segmentSchema.safeParse({
      ...validSegment,
      type: "spaceship",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = segmentSchema.safeParse({
      ...validSegment,
      title: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid time format", () => {
    const result = segmentSchema.safeParse({
      ...validSegment,
      startTime: "1:35PM",
    });
    expect(result.success).toBe(false);
  });

  it("accepts time with seconds", () => {
    const result = segmentSchema.safeParse({
      ...validSegment,
      startTime: "13:35:00",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid URL", () => {
    const result = segmentSchema.safeParse({
      ...validSegment,
      url: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects partySize less than 1", () => {
    const result = segmentSchema.safeParse({
      ...validSegment,
      partySize: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("tripDaySchema", () => {
  it("validates a valid trip day", () => {
    const result = tripDaySchema.safeParse({
      date: "2025-12-19",
      dayOfWeek: "Fri",
      city: "Seattle",
      segments: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = tripDaySchema.safeParse({
      date: "Dec 19, 2025",
      dayOfWeek: "Fri",
      city: "Seattle",
      segments: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty city", () => {
    const result = tripDaySchema.safeParse({
      date: "2025-12-19",
      dayOfWeek: "Fri",
      city: "",
      segments: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("todoSchema", () => {
  it("validates a valid todo", () => {
    const result = todoSchema.safeParse({
      id: "todo-1",
      text: "Book Paris dinner",
      isCompleted: false,
      category: "meals",
      sortOrder: 0,
    });
    expect(result.success).toBe(true);
  });

  it("allows todo without category", () => {
    const result = todoSchema.safeParse({
      id: "todo-1",
      text: "Research wineries",
      isCompleted: false,
      sortOrder: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid category", () => {
    const result = todoSchema.safeParse({
      id: "todo-1",
      text: "Something",
      isCompleted: false,
      category: "invalid",
      sortOrder: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("createTripSchema", () => {
  it("validates a valid create trip input", () => {
    const result = createTripSchema.safeParse({
      title: "Christmas 2025",
      startDate: "2025-12-19",
      endDate: "2025-12-30",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when endDate is before startDate", () => {
    const result = createTripSchema.safeParse({
      title: "Bad Trip",
      startDate: "2025-12-30",
      endDate: "2025-12-19",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("endDate");
    }
  });

  it("allows same start and end date (day trip)", () => {
    const result = createTripSchema.safeParse({
      title: "Day Trip",
      startDate: "2025-12-25",
      endDate: "2025-12-25",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = createTripSchema.safeParse({
      title: "",
      startDate: "2025-12-19",
      endDate: "2025-12-30",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateTripSchema", () => {
  it("accepts partial updates", () => {
    expect(updateTripSchema.safeParse({ title: "New Title" }).success).toBe(true);
    expect(updateTripSchema.safeParse({ status: "active" }).success).toBe(true);
    expect(updateTripSchema.safeParse({}).success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = updateTripSchema.safeParse({ status: "cancelled" });
    expect(result.success).toBe(false);
  });
});

describe("createSegmentSchema", () => {
  it("validates a minimal segment", () => {
    const result = createSegmentSchema.safeParse({
      type: "hotel",
      title: "Hilton Prague",
    });
    expect(result.success).toBe(true);
  });

  it("validates a full restaurant segment", () => {
    const result = createSegmentSchema.safeParse({
      type: "restaurant_dinner",
      title: "Rutz",
      venueName: "Rutz",
      startTime: "19:00",
      partySize: 2,
      creditCardHold: true,
      url: "https://rutz-restaurant.de",
    });
    expect(result.success).toBe(true);
  });
});

describe("createTodoSchema", () => {
  it("validates with category", () => {
    const result = createTodoSchema.safeParse({
      text: "Book Comice dinner",
      category: "meals",
    });
    expect(result.success).toBe(true);
  });

  it("validates without category", () => {
    const result = createTodoSchema.safeParse({
      text: "Research wineries in Sicily",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty text", () => {
    const result = createTodoSchema.safeParse({ text: "" });
    expect(result.success).toBe(false);
  });
});

describe("updateTodoSchema", () => {
  it("accepts marking as completed", () => {
    const result = updateTodoSchema.safeParse({ isCompleted: true });
    expect(result.success).toBe(true);
  });

  it("accepts reordering", () => {
    const result = updateTodoSchema.safeParse({ sortOrder: 5 });
    expect(result.success).toBe(true);
  });
});

describe("createShareSchema", () => {
  it("validates a link-based share", () => {
    const result = createShareSchema.safeParse({
      permission: "view",
      showCosts: false,
      showTodos: false,
    });
    expect(result.success).toBe(true);
  });

  it("validates a user-based share", () => {
    const result = createShareSchema.safeParse({
      sharedWithEmail: "family@example.com",
      permission: "edit",
      showCosts: true,
      showTodos: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = createShareSchema.safeParse({
      sharedWithEmail: "not-an-email",
      permission: "view",
      showCosts: false,
      showTodos: false,
    });
    expect(result.success).toBe(false);
  });
});

describe("userSettingsSchema", () => {
  it("validates default settings", () => {
    const result = userSettingsSchema.safeParse({
      emailScanIntervalMinutes: 15,
      notificationsEnabled: true,
    });
    expect(result.success).toBe(true);
  });

  it("validates with gmail label filter", () => {
    const result = userSettingsSchema.safeParse({
      gmailLabelFilter: "Travel",
      emailScanIntervalMinutes: 30,
      notificationsEnabled: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects scan interval less than 5 minutes", () => {
    const result = userSettingsSchema.safeParse({
      emailScanIntervalMinutes: 1,
      notificationsEnabled: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("tripSchema (full trip validation)", () => {
  it("validates a complete trip", () => {
    const result = tripSchema.safeParse({
      id: "trip-1",
      title: "Christmas 2025",
      startDate: "2025-12-19",
      endDate: "2025-12-30",
      status: "planning",
      days: [
        {
          date: "2025-12-19",
          dayOfWeek: "Fri",
          city: "Seattle",
          segments: [
            {
              id: "seg-1",
              type: "flight",
              title: "BA52 SEA-LHR",
              startTime: "13:35",
              endTime: "07:10",
              departureCity: "Seattle",
              arrivalCity: "London",
              carrier: "BA",
              routeCode: "52",
              confirmationCode: "XTWLTR",
              source: "manual",
              needsReview: false,
              sortOrder: 0,
            },
          ],
        },
      ],
      todos: [
        {
          id: "todo-1",
          text: "Book Paris dinner",
          isCompleted: false,
          category: "meals",
          sortOrder: 0,
        },
      ],
      shares: [],
      createdAt: "2025-08-18T21:08:00.000Z",
      updatedAt: "2025-08-18T21:08:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});
