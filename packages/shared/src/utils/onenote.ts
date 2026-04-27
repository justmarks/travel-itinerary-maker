import type { Trip, Segment, CostSummaryItem } from "../types/trip";
import { formatCurrency, sumByCurrency } from "./currency";
import { formatFlightLabel, formatFlightEndpoint } from "./segments";

/**
 * Format a segment's details as plain text for a table cell.
 */
function formatSegmentCell(segment: Segment): string {
  const parts: string[] = [];

  switch (segment.type) {
    case "flight":
    case "train": {
      const depLabel = formatFlightEndpoint(segment.departureAirport, segment.departureCity);
      const arrLabel = formatFlightEndpoint(segment.arrivalAirport, segment.arrivalCity);
      const route = [depLabel, arrLabel].filter(Boolean).join(" → ");
      const carrier = formatFlightLabel(segment);
      parts.push(carrier || segment.title);
      if (route) parts.push(route);
      if (segment.startTime && segment.endTime)
        parts.push(`${segment.startTime}–${segment.endTime}`);
      if (segment.confirmationCode) parts.push(`#${segment.confirmationCode}`);
      break;
    }
    case "cruise": {
      parts.push(segment.title);
      const route = [segment.departureCity, segment.arrivalCity]
        .filter(Boolean)
        .join(" → ");
      if (route) parts.push(route);
      if (segment.startTime) parts.push(segment.startTime);
      if (segment.confirmationCode) parts.push(`#${segment.confirmationCode}`);
      break;
    }
    case "hotel":
    case "car_rental":
    case "car_service":
    case "other_transport": {
      parts.push(segment.venueName || segment.title);
      if (segment.address) parts.push(segment.address);
      if (segment.confirmationCode) parts.push(`#${segment.confirmationCode}`);
      break;
    }
    case "restaurant_breakfast":
    case "restaurant_brunch":
    case "restaurant_lunch":
    case "restaurant_dinner": {
      parts.push(segment.venueName || segment.title);
      if (segment.startTime) parts.push(segment.startTime);
      if (segment.partySize) parts.push(`(${segment.partySize})`);
      if (segment.creditCardHold) parts.push("CC hold");
      break;
    }
    case "activity":
    case "tour":
    case "show":
    default: {
      parts.push(segment.venueName || segment.title);
      if (segment.startTime) parts.push(segment.startTime);
      if (segment.confirmationCode) parts.push(`#${segment.confirmationCode}`);
      break;
    }
  }

  return parts.join(" · ");
}

function getSegmentsByType(segments: Segment[], types: string[]): Segment[] {
  return segments
    .filter((s) => types.includes(s.type))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Escape HTML special characters */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function segmentLink(segment: Segment, text: string): string {
  if (segment.url) {
    return `<a href="${esc(segment.url)}">${esc(text)}</a>`;
  }
  return esc(text);
}

interface ExportOptions {
  includeCosts?: boolean;
  includeTodos?: boolean;
}

/**
 * Generate OneNote-compatible HTML for a trip.
 *
 * The output follows the OneNote API's supported HTML subset
 * (https://learn.microsoft.com/en-us/graph/onenote-input-output-html)
 * so it can be pushed directly via Microsoft Graph's Create Page endpoint,
 * or downloaded as a standalone `.html` file for manual import.
 */
export function tripToOneNoteHtml(
  trip: Trip,
  options: ExportOptions = {},
): string {
  const { includeCosts = true, includeTodos = true } = options;
  const lines: string[] = [];

  // OneNote API requires a full HTML document
  lines.push("<!DOCTYPE html>");
  lines.push("<html>");
  lines.push("<head>");
  lines.push(`<title>${esc(trip.title)}</title>`);
  lines.push('<meta name="created" content="' + new Date().toISOString() + '" />');
  lines.push("</head>");
  lines.push("<body>");

  // Title
  lines.push(`<h1>${esc(trip.title)}</h1>`);
  lines.push(`<p><strong>${esc(trip.startDate)} to ${esc(trip.endDate)}</strong></p>`);

  // Itinerary table
  lines.push("<h2>Itinerary</h2>");
  lines.push('<table border="1" style="border-collapse:collapse; width:100%;">');
  lines.push("<tr>");
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
    lines.push(
      `<th style="background-color:#4472C4; color:white; padding:6px 8px; text-align:left;">${hdr}</th>`,
    );
  }
  lines.push("</tr>");

  for (let i = 0; i < trip.days.length; i++) {
    const day = trip.days[i];
    const bgColor = i % 2 === 0 ? "#ffffff" : "#f2f2f2";
    const cellStyle = `style="padding:6px 8px; vertical-align:top; background-color:${bgColor};"`;

    const transportSegs = getSegmentsByType(day.segments, [
      "flight",
      "train",
      "car_rental",
      "car_service",
      "other_transport",
    ]);
    const lodgingSegs = getSegmentsByType(day.segments, ["hotel"]);
    const activitySegs = getSegmentsByType(day.segments, [
      "activity",
      "tour",
      "cruise",
      "show",
    ]);
    const lunchSegs = getSegmentsByType(day.segments, [
      "restaurant_breakfast",
      "restaurant_brunch",
      "restaurant_lunch",
    ]);
    const dinnerSegs = getSegmentsByType(day.segments, ["restaurant_dinner"]);

    const formatCell = (segs: Segment[]): string => {
      if (segs.length === 0) return "–";
      return segs
        .map((s) => segmentLink(s, formatSegmentCell(s)))
        .join("<br/>");
    };

    lines.push("<tr>");
    lines.push(`<td ${cellStyle}>${esc(day.city) || "–"}</td>`);
    lines.push(`<td ${cellStyle}>${esc(day.dayOfWeek)}</td>`);
    lines.push(`<td ${cellStyle}>${esc(day.date)}</td>`);
    lines.push(`<td ${cellStyle}>${formatCell(transportSegs)}</td>`);
    lines.push(`<td ${cellStyle}>${formatCell(lodgingSegs)}</td>`);
    lines.push(`<td ${cellStyle}>${formatCell(activitySegs)}</td>`);
    lines.push(`<td ${cellStyle}>${formatCell(lunchSegs)}</td>`);
    lines.push(`<td ${cellStyle}>${formatCell(dinnerSegs)}</td>`);
    lines.push("</tr>");
  }

  lines.push("</table>");

  // Cost summary
  if (includeCosts) {
    const costItems: CostSummaryItem[] = [];
    for (const day of trip.days) {
      for (const seg of day.segments) {
        if (seg.cost) {
          costItems.push({
            category: seg.type,
            description: seg.title,
            amount: seg.cost.amount,
            currency: seg.cost.currency,
            details: seg.cost.details,
            segmentId: seg.id,
          });
        }
      }
    }

    if (costItems.length > 0) {
      lines.push("<h2>Cost Summary</h2>");
      lines.push(
        '<table border="1" style="border-collapse:collapse; width:auto;">',
      );
      lines.push("<tr>");
      for (const hdr of ["Item", "Cost", "Details"]) {
        lines.push(
          `<th style="background-color:#4472C4; color:white; padding:6px 8px; text-align:left;">${hdr}</th>`,
        );
      }
      lines.push("</tr>");

      for (let i = 0; i < costItems.length; i++) {
        const item = costItems[i];
        const bgColor = i % 2 === 0 ? "#ffffff" : "#f2f2f2";
        const cellStyle = `style="padding:6px 8px; background-color:${bgColor};"`;
        lines.push("<tr>");
        lines.push(`<td ${cellStyle}>${esc(item.description)}</td>`);
        lines.push(
          `<td ${cellStyle}>${esc(formatCurrency(item.amount, item.currency))}</td>`,
        );
        lines.push(`<td ${cellStyle}>${esc(item.details || "–")}</td>`);
        lines.push("</tr>");
      }

      lines.push("</table>");

      const totals = sumByCurrency(costItems);
      const totalStr = Object.entries(totals)
        .map(([currency, amount]) => formatCurrency(amount, currency))
        .join(" + ");
      lines.push(`<p><strong>Totals:</strong> ${esc(totalStr)}</p>`);
    }
  }

  // TODOs
  if (includeTodos && trip.todos.length > 0) {
    lines.push("<h2>TODO</h2>");

    for (const todo of trip.todos) {
      const checked = todo.isCompleted
        ? ' data-tag="to-do:completed"'
        : ' data-tag="to-do"';
      const category = todo.category ? ` <em>(${esc(todo.category)})</em>` : "";
      lines.push(`<p${checked}>${esc(todo.text)}${category}</p>`);
    }
  }

  lines.push("</body>");
  lines.push("</html>");

  return lines.join("\n");
}
