import { ApiClient } from "@travel-app/api-client";
import { convertToUsd, applyCruisePortsToDayCities } from "@travel-app/shared";
import type {
  TripSummary,
  CostSummaryResponse,
  XlsxImportResponse,
} from "@travel-app/api-client";
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
  GmailLabel,
  EmailScanResult,
  EmailScanRequest,
  HtmlImportRequest,
  ApplyParsedSegmentsInput,
  XlsxImportRequest,
} from "@travel-app/shared";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function now() {
  return new Date().toISOString();
}

// ─── Sample Data ─────────────────────────────────────────────────────────────

const SAMPLE_TRIPS: Trip[] = [
  // ── Demo 1: Japan Adventure ───────────────────────────────────────────────
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
            seatNumber: "31A, 31B",
            cabinClass: "Economy",
            baggageInfo: "2 checked bags included",
            cost: { amount: 1250, currency: "USD", details: "Economy" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
            url: "https://www.jal.co.jp/en/",
          },
          {
            id: "seg-1b",
            type: "other_transport",
            title: "Airport Limousine Bus · NRT → Shinjuku",
            departureCity: "Narita Airport",
            arrivalCity: "Shinjuku",
            startTime: "14:15",
            endTime: "15:45",
            cost: { amount: 32, currency: "USD" },
            source: "manual",
            needsReview: false,
            sortOrder: 1,
            url: "https://www.limousinebus.co.jp/en/",
          },
          {
            id: "seg-2",
            type: "hotel",
            title: "Check-in · Shinjuku Granbell Hotel",
            venueName: "Shinjuku Granbell Hotel",
            city: "Tokyo",
            startTime: "16:00",
            endTime: "11:00",
            endDate: "2025-04-13",
            breakfastIncluded: false,
            confirmationCode: "SGBH-44821",
            cost: { amount: 180, currency: "USD", details: "Superior Twin × 3 nights" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 2,
            url: "https://www.granbell.jp/shinjuku/",
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
            address: "2-3-1 Asakusa, Taito City",
            startTime: "09:00",
            endTime: "11:30",
            source: "manual",
            needsReview: false,
            sortOrder: 0,
            url: "https://www.senso-ji.jp/english/",
          },
          {
            id: "seg-4",
            type: "restaurant_dinner",
            title: "Dinner · Ichiran Ramen Shinjuku",
            venueName: "Ichiran Ramen",
            address: "3-34-11 Shinjuku, Shinjuku-ku",
            startTime: "19:00",
            partySize: 2,
            phone: "+81 3-5292-6522",
            cost: { amount: 25, currency: "USD" },
            source: "manual",
            needsReview: false,
            sortOrder: 1,
            url: "https://ichiran.com/",
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
            url: "https://borderless.teamlab.art/",
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
            url: "https://www.gotokyo.org/en/spot/6/index.html",
          },
          {
            id: "seg-6b",
            type: "show",
            title: "Kabuki-za Evening Performance",
            venueName: "Kabuki-za Theatre",
            address: "4-12-15 Ginza, Chuo City",
            startTime: "18:00",
            endTime: "21:00",
            confirmationCode: "KBKZ-2025-8821",
            seatNumber: "Tier 2, Row B · Seats 14-15",
            cost: { amount: 180, currency: "USD", details: "2 tickets" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 2,
            url: "https://www.kabuki-bito.jp/eng/",
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
            url: "https://www.tsukiji.or.jp/english/",
          },
          {
            id: "seg-8",
            type: "train",
            title: "Shinkansen Tokyo → Kyoto",
            departureCity: "Tokyo Station",
            arrivalCity: "Kyoto Station",
            carrier: "JR",
            routeCode: "Nozomi 15",
            coach: "Car 7",
            seatNumber: "12A, 12B",
            startTime: "12:00",
            endTime: "14:24",
            source: "manual",
            needsReview: false,
            sortOrder: 1,
            url: "https://www.japanrailpass.net/en/",
          },
          {
            id: "seg-8b",
            type: "car_rental",
            title: "Car Rental · Toyota Aqua",
            venueName: "Times Car Rental Kyoto Station",
            city: "Kyoto",
            startTime: "15:00",
            endTime: "10:00",
            endDate: "2025-04-16",
            confirmationCode: "TCR-KYO-7741",
            cost: { amount: 180, currency: "USD", details: "3 days · compact" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 2,
            url: "https://timescar-rental.com/",
          },
          {
            id: "seg-9",
            type: "hotel",
            title: "Check-in · The Thousand Kyoto",
            venueName: "The Thousand Kyoto",
            city: "Kyoto",
            startTime: "15:00",
            endTime: "11:00",
            endDate: "2025-04-16",
            breakfastIncluded: true,
            confirmationCode: "TKY-18820",
            cost: { amount: 220, currency: "USD", details: "Deluxe Double × 3 nights" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 3,
            url: "https://www.thethousand-kyoto.com/",
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
            url: "https://inari.jp/en/",
          },
          {
            id: "seg-10b",
            type: "restaurant_brunch",
            title: "Brunch · Arabica Coffee & Eggs Arashiyama",
            venueName: "%Arabica Kyoto Arashiyama",
            address: "3-47 Sagatenryuji Susukinobabacho, Ukyo Ward",
            startTime: "11:00",
            partySize: 2,
            cost: { amount: 18, currency: "USD" },
            source: "manual",
            needsReview: false,
            sortOrder: 1,
            url: "https://arabica.coffee/",
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
            sortOrder: 2,
            url: "https://www.tenryuji.com/en/",
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
            url: "https://www.kyoto-nishiki.or.jp/en/",
          },
          {
            id: "seg-13",
            type: "activity",
            title: "Philosopher's Path & Nanzen-ji",
            venueName: "Nanzen-ji",
            address: "Nanzenji Fukuchicho, Sakyo Ward, Kyoto",
            startTime: "15:30",
            endTime: "18:00",
            source: "manual",
            needsReview: false,
            sortOrder: 1,
            url: "https://www.nanzenji.or.jp/english/",
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
            seatNumber: "31A, 31B",
            cabinClass: "Economy",
            baggageInfo: "2 checked bags included",
            cost: { amount: 1250, currency: "USD", details: "Economy" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
            url: "https://www.jal.co.jp/en/",
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

  // ── Demo 2: Paris Valentine's Weekend ────────────────────────────────────
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
            confirmationCode: "AFPAR99",
            seatNumber: "22C, 22D",
            cost: { amount: 890, currency: "USD", details: "Economy" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
            url: "https://www.airfrance.us/",
          },
          {
            id: "seg-p1b",
            type: "car_service",
            title: "Private Transfer · CDG → Montmartre",
            departureCity: "Charles de Gaulle Airport",
            arrivalCity: "Montmartre, Paris",
            provider: "Paris VIP Transfer",
            confirmationCode: "PVT-CDG-8812",
            contactName: "Jean-Pierre Moreau",
            phone: "+33 6 12 34 56 78",
            cost: { amount: 85, currency: "EUR" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 1,
            url: "https://parisviptransfer.com/",
          },
          {
            id: "seg-p2",
            type: "hotel",
            title: "Check-in · Hôtel des Arts Montmartre",
            venueName: "Hôtel des Arts Montmartre",
            city: "Paris",
            startTime: "14:00",
            endTime: "12:00",
            breakfastIncluded: true,
            confirmationCode: "HDART-5531",
            cost: { amount: 195, currency: "EUR", details: "Classic Double × 2 nights" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 2,
            url: "https://www.hotel-des-arts.fr/",
          },
          {
            id: "seg-p3",
            type: "restaurant_dinner",
            title: "Valentine's Dinner · Le Jules Verne",
            venueName: "Le Jules Verne",
            address: "Eiffel Tower, 2nd Floor, Avenue Gustave Eiffel",
            startTime: "20:00",
            partySize: 2,
            creditCardHold: true,
            cancellationDeadline: "2025-02-12",
            phone: "+33 1 45 55 61 44",
            confirmationCode: "JV-V-2025-441",
            cost: { amount: 320, currency: "EUR" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 3,
            url: "https://www.restaurants-toureiffel.com/en/jules-verne-restaurant.html",
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
            confirmationCode: "LVR-TKT-4421",
            cost: { amount: 22, currency: "EUR" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
            url: "https://www.louvre.fr/en",
          },
          {
            id: "seg-p5",
            type: "activity",
            title: "Stroll through Le Marais",
            city: "Paris",
            startTime: "14:30",
            endTime: "16:00",
            source: "manual",
            needsReview: false,
            sortOrder: 1,
          },
          {
            id: "seg-p5b",
            type: "cruise",
            title: "Seine River Cruise · Bateaux Parisiens",
            departureCity: "Port de la Bourdonnais, Paris",
            arrivalCity: "Port de la Bourdonnais, Paris",
            startTime: "16:30",
            endTime: "17:30",
            confirmationCode: "BP-2025-7731",
            cost: { amount: 18, currency: "EUR", details: "2 adults" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 2,
            url: "https://www.bateauxparisiens.com/",
          },
          {
            id: "seg-p6",
            type: "restaurant_dinner",
            title: "Dinner · Septime",
            venueName: "Septime",
            address: "80 Rue de Charonne, 11th arrondissement",
            startTime: "20:00",
            partySize: 2,
            creditCardHold: true,
            cancellationDeadline: "2025-02-13",
            phone: "+33 1 43 67 38 29",
            cost: { amount: 120, currency: "EUR" },
            source: "manual",
            needsReview: false,
            sortOrder: 3,
            url: "https://www.septime-charonne.fr/",
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
            type: "restaurant_breakfast",
            title: "Breakfast · Café de Flore",
            venueName: "Café de Flore",
            address: "172 Boulevard Saint-Germain",
            startTime: "09:30",
            partySize: 2,
            phone: "+33 1 45 48 55 26",
            cost: { amount: 40, currency: "EUR" },
            source: "manual",
            needsReview: false,
            sortOrder: 0,
            url: "https://www.cafedeflore.fr/",
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
            seatNumber: "22C, 22D",
            cost: { amount: 890, currency: "USD", details: "Economy" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 1,
            url: "https://www.airfrance.us/",
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

  // ── Demo 3: Disney Fantasy Caribbean Cruise ───────────────────────────────
  {
    id: "demo-3",
    title: "Disney Fantasy Caribbean Cruise",
    startDate: "2025-07-19",
    endDate: "2025-07-26",
    status: "completed",
    createdAt: "2025-04-01T10:00:00Z",
    updatedAt: "2025-04-01T10:00:00Z",
    days: [
      {
        date: "2025-07-19",
        dayOfWeek: "Sat",
        city: "Orlando, FL",
        segments: [
          {
            id: "seg-d1",
            type: "flight",
            title: "EWR → MCO",
            departureCity: "Newark",
            arrivalCity: "Orlando",
            carrier: "United Airlines",
            routeCode: "UA2241",
            startTime: "07:00",
            endTime: "10:05",
            confirmationCode: "UA-DIS7741",
            seatNumber: "18A, 18B, 18C",
            cost: { amount: 540, currency: "USD", details: "Economy · 3 seats" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
            url: "https://www.united.com/",
          },
          {
            id: "seg-d2",
            type: "car_service",
            title: "Private Transfer · MCO → Cape Canaveral",
            departureCity: "Orlando International Airport",
            arrivalCity: "Cape Canaveral",
            contactName: "Marcus Williams",
            phone: "+1 407-555-0182",
            confirmationCode: "SFTRANS-4421",
            cost: { amount: 120, currency: "USD" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 1,
            url: "https://sunfloridatransportation.com/",
          },
          {
            id: "seg-d3",
            type: "hotel",
            title: "Check-in · Airbnb · Cape Canaveral Beach House",
            venueName: "Cape Canaveral Beach House",
            address: "Ocean Beach Blvd, Cape Canaveral, FL",
            startTime: "15:00",
            endTime: "10:00",
            endDate: "2025-07-20",
            breakfastIncluded: false,
            confirmationCode: "HMG5RABX7K",
            cost: { amount: 285, currency: "USD", details: "1 night · sleeps 6" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 2,
            url: "https://www.airbnb.com/",
          },
        ],
      },
      {
        date: "2025-07-20",
        dayOfWeek: "Sun",
        city: "Port Canaveral, FL",
        segments: [
          {
            id: "seg-d4",
            type: "car_service",
            title: "Transfer · Airbnb → Port Canaveral Terminal",
            departureCity: "Cape Canaveral Beach House",
            arrivalCity: "Port Canaveral Cruise Terminal 8",
            contactName: "Marcus Williams",
            phone: "+1 407-555-0182",
            startTime: "10:30",
            confirmationCode: "SFTRANS-4422",
            cost: { amount: 45, currency: "USD" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
            url: "https://sunfloridatransportation.com/",
          },
          {
            id: "seg-d5",
            type: "cruise",
            title: "Disney Fantasy — 7-Night Eastern Caribbean",
            departureCity: "Port Canaveral, FL",
            arrivalCity: "Port Canaveral, FL",
            startTime: "12:00",
            endTime: "08:00",
            endDate: "2025-07-26",
            confirmationCode: "DCL-2025-F7741",
            portsOfCall: [
              { date: "2025-07-20", port: "Port Canaveral, FL", departureTime: "16:00" },
              { date: "2025-07-21", port: "Nassau, Bahamas", arrivalTime: "09:00", departureTime: "17:00" },
              { date: "2025-07-22", port: "Castaway Cay, Bahamas", arrivalTime: "08:30", departureTime: "16:30" },
              { date: "2025-07-23", atSea: true },
              { date: "2025-07-24", atSea: true },
              { date: "2025-07-25", atSea: true },
              { date: "2025-07-26", port: "Port Canaveral, FL", arrivalTime: "08:00" },
            ],
            cost: { amount: 6200, currency: "USD", details: "7-night Eastern Caribbean · Stateroom 7652" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 1,
            url: "https://disneycruise.disney.go.com/",
          },
          {
            id: "seg-d6",
            type: "restaurant_dinner",
            title: "Dinner · Animator's Palate",
            venueName: "Animator's Palate",
            address: "Disney Fantasy, Deck 4 Aft",
            startTime: "18:00",
            partySize: 3,
            confirmationCode: "DCL-DINING-AP1",
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 2,
            url: "https://disneycruise.disney.go.com/restaurants/",
          },
        ],
      },
      {
        date: "2025-07-21",
        dayOfWeek: "Mon",
        city: "Nassau, Bahamas",
        segments: [
          {
            id: "seg-d7",
            type: "activity",
            title: "Blue Lagoon Island Dolphin Encounter",
            venueName: "Blue Lagoon Island",
            startTime: "09:30",
            endTime: "13:00",
            confirmationCode: "BLI-DOLPH-8812",
            cost: { amount: 285, currency: "USD", details: "3 guests" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
            url: "https://www.dolphinencounters.com/",
          },
          {
            id: "seg-d8",
            type: "restaurant_dinner",
            title: "Dinner · Royal Palace",
            venueName: "Royal Palace",
            address: "Disney Fantasy, Deck 3 Midship",
            startTime: "18:00",
            partySize: 3,
            confirmationCode: "DCL-DINING-RP1",
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 1,
            url: "https://disneycruise.disney.go.com/restaurants/",
          },
        ],
      },
      {
        date: "2025-07-22",
        dayOfWeek: "Tue",
        city: "Castaway Cay, Bahamas",
        segments: [
          {
            id: "seg-d9",
            type: "activity",
            title: "Castaway Cay Beach & Snorkeling",
            venueName: "Castaway Cay",
            startTime: "09:00",
            endTime: "15:00",
            source: "manual",
            needsReview: false,
            sortOrder: 0,
            url: "https://disneycruise.disney.go.com/ports/castaway-cay/",
          },
          {
            id: "seg-d10",
            type: "restaurant_lunch",
            title: "Lunch · Cookie's BBQ",
            venueName: "Cookie's BBQ",
            address: "Castaway Cay Beach",
            startTime: "12:00",
            partySize: 3,
            source: "manual",
            needsReview: false,
            sortOrder: 1,
            url: "https://disneycruise.disney.go.com/ports/castaway-cay/",
          },
        ],
      },
      {
        date: "2025-07-23",
        dayOfWeek: "Wed",
        city: "At Sea",
        segments: [
          {
            id: "seg-d11",
            type: "activity",
            title: "Aquaduck Water Coaster",
            venueName: "AquaDuck",
            address: "Disney Fantasy, Deck 12",
            startTime: "10:00",
            endTime: "12:00",
            source: "manual",
            needsReview: false,
            sortOrder: 0,
            url: "https://disneycruise.disney.go.com/onboard-activities/",
          },
          {
            id: "seg-d12",
            type: "restaurant_dinner",
            title: "Dinner · Rapunzel's Royal Table",
            venueName: "Rapunzel's Royal Table",
            address: "Disney Fantasy, Deck 3 Aft",
            startTime: "18:00",
            partySize: 3,
            confirmationCode: "DCL-DINING-RT1",
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 1,
            url: "https://disneycruise.disney.go.com/restaurants/",
          },
        ],
      },
      {
        date: "2025-07-24",
        dayOfWeek: "Thu",
        city: "At Sea",
        segments: [
          {
            id: "seg-d13",
            type: "activity",
            title: "Bibbidi Bobbidi Boutique — Princess Package",
            venueName: "Bibbidi Bobbidi Boutique",
            address: "Disney Fantasy, Deck 5 Forward",
            startTime: "10:00",
            endTime: "11:30",
            confirmationCode: "DCL-BBB-0392",
            cost: { amount: 225, currency: "USD", details: "Castle Package" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
            url: "https://disneycruise.disney.go.com/onboard-activities/",
          },
          {
            id: "seg-d14",
            type: "restaurant_dinner",
            title: "Dinner · Animator's Palate (Drawn to Magic)",
            venueName: "Animator's Palate",
            address: "Disney Fantasy, Deck 4 Aft",
            startTime: "18:00",
            partySize: 3,
            confirmationCode: "DCL-DINING-AP2",
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 1,
            url: "https://disneycruise.disney.go.com/restaurants/",
          },
        ],
      },
      {
        date: "2025-07-25",
        dayOfWeek: "Fri",
        city: "At Sea",
        segments: [
          {
            id: "seg-d15",
            type: "activity",
            title: "Sail Away Deck Party",
            venueName: "Disney Fantasy, Pool Deck",
            startTime: "16:00",
            endTime: "17:30",
            source: "manual",
            needsReview: false,
            sortOrder: 0,
            url: "https://disneycruise.disney.go.com/onboard-activities/",
          },
          {
            id: "seg-d16",
            type: "restaurant_dinner",
            title: "Dinner · Royal Palace (Formal Night)",
            venueName: "Royal Palace",
            address: "Disney Fantasy, Deck 3 Midship",
            startTime: "18:00",
            partySize: 3,
            confirmationCode: "DCL-DINING-RP2",
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 1,
            url: "https://disneycruise.disney.go.com/restaurants/",
          },
        ],
      },
      {
        date: "2025-07-26",
        dayOfWeek: "Sat",
        city: "Port Canaveral, FL",
        segments: [
          {
            id: "seg-d18",
            type: "flight",
            title: "MCO → EWR",
            departureCity: "Orlando",
            arrivalCity: "Newark",
            carrier: "United Airlines",
            routeCode: "UA2390",
            startTime: "14:30",
            endTime: "17:45",
            confirmationCode: "UA-DIS7742",
            seatNumber: "18A, 18B, 18C",
            cost: { amount: 540, currency: "USD", details: "Economy · 3 seats" },
            source: "email_confirmed",
            needsReview: false,
            sortOrder: 0,
            url: "https://www.united.com/",
          },
        ],
      },
    ],
    todos: [
      { id: "todo-d1", text: "Pack formal night outfits (2 nights required)", isCompleted: true, category: "logistics", sortOrder: 0 },
      { id: "todo-d2", text: "Book Bibbidi Bobbidi Boutique (opens 75 days before sail)", isCompleted: true, category: "activities", sortOrder: 1 },
      { id: "todo-d3", text: "Register for Port Adventures shore excursions", isCompleted: true, category: "activities", sortOrder: 2 },
      { id: "todo-d4", text: "Download Disney Cruise Line Navigator app", isCompleted: false, category: "logistics", sortOrder: 3 },
      { id: "todo-d5", text: "Order stateroom decoration gift basket via DCL", isCompleted: false, category: "logistics", sortOrder: 4 },
      { id: "todo-d6", text: "Research Nassau restaurants & activities", isCompleted: true, category: "research", sortOrder: 5 },
      { id: "todo-d7", text: "Pack reef-safe sunscreen and snorkel gear", isCompleted: false, category: "logistics", sortOrder: 6 },
      { id: "todo-d8", text: "Purchase Disney gift cards for onboard credit", isCompleted: false, category: "logistics", sortOrder: 7 },
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

  override importXlsxTrip(
    input: XlsxImportRequest,
  ): Promise<XlsxImportResponse> {
    // In demo mode we don't actually parse the workbook — just synthesize a
    // believable imported trip so the UI can navigate to it.
    const id = `demo-${uid()}`;
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() + 30);
    const end = new Date(start);
    end.setDate(end.getDate() + 4);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);

    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days: TripDay[] = [];
    for (
      let d = new Date(start);
      d <= end;
      d.setDate(d.getDate() + 1)
    ) {
      days.push({
        date: d.toISOString().slice(0, 10),
        dayOfWeek: DAY_NAMES[d.getDay()],
        city: "Demo City",
        segments: [],
      });
    }

    const baseTitle =
      input.title ??
      (input.filename ? input.filename.replace(/\.xlsx$/i, "") : "Imported Trip");

    // Drop a representative auto-imported flight onto day 1 so the UI isn't empty.
    if (days[0]) {
      days[0].segments.push({
        id: `seg-${uid()}`,
        type: "flight",
        title: "SEA → Demo",
        startTime: "08:00",
        departureCity: "Seattle",
        arrivalCity: "Demo City",
        carrier: "Demo Air",
        routeCode: "DA100",
        confirmationCode: "DEMO01",
        cost: { amount: 450, currency: "USD" },
        source: "manual",
        needsReview: true,
        sortOrder: 0,
      });
    }

    const trip: Trip = {
      id,
      title: baseTitle,
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

    return Promise.resolve({
      trip: structuredClone(trip),
      warnings: [
        "Demo mode: XLSX contents were not actually parsed — this is a sample trip.",
      ],
      unmatchedCosts: [],
    });
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
    input: Partial<Segment> & { date?: string },
  ): Promise<Segment> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    const { date: newDate, ...segmentUpdates } = input;
    for (const day of trip.days) {
      const seg = day.segments.find((s) => s.id === segmentId);
      if (!seg) continue;

      if (newDate && newDate !== day.date) {
        const targetDay = trip.days.find((d) => d.date === newDate);
        if (!targetDay) {
          return Promise.reject(
            new Error("Target date is outside this trip's range"),
          );
        }
        day.segments = day.segments.filter((s) => s.id !== segmentId);
        seg.sortOrder = targetDay.segments.length;
        targetDay.segments.push(seg);
      }

      const wasNeedsReview = seg.needsReview;
      Object.assign(seg, segmentUpdates);
      if (wasNeedsReview && seg.needsReview === false) {
        seg.source = "email_confirmed";
      }
      return Promise.resolve(structuredClone(seg));
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

  override confirmAllSegments(
    tripId: string,
  ): Promise<{ confirmed: number }> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    let confirmed = 0;
    for (const day of trip.days) {
      for (const segment of day.segments) {
        if (segment.needsReview) {
          segment.needsReview = false;
          segment.source = "email_confirmed";
          confirmed += 1;
        }
      }
    }
    if (confirmed > 0) {
      trip.updatedAt = new Date().toISOString();
    }
    return Promise.resolve({ confirmed });
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
          city: s.city?.trim() || day.city?.trim() || undefined,
          amount: s.cost!.amount,
          currency: s.cost!.currency,
          amountUsd: convertToUsd(s.cost!.amount, s.cost!.currency),
          details: s.cost?.details,
        })),
    );

    const totalsByCurrency: Record<string, number> = {};
    let totalUsd = 0;
    let anyUsd = false;
    for (const item of items) {
      totalsByCurrency[item.currency] =
        (totalsByCurrency[item.currency] ?? 0) + item.amount;
      if (item.amountUsd !== undefined) {
        totalUsd += item.amountUsd;
        anyUsd = true;
      }
    }

    return Promise.resolve({
      items,
      totalsByCurrency,
      ...(anyUsd ? { totalUsd } : {}),
    });
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

  // ─── Shared (public) ────────────────────────────────────

  override getSharedTrip(token: string) {
    for (const trip of this.trips.values()) {
      const share = trip.shares.find((s) => s.shareToken === token);
      if (share) {
        return Promise.resolve({
          id: trip.id,
          title: trip.title,
          startDate: trip.startDate,
          endDate: trip.endDate,
          status: trip.status,
          days: trip.days.map((day) => ({
            ...day,
            segments: day.segments.map((seg) => ({
              ...seg,
              cost: share.showCosts ? seg.cost : undefined,
            })),
          })),
          todos: share.showTodos ? trip.todos : [],
          permission: share.permission,
        });
      }
    }
    return Promise.reject(new Error("Shared trip not found"));
  }

  // ─── Email Scanning ──────────────────────────────────────

  override getPendingEmails(): Promise<{ results: EmailScanResult[] }> {
    return Promise.resolve({ results: [] });
  }

  override getGmailLabels(): Promise<GmailLabel[]> {
    return Promise.resolve([
      { id: "INBOX", name: "INBOX", type: "system" },
      { id: "STARRED", name: "STARRED", type: "system" },
      { id: "Label_1", name: "Travel", type: "user" },
      { id: "Label_2", name: "Receipts", type: "user" },
    ]);
  }

  override scanEmails(
    _input?: EmailScanRequest,
  ): Promise<{ results: never[]; message: string }> {
    // In demo mode, pretend no new emails to process
    return Promise.resolve({
      results: [],
      message: "No new emails to process (demo mode)",
    });
  }

  override importHtmlEmail(
    _input: HtmlImportRequest,
  ): Promise<{ result: EmailScanResult }> {
    // In demo mode, pretend nothing was extracted from the HTML blob.
    // The real endpoint hits Claude; demo stays offline.
    return Promise.resolve({
      result: {
        emailId: `html-import-demo-${uid()}`,
        subject: _input.subject || "(HTML import — demo)",
        from: _input.from || "(unknown sender)",
        receivedAt: _input.receivedAt || now(),
        parsedSegments: [],
        parseStatus: "no_travel_content",
      },
    });
  }

  override applyParsedSegments(
    input: ApplyParsedSegmentsInput,
  ): Promise<{ created: Array<{ tripId: string; segmentId: string; title: string }> }> {
    const created: Array<{ tripId: string; segmentId: string; title: string }> = [];
    for (const seg of input.segments) {
      const trip = this.trips.get(seg.tripId);
      if (!trip) continue;
      const day = trip.days.find((d) => d.date === seg.date);
      if (!day) continue;
      const segmentId = `seg-${uid()}`;
      day.segments.push({
        id: segmentId,
        type: seg.type,
        title: seg.title,
        startTime: seg.startTime,
        endTime: seg.endTime,
        venueName: seg.venueName,
        address: seg.address,
        city: seg.city,
        url: seg.url || undefined,
        confirmationCode: seg.confirmationCode,
        provider: seg.provider,
        departureCity: seg.departureCity,
        arrivalCity: seg.arrivalCity,
        carrier: seg.carrier,
        routeCode: seg.routeCode,
        partySize: seg.partySize,
        creditCardHold: seg.creditCardHold,
        seatNumber: seg.seatNumber,
        cabinClass: seg.cabinClass,
        baggageInfo: seg.baggageInfo,
        contactName: seg.contactName,
        phone: seg.phone,
        endDate: seg.endDate,
        portsOfCall: seg.portsOfCall,
        breakfastIncluded: seg.breakfastIncluded,
        cost: seg.cost,
        source: "email_auto",
        sourceEmailId: seg.emailId,
        needsReview: true,
        sortOrder: day.segments.length,
      });
      created.push({ tripId: seg.tripId, segmentId, title: seg.title });
    }
    // Cruise per-day port override: update each affected trip's days so the
    // cities line up with the ship's ports of call (mirrors the server path).
    const touchedTripIds = new Set(input.segments.map((s) => s.tripId));
    for (const tid of touchedTripIds) {
      const trip = this.trips.get(tid);
      if (trip) applyCruisePortsToDayCities(trip);
    }
    return Promise.resolve({ created });
  }

  override getProcessedEmails(): Promise<Array<{
    gmailMessageId: string;
    subject?: string;
    fromAddress?: string;
    parseStatus: string;
    createdAt: string;
  }>> {
    return Promise.resolve([]);
  }

  override dismissEmail(_emailId: string): Promise<{ status: string }> {
    return Promise.resolve({ status: "dismissed" });
  }

  // ─── Export ─────────────────────────────────────────────

  override async exportMarkdown(tripId: string): Promise<string> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    const { tripToMarkdown } = await import("@travel-app/shared");
    return tripToMarkdown(trip, { includeCosts: true, includeTodos: true });
  }

  override async exportOneNote(tripId: string): Promise<string> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    const { tripToOneNoteHtml } = await import("@travel-app/shared");
    return tripToOneNoteHtml(trip, { includeCosts: true, includeTodos: true });
  }

  override async exportPdf(tripId: string): Promise<Blob> {
    const trip = this.trips.get(tripId);
    if (!trip) return Promise.reject(new Error("Trip not found"));
    const { tripToOneNoteHtml } = await import("@travel-app/shared");
    const html = tripToOneNoteHtml(trip, {
      includeCosts: true,
      includeTodos: true,
    });
    return new Blob([html], { type: "text/html" });
  }
}
