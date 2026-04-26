/**
 * Best-effort city name → IANA timezone lookup for calendar sync.
 *
 * Keys are lowercase, stripped of common suffixes. The lookup normalises the
 * incoming city string the same way before comparing, so "Narita Airport",
 * "Tokyo", "Shinjuku", "New York, NY" and "JFK" all resolve correctly.
 *
 * Coverage goal: every city that realistically appears as a trip destination,
 * departure city, or arrival city in a travel itinerary. Falls back to
 * `undefined` for unrecognised cities (caller omits the timeZone field and
 * Google Calendar treats the datetime as floating/local — still better than
 * a wrong timezone).
 */

// ─── Lookup table ─────────────────────────────────────────────────────────────

const TABLE: Record<string, string> = {
  // ── Japan ──────────────────────────────────────────────────────────────────
  tokyo:         "Asia/Tokyo",
  shinjuku:      "Asia/Tokyo",
  shibuya:       "Asia/Tokyo",
  asakusa:       "Asia/Tokyo",
  narita:        "Asia/Tokyo",
  haneda:        "Asia/Tokyo",
  nrt:           "Asia/Tokyo",
  hnd:           "Asia/Tokyo",
  kyoto:         "Asia/Tokyo",
  osaka:         "Asia/Tokyo",
  kansai:        "Asia/Tokyo",
  kix:           "Asia/Tokyo",
  nara:          "Asia/Tokyo",
  hiroshima:     "Asia/Tokyo",
  sapporo:       "Asia/Tokyo",
  fukuoka:       "Asia/Tokyo",
  nagoya:        "Asia/Tokyo",
  yokohama:      "Asia/Tokyo",
  kamakura:      "Asia/Tokyo",
  hakone:        "Asia/Tokyo",
  nikko:         "Asia/Tokyo",

  // ── South Korea ────────────────────────────────────────────────────────────
  seoul:         "Asia/Seoul",
  incheon:       "Asia/Seoul",
  busan:         "Asia/Seoul",
  jeju:          "Asia/Seoul",

  // ── China ──────────────────────────────────────────────────────────────────
  beijing:       "Asia/Shanghai",
  shanghai:      "Asia/Shanghai",
  guangzhou:     "Asia/Shanghai",
  shenzhen:      "Asia/Shanghai",
  chengdu:       "Asia/Shanghai",
  chongqing:     "Asia/Shanghai",
  xi:            "Asia/Shanghai", // xi'an normalises to "xi"
  hangzhou:      "Asia/Shanghai",
  nanjing:       "Asia/Shanghai",
  suzhou:        "Asia/Shanghai",
  wuhan:         "Asia/Shanghai",

  // ── Hong Kong / Macao / Taiwan ─────────────────────────────────────────────
  "hong kong":   "Asia/Hong_Kong",
  "hong_kong":   "Asia/Hong_Kong",
  macau:         "Asia/Macau",
  macao:         "Asia/Macau",
  taipei:        "Asia/Taipei",
  kaohsiung:     "Asia/Taipei",

  // ── Southeast Asia ─────────────────────────────────────────────────────────
  singapore:     "Asia/Singapore",
  "kuala lumpur":"Asia/Kuala_Lumpur",
  kl:            "Asia/Kuala_Lumpur",
  penang:        "Asia/Kuala_Lumpur",
  bangkok:       "Asia/Bangkok",
  "chiang mai":  "Asia/Bangkok",
  phuket:        "Asia/Bangkok",
  pattaya:       "Asia/Bangkok",
  bali:          "Asia/Makassar",
  denpasar:      "Asia/Makassar",
  jakarta:       "Asia/Jakarta",
  yogyakarta:    "Asia/Jakarta",
  surabaya:      "Asia/Jakarta",
  manila:        "Asia/Manila",
  cebu:          "Asia/Manila",
  hanoi:         "Asia/Ho_Chi_Minh",
  "ho chi minh": "Asia/Ho_Chi_Minh",
  saigon:        "Asia/Ho_Chi_Minh",
  "da nang":     "Asia/Ho_Chi_Minh",
  "hoi an":      "Asia/Ho_Chi_Minh",
  yangon:        "Asia/Rangoon",
  rangoon:       "Asia/Rangoon",
  "phnom penh":    "Asia/Phnom_Penh",
  "siem reap":     "Asia/Phnom_Penh",
  vientiane:     "Asia/Vientiane",
  "luang prabang":"Asia/Vientiane",

  // ── South Asia ─────────────────────────────────────────────────────────────
  mumbai:        "Asia/Kolkata",
  bombay:        "Asia/Kolkata",
  delhi:         "Asia/Kolkata",
  "new delhi":   "Asia/Kolkata",
  bangalore:     "Asia/Kolkata",
  bengaluru:     "Asia/Kolkata",
  chennai:       "Asia/Kolkata",
  madras:        "Asia/Kolkata",
  kolkata:       "Asia/Kolkata",
  calcutta:      "Asia/Kolkata",
  hyderabad:     "Asia/Kolkata",
  pune:          "Asia/Kolkata",
  goa:           "Asia/Kolkata",
  jaipur:        "Asia/Kolkata",
  agra:          "Asia/Kolkata",
  kathmandu:     "Asia/Kathmandu",
  dhaka:         "Asia/Dhaka",
  colombo:       "Asia/Colombo",
  islamabad:     "Asia/Karachi",
  karachi:       "Asia/Karachi",
  lahore:        "Asia/Karachi",

  // ── Middle East ────────────────────────────────────────────────────────────
  dubai:         "Asia/Dubai",
  "abu dhabi":   "Asia/Dubai",
  sharjah:       "Asia/Dubai",
  doha:          "Asia/Qatar",
  riyadh:        "Asia/Riyadh",
  jeddah:        "Asia/Riyadh",
  kuwait:        "Asia/Kuwait",
  "kuwait city": "Asia/Kuwait",
  "tel aviv":    "Asia/Jerusalem",
  jerusalem:     "Asia/Jerusalem",
  amman:         "Asia/Amman",
  beirut:        "Asia/Beirut",
  muscat:        "Asia/Muscat",
  bahrain:       "Asia/Bahrain",
  manama:        "Asia/Bahrain",
  tehran:        "Asia/Tehran",

  // ── Europe — British Isles ─────────────────────────────────────────────────
  london:        "Europe/London",
  heathrow:      "Europe/London",
  gatwick:       "Europe/London",
  lhr:           "Europe/London",
  lgw:           "Europe/London",
  manchester:    "Europe/London",
  birmingham:    "Europe/London",
  edinburgh:     "Europe/London",
  glasgow:       "Europe/London",
  dublin:        "Europe/Dublin",

  // ── Europe — Western ───────────────────────────────────────────────────────
  paris:         "Europe/Paris",
  "charles de gaulle": "Europe/Paris",
  cdg:           "Europe/Paris",
  lyon:          "Europe/Paris",
  nice:          "Europe/Paris",
  marseille:     "Europe/Paris",
  bordeaux:      "Europe/Paris",
  toulouse:      "Europe/Paris",
  amsterdam:     "Europe/Amsterdam",
  rotterdam:     "Europe/Amsterdam",
  brussels:      "Europe/Brussels",
  "bruxelles":   "Europe/Brussels",
  lisbon:        "Europe/Lisbon",
  "lisboa":      "Europe/Lisbon",
  porto:         "Europe/Lisbon",
  madrid:        "Europe/Madrid",
  barcelona:     "Europe/Madrid",
  seville:       "Europe/Madrid",
  valencia:      "Europe/Madrid",
  malaga:        "Europe/Madrid",
  ibiza:         "Europe/Madrid",

  // ── Europe — Germanic ──────────────────────────────────────────────────────
  berlin:        "Europe/Berlin",
  frankfurt:     "Europe/Berlin",
  munich:        "Europe/Berlin",
  hamburg:       "Europe/Berlin",
  cologne:       "Europe/Berlin",
  dusseldorf:    "Europe/Berlin",
  düsseldorf:    "Europe/Berlin",
  stuttgart:     "Europe/Berlin",
  nuremberg:     "Europe/Berlin",
  vienna:        "Europe/Vienna",
  wien:          "Europe/Vienna",
  salzburg:      "Europe/Vienna",
  zurich:        "Europe/Zurich",
  zürich:        "Europe/Zurich",
  geneva:        "Europe/Zurich",
  "genève":      "Europe/Zurich",
  bern:          "Europe/Zurich",
  basel:         "Europe/Zurich",

  // ── Europe — Scandinavian ──────────────────────────────────────────────────
  copenhagen:    "Europe/Copenhagen",
  stockholm:     "Europe/Stockholm",
  oslo:          "Europe/Oslo",
  bergen:        "Europe/Oslo",
  helsinki:      "Europe/Helsinki",
  tallinn:       "Europe/Tallinn",
  riga:          "Europe/Riga",
  vilnius:       "Europe/Vilnius",
  reykjavik:     "Atlantic/Reykjavik",

  // ── Europe — Mediterranean / Eastern ──────────────────────────────────────
  rome:          "Europe/Rome",
  milan:         "Europe/Rome",
  milano:        "Europe/Rome",
  venice:        "Europe/Rome",
  venezia:       "Europe/Rome",
  florence:      "Europe/Rome",
  firenze:       "Europe/Rome",
  naples:        "Europe/Rome",
  napoli:        "Europe/Rome",
  turin:         "Europe/Rome",
  torino:        "Europe/Rome",
  bologna:       "Europe/Rome",
  genoa:         "Europe/Rome",
  genova:        "Europe/Rome",
  verona:        "Europe/Rome",
  pisa:          "Europe/Rome",
  bari:          "Europe/Rome",
  palermo:       "Europe/Rome",
  pmo:           "Europe/Rome",
  catania:       "Europe/Rome",
  cta:           "Europe/Rome",
  taormina:      "Europe/Rome",
  marsala:       "Europe/Rome",
  agrigento:     "Europe/Rome",
  trapani:       "Europe/Rome",
  siracusa:      "Europe/Rome",
  syracuse:      "Europe/Rome",
  ragusa:        "Europe/Rome",
  messina:       "Europe/Rome",
  lecce:         "Europe/Rome",
  trieste:       "Europe/Rome",
  perugia:       "Europe/Rome",
  assisi:        "Europe/Rome",
  amalfi:        "Europe/Rome",
  positano:      "Europe/Rome",
  sorrento:      "Europe/Rome",
  capri:         "Europe/Rome",
  pompei:        "Europe/Rome",
  pompeii:       "Europe/Rome",
  "lake como":   "Europe/Rome",
  como:          "Europe/Rome",
  "civitavecchia":"Europe/Rome",
  athens:        "Europe/Athens",
  thessaloniki:  "Europe/Athens",
  santorini:     "Europe/Athens",
  mykonos:       "Europe/Athens",
  istanbul:      "Europe/Istanbul",
  ankara:        "Europe/Istanbul",
  dubrovnik:     "Europe/Zagreb",
  split:         "Europe/Zagreb",
  zagreb:        "Europe/Zagreb",
  prague:        "Europe/Prague",
  warsaw:        "Europe/Warsaw",
  krakow:        "Europe/Warsaw",
  gdansk:        "Europe/Warsaw",
  budapest:      "Europe/Budapest",
  bucharest:     "Europe/Bucharest",
  sofia:         "Europe/Sofia",
  belgrade:      "Europe/Belgrade",
  ljubljana:     "Europe/Ljubljana",
  bratislava:    "Europe/Bratislava",
  valletta:      "Europe/Malta",
  malta:         "Europe/Malta",
  nicosia:       "Asia/Nicosia",
  limassol:      "Asia/Nicosia",

  // ── Africa ─────────────────────────────────────────────────────────────────
  cairo:         "Africa/Cairo",
  "sharm el sheikh": "Africa/Cairo",
  hurghada:      "Africa/Cairo",
  nairobi:       "Africa/Nairobi",
  mombasa:       "Africa/Nairobi",
  "cape town":   "Africa/Johannesburg",
  johannesburg:  "Africa/Johannesburg",
  durban:        "Africa/Johannesburg",
  lagos:         "Africa/Lagos",
  accra:         "Africa/Accra",
  casablanca:    "Africa/Casablanca",
  marrakech:     "Africa/Casablanca",
  tunis:         "Africa/Tunis",
  "addis ababa":   "Africa/Addis_Ababa",
  "dar es salaam": "Africa/Dar_es_Salaam",
  zanzibar:      "Africa/Dar_es_Salaam",
  mauritius:     "Indian/Mauritius",
  "port louis":  "Indian/Mauritius",
  maldives:      "Indian/Maldives",
  "male":        "Indian/Maldives",
  seychelles:    "Indian/Mahe",
  mahé:          "Indian/Mahe",

  // ── North America — US East ────────────────────────────────────────────────
  "new york":    "America/New_York",
  nyc:           "America/New_York",
  jfk:           "America/New_York",
  ewr:           "America/New_York",
  lga:           "America/New_York",
  newark:        "America/New_York",
  manhattan:     "America/New_York",
  brooklyn:      "America/New_York",
  boston:        "America/New_York",
  bos:           "America/New_York",
  philadelphia:  "America/New_York",
  phl:           "America/New_York",
  washington:    "America/New_York",
  "washington dc":"America/New_York",
  baltimore:     "America/New_York",
  miami:         "America/New_York",
  mia:           "America/New_York",
  "fort lauderdale":"America/New_York",
  fll:           "America/New_York",
  orlando:       "America/New_York",
  mco:           "America/New_York",
  "cape canaveral":"America/New_York",
  "port canaveral":"America/New_York",
  tampa:         "America/New_York",
  jacksonville:  "America/New_York",
  charlotte:     "America/New_York",
  atlanta:       "America/New_York",
  atl:           "America/New_York",
  "north carolina":"America/New_York",
  raleigh:       "America/New_York",
  pittsburgh:    "America/New_York",
  cleveland:     "America/New_York",
  detroit:       "America/New_York",
  dtw:           "America/New_York",
  nassau:        "America/Nassau",
  bahamas:       "America/Nassau",
  "castaway cay": "America/Nassau",
  havana:        "America/Havana",

  // ── North America — US Central ─────────────────────────────────────────────
  chicago:       "America/Chicago",
  ohare:         "America/Chicago",
  ord:           "America/Chicago",
  "o'hare":      "America/Chicago",
  dallas:        "America/Chicago",
  dfw:           "America/Chicago",
  houston:       "America/Chicago",
  iah:           "America/Chicago",
  "new orleans": "America/Chicago",
  "saint louis": "America/Chicago",
  minneapolis:   "America/Chicago",
  msp:           "America/Chicago",
  kansas:        "America/Chicago",
  memphis:       "America/Chicago",
  nashville:     "America/Chicago",
  milwaukee:     "America/Chicago",
  mexico:        "America/Mexico_City",
  "mexico city": "America/Mexico_City",
  "ciudad de mexico":"America/Mexico_City",
  cancun:        "America/Cancun",
  guadalajara:   "America/Mexico_City",
  monterrey:     "America/Mexico_City",

  // ── North America — US Mountain ────────────────────────────────────────────
  denver:        "America/Denver",
  den:           "America/Denver",
  "salt lake":   "America/Denver",
  slc:           "America/Denver",
  phoenix:       "America/Phoenix",
  phx:           "America/Phoenix",
  tucson:        "America/Phoenix",
  albuquerque:   "America/Denver",
  "santa fe":    "America/Denver",

  // ── North America — US Pacific ─────────────────────────────────────────────
  "los angeles": "America/Los_Angeles",
  lax:           "America/Los_Angeles",
  "san diego":   "America/Los_Angeles",
  "san francisco":"America/Los_Angeles",
  sfo:           "America/Los_Angeles",
  oakland:       "America/Los_Angeles",
  "san jose":    "America/Los_Angeles",
  "las vegas":   "America/Los_Angeles",
  las:           "America/Los_Angeles",
  seattle:       "America/Los_Angeles",
  sea:           "America/Los_Angeles",
  portland:      "America/Los_Angeles",
  pdx:           "America/Los_Angeles",
  sacramento:    "America/Los_Angeles",

  // ── North America — US Hawaii / Alaska ─────────────────────────────────────
  honolulu:      "Pacific/Honolulu",
  hnl:           "Pacific/Honolulu",
  maui:          "Pacific/Honolulu",
  anchorage:     "America/Anchorage",
  anc:           "America/Anchorage",

  // ── Canada ─────────────────────────────────────────────────────────────────
  toronto:       "America/Toronto",
  yyz:           "America/Toronto",
  ottawa:        "America/Toronto",
  montreal:      "America/Toronto",
  yul:           "America/Toronto",
  "quebec city": "America/Toronto",
  vancouver:     "America/Vancouver",
  yvr:           "America/Vancouver",
  calgary:       "America/Edmonton",
  edmonton:      "America/Edmonton",
  winnipeg:      "America/Winnipeg",

  // ── Caribbean & Central America ────────────────────────────────────────────
  "san juan":    "America/Puerto_Rico",
  "puerto rico": "America/Puerto_Rico",
  "saint martin":"America/Marigot",
  "st martin":   "America/Marigot",
  "saint lucia": "America/St_Lucia",
  "st lucia":    "America/St_Lucia",
  barbados:      "America/Barbados",
  bridgetown:    "America/Barbados",
  "trinidad":    "America/Port_of_Spain",
  "port of spain":"America/Port_of_Spain",
  "antigua":     "America/Antigua",
  "grand cayman":"America/Grand_Cayman",
  cayman:        "America/Grand_Cayman",
  jamaica:       "America/Jamaica",
  kingston:      "America/Jamaica",
  "montego bay": "America/Jamaica",
  "costa rica":  "America/Costa_Rica",
  "san jose cr": "America/Costa_Rica",
  panama:        "America/Panama",
  belize:        "America/Belize",
  guatemala:     "America/Guatemala",

  // ── South America ──────────────────────────────────────────────────────────
  bogota:        "America/Bogota",
  medellin:      "America/Bogota",
  lima:          "America/Lima",
  quito:         "America/Guayaquil",
  guayaquil:     "America/Guayaquil",
  santiago:      "America/Santiago",
  "buenos aires":"America/Argentina/Buenos_Aires",
  cordoba:       "America/Argentina/Cordoba",
  "sao paulo":   "America/Sao_Paulo",
  "são paulo":   "America/Sao_Paulo",
  "rio de janeiro":"America/Sao_Paulo",
  rio:           "America/Sao_Paulo",
  brasilia:      "America/Sao_Paulo",
  montevideo:    "America/Montevideo",
  "la paz":      "America/La_Paz",
  caracas:       "America/Caracas",

  // ── Pacific / Oceania ──────────────────────────────────────────────────────
  sydney:        "Australia/Sydney",
  "sydney airport":"Australia/Sydney",
  melbourne:     "Australia/Melbourne",
  brisbane:      "Australia/Brisbane",
  "gold coast":    "Australia/Brisbane",
  perth:         "Australia/Perth",
  adelaide:      "Australia/Adelaide",
  darwin:        "Australia/Darwin",
  auckland:      "Pacific/Auckland",
  christchurch:  "Pacific/Auckland",
  queenstown:    "Pacific/Auckland",
  wellington:    "Pacific/Auckland",
  fiji:          "Pacific/Fiji",
  suva:          "Pacific/Fiji",
  tahiti:        "Pacific/Tahiti",
  papeete:       "Pacific/Tahiti",
  "french polynesia":"Pacific/Tahiti",
  "bora bora":   "Pacific/Tahiti",
  "guam":        "Pacific/Guam",
};

// ─── Normalise helper ─────────────────────────────────────────────────────────

function normalise(raw: string): string {
  return raw
    .toLowerCase()
    // Strip " (CDG)" style parentheticals
    .replace(/\s*\([^)]*\)/g, "")
    // Strip "international airport", "airport"
    .replace(/\binternational\s+airport\b/g, "")
    .replace(/\bairport\b/g, "")
    // Strip trailing US state abbreviations like ", FL" or ", NY"
    .replace(/,\s*[a-z]{2}\s*$/, "")
    // Strip trailing country names after comma (", Bahamas" etc.)
    .replace(/,.*$/, "")
    // Collapse multiple spaces
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return the IANA timezone for a city string, or `undefined` if the city is
 * not recognised (caller should omit the timeZone field rather than guess).
 */
export function getCityTimezone(city: string | undefined): string | undefined {
  if (!city) return undefined;

  const n = normalise(city);
  if (!n || n === "at sea" || n === "sea day") return undefined;

  // 1. Exact match after normalisation
  if (TABLE[n]) return TABLE[n];

  // 2. Check if any multi-word key is a substring of the normalised city,
  //    or the normalised city is a substring of a longer key.
  //    This catches "Shinjuku, Tokyo" matching "tokyo", "Port Canaveral, FL"
  //    matching "port canaveral", etc.
  for (const [key, tz] of Object.entries(TABLE)) {
    if (n.includes(key) || key.includes(n)) {
      return tz;
    }
  }

  return undefined;
}
