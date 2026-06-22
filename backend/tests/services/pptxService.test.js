const AdmZip = require("adm-zip");
const { extractPptxFields } = require("../../src/services/pptxService");

// Helper to create a minimal PPTX buffer with slide XML content
function createPptxBuffer(slides) {
  const zip = new AdmZip();

  // Add minimal required PPTX structure
  zip.addFile(
    "[Content_Types].xml",
    Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
  );

  for (let i = 0; i < slides.length; i++) {
    const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${slides[i]}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;
    zip.addFile(`ppt/slides/slide${i + 1}.xml`, Buffer.from(slideXml));
  }

  return zip.toBuffer();
}

describe("pptxService", () => {
  describe("extractPptxFields", () => {
    test("extracts {{field}} placeholders from slides", async () => {
      const buf = createPptxBuffer(["Hello {{name}}"]);

      const fields = await extractPptxFields(buf);
      expect(fields).toContain("name");
    });

    test("extracts ${field} placeholders from slides", async () => {
      const buf = createPptxBuffer(["Hello ${name}"]);

      const fields = await extractPptxFields(buf);
      expect(fields).toContain("name");
    });

    test("extracts both placeholder syntaxes", async () => {
      const buf = createPptxBuffer(["{{title}} and ${subtitle}"]);

      const fields = await extractPptxFields(buf);
      expect(fields).toContain("title");
      expect(fields).toContain("subtitle");
    });

    test("extracts from multiple slides", async () => {
      const buf = createPptxBuffer(["{{firstName}}", "{{lastName}}"]);

      const fields = await extractPptxFields(buf);
      expect(fields).toContain("firstName");
      expect(fields).toContain("lastName");
    });

    test("deduplicates repeated placeholders", async () => {
      const buf = createPptxBuffer(["{{name}}", "{{name}}"]);

      const fields = await extractPptxFields(buf);
      expect(fields).toEqual(["name"]);
    });

    test("trims whitespace from field names", async () => {
      const buf = createPptxBuffer(["{{ name }}", "${ email }"]);

      const fields = await extractPptxFields(buf);
      expect(fields).toContain("name");
      expect(fields).toContain("email");
    });

    test("returns empty array when no placeholders exist", async () => {
      const buf = createPptxBuffer(["Just plain text"]);

      const fields = await extractPptxFields(buf);
      expect(fields).toEqual([]);
    });

    test("ignores non-slide XML entries", async () => {
      const zip = new AdmZip();
      zip.addFile(
        "[Content_Types].xml",
        Buffer.from('<?xml version="1.0"?><Types></Types>')
      );
      // This should be ignored (slide layout, not a slide)
      zip.addFile(
        "ppt/slideLayouts/slideLayout1.xml",
        Buffer.from("<xml>{{ignored}}</xml>")
      );
      // This is a real slide
      zip.addFile(
        "ppt/slides/slide1.xml",
        Buffer.from("<xml>{{included}}</xml>")
      );

      const fields = await extractPptxFields(zip.toBuffer());
      expect(fields).toContain("included");
      expect(fields).not.toContain("ignored");
    });

    test("extracts multiple placeholders from a single slide", async () => {
      const buf = createPptxBuffer(["{{firstName}} {{lastName}} at {{company}}"]);

      const fields = await extractPptxFields(buf);
      expect(fields).toContain("firstName");
      expect(fields).toContain("lastName");
      expect(fields).toContain("company");
      expect(fields).toHaveLength(3);
    });

    test("throws on invalid buffer", async () => {
      await expect(
        extractPptxFields(Buffer.from("not-a-real-pptx"))
      ).rejects.toThrow("Failed to extract PPTX fields");
    });
  });
});
