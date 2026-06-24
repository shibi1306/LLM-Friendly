'use strict';

/**
 * Patched browser defaultOptions for Manifest V3 compliance
 *
 * Removes the CDN-based default workerPath, which Chrome flags as
 * remotely hosted code. The extension always provides local paths
 * explicitly in the createWorker call.
 *
 * NOTE: Uses a module-level require (not relative) so webpack resolves
 * it through resolve.alias to our patched constants defaultOptions.
 */
const defaultOptions = require('tesseract.js/src/constants/defaultOptions');

module.exports = {
  ...defaultOptions,
  workerPath: undefined, // Must be provided by caller via createWorker options
};
