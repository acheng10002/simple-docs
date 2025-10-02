/* *** PATH.JS GIVES CONSISTENT FOLDERS FOR UPLOADS/OUTPUTS 
*** CENTRALIZED FILESYSTEM PATHS
- constants for uploads/ and outputs/ relative to project root
- used by both the templateUploadHandler.js and merge.service.js to read/write files 
- Node's path utilities */
const path = require("path");

// this file is at the root
const PROJECT_ROOT = path.resolve(__dirname);

// centralized absolute path for uploads directory
const UPLOADS_DIR = path.join(PROJECT_ROOT, "uploads");
// centralized absolute path for outputs directory
const OUTPUTS_DIR = path.join(PROJECT_ROOT, "outputs");

module.exports = { PROJECT_ROOT, UPLOADS_DIR, OUTPUTS_DIR };
