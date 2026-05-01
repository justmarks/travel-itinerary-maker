import PDFDocument from "pdfkit";
import type { Trip, Segment, CostSummaryItem } from "@travel-app/shared";
import {
  formatCurrency,
  sumByCurrency,
  formatFlightLabel,
} from "@travel-app/shared";

interface PdfOptions {
  includeCosts?: boolean;
  includeTodos?: boolean;
}

// ─── Text sanitization ───────────────────────────────────────────────────────
//
// PDFKit's built-in Helvetica uses WinAnsi encoding, which supports a limited
// Unicode range. Common glyphs users type (→, ✓, curly quotes) render as
// garbled symbols like `!'` if passed through. Strip or substitute known
// problem glyphs before handing strings to `.text()`.

const SANITIZE_MAP: Record<string, string> = {
  "\u2192": "—", // → right arrow
  "\u2190": "—", // ← left arrow
  "\u2194": "—", // ↔ left-right arrow
  "\u2713": "[x]", // ✓ check
  "\u2714": "[x]", // ✔ heavy check
  "\u2717": "[ ]", // ✗ ballot x
  "\u2718": "[ ]", // ✘ heavy ballot x
  "\u2610": "[ ]", // ☐ empty checkbox
  "\u2611": "[x]", // ☑ checked checkbox
  "\u2612": "[x]", // ☒ crossed checkbox
  "\u2022": "·", // • bullet → middle dot (which IS in WinAnsi)
  "\u2018": "'", // left single quote
  "\u2019": "'", // right single quote
  "\u201c": '"', // left double quote
  "\u201d": '"', // right double quote
  "\u2026": "...", // … horizontal ellipsis
};

export function sanitizeForPdf(s: string): string {
  if (!s) return s;
  return s.replace(/[\u2192\u2190\u2194\u2713\u2714\u2717\u2718\u2610\u2611\u2612\u2022\u2018\u2019\u201c\u201d\u2026]/g, (ch) => SANITIZE_MAP[ch] ?? ch);
}

/**
 * Compose the cost-summary "Item" column text for a single cost row.
 *
 * Mirrors the web UX in apps/web/src/components/trip-costs.tsx:
 *   - `primary`: "{City}: {Category}" when a city is known, else just the
 *     category label. Rendered in bold.
 *   - `subtitle`: the segment title (if it adds information beyond the
 *     category label — i.e. not the exact same string, case-insensitive).
 *     Rendered in muted gray below the primary. Empty when it would just
 *     repeat the category.
 *
 * Exported for unit testing; the PDF renderer uses it inline.
 */
export function formatCostItemDescription(
  item: Pick<CostSummaryItem, "category" | "city" | "description">,
): { primary: string; subtitle: string } {
  const catLabel = SEGMENT_LABELS[item.category] ?? item.category;
  const primary = item.city ? `${item.city}: ${catLabel}` : catLabel;
  const subtitle =
    item.description &&
    item.description.trim().toLowerCase() !== catLabel.toLowerCase()
      ? item.description
      : "";
  return { primary, subtitle };
}

// ─── Segment formatting ──────────────────────────────────────────────────────

const SEGMENT_LABELS: Record<string, string> = {
  flight: "Flight",
  train: "Train",
  car_rental: "Car Rental",
  car_service: "Car Service",
  other_transport: "Transport",
  hotel: "Hotel",
  activity: "Activity",
  restaurant_breakfast: "Breakfast",
  restaurant_brunch: "Brunch",
  restaurant_lunch: "Lunch",
  restaurant_dinner: "Dinner",
  tour: "Tour",
  cruise: "Cruise",
};

function formatSegmentDetails(segment: Segment): string {
  const parts: string[] = [];

  switch (segment.type) {
    case "flight":
    case "train": {
      // em-dash renders reliably in WinAnsi (PDFKit's default encoding for
      // Helvetica); a Unicode arrow (U+2192) does not and prints as garbage.
      const route = [segment.departureCity, segment.arrivalCity]
        .filter(Boolean)
        .join(" — ");
      const carrier = formatFlightLabel(segment);
      parts.push(carrier || segment.title);
      if (route) parts.push(route);
      if (segment.startTime && segment.endTime)
        parts.push(`${segment.startTime}–${segment.endTime}`);
      if (segment.seatNumber) parts.push(`Seat ${segment.seatNumber}`);
      if (segment.cabinClass) parts.push(segment.cabinClass);
      if (segment.confirmationCode) parts.push(`#${segment.confirmationCode}`);
      break;
    }
    case "hotel": {
      parts.push(segment.venueName || segment.title);
      if (segment.address) parts.push(segment.address);
      if (segment.endDate) parts.push(`Check-out: ${segment.endDate}`);
      if (segment.breakfastIncluded) parts.push("Breakfast included");
      if (segment.confirmationCode) parts.push(`#${segment.confirmationCode}`);
      break;
    }
    case "car_rental":
    case "car_service":
    case "other_transport": {
      parts.push(segment.venueName || segment.title);
      if (segment.address) parts.push(segment.address);
      if (segment.startTime) parts.push(segment.startTime);
      if (segment.contactName) parts.push(`Contact: ${segment.contactName}`);
      if (segment.confirmationCode) parts.push(`#${segment.confirmationCode}`);
      break;
    }
    case "restaurant_breakfast":
    case "restaurant_brunch":
    case "restaurant_lunch":
    case "restaurant_dinner": {
      parts.push(segment.venueName || segment.title);
      if (segment.startTime) parts.push(segment.startTime);
      if (segment.partySize) parts.push(`Party of ${segment.partySize}`);
      if (segment.creditCardHold) parts.push("CC hold required");
      if (segment.cancellationDeadline)
        parts.push(`Cancel by: ${segment.cancellationDeadline}`);
      if (segment.phone) parts.push(segment.phone);
      break;
    }
    default: {
      parts.push(segment.venueName || segment.title);
      if (segment.startTime && segment.endTime)
        parts.push(`${segment.startTime}–${segment.endTime}`);
      else if (segment.startTime) parts.push(segment.startTime);
      if (segment.confirmationCode) parts.push(`#${segment.confirmationCode}`);
      break;
    }
  }

  return sanitizeForPdf(parts.join("  ·  "));
}

// ─── Layout helpers ──────────────────────────────────────────────────────────

const PAGE_MARGIN = 50;
const CONTENT_WIDTH = 495; // A4 width (595) - 2 * 50 margin
const HEADER_COLOR = "#1e3a5f";
const ACCENT_COLOR = "#4472C4";
const LIGHT_GRAY = "#f5f5f5";
const MID_GRAY = "#666666";
const SEGMENT_INDENT = 12;

function drawDayHeader(
  doc: InstanceType<typeof PDFDocument>,
  label: string,
): void {
  const y = doc.y;
  doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 22).fill(ACCENT_COLOR);
  doc
    .fillColor("white")
    .fontSize(10)
    .font("Helvetica-Bold")
    .text(label, PAGE_MARGIN + 8, y + 6, { width: CONTENT_WIDTH - 16 });
  doc.fillColor("black");
  doc.y = y + 26;
}

function drawSegmentRow(
  doc: InstanceType<typeof PDFDocument>,
  typeLabel: string,
  details: string,
  costStr: string | null,
  rowIndex: number,
): void {
  // Row grows to fit wrapped text in the tallest column. A fixed row height
  // caused wrapped 2nd lines to paint below the row background and get
  // visually clipped by the following row's zebra stripe.
  const CELL_PAD_Y = 4;
  const labelWidth = 80;
  const costWidth = costStr ? 80 : 0;
  const detailsX = PAGE_MARGIN + SEGMENT_INDENT + labelWidth;
  const detailsWidth =
    CONTENT_WIDTH - SEGMENT_INDENT - labelWidth - costWidth;

  // Measure each column's wrapped height with the font settings we'll
  // actually render with.
  doc.fontSize(8.5).font("Helvetica-Bold");
  const labelH = doc.heightOfString(typeLabel, { width: labelWidth });
  doc.font("Helvetica");
  const detailsH = doc.heightOfString(details, { width: detailsWidth });
  const costH = costStr
    ? doc.heightOfString(costStr, { width: costWidth })
    : 0;

  const rowHeight = Math.max(labelH, detailsH, costH, 10) + CELL_PAD_Y * 2;
  const y = doc.y;
  const bgColor = rowIndex % 2 === 0 ? "white" : LIGHT_GRAY;

  doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, rowHeight).fill(bgColor);

  // Type label (bold, fixed width)
  doc
    .fillColor(HEADER_COLOR)
    .fontSize(8.5)
    .font("Helvetica-Bold")
    .text(typeLabel, PAGE_MARGIN + SEGMENT_INDENT, y + CELL_PAD_Y, {
      width: labelWidth,
      align: "left",
    });

  // Details (may wrap)
  doc
    .fillColor("black")
    .font("Helvetica")
    .text(details, detailsX, y + CELL_PAD_Y, {
      width: detailsWidth,
      align: "left",
    });

  // Cost (right-aligned)
  if (costStr) {
    doc
      .fillColor(MID_GRAY)
      .font("Helvetica")
      .text(costStr, PAGE_MARGIN + CONTENT_WIDTH - costWidth, y + CELL_PAD_Y, {
        width: costWidth,
        align: "right",
      });
  }

  doc.fillColor("black");
  doc.y = y + rowHeight;
  doc.x = PAGE_MARGIN;
}

function ensureSpace(
  doc: InstanceType<typeof PDFDocument>,
  needed: number,
): void {
  const pageBottom = doc.page.height - PAGE_MARGIN;
  if (doc.y + needed > pageBottom) {
    doc.addPage();
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function generateTripPdf(
  trip: Trip,
  options: PdfOptions = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { includeCosts = true, includeTodos = true } = options;

    const doc = new PDFDocument({
      margin: PAGE_MARGIN,
      size: "A4",
      info: {
        Title: trip.title,
        Author: "itinly",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Cover / title ────────────────────────────────────────────────────────
    doc.x = PAGE_MARGIN;
    doc
      .fontSize(26)
      .font("Helvetica-Bold")
      .fillColor(HEADER_COLOR)
      .text(sanitizeForPdf(trip.title), { align: "left" });
    doc.moveDown(0.3);
    doc
      .fontSize(12)
      .font("Helvetica")
      .fillColor(MID_GRAY)
      .text(`${trip.startDate}  —  ${trip.endDate}`, { align: "left" });
    doc.fillColor("black").moveDown(1.2);

    // Horizontal rule
    doc
      .moveTo(PAGE_MARGIN, doc.y)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y)
      .strokeColor("#cccccc")
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.8);

    // ── Itinerary ────────────────────────────────────────────────────────────
    doc.x = PAGE_MARGIN;
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .fillColor(HEADER_COLOR)
      .text("Itinerary", { align: "left" });
    doc.fillColor("black").moveDown(0.5);

    for (const day of trip.days) {
      const segCount = day.segments.length;
      const estimatedHeight = 26 + segCount * 18 + 8;
      ensureSpace(doc, estimatedHeight);

      const dayLabel = sanitizeForPdf(
        `${day.dayOfWeek}  ·  ${day.date}${day.city ? "  —  " + day.city : ""}`,
      );
      drawDayHeader(doc, dayLabel);

      const sorted = [...day.segments].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      sorted.forEach((seg, i) => {
        ensureSpace(doc, 20);
        const typeLabel = SEGMENT_LABELS[seg.type] ?? seg.type;
        const details = formatSegmentDetails(seg);
        const costStr = seg.cost
          ? formatCurrency(seg.cost.amount, seg.cost.currency)
          : null;
        drawSegmentRow(doc, typeLabel, details, costStr, i);
      });

      if (segCount === 0) {
        doc
          .fontSize(8.5)
          .fillColor(MID_GRAY)
          .text("No segments", PAGE_MARGIN + SEGMENT_INDENT, doc.y + 3);
        doc.fillColor("black");
        doc.y += 18;
      }

      doc.moveDown(0.4);
    }

    // ── Cost summary ─────────────────────────────────────────────────────────
    if (includeCosts) {
      const costItems: CostSummaryItem[] = [];
      for (const day of trip.days) {
        for (const seg of day.segments) {
          if (seg.cost) {
            costItems.push({
              category: seg.type,
              description: sanitizeForPdf(seg.title),
              city: seg.city || day.city,
              amount: seg.cost.amount,
              currency: seg.cost.currency,
              details: seg.cost.details
                ? sanitizeForPdf(seg.cost.details)
                : seg.cost.details,
              segmentId: seg.id,
            });
          }
        }
      }

      if (costItems.length > 0) {
        ensureSpace(doc, 60);
        doc.moveDown(0.8);

        doc
          .moveTo(PAGE_MARGIN, doc.y)
          .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y)
          .strokeColor("#cccccc")
          .lineWidth(0.5)
          .stroke();
        doc.moveDown(0.8);

        // Reset x explicitly — the preceding segment row's right-aligned
        // cost column leaves PDFKit's alignment context pinned to "right",
        // which would otherwise cause this heading to stack vertically on
        // the right margin instead of rendering left-aligned.
        doc.x = PAGE_MARGIN;
        doc
          .fontSize(14)
          .font("Helvetica-Bold")
          .fillColor(HEADER_COLOR)
          .text("Cost Summary", { align: "left" });
        doc.fillColor("black").moveDown(0.5);

        // Table header
        const colDesc = 280;
        const colCost = 100;
        const colDetails = CONTENT_WIDTH - colDesc - colCost;
        const headerY = doc.y;
        doc.rect(PAGE_MARGIN, headerY, CONTENT_WIDTH, 18).fill(ACCENT_COLOR);
        doc
          .fillColor("white")
          .fontSize(8.5)
          .font("Helvetica-Bold")
          .text("Item", PAGE_MARGIN + 6, headerY + 4, {
            width: colDesc,
            lineBreak: false,
          })
          .text("Cost", PAGE_MARGIN + colDesc + 6, headerY + 4, {
            width: colCost,
            lineBreak: false,
          })
          .text("Details", PAGE_MARGIN + colDesc + colCost + 6, headerY + 4, {
            width: colDetails,
            lineBreak: false,
          });
        doc.fillColor("black");
        doc.y = headerY + 20;

        // Row padding above and below text inside each cell.
        const CELL_PAD_Y = 4;
        // Vertical gap between the bold primary line and the muted
        // subtitle in the Item column.
        const SUBTITLE_GAP = 1;

        costItems.forEach((item, i) => {
          // The Item column mirrors the web cost card:
          //   Line 1 (bold):   "{City}: {Category}"   e.g. "Palermo: Car Rental"
          //   Line 2 (muted):  seg.title              e.g. "Hertz at CTA airport"
          // See formatCostItemDescription() for the showSubtitle rule.
          const { primary: primaryText, subtitle: subtitleText } =
            formatCostItemDescription(item);
          const costText = formatCurrency(item.amount, item.currency);
          const detailsText = item.details || "—";

          // Measure each column's wrapped height so rows grow to fit the
          // tallest cell. The old fixed 16px row height caused wrapped
          // text to render below the background and spill onto later
          // pages as orphan fragments.
          doc.fontSize(8.5).font("Helvetica-Bold");
          const primaryH = doc.heightOfString(primaryText, {
            width: colDesc - 6,
          });
          doc.font("Helvetica");
          const subtitleH = subtitleText
            ? doc.heightOfString(subtitleText, { width: colDesc - 6 })
            : 0;
          const descH =
            primaryH + (subtitleText ? subtitleH + SUBTITLE_GAP : 0);
          const costH = doc.heightOfString(costText, { width: colCost - 6 });
          const detailsH = doc.heightOfString(detailsText, {
            width: colDetails - 6,
          });
          const rowHeight =
            Math.max(descH, costH, detailsH, 10) + CELL_PAD_Y * 2;

          ensureSpace(doc, rowHeight);
          const rowY = doc.y;
          const bg = i % 2 === 0 ? "white" : LIGHT_GRAY;
          doc.rect(PAGE_MARGIN, rowY, CONTENT_WIDTH, rowHeight).fill(bg);

          // Item column — primary (bold) + optional subtitle (muted)
          doc
            .fillColor("black")
            .fontSize(8.5)
            .font("Helvetica-Bold")
            .text(primaryText, PAGE_MARGIN + 6, rowY + CELL_PAD_Y, {
              width: colDesc - 6,
            });
          if (subtitleText) {
            doc
              .fillColor(MID_GRAY)
              .font("Helvetica")
              .text(
                subtitleText,
                PAGE_MARGIN + 6,
                rowY + CELL_PAD_Y + primaryH + SUBTITLE_GAP,
                { width: colDesc - 6 },
              );
          }

          // Cost column
          doc
            .fillColor("black")
            .font("Helvetica")
            .text(costText, PAGE_MARGIN + colDesc + 6, rowY + CELL_PAD_Y, {
              width: colCost - 6,
            });

          // Details column
          doc
            .fillColor("black")
            .font("Helvetica")
            .text(
              detailsText,
              PAGE_MARGIN + colDesc + colCost + 6,
              rowY + CELL_PAD_Y,
              { width: colDetails - 6 },
            );

          doc.y = rowY + rowHeight;
        });

        // Totals row
        const totals = sumByCurrency(costItems);
        const totalStr = Object.entries(totals)
          .map(([currency, amount]) => formatCurrency(amount, currency))
          .join("  +  ");

        doc.moveDown(0.4);
        doc.x = PAGE_MARGIN;
        doc
          .fontSize(9)
          .font("Helvetica-Bold")
          .fillColor(HEADER_COLOR)
          .text(`Total: ${totalStr}`, PAGE_MARGIN, doc.y, {
            width: CONTENT_WIDTH,
            align: "right",
          });
        doc.fillColor("black");
        doc.x = PAGE_MARGIN;
      }
    }

    // ── TODOs ────────────────────────────────────────────────────────────────
    if (includeTodos && trip.todos.length > 0) {
      ensureSpace(doc, 60);
      doc.moveDown(0.8);

      doc
        .moveTo(PAGE_MARGIN, doc.y)
        .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y)
        .strokeColor("#cccccc")
        .lineWidth(0.5)
        .stroke();
      doc.moveDown(0.8);

      doc.x = PAGE_MARGIN;
      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .fillColor(HEADER_COLOR)
        .text("TODO", { align: "left" });
      doc.fillColor("black").moveDown(0.5);

      const sorted = [...trip.todos].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      for (const todo of sorted) {
        ensureSpace(doc, 16);
        // ☑/☐ are outside WinAnsi and render as garbage in PDFKit's
        // default Helvetica; use ASCII equivalents.
        const check = todo.isCompleted ? "[x]" : "[ ]";
        const category = todo.category
          ? `  (${sanitizeForPdf(todo.category)})`
          : "";
        doc
          .fontSize(9)
          .font("Helvetica")
          .fillColor(todo.isCompleted ? MID_GRAY : "black")
          .text(
            `${check}  ${sanitizeForPdf(todo.text)}${category}`,
            PAGE_MARGIN + 8,
            doc.y,
            { align: "left" },
          );
      }
      doc.fillColor("black");
    }

    doc.end();
  });
}
