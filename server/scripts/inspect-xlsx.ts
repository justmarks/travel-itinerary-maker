/**
 * Ad-hoc inspector for real-world XLSX itinerary workbooks. Not part of the
 * build — run manually with:
 *
 *     cd server && pnpm ts-node scripts/inspect-xlsx.ts <path>
 */
import ExcelJS from "exceljs";
import { XlsxTripImporter } from "../src/services/xlsx-importer";

async function main() {
  const [, , ...paths] = process.argv;
  if (paths.length === 0) {
    console.error("usage: ts-node scripts/inspect-xlsx.ts <file.xlsx> [<file.xlsx> ...]");
    process.exit(1);
  }

  for (const path of paths) {
    console.log(`\n===== ${path} =====`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    console.log(`Sheets: ${workbook.worksheets.map((s) => s.name).join(" | ")}`);

    for (const sheet of workbook.worksheets) {
      console.log(`\n--- Sheet: "${sheet.name}" (rows=${sheet.rowCount}, cols=${sheet.columnCount}) ---`);
      const maxRows = Math.min(sheet.rowCount, 40);
      for (let r = 1; r <= maxRows; r++) {
        const row = sheet.getRow(r);
        const cells: string[] = [];
        for (let c = 1; c <= Math.min(sheet.columnCount, 8); c++) {
          const cell = row.getCell(c);
          const value = cell.value;
          let display: string;
          if (cell.type === ExcelJS.ValueType.Merge) display = "<merge>";
          else if (value === null || value === undefined) display = "";
          else if (value instanceof Date) display = `Date(${value.toISOString()})`;
          else if (typeof value === "object" && "richText" in value) {
            display = `RT[${(value as { richText: { text: string }[] }).richText.map((x) => x.text).join("")}]`;
          } else if (typeof value === "number") {
            display = `num(${value})`;
          } else {
            display = String(value);
          }
          cells.push(`${String.fromCharCode(64 + c)}=${display.slice(0, 50)}`);
        }
        console.log(`  R${r}: ${cells.join(" | ")}`);
      }
    }

    console.log("\n--- Parser output ---");
    try {
      const importer = new XlsxTripImporter();
      const buffer = await workbook.xlsx.writeBuffer();
      const parsed = await importer.parseWorkbook(Buffer.from(buffer));
      console.log(`  title=${parsed.title}  start=${parsed.startDate}  end=${parsed.endDate}`);
      console.log(`  days=${parsed.days.length}  costs=${parsed.costs.length}`);
      for (const day of parsed.days.slice(0, 5)) {
        console.log(`  [${day.date} ${day.dayOfWeek}] city=${day.city}  segs=${day.segments.length}`);
      }
    } catch (err) {
      console.error(`  PARSER ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
