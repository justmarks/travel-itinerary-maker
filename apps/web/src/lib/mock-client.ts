import { ApiClient } from "@travel-app/api-client";
import type { TripSummary, CostSummaryResponse } from "@travel-app/api-client";
import type {
  Trip,
  Segment,
  Todo,
  TripShare,
  TripDay,
  CreateTripInput,
  UpdateTripInput,
  CreateSegmentInput,
  CreateTodoInput,
  UpdateTodoInput,
  CreateShareInput,
} from "@travel-app/shared";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function now() {
  return new Date().toISOString();
}

// ─── Sample Data ─────────────────────────────────────────────────────────────

const SAMPLE_TRIPS: Trip[] = [
  {
    id: "demo-1",
    title: "Japan Adventure",
    startDate: "2025-04-10",
    endDate: "2025-04-16",
    status: "planning",
    createdAt: "2025-03-01T10:00:00Z",
    updatedAt: "2025-03-15T14:30:00Z",
    days: [
      {
        date: "2025-04-10",
        dayOfWeek: "Thu",
        city: "Tokyo",
        segments: [
          {
            id: "seg-1",
            type: "flight",
            title: "JFK → NRT",
            startTime: "11:30",
            departureCity: "New York",
            arrivalCity: "Tokyo",
            carrier: "Japan Airlines",
            routeCode: "JL006",
            confirmationCode: "JLXYZ12",
            cost: { amount: 1250, currency: "USD", details: "Economy" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
          },
          {
            id: "seg-2",
            type: "hotel",
            title: "Check-in · Shinjuku Granbell Hotel",
            venueName: "Shinjuku Granbell Hotel",
            city: "Tokyo",
            startTime: "15:00",
            confirmationCode: "SGBH-44821",
            cost: { amount: 180, currency: "USD", details: "Superior Twin × 4 nights" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 1,
          },
        ],
      },
      {
        date: "2025-04-11",
        dayOfWeek: "Fri",
        city: "Tokyo",
        segments: [
          {
            id: "seg-3",
            type: "activity",
            title: "Senso-ji Temple & Nakamise Street",
            venueName: "Senso-ji",
            city: "Tokyo",
            address: "2-3-1 Asakusa, Taito City",
            startTime: "09:00",
            endTime: "11:30",
            source: "manual",
            needsReview: false,
            sortOrder: 0,
          },
          {
            id: "seg-4",
            type: "restaurant_dinner",
            title: "Dinner · Ichiran Ramen Shinjuku",
            venueName: "Ichiran Ramen",
            city: "Tokyo",
            startTime: "19:00",
            partySize: 2,
            cost: { amount: 25, currency: "USD" },
            source: "manual",
            needsReview: false,
            sortOrder: 1,
          },
        ],
      },
      {
        date: "2025-04-12",
        dayOfWeek: "Sat",
        city: "Tokyo",
        segments: [
          {
            id: "seg-5",
            type: "activity",
            title: "teamLab Borderless",
            venueName: "teamLab Borderless Tokyo",
            startTime: "10:00",
            endTime: "14:00",
            cost: { amount: 32, currency: "USD" },
            confirmationCode: "TLB-90341",
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
          },
          {
            id: "seg-6",
            type: "activity",
            title: "Shibuya Crossing & Harajuku",
            city: "Tokyo",
            startTime: "16:00",
            source: "manual",
            needsReview: false,
            sortOrder: 1,
          },
        ],
      },
      {
        date: "2025-04-13",
        dayOfWeek: "Sun",
        city: "Tokyo",
        segments: [
          {
            id: "seg-7",
            type: "activity",
            title: "Tsukiji Outer Market",
            venueName: "Tsukiji Outer Market",
            startTime: "08:00",
            source: "manual",
            needsReview: false,
            sortOrder: 0,
          },
          {
            id: "seg-8",
            type: "train",
            title: "Shinkansen Tokyo → Kyoto",
            departureCity: "Tokyo",
            arrivalCity: "Kyoto",
            carrier: "JR",
            routeCode: "Nozomi 15",
            startTime: "12:00",
            endTime: "14:24",
            source: "manual",
            needsReview: false,
            sortOrder: 1,
          },
          {
            id: "seg-9",
            type: "hotel",
            title: "Check-in · The Thousand Kyoto",
            venueName: "The Thousand Kyoto",
            city: "Kyoto",
            startTime: "15:00",
            confirmationCode: "TKY-18820",
            cost: { amount: 220, currency: "USD", details: "Deluxe Double × 3 nights" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 2,
          },
        ],
      },
      {
        date: "2025-04-14",
        dayOfWeek: "Mon",
        city: "Kyoto",
        segments: [
          {
            id: "seg-10",
            type: "activity",
            title: "Fushimi Inari Taisha",
            venueName: "Fushimi Inari Shrine",
            address: "68 Fukakusa Yabunouchicho, Fushimi Ward",
            startTime: "07:00",
            endTime: "10:00",
            source: "manual",
            needsReview: false,
            sortOrder: 0,
          },
          {
            id: "seg-11",
            type: "activity",
            title: "Arashiyama Bamboo Grove & Tenryu-ji",
            city: "Kyoto",
            startTime: "13:00",
            endTime: "17:00",
            source: "manual",
            needsReview: false,
            sortOrder: 1,
          },
        ],
      },
      {
        date: "2025-04-15",
        dayOfWeek: "Tue",
        city: "Kyoto",
        segments: [
          {
            id: "seg-12",
            type: "tour",
            title: "Nishiki Market Food Tour",
            venueName: "Nishiki Market",
            startTime: "10:00",
            endTime: "13:00",
            cost: { amount: 75, currency: "USD" },
            confirmationCode: "NFTOUR-2892",
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
          },
          {
            id: "seg-13",
            type: "activity",
            title: "Philosopher's Path & Nanzen-ji",
            city: "Kyoto",
            startTime: "15:30",
            source: "manual",
            needsReview: false,
            sortOrder: 1,
          },
        ],
      },
      {
        date: "2025-04-16",
        dayOfWeek: "Wed",
        city: "Kyoto",
        segments: [
          {
            id: "seg-14",
            type: "flight",
            title: "KIX → JFK",
            departureCity: "Osaka (Kansai)",
            arrivalCity: "New York",
            carrier: "Japan Airlines",
            routeCode: "JL061",
            startTime: "10:30",
            confirmationCode: "JLXYZ13",
            cost: { amount: 1250, currency: "USD", details: "Economy" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
          },
        ],
      },
    ],
    todos: [
      { id: "todo-1", text: "Purchase 14-day JR Pass", isCompleted: true, category: "logistics", sortOrder: 0 },
      { id: "todo-2", text: "Book Shinkansen seat reservations", isCompleted: true, category: "logistics", sortOrder: 1 },
      { id: "todo-3", text: "Research best ramen spots in Tokyo", isCompleted: false, category: "meals", sortOrder: 2 },
      { id: "todo-4", text: "Download offline Google Maps for Japan", isCompleted: false, category: "logistics", sortOrder: 3 },
      { id: "todo-5", text: "Get IC card (Suica / Pasmo)", isCompleted: false, category: "logistics", sortOrder: 4 },
      { id: "todo-6", text: "Pack light layers for April weather", isCompleted: false, category: "logistics", sortOrder: 5 },
    ],
    shares: [],
  },
  {
    id: "demo-2",
    title: "Paris Valentine's Weekend",
    startDate: "2025-02-14",
    endDate: "2025-02-16",
    status: "completed",
    createdAt: "2025-01-20T09:00:00Z",
    updatedAt: "2025-02-16T22:00:00Z",
    days: [
      {
        date: "2025-02-14",
        dayOfWeek: "Fri",
        city: "Paris",
        segments: [
          {
            id: "seg-p1",
            type: "flight",
            title: "JFK → CDG",
            departureCity: "New York",
            arrivalCity: "Paris",
            carrier: "Air France",
            routeCode: "AF011",
            startTime: "22:00",
            cost: { amount: 890, currency: "USD", details: "Economy" },
            confirmationCode: "AFPAR99",
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
          },
          {
            id: "seg-p2",
            type: "hotel",
            title: "Check-in · Hôtel des Arts Montmartre",
            venueName: "Hôtel des Arts Montmartre",
            city: "Paris",
            confirmationCode: "HDART-5531",
            cost: { amount: 195, currency: "EUR", details: "Classic Double × 2 nights" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 1,
          },
          {
            id: "seg-p3",
            type: "restaurant_dinner",
            title: "Valentine's Dinner · Le Jules Verne",
            venueName: "Le Jules Verne",
            address: "Eiffel Tower, 2nd Floor, Avenue Gustave Eiffel",
            startTime: "20:00",
            partySize: 2,
            cost: { amount: 320, currency: "EUR" },
            confirmationCode: "JV-V-2025-441",
            creditCardHold: true,
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 2,
          },
        ],
      },
      {
        date: "2025-02-15",
        dayOfWeek: "Sat",
        city: "Paris",
        segments: [
          {
            id: "seg-p4",
            type: "activity",
            title: "Louvre Museum",
            venueName: "Musée du Louvre",
            startTime: "09:00",
            endTime: "13:00",
            cost: { amount: 22, currency: "EUR" },
            confirmationCode: "LVR-TKT-4421",
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
          },
          {
            id: "seg-p5",
            type: "activity",
            title: "Stroll through Le Marais",
            city: "Paris",
            startTime: "14:30",
            source: "manual",
            needsReview: false,
            sortOrder: 1,
          },
          {
            id: "seg-p6",
            type: "restaurant_dinner",
            title: "Dinner · Septime",
            venueName: "Septime",
            address: "80 Rue de Charonne, 11th arrondissement",
            startTime: "20:00",
            partySize: 2,
            cost: { amount: 120, currency: "EUR" },
            source: "manual",
            needsReview: false,
            sortOrder: 2,
          },
        ],
      },
      {
        date: "2025-02-16",
        dayOfWeek: "Sun",
        city: "Paris",
        segments: [
          {
            id: "seg-p7",
            type: "restaurant_lunch",
            title: "Breakfast · Café de Flore",
            venueName: "Café de Flore",
            address: "172 Boulevard Saint-Germain",
            startTime: "09:30",
            partySize: 2,
            cost: { amount: 40, currency: "EUR" },
            source: "manual",
            needsReview: false,
            sortOrder: 0,
          },
          {
            id: "seg-p8",
            type: "flight",
            title: "CDG → JFK",
            departureCity: "Paris",
            arrivalCity: "New York",
            carrier: "Air France",
            routeCode: "AF012",
            startTime: "14:15",
            confirmationCode: "AFPAR00",
            cost: { amount: 890, currency: "USD", details: "Economy" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 1,
          },
        ],
      },
    ],
    todos: [
      { id: "todo-p1", text: "Book Le Jules Verne (reserve months ahead!)", isCompleted: true, category: "meals", sortOrder: 0 },
      { id: "todo-p2", text: "Buy Paris Museum Pass", isCompleted: true, category: "activities", sortOrder: 1 },
      { id: "todo-p3", text: "Research Montmartre neighbourhood", isCompleted: true, category: "research", sortOrder: 2 },
    ],
    shares: [],
  },
];

// ─── Mock Client ──────────────────────────────────────────────────────────────

export class MockApiClient extends ApiClient {
  private trips: Map<string, Trip>;

  constructor() {
    super(""); // no real base URL needed
    this.trips = new Map(SAMPLE_TRIPS.map((t) => [t.id, structuredClone(t)]));
  }

  private tripToSummary(t: Trip): TripSummary {
    return {
      id: t.id,
      title: t.title,
      startDate: t.startDate,
      endDate: t.endDate,
      status: t.status,
      dayCount: t.days.length,
      todoCount: t.todos.length,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  // ─── Trips ───────────────────────────────────────────────

  override listTrips(): Promise<TripSummary[]> {
    return Promise.resolve([...this.trips.values()].map(this.tripToSummary));
  }

  override getTrip(tripId: string): Promise<Trip> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    return Promise.resolve(structuredClone(trip));
  }

  override createTrip(input: CreateTripInput): Promise<Trip> {
    const id = `demo-${uid()}`;
    const startDate = input.startDate;
    const endDate = input.endDate;

    // Generate days between startDate and endDate
    const days: TripDay[] = [];
    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push({
        date: d.toISOString().slice(0, 10),
        dayOfWeek: DAY_NAMES[d.getDay()],
        city: "",
        segments: [],
      });
    }

    const trip: Trip = {
      id,
      title: input.title,
      startDate,
      endDate,
      status: "planning",
      days,
      todos: [],
      shares: [],
      createdAt: now(),
      updatedAt: now(),
    };
    this.trips.set(id, trip);
    return Promise.resolve(structuredClone(trip));
  }

  override updateTrip(tripId: string, input: UpdateTripInput): Promise<Trip> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    Object.assign(trip, input, { updatedAt: now() });
    return Promise.resolve(structuredClone(trip));
  }

  override deleteTrip(tripId: string): Promise<void> {
    this.trips.delete(tripId);
    return Promise.resolve();
  }

  // ─── Days ────────────────────────────────────────────────

  override listDays(tripId: string): Promise<TripDay[]> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    return Promise.resolve(structuredClone(trip.days));
  }

  override updateDay(
    tripId: string,
    date: string,
    input: { city?: string },
  ): Promise<TripDay> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    const day = trip.days.find((d) => d.date === date);
    if (!day) return Promise.reject(new Error("Day not found"));
    Object.assign(day, input);
    return Promise.resolve(structuredClone(day));
  }

  // ─── Segments ────────────────────────────────────────────

  override listSegments(
    tripId: string,
    filters?: { type?: string; needs_review?: boolean },
  ): Promise<(Segment & { date: string })[]> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    const result = trip.days.flatMap((day) =>
      day.segments
        .filter((s) => {
          if (filters?.type && s.type !== filters.type) return false;
          if (filters?.needs_review && !s.needsReview) return false;
          return true;
        })
        .map((s) => ({ ...s, date: day.date })),
    );
    return Promise.resolve(structuredClone(result));
  }

  override createSegment(
    tripId: string,
    date: string,
    input: CreateSegmentInput,
  ): Promise<Segment> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    const day = trip.days.find((d) => d.date === date);
    if (!day) return Promise.reject(new Error("Day not found"));
    const segment: Segment = {
      id: `seg-${uid()}`,
      source: "manual",
      needsReview: false,
      sortOrder: day.segments.length,
      ...input,
    } as Segment;
    day.segments.push(segment);
    return Promise.resolve(structuredClone(segment));
  }

  override updateSegment(
    tripId: string,
    segmentId: string,
    input: Partial<Segment>,
  ): Promise<Segment> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    for (const day of trip.days) {
      const seg = day.segments.find((s) => s.id === segmentId);
      if (seg) {
        Object.assign(seg, input);
        return Promise.resolve(structuredClone(seg));
      }
    }
    return Promise.reject(new Error("Segment not found"));
  }

  override deleteSegment(tripId: string, segmentId: string): Promise<void> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    for (const day of trip.days) {
      const idx = day.segments.findIndex((s) => s.id === segmentId);
      if (idx !== -1) {
        day.segments.splice(idx, 1);
        return Promise.resolve();
      }
    }
    return Promise.resolve();
  }

  override confirmSegment(tripId: string, segmentId: string): Promise<Segment> {
    return this.updateSegment(tripId, segmentId, {
      needsReview: false,
      source: "email_confirmed",
    });
  }

  // ─── Costs ───────────────────────────────────────────────

  override getCostSummary(tripId: string): Promise<CostSummaryResponse> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));

    const items = trip.days.flatMap((day) =>
      day.segments
        .filter((s) => s.cost)
        .map((s) => ({
          segmentId: s.id,
          category: s.type,
          description: s.title,
          amount: s.cost!.amount,
          currency: s.cost!.currency,
          details: s.cost?.details,
        })),
    );

    const totalsByCurrency: Record<string, number> = {};
    for (const item of items) {
      totalsByCurrency[item.currency] =
        (totalsByCurrency[item.currency] ?? 0) + item.amount;
    }

    return Promise.resolve({ items, totalsByCurrency });
  }

  // ─── Todos ───────────────────────────────────────────────

  override listTodos(tripId: string): Promise<Todo[]> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    return Promise.resolve(structuredClone(trip.todos));
  }

  override createTodo(tripId: string, input: CreateTodoInput): Promise<Todo> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    const todo: Todo = {
      id: `todo-${uid()}`,
      sortOrder: trip.todos.length,
      isCompleted: false,
      ...input,
    };
    trip.todos.push(todo);
    return Promise.resolve(structuredClone(todo));
  }

  override updateTodo(
    tripId: string,
    todoId: string,
    input: UpdateTodoInput,
  ): Promise<Todo> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    const todo = trip.todos.find((t) => t.id === todoId);
    if (!todo) return Promise.reject(new Error("Todo not found"));
    Object.assign(todo, input);
    return Promise.resolve(structuredClone(todo));
  }

  override deleteTodo(tripId: string, todoId: string): Promise<void> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    trip.todos = trip.todos.filter((t) => t.id !== todoId);
    return Promise.resolve();
  }

  // ─── Shares ──────────────────────────────────────────────

  override listShares(tripId: string): Promise<TripShare[]> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    return Promise.resolve(structuredClone(trip.shares));
  }

  override createShare(tripId: string, input: CreateShareInput): Promise<TripShare> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    const share: TripShare = {
      id: `share-${uid()}`,
      shareToken: uid(),
      permission: input.permission ?? "view",
      showCosts: input.showCosts ?? true,
      showTodos: input.showTodos ?? false,
      sharedWithEmail: input.sharedWithEmail,
      createdAt: now(),
    };
    trip.shares.push(share);
    return Promise.resolve(structuredClone(share));
  }

  override deleteShare(tripId: string, shareId: string): Promise<void> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    trip.shares = trip.shares.filter((s) => s.id !== shareId);
    return Promise.resolve();
  }
}
