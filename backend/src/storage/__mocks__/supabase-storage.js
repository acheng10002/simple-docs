/* Mock Supabase Storage client for testing */

const s3 = {
  send: jest.fn(),
};

// Mock S3 command classes that capture constructor input
function PutObjectCommand(input) {
  this.input = input;
}
PutObjectCommand.prototype = {};

function GetObjectCommand(input) {
  this.input = input;
}
GetObjectCommand.prototype = {};

function DeleteObjectCommand(input) {
  this.input = input;
}
DeleteObjectCommand.prototype = {};

function HeadObjectCommand(input) {
  this.input = input;
}
HeadObjectCommand.prototype = {};

const withPrefix = jest.fn((key) => key);

module.exports = {
  s3,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  withPrefix,
};
