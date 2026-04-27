// Generate packages/shared/src/utils/airports-data.ts from airports.csv
// (OurAirports schema). Filter to large_airport rows with an IATA code,
// look up an IANA timezone via region/country tables, and emit a typed
// Record<string, AirportInfo>.
//
// One-shot — checked into scripts/ for reproducibility but not run at build.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = process.argv[2] ?? "/home/user/travel-itinerary-maker";
const CSV = join(REPO, "airports.csv");
const OUT = join(REPO, "packages/shared/src/utils/airports-data.ts");

// ─── Country (single TZ) → IANA ──────────────────────────────────────────────
// Default for countries that observe one timezone year-round. Multi-zone
// countries are handled by REGION_TZ below; if a region isn't listed there
// we fall back to this map.
const COUNTRY_TZ = {
  AE: "Asia/Dubai", AF: "Asia/Kabul", AG: "America/Antigua", AL: "Europe/Tirane",
  AM: "Asia/Yerevan", AO: "Africa/Luanda", AS: "Pacific/Pago_Pago",
  AT: "Europe/Vienna", AW: "America/Aruba", AZ: "Asia/Baku",
  BA: "Europe/Sarajevo", BB: "America/Barbados", BD: "Asia/Dhaka",
  BE: "Europe/Brussels", BF: "Africa/Ouagadougou", BG: "Europe/Sofia",
  BH: "Asia/Bahrain", BI: "Africa/Bujumbura", BJ: "Africa/Porto-Novo",
  BM: "Atlantic/Bermuda", BN: "Asia/Brunei", BO: "America/La_Paz",
  BQ: "America/Kralendijk", BS: "America/Nassau", BT: "Asia/Thimphu",
  BW: "Africa/Gaborone", BY: "Europe/Minsk", BZ: "America/Belize",
  CC: "Indian/Cocos", CF: "Africa/Bangui", CG: "Africa/Brazzaville",
  CH: "Europe/Zurich", CI: "Africa/Abidjan", CK: "Pacific/Rarotonga",
  CM: "Africa/Douala", CN: "Asia/Shanghai", CO: "America/Bogota",
  CR: "America/Costa_Rica", CU: "America/Havana", CV: "Atlantic/Cape_Verde",
  CW: "America/Curacao", CY: "Asia/Nicosia", CZ: "Europe/Prague",
  DE: "Europe/Berlin", DJ: "Africa/Djibouti", DK: "Europe/Copenhagen",
  DO: "America/Santo_Domingo", DZ: "Africa/Algiers", EE: "Europe/Tallinn",
  EG: "Africa/Cairo", EH: "Africa/El_Aaiun", ES: "Europe/Madrid",
  ET: "Africa/Addis_Ababa", FI: "Europe/Helsinki", FJ: "Pacific/Fiji",
  FK: "Atlantic/Stanley", FO: "Atlantic/Faroe", GA: "Africa/Libreville",
  GB: "Europe/London", GD: "America/Grenada", GE: "Asia/Tbilisi",
  GF: "America/Cayenne", GH: "Africa/Accra", GI: "Europe/Gibraltar",
  GM: "Africa/Banjul", GN: "Africa/Conakry", GP: "America/Guadeloupe",
  GQ: "Africa/Malabo", GR: "Europe/Athens", GT: "America/Guatemala",
  GU: "Pacific/Guam", GW: "Africa/Bissau", GY: "America/Guyana",
  HK: "Asia/Hong_Kong", HN: "America/Tegucigalpa", HR: "Europe/Zagreb",
  HT: "America/Port-au-Prince", HU: "Europe/Budapest", IE: "Europe/Dublin",
  IL: "Asia/Jerusalem", IM: "Europe/Isle_of_Man", IN: "Asia/Kolkata",
  IQ: "Asia/Baghdad", IR: "Asia/Tehran", IS: "Atlantic/Reykjavik",
  IT: "Europe/Rome", JM: "America/Jamaica", JO: "Asia/Amman",
  JP: "Asia/Tokyo", KE: "Africa/Nairobi", KG: "Asia/Bishkek",
  KH: "Asia/Phnom_Penh", KI: "Pacific/Tarawa", KM: "Indian/Comoro",
  KN: "America/St_Kitts", KP: "Asia/Pyongyang", KR: "Asia/Seoul",
  KW: "Asia/Kuwait", KY: "America/Cayman", LA: "Asia/Vientiane",
  LB: "Asia/Beirut", LC: "America/St_Lucia", LK: "Asia/Colombo",
  LR: "Africa/Monrovia", LS: "Africa/Maseru", LT: "Europe/Vilnius",
  LU: "Europe/Luxembourg", LV: "Europe/Riga", LY: "Africa/Tripoli",
  MA: "Africa/Casablanca", MD: "Europe/Chisinau", ME: "Europe/Podgorica",
  MG: "Indian/Antananarivo", MH: "Pacific/Majuro", MK: "Europe/Skopje",
  ML: "Africa/Bamako", MM: "Asia/Yangon", MO: "Asia/Macau",
  MP: "Pacific/Saipan", MQ: "America/Martinique", MR: "Africa/Nouakchott",
  MS: "America/Montserrat", MT: "Europe/Malta", MU: "Indian/Mauritius",
  MV: "Indian/Maldives", MW: "Africa/Blantyre", MY: "Asia/Kuala_Lumpur",
  MZ: "Africa/Maputo", NA: "Africa/Windhoek", NC: "Pacific/Noumea",
  NE: "Africa/Niamey", NG: "Africa/Lagos", NI: "America/Managua",
  NL: "Europe/Amsterdam", NO: "Europe/Oslo", NP: "Asia/Kathmandu",
  OM: "Asia/Muscat", PA: "America/Panama", PE: "America/Lima",
  PF: "Pacific/Tahiti", PG: "Pacific/Port_Moresby", PH: "Asia/Manila",
  PK: "Asia/Karachi", PL: "Europe/Warsaw", PR: "America/Puerto_Rico",
  PW: "Pacific/Palau", PY: "America/Asuncion", QA: "Asia/Qatar",
  RE: "Indian/Reunion", RO: "Europe/Bucharest", RS: "Europe/Belgrade",
  RW: "Africa/Kigali", SA: "Asia/Riyadh", SB: "Pacific/Guadalcanal",
  SC: "Indian/Mahe", SD: "Africa/Khartoum", SE: "Europe/Stockholm",
  SG: "Asia/Singapore", SI: "Europe/Ljubljana", SK: "Europe/Bratislava",
  SL: "Africa/Freetown", SN: "Africa/Dakar", SO: "Africa/Mogadishu",
  SR: "America/Paramaribo", SS: "Africa/Juba", ST: "Africa/Sao_Tome",
  SV: "America/El_Salvador", SX: "America/Lower_Princes", SY: "Asia/Damascus",
  SZ: "Africa/Mbabane", TC: "America/Grand_Turk", TD: "Africa/Ndjamena",
  TG: "Africa/Lome", TH: "Asia/Bangkok", TJ: "Asia/Dushanbe",
  TL: "Asia/Dili", TM: "Asia/Ashgabat", TN: "Africa/Tunis",
  TO: "Pacific/Tongatapu", TR: "Europe/Istanbul", TT: "America/Port_of_Spain",
  TW: "Asia/Taipei", TZ: "Africa/Dar_es_Salaam", UA: "Europe/Kyiv",
  UG: "Africa/Kampala", UY: "America/Montevideo", UZ: "Asia/Tashkent",
  VC: "America/St_Vincent", VE: "America/Caracas", VG: "America/Tortola",
  VI: "America/St_Thomas", VN: "Asia/Ho_Chi_Minh", VU: "Pacific/Efate",
  WF: "Pacific/Wallis", WS: "Pacific/Apia", XK: "Europe/Belgrade",
  YE: "Asia/Aden", YT: "Indian/Mayotte", ZA: "Africa/Johannesburg",
  ZM: "Africa/Lusaka", ZW: "Africa/Harare",
};

// ─── Region (multi-TZ country) → IANA ────────────────────────────────────────
// iso_region values are "<country>-<region>". Listed here when the country
// spans more than one IANA zone.
const REGION_TZ = {
  // United States
  "US-AK": "America/Anchorage", "US-AL": "America/Chicago",
  "US-AR": "America/Chicago",  "US-AZ": "America/Phoenix",
  "US-CA": "America/Los_Angeles", "US-CO": "America/Denver",
  "US-CT": "America/New_York", "US-DC": "America/New_York",
  "US-DE": "America/New_York", "US-FL": "America/New_York",
  "US-GA": "America/New_York", "US-HI": "Pacific/Honolulu",
  "US-IA": "America/Chicago", "US-ID": "America/Boise",
  "US-IL": "America/Chicago", "US-IN": "America/Indiana/Indianapolis",
  "US-KS": "America/Chicago", "US-KY": "America/New_York",
  "US-LA": "America/Chicago", "US-MA": "America/New_York",
  "US-MD": "America/New_York", "US-ME": "America/New_York",
  "US-MI": "America/Detroit", "US-MN": "America/Chicago",
  "US-MO": "America/Chicago", "US-MS": "America/Chicago",
  "US-MT": "America/Denver", "US-NC": "America/New_York",
  "US-ND": "America/Chicago", "US-NE": "America/Chicago",
  "US-NH": "America/New_York", "US-NJ": "America/New_York",
  "US-NM": "America/Denver", "US-NV": "America/Los_Angeles",
  "US-NY": "America/New_York", "US-OH": "America/New_York",
  "US-OK": "America/Chicago", "US-OR": "America/Los_Angeles",
  "US-PA": "America/New_York", "US-RI": "America/New_York",
  "US-SC": "America/New_York", "US-SD": "America/Chicago",
  "US-TN": "America/Chicago", "US-TX": "America/Chicago",
  "US-UT": "America/Denver", "US-VA": "America/New_York",
  "US-VT": "America/New_York", "US-WA": "America/Los_Angeles",
  "US-WI": "America/Chicago", "US-WV": "America/New_York",
  "US-WY": "America/Denver",

  // Canada
  "CA-AB": "America/Edmonton", "CA-BC": "America/Vancouver",
  "CA-MB": "America/Winnipeg", "CA-NB": "America/Moncton",
  "CA-NL": "America/St_Johns", "CA-NS": "America/Halifax",
  "CA-NT": "America/Yellowknife", "CA-NU": "America/Iqaluit",
  "CA-ON": "America/Toronto", "CA-PE": "America/Halifax",
  "CA-QC": "America/Toronto", "CA-SK": "America/Regina",
  "CA-YT": "America/Whitehorse",

  // Russia (large zones — close enough for itinerary calendar export)
  "RU-KGD": "Europe/Kaliningrad",
  "RU-MOW": "Europe/Moscow", "RU-MOS": "Europe/Moscow",
  "RU-SPE": "Europe/Moscow", "RU-LEN": "Europe/Moscow",
  "RU-AD": "Europe/Moscow", "RU-AST": "Europe/Astrakhan",
  "RU-BEL": "Europe/Moscow", "RU-BRY": "Europe/Moscow",
  "RU-VLG": "Europe/Volgograd", "RU-VOR": "Europe/Moscow",
  "RU-IVA": "Europe/Moscow", "RU-KGN": "Asia/Yekaterinburg",
  "RU-KLU": "Europe/Moscow", "RU-KOS": "Europe/Moscow",
  "RU-KDA": "Europe/Moscow", "RU-KIR": "Europe/Kirov",
  "RU-KRS": "Europe/Moscow", "RU-LIP": "Europe/Moscow",
  "RU-MUR": "Europe/Moscow", "RU-NIZ": "Europe/Moscow",
  "RU-NGR": "Europe/Moscow", "RU-ORL": "Europe/Moscow",
  "RU-ORE": "Asia/Yekaterinburg", "RU-PNZ": "Europe/Moscow",
  "RU-PRI": "Asia/Vladivostok", "RU-PSK": "Europe/Moscow",
  "RU-ROS": "Europe/Moscow", "RU-RYA": "Europe/Moscow",
  "RU-SAM": "Europe/Samara", "RU-SAR": "Europe/Saratov",
  "RU-SAK": "Asia/Sakhalin", "RU-SVE": "Asia/Yekaterinburg",
  "RU-SMO": "Europe/Moscow", "RU-STA": "Europe/Moscow",
  "RU-TAM": "Europe/Moscow", "RU-TVE": "Europe/Moscow",
  "RU-TUL": "Europe/Moscow", "RU-TYU": "Asia/Yekaterinburg",
  "RU-UD": "Europe/Samara", "RU-ULY": "Europe/Ulyanovsk",
  "RU-CHE": "Asia/Yekaterinburg", "RU-YAR": "Europe/Moscow",
  "RU-AMU": "Asia/Yakutsk", "RU-IRK": "Asia/Irkutsk",
  "RU-KEM": "Asia/Krasnoyarsk", "RU-KAM": "Asia/Kamchatka",
  "RU-KYA": "Asia/Krasnoyarsk", "RU-MAG": "Asia/Magadan",
  "RU-NVS": "Asia/Novosibirsk", "RU-OMS": "Asia/Omsk",
  "RU-TOM": "Asia/Tomsk", "RU-CHU": "Asia/Anadyr",
  "RU-YEV": "Asia/Vladivostok", "RU-KHA": "Asia/Vladivostok",
  "RU-SA": "Asia/Yakutsk", "RU-BU": "Asia/Irkutsk",
  "RU-TY": "Asia/Krasnoyarsk", "RU-KK": "Asia/Krasnoyarsk",
  "RU-AL": "Asia/Krasnoyarsk", "RU-KAR": "Europe/Moscow",
  "RU-KO": "Europe/Moscow", "RU-NEN": "Europe/Moscow",
  "RU-YAN": "Asia/Yekaterinburg", "RU-KHM": "Asia/Yekaterinburg",
  "RU-PER": "Asia/Yekaterinburg", "RU-BA": "Asia/Yekaterinburg",
  "RU-DA": "Europe/Moscow", "RU-IN": "Europe/Moscow",
  "RU-KB": "Europe/Moscow", "RU-KC": "Europe/Moscow",
  "RU-CE": "Europe/Moscow", "RU-CU": "Europe/Moscow",
  "RU-ME": "Europe/Moscow", "RU-MO": "Europe/Moscow",
  "RU-TA": "Europe/Moscow", "RU-CR": "Europe/Simferopol",

  // Australia
  "AU-NSW": "Australia/Sydney", "AU-VIC": "Australia/Melbourne",
  "AU-QLD": "Australia/Brisbane", "AU-SA": "Australia/Adelaide",
  "AU-WA": "Australia/Perth", "AU-TAS": "Australia/Hobart",
  "AU-NT": "Australia/Darwin", "AU-ACT": "Australia/Sydney",

  // Brazil
  "BR-AC": "America/Rio_Branco", "BR-AM": "America/Manaus",
  "BR-RR": "America/Boa_Vista", "BR-RO": "America/Porto_Velho",
  "BR-MT": "America/Cuiaba", "BR-MS": "America/Campo_Grande",
  "BR-PA": "America/Belem", "BR-AP": "America/Belem",
  "BR-TO": "America/Araguaina", "BR-MA": "America/Fortaleza",
  "BR-PI": "America/Fortaleza", "BR-CE": "America/Fortaleza",
  "BR-RN": "America/Fortaleza", "BR-PB": "America/Fortaleza",
  "BR-PE": "America/Recife", "BR-AL": "America/Maceio",
  "BR-SE": "America/Maceio", "BR-BA": "America/Bahia",
  "BR-MG": "America/Sao_Paulo", "BR-ES": "America/Sao_Paulo",
  "BR-RJ": "America/Sao_Paulo", "BR-SP": "America/Sao_Paulo",
  "BR-PR": "America/Sao_Paulo", "BR-SC": "America/Sao_Paulo",
  "BR-RS": "America/Sao_Paulo", "BR-GO": "America/Sao_Paulo",
  "BR-DF": "America/Sao_Paulo", "BR-FN": "America/Noronha",

  // Mexico
  "MX-BCN": "America/Tijuana", "MX-BCS": "America/Mazatlan",
  "MX-SON": "America/Hermosillo", "MX-CHH": "America/Chihuahua",
  "MX-SIN": "America/Mazatlan", "MX-NAY": "America/Mazatlan",
  "MX-ROO": "America/Cancun",
  // Everything else falls to America/Mexico_City (default below)

  // Indonesia
  "ID-AC": "Asia/Jakarta", "ID-SU": "Asia/Jakarta",
  "ID-SB": "Asia/Jakarta", "ID-SS": "Asia/Jakarta",
  "ID-RI": "Asia/Jakarta", "ID-KR": "Asia/Jakarta",
  "ID-JA": "Asia/Jakarta", "ID-BE": "Asia/Jakarta",
  "ID-LA": "Asia/Jakarta", "ID-BB": "Asia/Jakarta",
  "ID-BT": "Asia/Jakarta", "ID-JK": "Asia/Jakarta",
  "ID-JB": "Asia/Jakarta", "ID-JT": "Asia/Jakarta",
  "ID-YO": "Asia/Jakarta", "ID-JI": "Asia/Jakarta",
  "ID-KB": "Asia/Pontianak",
  "ID-BA": "Asia/Makassar", "ID-NB": "Asia/Makassar",
  "ID-NT": "Asia/Makassar", "ID-KS": "Asia/Makassar",
  "ID-KT": "Asia/Makassar", "ID-KI": "Asia/Makassar",
  "ID-KU": "Asia/Makassar", "ID-SA": "Asia/Makassar",
  "ID-SR": "Asia/Makassar", "ID-ST": "Asia/Makassar",
  "ID-SG": "Asia/Makassar", "ID-SN": "Asia/Makassar",
  "ID-GO": "Asia/Makassar",
  "ID-MA": "Asia/Jayapura", "ID-MU": "Asia/Jayapura",
  "ID-PA": "Asia/Jayapura", "ID-PB": "Asia/Jayapura",

  // Kazakhstan
  "KZ-AKM": "Asia/Almaty", "KZ-AKT": "Asia/Aqtobe",
  "KZ-ALA": "Asia/Almaty", "KZ-AST": "Asia/Almaty",
  "KZ-ATY": "Asia/Atyrau", "KZ-VOS": "Asia/Almaty",
  "KZ-MAN": "Asia/Aqtau", "KZ-YUZ": "Asia/Almaty",
  "KZ-PAV": "Asia/Almaty", "KZ-SEV": "Asia/Almaty",
  "KZ-SHY": "Asia/Almaty", "KZ-ZAP": "Asia/Oral",
  "KZ-ZHA": "Asia/Aqtau", "KZ-KAR": "Asia/Almaty",
  "KZ-KUS": "Asia/Almaty", "KZ-KZY": "Asia/Qyzylorda",

  // Mongolia
  "MN-BO": "Asia/Choibalsan", "MN-DD": "Asia/Choibalsan",
  "MN-SU": "Asia/Choibalsan",
  "MN-BU": "Asia/Hovd", "MN-GA": "Asia/Hovd",
  "MN-HO": "Asia/Hovd", "MN-UV": "Asia/Hovd",

  // DRC
  "CD-KN": "Africa/Kinshasa", "CD-BC": "Africa/Kinshasa",
  "CD-EQ": "Africa/Kinshasa", "CD-MA": "Africa/Kinshasa",
  "CD-KW": "Africa/Kinshasa", "CD-KE": "Africa/Lubumbashi",
  "CD-HK": "Africa/Lubumbashi", "CD-LU": "Africa/Lubumbashi",
  "CD-NK": "Africa/Lubumbashi", "CD-SK": "Africa/Lubumbashi",
  "CD-MN": "Africa/Lubumbashi", "CD-OR": "Africa/Lubumbashi",
  "CD-TA": "Africa/Lubumbashi", "CD-IT": "Africa/Lubumbashi",
  "CD-HU": "Africa/Lubumbashi", "CD-BU": "Africa/Lubumbashi",

  // Argentina (mostly Buenos_Aires; some western provinces use different)
  // Defaulting all to Buenos_Aires is acceptable — DST behavior is shared.
  // Chile
  "CL-IP": "Pacific/Easter",
  "CL-AP": "America/Santiago", "CL-AT": "America/Santiago",
  "CL-AN": "America/Santiago", "CL-AR": "America/Santiago",
  "CL-LI": "America/Santiago", "CL-LL": "America/Santiago",
  "CL-LR": "America/Santiago", "CL-MA": "America/Punta_Arenas",
  "CL-ML": "America/Santiago", "CL-NB": "America/Santiago",
  "CL-RM": "America/Santiago", "CL-TA": "America/Santiago",
  "CL-VS": "America/Santiago", "CL-BI": "America/Santiago",
  "CL-CO": "America/Santiago",

  // Ecuador
  "EC-W": "Pacific/Galapagos",

  // Portugal
  "PT-20": "Atlantic/Azores", "PT-30": "Atlantic/Madeira",

  // Greenland
  "GL-SM": "America/Nuuk", "GL-AV": "America/Nuuk",
  "GL-QE": "America/Nuuk", "GL-QA": "America/Nuuk",
  "GL-KU": "America/Nuuk",

  // Spain (Canary Islands)
  "ES-CN": "Atlantic/Canary",

  // France overseas
  "FR-A": "Europe/Paris", // Standard French Republic; overseas handled by separate ISO codes (RE, GF, MQ, GP, etc.)

  // New Zealand (Chatham)
  "NZ-CIT": "Pacific/Chatham",

  // Federated States of Micronesia
  "FM-PNI": "Pacific/Pohnpei",
  "FM-TRK": "Pacific/Chuuk",
  "FM-KSA": "Pacific/Kosrae",
  "FM-YAP": "Pacific/Chuuk",

  // China only has one official zone
  // South Africa, Saudi Arabia, India, Japan, Korea, Turkey, Iran etc. — single zone (handled by COUNTRY_TZ)
};

// Default for multi-TZ countries when the region isn't enumerated above.
const COUNTRY_DEFAULT_TZ = {
  RU: "Europe/Moscow",
  AU: "Australia/Sydney",
  BR: "America/Sao_Paulo",
  MX: "America/Mexico_City",
  ID: "Asia/Jakarta",
  KZ: "Asia/Almaty",
  CA: "America/Toronto",
  US: "America/New_York",
  CD: "Africa/Kinshasa",
  CL: "America/Santiago",
  EC: "America/Guayaquil",
  AR: "America/Argentina/Buenos_Aires",
  PT: "Europe/Lisbon",
  GL: "America/Nuuk",
  ES: "Europe/Madrid",
  FR: "Europe/Paris",
  NZ: "Pacific/Auckland",
  MN: "Asia/Ulaanbaatar",
  PF: "Pacific/Tahiti",
};

function unq(s) {
  if (!s) return "";
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

function parseCsv(text) {
  // RFC 4180-ish: handles quoted fields with embedded commas/quotes.
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* ignore */ }
      else field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const text = readFileSync(CSV, "utf8");
const rows = parseCsv(text);
const header = rows[0];
const idx = (name) => header.indexOf(name);
const I_TYPE = idx("type");
const I_NAME = idx("name");
const I_COUNTRY = idx("iso_country");
const I_REGION = idx("iso_region");
const I_MUNI = idx("municipality");
const I_IATA = idx("iata_code");
const I_KEYWORDS = idx("keywords");

const seen = new Set();
const records = [];

for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  if (!row || row.length < 14) continue;
  const type = row[I_TYPE];
  if (type !== "large_airport") continue;
  const name = row[I_NAME];
  if (name.startsWith("(Duplicate)")) continue;
  const iata = (row[I_IATA] ?? "").trim().toUpperCase();
  if (!iata || iata.length !== 3 || !/^[A-Z]{3}$/.test(iata)) continue;
  if (seen.has(iata)) continue;
  seen.add(iata);

  const country = row[I_COUNTRY];
  const region = row[I_REGION];
  // Strip trailing parentheticals from municipality names so e.g.
  // "Paris (Roissy-en-France, Val-d'Oise)" becomes "Paris" — what users
  // expect to see next to an airport code.
  const muni = (row[I_MUNI] ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();

  const tz = REGION_TZ[region] ?? COUNTRY_TZ[country] ?? COUNTRY_DEFAULT_TZ[country];
  if (!tz) {
    console.warn(`No TZ for ${iata} (${country}/${region})`);
    continue;
  }

  // Keywords help searchAirports("Tokyo") return NRT (whose municipality is
  // "Narita") and similar airport↔city aliases. Filter to short ASCII tokens
  // and drop the airport name/city we already store.
  const rawKeywords = (row[I_KEYWORDS] ?? "").split(/[,;]/).map((s) => s.trim());
  const keywords = [];
  const seenKw = new Set();
  for (const kw of rawKeywords) {
    if (!kw) continue;
    if (!/^[\x20-\x7e]+$/.test(kw)) continue; // ASCII only — drop CJK / accents
    if (kw.length > 40) continue;
    const lower = kw.toLowerCase();
    if (lower === muni.toLowerCase()) continue;
    if (lower === name.toLowerCase()) continue;
    if (lower === iata.toLowerCase()) continue;
    if (seenKw.has(lower)) continue;
    seenKw.add(lower);
    keywords.push(kw);
  }

  records.push({ code: iata, city: muni, country, name, tz, keywords });
}

records.sort((a, b) => a.code.localeCompare(b.code));

const lines = [
  "// Auto-generated from airports.csv (OurAirports schema, large_airport rows).",
  "// Regenerate via scripts/build-airports.mjs — do not hand-edit.",
  "//",
  `// Source row count: ${records.length}`,
  "",
  "import type { AirportInfo } from \"./airport-lookup\";",
  "",
  "export const AIRPORTS: Record<string, AirportInfo> = {",
];

function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

for (const r of records) {
  const cityEsc = esc(r.city);
  const nameEsc = esc(r.name);
  const kw = r.keywords.length
    ? `, keywords: [${r.keywords.map((k) => `"${esc(k)}"`).join(", ")}]`
    : "";
  lines.push(
    `  ${r.code}: { city: "${cityEsc}", country: "${r.country}", airportName: "${nameEsc}", timezone: "${r.tz}"${kw} },`,
  );
}

lines.push("};", "");

writeFileSync(OUT, lines.join("\n"));
console.log(`Wrote ${records.length} airports → ${OUT}`);
