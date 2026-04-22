import { tripToMarkdown } from "../src/utils/markdown";
import type { Trip } from "../src/types/trip";

const sampleTrip: Trip = {
  id: "trip-1",
  title: "Christmas 2025",
  startDate: "2025-12-19",
  endDate: "2025-12-21",
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
          cost: { amount: 4704.05, currency: "USD" },
          source: "manual",
          needsReview: false,
          sortOrder: 0,
        },
      ],
    },
    {
      date: "2025-12-20",
      dayOfWeek: "Sat",
      city: "Prague",
      segments: [
        {
          id: "seg-2",
          type: "hotel",
          title: "Hilton Prague Old Town",
          venueName: "Hilton Prague Old Town",
          address: "V Celnici 2079/7",
          confirmationCode: "3330467896",
          url: "https://hilton.com/prague",
          cost: {
            amount: 649.9,
            currency: "USD",
            details: "Queen Guest Room, check-in 15:00",
          },
          source: "manual",
          needsReview: false,
          sortOrder: 0,
        },
        {
          id: "seg-3",
          type: "restaurant_dinner",
          title: "Field",
          venueName: "Field",
          startTime: "21:00",
          partySize: 2,
          creditCardHold: false,
          source: "manual",
          needsReview: false,
          sortOrder: 1,
        },
      ],
    },
    {
      date: "2025-12-21",
      dayOfWeek: "Sun",
      city: "Dresden",
      segments: [],
    },
  ],
  todos: [
    {
      id: "todo-1",
      text: "Book Paris dinner at Comice",
      isCompleted: false,
      category: "meals",
      sortOrder: 0,
    },
    {
      id: "todo-2",
      text: "Research Christmas markets",
      isCompleted: true,
      category: "research",
      sortOrder: 1,
    },
  ],
  shares: [],
  createdAt: "2025-08-18T21:08:00.000Z",
  updatedAt: "2025-08-18T21:08:00.000Z",
  schemaVersion: 1,
};

describe("tripToMarkdown", () => {
  it("includes trip title and dates", () => {
    const md = tripToMarkdown(sampleTrip);
    expect(md).toContain("# Christmas 2025");
    expect(md).toContain("**2025-12-19 to 2025-12-21**");
  });

  it("includes itinerary table with 8 columns", () => {
    const md = tripToMarkdown(sampleTrip);
    expect(md).toContain(
      "| City | Day | Date | Transport | Lodging | Activities | Lunch | Dinner |",
    );
  });

  it("renders flight segments with carrier, route, times, confirmation code", () => {
    const md = tripToMarkdown(sampleTrip);
    expect(md).toContain("BA 52");
    expect(md).toContain("Seattle → London");
    expect(md).toContain("13:35-07:10");
    expect(md).toContain("`XTWLTR`");
  });

  it("renders hotel as hyperlink when URL is present", () => {
    const md = tripToMarkdown(sampleTrip);
    expect(md).toContain("[Hilton Prague Old Town](https://hilton.com/prague)");
  });

  it("renders restaurant with time and party size", () => {
    const md = tripToMarkdown(sampleTrip);
    expect(md).toContain("Field");
    expect(md).toContain("21:00");
    expect(md).toContain("(2)");
  });

  it("renders empty day with dashes", () => {
    const md = tripToMarkdown(sampleTrip);
    // Dresden row should have dashes for empty cells
    const dresdenLine = md.split("\n").find((l) => l.includes("Dresden"));
    expect(dresdenLine).toBeDefined();
    // Should contain multiple dashes for empty cells
    expect(dresdenLine!.match(/-/g)!.length).toBeGreaterThan(3);
  });

  it("includes cost summary by default", () => {
    const md = tripToMarkdown(sampleTrip);
    expect(md).toContain("## Cost Summary");
    expect(md).toContain("$4,704.05");
    expect(md).toContain("$649.90");
    expect(md).toContain("Queen Guest Room");
  });

  it("includes todos by default", () => {
    const md = tripToMarkdown(sampleTrip);
    expect(md).toContain("## TODO");
    expect(md).toContain("- [ ] Book Paris dinner at Comice *(meals)*");
    expect(md).toContain("- [x] Research Christmas markets *(research)*");
  });

  it("excludes costs when option is false", () => {
    const md = tripToMarkdown(sampleTrip, { includeCosts: false });
    expect(md).not.toContain("## Cost Summary");
    expect(md).not.toContain("$4,704.05");
  });

  it("excludes todos when option is false", () => {
    const md = tripToMarkdown(sampleTrip, { includeTodos: false });
    expect(md).not.toContain("## TODO");
    expect(md).not.toContain("Book Paris dinner");
  });

  it("shows currency totals", () => {
    const md = tripToMarkdown(sampleTrip);
    expect(md).toContain("**Totals:**");
    expect(md).toContain("$5,353.95"); // 4704.05 + 649.90
  });
});
