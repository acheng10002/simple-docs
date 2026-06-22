const { PDFDocument, PDFTextField } = require("pdf-lib");
const { extractPdfFields } = require("../../src/services/pdfService");

// Helper to create a PDF with form fields
async function createFormPdfBuffer(fieldNames) {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();

  for (const name of fieldNames) {
    const textField = form.createTextField(name);
    textField.addToPage(page, { x: 50, y: 50, width: 200, height: 20 });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe("pdfService", () => {
  describe("extractPdfFields", () => {
    test("extracts form field names from a fillable PDF", async () => {
      const buf = await createFormPdfBuffer(["name", "email", "phone"]);

      const fields = await extractPdfFields(buf);
      expect(fields).toContain("name");
      expect(fields).toContain("email");
      expect(fields).toContain("phone");
      expect(fields).toHaveLength(3);
    });

    test("extracts single form field", async () => {
      const buf = await createFormPdfBuffer(["customerName"]);

      const fields = await extractPdfFields(buf);
      expect(fields).toEqual(["customerName"]);
    });

test("prefers form fields over text placeholders", async () => {
      // A PDF with form fields should return those, not text placeholders
      const buf = await createFormPdfBuffer(["formField"]);

      const fields = await extractPdfFields(buf);
      expect(fields).toEqual(["formField"]);
    });

    test("throws on invalid buffer", async () => {
      await expect(
        extractPdfFields(Buffer.from("not-a-real-pdf"))
      ).rejects.toThrow("Failed to extract PDF fields");
    });
  });
});
