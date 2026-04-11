import { EmailParser } from "../../src/services/email-parser";

describe("EmailParser.htmlToText", () => {
  it("returns an empty string for empty input", () => {
    expect(EmailParser.htmlToText("")).toBe("");
  });

  it("strips simple tags and keeps the text", () => {
    const html = "<p>Hello <strong>world</strong></p>";
    expect(EmailParser.htmlToText(html)).toBe("Hello world");
  });

  it("drops <script> blocks entirely", () => {
    const html = `
      <html>
        <head><title>t</title></head>
        <body>
          <script>var x = 'secret';</script>
          <p>Booking confirmed</p>
        </body>
      </html>
    `;
    const out = EmailParser.htmlToText(html);
    expect(out).toContain("Booking confirmed");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("var x");
  });

  it("drops <style> blocks entirely", () => {
    const html = "<style>.foo{color:red}</style><p>Hotel</p>";
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("Hotel");
  });

  it("preserves anchor hrefs inline so booking URLs survive", () => {
    const html =
      '<p>Manage your booking at <a href="https://hotel.example/b/abc">this link</a>.</p>';
    const out = EmailParser.htmlToText(html);
    expect(out).toContain("this link (https://hotel.example/b/abc)");
  });

  it("omits the text form when the anchor text equals the href", () => {
    const html = '<a href="https://hotel.example">https://hotel.example</a>';
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("https://hotel.example");
  });

  it("falls back to the href when the anchor has no inner text", () => {
    const html = '<a href="https://hotel.example/image"><img src="x.png"/></a>';
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("https://hotel.example/image");
  });

  it("converts <br> and block closers into newlines", () => {
    const html = "<p>Line 1</p><p>Line 2<br>Line 3</p>";
    const out = EmailParser.htmlToText(html);
    expect(out.split("\n")).toEqual(["Line 1", "Line 2", "Line 3"]);
  });

  it("converts table rows into newlines", () => {
    const html =
      "<table><tr><td>Flight</td><td>BA 52</td></tr><tr><td>Date</td><td>Dec 19</td></tr></table>";
    const out = EmailParser.htmlToText(html);
    expect(out.split("\n")).toEqual(["Flight BA 52", "Date Dec 19"]);
  });

  it("decodes common named entities", () => {
    const html = "<p>Smith &amp; Sons &mdash; &ldquo;luxury&rdquo;</p>";
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("Smith & Sons — “luxury”");
  });

  it("decodes numeric decimal entities", () => {
    const html = "<p>&#8364;100.00</p>";
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("€100.00");
  });

  it("decodes numeric hex entities", () => {
    const html = "<p>&#x20AC;100.00</p>";
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("€100.00");
  });

  it("collapses runs of whitespace inside a line", () => {
    const html = "<p>Hello     world  \n  \t  again</p>";
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("Hello world again");
  });

  it("strips leading/trailing whitespace per line and removes empty lines", () => {
    const html = "<div>   </div><p>real content</p><div>   </div>";
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("real content");
  });

  it("handles a realistic hotel confirmation snippet", () => {
    const html = `
      <html>
        <body>
          <h1>Booking Confirmation</h1>
          <p>Dear guest,</p>
          <p>Your reservation at <strong>Palazzo Natoli</strong> is confirmed.</p>
          <table>
            <tr><td>Check-in</td><td>June 15, 2026</td></tr>
            <tr><td>Check-out</td><td>June 18, 2026</td></tr>
            <tr><td>Confirmation</td><td>ABC123456</td></tr>
            <tr><td>Total</td><td>&euro;540.00</td></tr>
          </table>
          <p>Manage booking: <a href="https://palazzo.example/b/ABC123456">here</a></p>
        </body>
      </html>
    `;
    const out = EmailParser.htmlToText(html);
    expect(out).toContain("Palazzo Natoli");
    expect(out).toContain("Check-in June 15, 2026");
    expect(out).toContain("Check-out June 18, 2026");
    expect(out).toContain("Confirmation ABC123456");
    expect(out).toContain("€540.00");
    expect(out).toContain("here (https://palazzo.example/b/ABC123456)");
  });
});
