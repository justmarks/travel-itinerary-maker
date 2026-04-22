import type { Trip, Segment, CostSummaryItem } from "../types/trip";
import { formatCurrency, sumByCurrency } from "./currency";
import { formatFlightLabel } from "./segments";

/** Get the itinerary table column value for a segment */
function formatSegmentForTable(segment: Segment): string {
  const parts: string[] = [];

  switch (segment.type) {
    case "flight":
    case "train": {
      const route = [segment.departureCity, segment.arrivalCity]
        .filter(Boolean)
        .join(" → ");
      const carrier = formatFlightLabel(segment);
      parts.push(carrier || segment.title);
      if (route) parts.push(route);
      if (segment.startTime && segment.endTime)
        parts.push(`${segment.startTime}-${segment.endTime}`);
      if (segment.confirmationCode) parts.push(`\`${segment.confirmationCode}\``);
      break;
    }
    case "hotel":
    case "car_rental":
    case "car_service":
    case "other_transport": {
      const name = segment.url
        ? `[${segment.venueName || segment.title}](${segment.url})`
        : segment.venueName || segment.title;
      parts.push(name);
      if (segment.address) parts.push(segment.address);
      if (segment.confirmationCode) parts.push(`\`${segment.confirmationCode}\``);
      break;
    }
    case "restaurant_lunch":
    case "restaurant_dinner": {
      const rName = segment.url
        ? `[${segment.venueName || segment.title}](${segment.url})`
        : segment.venueName || segment.title;
      parts.push(rName);
      if (segment.startTime) parts.push(segment.startTime);
      if (segment.partySize) parts.push(`(${segment.partySize})`);
      if (segment.creditCardHold) parts.push("CC");
      break;
    }
    case "activity":
    case "tour":
    case "cruise":
    case "show":
    default: {
      const aName = segment.url
        ? `[${segment.venueName || segment.title}](${segment.url})`
        : segment.venueName || segment.title;
      parts.push(aName);
      if (segment.startTime) parts.push(segment.startTime);
      if (segment.confirmationCode) parts.push(`\`${segment.confirmationCode}\``);
      break;
    }
  }

  return parts.join(" ");
}

function getSegmentsByType(segments: Segment[], types: string[]): Segment[] {
  return segments
    .filter((s) => types.includes(s.type))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

interface ExportOptions {
  includeCosts?: boolean;
  includeTodos?: boolean;
}

/** Generate a markdown representation of a trip */
export function tripToMarkdown(trip: Trip, options: ExportOptions = {}): string {
  const { includeCosts = true, includeTodos = true } = options;
  const lines: string[] = [];

  lines.push(`# ${trip.title}`);
  lines.push(`**${trip.startDate} to ${trip.endDate}**`);
  lines.push("");

  // Itinerary table
  lines.push("## Itinerary");
  lines.push("");
  lines.push(
    "| City | Day | Date | Transport | Lodging | Activities | Lunch | Dinner |",
  );
  lines.push(
    "|------|-----|------|-----------|---------|------------|-------|--------|",
  );

  for (const day of trip.days) {
    const transport = getSegmentsByType(day.segments, [
      "flight",
      "train",
      "car_rental",
      "car_service",
      "other_transport",
    ])
      .map(formatSegmentForTable)
      .join("<br>");

    const lodging = getSegmentsByType(day.segments, ["hotel"])
      .map(formatSegmentForTable)
      .join("<br>");

    const activities = getSegmentsByType(day.segments, [
      "activity",
      "tour",
      "cruise",
      "show",
    ])
      .map(formatSegmentForTable)
      .join("<br>");

    const lunch = getSegmentsByType(day.segments, ["restaurant_lunch"])
      .map(formatSegmentForTable)
      .join("<br>");

    const dinner = getSegmentsByType(day.segments, ["restaurant_dinner"])
      .map(formatSegmentForTable)
      .join("<br>");

    lines.push(
      `| ${day.city} | ${day.dayOfWeek} | ${day.date} | ${transport || "-"} | ${lodging || "-"} | ${activities || "-"} | ${lunch || "-"} | ${dinner || "-"} |`,
    );
  }

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
      lines.push("");
      lines.push("## Cost Summary");
      lines.push("");
      lines.push("| Item | Cost | Details |");
      lines.push("|------|------|---------|");

      for (const item of costItems) {
        lines.push(
          `| ${item.description} | ${formatCurrency(item.amount, item.currency)} | ${item.details || "-"} |`,
        );
      }

      const totals = sumByCurrency(costItems);
      lines.push("");
      lines.push(
        "**Totals:** " +
          Object.entries(totals)
            .map(([currency, amount]) => formatCurrency(amount, currency))
            .join(" + "),
      );
    }
  }

  // TODOs
  if (includeTodos && trip.todos.length > 0) {
    lines.push("");
    lines.push("## TODO");
    lines.push("");

    for (const todo of trip.todos) {
      const checkbox = todo.isCompleted ? "[x]" : "[ ]";
      const category = todo.category ? ` *(${todo.category})*` : "";
      lines.push(`- ${checkbox} ${todo.text}${category}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
