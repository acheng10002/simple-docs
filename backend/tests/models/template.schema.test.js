/* Template schema tests - verifies new defaultOutputType and outputNameFormat fields */

jest.mock("../../src/storage/supabase-storage", () => require("../../__mocks__/s3"));

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

describe("Template Schema - defaultOutputType and outputNameFormat", () => {
  let testTemplate;

  beforeAll(async () => {
    // Clean up any existing test data
    await prisma.template.deleteMany({
      where: {
        displayName: {
          startsWith: 'TEST_SCHEMA_'
        }
      }
    });
  });

  afterAll(async () => {
    // Clean up test data
    if (testTemplate) {
      await prisma.template.delete({ where: { id: testTemplate.id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  test("should create template without defaultOutputType and outputNameFormat (fields are nullable)", async () => {
    const template = await prisma.template.create({
      data: {
        displayName: 'TEST_SCHEMA_nullable',
        storageKey: 'test-key-1',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }
    });

    expect(template.defaultOutputType).toBeNull();
    expect(template.outputNameFormat).toBeNull();

    await prisma.template.delete({ where: { id: template.id } });
  });

  test("should create template with defaultOutputType", async () => {
    const template = await prisma.template.create({
      data: {
        displayName: 'TEST_SCHEMA_with_output_type',
        storageKey: 'test-key-2',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        defaultOutputType: 'pdf'
      }
    });

    expect(template.defaultOutputType).toBe('pdf');
    expect(template.outputNameFormat).toBeNull();

    await prisma.template.delete({ where: { id: template.id } });
  });

  test("should create template with outputNameFormat", async () => {
    const template = await prisma.template.create({
      data: {
        displayName: 'TEST_SCHEMA_with_name_format',
        storageKey: 'test-key-3',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        outputNameFormat: 'invoiceNumber'
      }
    });

    expect(template.defaultOutputType).toBeNull();
    expect(template.outputNameFormat).toBe('invoiceNumber');

    await prisma.template.delete({ where: { id: template.id } });
  });

  test("should create template with both defaultOutputType and outputNameFormat", async () => {
    testTemplate = await prisma.template.create({
      data: {
        displayName: 'TEST_SCHEMA_with_both',
        storageKey: 'test-key-4',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        defaultOutputType: 'docx',
        outputNameFormat: 'customerName'
      }
    });

    expect(testTemplate.defaultOutputType).toBe('docx');
    expect(testTemplate.outputNameFormat).toBe('customerName');
  });

  test("should update defaultOutputType on existing template", async () => {
    const updated = await prisma.template.update({
      where: { id: testTemplate.id },
      data: { defaultOutputType: 'pdf' }
    });

    expect(updated.defaultOutputType).toBe('pdf');
    expect(updated.outputNameFormat).toBe('customerName'); // Should remain unchanged
  });

  test("should update outputNameFormat on existing template", async () => {
    const updated = await prisma.template.update({
      where: { id: testTemplate.id },
      data: { outputNameFormat: 'firstName' }
    });

    expect(updated.defaultOutputType).toBe('pdf'); // Should remain unchanged
    expect(updated.outputNameFormat).toBe('firstName');
  });

  test("should accept all valid OutputType enum values", async () => {
    const validOutputTypes = ['docx', 'html', 'pdf', 'xlsx', 'pptx', 'ppsx', 'jpg'];

    for (const outputType of validOutputTypes) {
      const template = await prisma.template.create({
        data: {
          displayName: `TEST_SCHEMA_output_${outputType}`,
          storageKey: `test-key-output-${outputType}`,
          mimeType: 'application/pdf',
          defaultOutputType: outputType
        }
      });

      expect(template.defaultOutputType).toBe(outputType);

      await prisma.template.delete({ where: { id: template.id } });
    }
  });

  test("should set defaultOutputType to null when updating with null", async () => {
    const updated = await prisma.template.update({
      where: { id: testTemplate.id },
      data: { defaultOutputType: null }
    });

    expect(updated.defaultOutputType).toBeNull();
  });

  test("should set outputNameFormat to null when updating with null", async () => {
    const updated = await prisma.template.update({
      where: { id: testTemplate.id },
      data: { outputNameFormat: null }
    });

    expect(updated.outputNameFormat).toBeNull();
  });
});
