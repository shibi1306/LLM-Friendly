'use strict';

/**
 * Patched constants/defaultOptions for Manifest V3 compliance
 *
 * Disables workerBlobURL by default — we never want Blob + importScripts
 * worker creation in MV3 extensions.
 */
module.exports = {
  workerBlobURL: false,
  logger: () => {},
};
