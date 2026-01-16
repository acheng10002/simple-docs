/* Mock Supabase Storage client for testing */

const s3 = {
  send: jest.fn(),
};

const PutObjectCommand = jest.fn();
const GetObjectCommand = jest.fn();
const DeleteObjectCommand = jest.fn();
const HeadObjectCommand = jest.fn();

const withPrefix = jest.fn((key) => key);

module.exports = {
  s3,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  withPrefix,
};
