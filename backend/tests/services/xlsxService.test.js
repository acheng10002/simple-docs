const ExcelJS = require("exceljs");
const { extractXlsxFields } = require("../../src/services/xlsxService");

// Helper to create a real XLSX buffer with given cell values
async function createXlsxBuffer(sheets) {
  const workbook = new ExcelJS.Workbook();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(sheetName);
    for (const row of rows) {
      sheet.addRow(row);
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("xlsxService", () => {
  describe("extractXlsxFields", () => {
    test("extracts {{field}} placeholders from cells", async () => {
      const buf = await createXlsxBuffer({
        Sheet1: [["{{name}}", "{{email}}"]],
      });

      const fields = await extractXlsxFields(buf);
      expect(fields).toContain("name");
      expect(fields).toContain("email");
    });

    test("extracts ${field} placeholders from cells", async () => {
      const buf = await createXlsxBuffer({
        Sheet1: [["${company}", "${address}"]],
      });

      const fields = await extractXlsxFields(buf);
      expect(fields).toContain("company");
      expect(fields).toContain("address");
    });

    test("extracts both placeholder syntaxes in same sheet", async () => {
      const buf = await createXlsxBuffer({
        Sheet1: [["{{name}}", "${email}"]],
      });

      const fields = await extractXlsxFields(buf);
      expect(fields).toContain("name");
      expect(fields).toContain("email");
    });

    test("deduplicates repeated placeholders", async () => {
      const buf = await createXlsxBuffer({
        Sheet1: [["{{name}}"], ["{{name}}"], ["{{name}}"]],
      });

      const fields = await extractXlsxFields(buf);
      expect(fields).toEqual(["name"]);
    });

    test("extracts fields from multiple worksheets", async () => {
      const buf = await createXlsxBuffer({
        Sheet1: [["{{firstName}}"]],
        Sheet2: [["{{lastName}}"]],
      });

      const fields = await extractXlsxFields(buf);
      expect(fields).toContain("firstName");
      expect(fields).toContain("lastName");
    });

    test("ignores non-string cells", async () => {
      const buf = await createXlsxBuffer({
        Sheet1: [[42, true, null, "{{name}}"]],
      });

      const fields = await extractXlsxFields(buf);
      expect(fields).toEqual(["name"]);
    });

    test("trims whitespace from field names", async () => {
      const buf = await createXlsxBuffer({
        Sheet1: [["{{ name }}", "${ email }"]],
      });

      const fields = await extractXlsxFields(buf);
      expect(fields).toContain("name");
      expect(fields).toContain("email");
    });

    test("returns empty array when no placeholders exist", async () => {
      const buf = await createXlsxBuffer({
        Sheet1: [["Hello", "World"]],
      });

      const fields = await extractXlsxFields(buf);
      expect(fields).toEqual([]);
    });

    test("extracts multiple placeholders from a single cell", async () => {
      const buf = await createXlsxBuffer({
        Sheet1: [["{{firstName}} {{lastName}}"]],
      });

      const fields = await extractXlsxFields(buf);
      expect(fields).toContain("firstName");
      expect(fields).toContain("lastName");
    });

    test("throws on invalid buffer", async () => {
      await expect(
        extractXlsxFields(Buffer.from("not-a-real-xlsx"))
      ).rejects.toThrow("Failed to extract XLSX fields");
    });
  });
});
