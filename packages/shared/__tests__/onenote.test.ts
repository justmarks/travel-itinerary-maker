import { tripToOneNoteHtml } from "../src/utils/onenote";
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
};

describe("tripToOneNoteHtml", () => {
  it("generates valid HTML document structure", () => {
    const html = tripToOneNoteHtml(sampleTrip);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html>");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
    expect(html).toContain("<title>Christmas 2025</title>");
  });

  it("includes trip title and date range", () => {
    const html = tripToOneNoteHtml(sampleTrip);
    expect(html).toContain("<h1>Christmas 2025</h1>");
    expect(html).toContain("2025-12-19 to 2025-12-21");
  });

  it("includes 8-column itinerary table with headers", () => {
    const html = tripToOneNoteHtml(sampleTrip);
    expect(html).toContain("<h2>Itinerary</h2>");
    for (const hdr of [
      "City",
      "Day",
      "Date",
      "Transport",
      "Lodging",
      "Activities",
      "Lunch",
      "Dinner",
    ]) {
      expect(html).toContain(`>${hdr}</th>`);
    }
  });

  it("renders flight with carrier, route, times, and confirmation", () => {
    const html = tripToOneNoteHtml(sampleTrip);
    expect(html).toContain("BA 52");
    expect(html).toContain("Seattle → London");
    expect(html).toContain("13:35–07:10");
    expect(html).toContain("#XTWLTR");
  });

  it("renders hotel as hyperlink when URL is present", () => {
    const html = tripToOneNoteHtml(sampleTrip);
    expect(html).toContain(
      '<a href="https://hilton.com/prague">Hilton Prague Old Town',
    );
  });

  it("renders restaurant with time and party size", () => {
    const html = tripToOneNoteHtml(sampleTrip);
    expect(html).toContain("Field");
    expect(html).toContain("21:00");
    expect(html).toContain("(2)");
  });

  it("renders empty day cells with dashes", () => {
    const html = tripToOneNoteHtml(sampleTrip);
    // Dresden row has no segments — cells should contain "–"
    const lines = html.split("\n");
    const dresdenLines = lines.filter((l) => l.includes("Dresden"));
    expect(dresdenLines.length).toBeGreaterThan(0);
  });

  it("includes cost summary by default", () => {
    const html = tripToOneNoteHtml(sampleTrip);
    expect(html).toContain("<h2>Cost Summary</h2>");
    expect(html).toContain("$4,704.05");
    expect(html).toContain("$649.90");
    expect(html).toContain("Queen Guest Room");
  });

  it("includes cost totals", () => {
    const html = tripToOneNoteHtml(sampleTrip);
    expect(html).toContain("<strong>Totals:</strong>");
    expect(html).toContain("$5,353.95");
  });

  it("includes todos with OneNote data-tag attributes", () => {
    const html = tripToOneNoteHtml(sampleTrip);
    expect(html).toContain("<h2>TODO</h2>");
    expect(html).toContain('data-tag="to-do"');
    expect(html).toContain('data-tag="to-do:completed"');
    expect(html).toContain("Book Paris dinner at Comice");
    expect(html).toContain("Research Christmas markets");
    expect(html).toContain("<em>(meals)</em>");
    expect(html).toContain("<em>(research)</em>");
  });

  it("excludes costs when option is false", () => {
    const html = tripToOneNoteHtml(sampleTrip, { includeCosts: false });
    expect(html).not.toContain("<h2>Cost Summary</h2>");
    expect(html).not.toContain("$4,704.05");
  });

  it("excludes todos when option is false", () => {
    const html = tripToOneNoteHtml(sampleTrip, { includeTodos: false });
    expect(html).not.toContain("<h2>TODO</h2>");
    expect(html).not.toContain("Book Paris dinner");
  });

  it("escapes HTML special characters in titles", () => {
    const tripWithSpecialChars: Trip = {
      ...sampleTrip,
      title: 'Trip <script>alert("xss")</script>',
    };
    const html = tripToOneNoteHtml(tripWithSpecialChars);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("uses alternating row colors for readability", () => {
    const html = tripToOneNoteHtml(sampleTrip);
    expect(html).toContain("#ffffff");
    expect(html).toContain("#f2f2f2");
  });

  it("uses styled table headers", () => {
    const html = tripToOneNoteHtml(sampleTrip);
    expect(html).toContain("background-color:#4472C4");
    expect(html).toContain("color:white");
  });
});
