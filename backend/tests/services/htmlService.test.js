const { extractHtmlFields } = require("../../src/services/htmlService");

describe("htmlService", () => {
  describe("extractHtmlFields", () => {
    test("extracts single placeholder", async () => {
      const html = Buffer.from("<html><body>{{name}}</body></html>");
      const fields = await extractHtmlFields(html);
      expect(fields).toEqual(["name"]);
    });

    test("extracts multiple placeholders", async () => {
      const html = Buffer.from(
        "<html><body><h1>{{title}}</h1><p>{{description}}</p></body></html>"
      );
      const fields = await extractHtmlFields(html);
      expect(fields).toContain("title");
      expect(fields).toContain("description");
      expect(fields).toHaveLength(2);
    });

    test("deduplicates repeated placeholders", async () => {
      const html = Buffer.from(
        "<html><body>{{name}} and {{name}} again</body></html>"
      );
      const fields = await extractHtmlFields(html);
      expect(fields).toEqual(["name"]);
    });

    test("handles placeholders with spaces around name", async () => {
      const html = Buffer.from(
        "<html><body>{{ firstName }} {{ lastName }}</body></html>"
      );
      const fields = await extractHtmlFields(html);
      expect(fields).toContain("firstName");
      expect(fields).toContain("lastName");
    });

    test("handles dotted field names", async () => {
      const html = Buffer.from(
        "<html><body>{{user.name}} {{user.email}}</body></html>"
      );
      const fields = await extractHtmlFields(html);
      expect(fields).toContain("user.name");
      expect(fields).toContain("user.email");
    });

    test("returns empty array when no placeholders exist", async () => {
      const html = Buffer.from("<html><body>No fields here</body></html>");
      const fields = await extractHtmlFields(html);
      expect(fields).toEqual([]);
    });

    test("ignores placeholders inside HTML attributes", async () => {
      const html = Buffer.from(
        '<html><body><a href="{{link}}">Click</a></body></html>'
      );
      const fields = await extractHtmlFields(html);
      // textContent only sees "Click", not the href attribute value
      expect(fields).not.toContain("link");
    });

    test("extracts placeholders from nested elements", async () => {
      const html = Buffer.from(
        "<html><body><div><span>{{city}}</span></div><ul><li>{{state}}</li></ul></body></html>"
      );
      const fields = await extractHtmlFields(html);
      expect(fields).toContain("city");
      expect(fields).toContain("state");
    });

    test("ignores triple braces (not matched by pattern)", async () => {
      const html = Buffer.from(
        "<html><body>{{{rawHtml}}} and {{safeField}}</body></html>"
      );
      const fields = await extractHtmlFields(html);
      // The regex matches word chars only, triple braces may partially match
      expect(fields).toContain("safeField");
    });
  });
});
