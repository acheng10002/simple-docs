jest.mock("mammoth");
const mammoth = require("mammoth");

const { extractDocxFields } = require("../../src/services/docxService");

describe("docxService", () => {
  describe("extractDocxFields", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test("extracts single placeholder", async () => {
      mammoth.extractRawText.mockResolvedValue({
        value: "Hello {{name}}, welcome!",
      });

      const fields = await extractDocxFields(Buffer.from("fake-docx"));
      expect(fields).toEqual(["name"]);
    });

    test("extracts multiple placeholders", async () => {
      mammoth.extractRawText.mockResolvedValue({
        value: "Dear {{firstName}} {{lastName}}, your order is ready.",
      });

      const fields = await extractDocxFields(Buffer.from("fake-docx"));
      expect(fields).toContain("firstName");
      expect(fields).toContain("lastName");
      expect(fields).toHaveLength(2);
    });

    test("deduplicates repeated placeholders", async () => {
      mammoth.extractRawText.mockResolvedValue({
        value: "{{name}} appears here and {{name}} appears again",
      });

      const fields = await extractDocxFields(Buffer.from("fake-docx"));
      expect(fields).toEqual(["name"]);
    });

    test("handles placeholders with spaces around name", async () => {
      mammoth.extractRawText.mockResolvedValue({
        value: "{{ firstName }} {{ lastName }}",
      });

      const fields = await extractDocxFields(Buffer.from("fake-docx"));
      expect(fields).toContain("firstName");
      expect(fields).toContain("lastName");
    });

    test("handles dotted field names", async () => {
      mammoth.extractRawText.mockResolvedValue({
        value: "{{user.name}} - {{user.email}}",
      });

      const fields = await extractDocxFields(Buffer.from("fake-docx"));
      expect(fields).toContain("user.name");
      expect(fields).toContain("user.email");
    });

    test("returns empty array when no placeholders exist", async () => {
      mammoth.extractRawText.mockResolvedValue({
        value: "No placeholders in this document.",
      });

      const fields = await extractDocxFields(Buffer.from("fake-docx"));
      expect(fields).toEqual([]);
    });

    test("returns empty array for empty text", async () => {
      mammoth.extractRawText.mockResolvedValue({ value: "" });

      const fields = await extractDocxFields(Buffer.from("fake-docx"));
      expect(fields).toEqual([]);
    });

    test("passes buffer to mammoth", async () => {
      mammoth.extractRawText.mockResolvedValue({ value: "{{field}}" });
      const buf = Buffer.from("docx-content");

      await extractDocxFields(buf);

      expect(mammoth.extractRawText).toHaveBeenCalledWith({ buffer: buf });
    });
  });
});
