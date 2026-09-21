const config = require("../config");

/**
 * Which queue a job type runs on.
 *
 * Deliberately separate from `jobs/registry.js`: a route has to know the lane
 * in order to enqueue, and requiring the registry would pull every handler —
 * and every provider SDK behind them — into the API process, which exists to
 * answer HTTP and never runs a job.
 *
 * Almost everything belongs on `default`. A type earns its own lane only when
 * its runtime is so unlike the rest that sharing worker slots would starve
 * them: today that is video and nothing else. Anything absent here is
 * `default`, so a new tool joins the queue without touching this file.
 */
const LANES = {
  default: {
    name: config.queue.name,
    concurrency: config.queue.concurrency,
    lockDuration: config.queue.lockDurationMs,
  },
  video: {
    name: config.queue.videoName,
    concurrency: config.queue.videoConcurrency,
    lockDuration: config.queue.videoLockDurationMs,
  },
};

const LANE_BY_TYPE = {
  "imageToVideo.generate": "video",
};

const LANE_IDS = Object.keys(LANES);

function laneFor(type) {
  return LANE_BY_TYPE[type] || "default";
}

function laneConfig(laneId) {
  const lane = LANES[laneId];
  if (!lane) throw new Error(`unknown queue lane "${laneId}"`);
  return lane;
}

module.exports = { LANE_IDS, laneFor, laneConfig };
