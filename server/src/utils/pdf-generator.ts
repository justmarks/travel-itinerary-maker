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

  return parts.join("  ·  ");
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
  const y = doc.y;
  const rowHeight = 18;
  const bgColor = rowIndex % 2 === 0 ? "white" : LIGHT_GRAY;

  doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, rowHeight).fill(bgColor);

  // Type label (bold, fixed width)
  const labelWidth = 80;
  doc
    .fillColor(HEADER_COLOR)
    .fontSize(8.5)
    .font("Helvetica-Bold")
    .text(typeLabel, PAGE_MARGIN + SEGMENT_INDENT, y + 4, {
      width: labelWidth,
      lineBreak: false,
    });

  // Details
  const detailsX = PAGE_MARGIN + SEGMENT_INDENT + labelWidth;
  const costWidth = costStr ? 80 : 0;
  const detailsWidth = CONTENT_WIDTH - SEGMENT_INDENT - labelWidth - costWidth;
  doc
    .fillColor("black")
    .font("Helvetica")
    .text(details, detailsX, y + 4, {
      width: detailsWidth,
      lineBreak: false,
      ellipsis: true,
    });

  // Cost (right-aligned)
  if (costStr) {
    doc
      .fillColor(MID_GRAY)
      .font("Helvetica")
      .text(costStr, PAGE_MARGIN + CONTENT_WIDTH - costWidth, y + 4, {
        width: costWidth,
        lineBreak: false,
        align: "right",
      });
  }

  doc.fillColor("black");
  doc.y = y + rowHeight;
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
        Author: "Travel Itinerary Maker",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Cover / title ────────────────────────────────────────────────────────
    doc
      .fontSize(26)
      .font("Helvetica-Bold")
      .fillColor(HEADER_COLOR)
      .text(trip.title, { align: "left" });
    doc.moveDown(0.3);
    doc
      .fontSize(12)
      .font("Helvetica")
      .fillColor(MID_GRAY)
      .text(`${trip.startDate}  —  ${trip.endDate}`);
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
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .fillColor(HEADER_COLOR)
      .text("Itinerary");
    doc.fillColor("black").moveDown(0.5);

    for (const day of trip.days) {
      const segCount = day.segments.length;
      const estimatedHeight = 26 + segCount * 18 + 8;
      ensureSpace(doc, estimatedHeight);

      const dayLabel = `${day.dayOfWeek}  ·  ${day.date}${day.city ? "  —  " + day.city : ""}`;
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
              description: seg.title,
              city: seg.city || day.city,
              amount: seg.cost.amount,
              currency: seg.cost.currency,
              details: seg.cost.details,
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

        doc
          .fontSize(14)
          .font("Helvetica-Bold")
          .fillColor(HEADER_COLOR)
          .text("Cost Summary");
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

        costItems.forEach((item, i) => {
          // Measure each column's wrapped height so rows grow to fit the
          // tallest cell. The old fixed 16px row height caused wrapped
          // text to render below the background and spill onto later
          // pages as orphan fragments.
          doc.fontSize(8.5).font("Helvetica");
          const descText = item.description;
          const costText = formatCurrency(item.amount, item.currency);
          const detailsText = item.details || "—";
          const descH = doc.heightOfString(descText, { width: colDesc - 6 });
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
          doc
            .fillColor("black")
            .fontSize(8.5)
            .font("Helvetica")
            .text(descText, PAGE_MARGIN + 6, rowY + CELL_PAD_Y, {
              width: colDesc - 6,
            })
            .text(
              costText,
              PAGE_MARGIN + colDesc + 6,
              rowY + CELL_PAD_Y,
              { width: colCost - 6 },
            )
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
        doc
          .fontSize(9)
          .font("Helvetica-Bold")
          .fillColor(HEADER_COLOR)
          .text(`Total: ${totalStr}`, { align: "right" });
        doc.fillColor("black");
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

      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .fillColor(HEADER_COLOR)
        .text("TODO");
      doc.fillColor("black").moveDown(0.5);

      const sorted = [...trip.todos].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      for (const todo of sorted) {
        ensureSpace(doc, 16);
        const check = todo.isCompleted ? "☑" : "☐";
        const category = todo.category ? `  (${todo.category})` : "";
        doc
          .fontSize(9)
          .font("Helvetica")
          .fillColor(todo.isCompleted ? MID_GRAY : "black")
          .text(
            `${check}  ${todo.text}${category}`,
            PAGE_MARGIN + 8,
            doc.y,
          );
      }
      doc.fillColor("black");
    }

    doc.end();
  });
}
