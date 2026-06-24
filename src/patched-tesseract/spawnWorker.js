'use strict';

/**
 * Patched spawnWorker for Manifest V3 compliance
 *
 * Removes Blob + importScripts() worker creation pattern, which Chrome
 * flags as "remotely hosted code" in MV3 extensions. Only direct Worker
 * construction is allowed.
 */
module.exports = ({ workerPath }) => {
  // Direct Worker creation only — no Blob/importScripts path
  return new Worker(workerPath);
};
