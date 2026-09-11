const express = require("express");
const mongoose = require("mongoose");
const { requireAuth } = require("../middleware/auth");
const { getQueue, toPublicJob } = require("../queue");
const { logAudit, requestMeta, actorFrom } = require("../auditLog");
const Job = require("../models/job");

const router = express.Router();

router.use(requireAuth);

const LIVE_STATUSES = ["queued", "running"];
const MAX_LIMIT = 100;

/**
 * The caller's own jobs.
 *
 * This is what makes a reload survivable: the page doesn't remember what it
 * had in flight, it asks. Defaults to the live statuses because that is the
 * question a freshly-loaded page is actually asking — "is anything of mine
 * still running?" — while `status=all` serves a fuller queue history.
 *
 * Scoped to `req.dbUser._id` with no override: a job carries the images
 * someone submitted, so there is no "whole team" view here the way there is
 * for finished results in History.
 */
router.get("/", async (req, res) => {
  const { status, tool } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), MAX_LIMIT);

  const query = { userId: req.dbUser._id };
  if (tool) query.tool = tool;

  if (status === "all") {
    // no status clause — everything this person has ever queued
  } else if (typeof status === "string" && status.trim()) {
    query.status = { $in: status.split(",").map((value) => value.trim()).filter(Boolean) };
  } else {
    query.status = { $in: LIVE_STATUSES };
  }

  const jobs = await Job.find(query).sort({ createdAt: -1 }).limit(limit);

  res.json({
    status: "success",
    jobs: jobs.map(toPublicJob),
    // Lets the UI say "2 running" without a second request or counting a
    // truncated page.
    activeCount: await Job.countDocuments({ userId: req.dbUser._id, status: { $in: LIVE_STATUSES } }),
  });
});

router.get("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ status: "error", message: "invalid job id", code: "invalid" });
  }

  const job = await Job.findOne({ _id: req.params.id, userId: req.dbUser._id });
  if (!job) return res.status(404).json({ status: "error", message: "job not found", code: "not_found" });

  res.json({ status: "success", job: toPublicJob(job) });
});

/**
 * Cancels a job that has not started yet.
 *
 * A running job is deliberately refused rather than half-cancelled: the
 * provider call already in flight cannot be recalled, so "cancelled" would be
 * a lie told while the work continues and still bills. Stopping mid-run needs
 * an abort signal threaded down to the provider SDKs, which does not exist yet.
 */
router.delete("/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ status: "error", message: "invalid job id", code: "invalid" });
  }

  const job = await Job.findOne({ _id: req.params.id, userId: req.dbUser._id });
  if (!job) return res.status(404).json({ status: "error", message: "job not found", code: "not_found" });

  if (job.status !== "queued") {
    return res.status(409).json({
      status: "error",
      message:
        job.status === "running"
          ? "this job has already started and can't be cancelled"
          : `this job is already ${job.status}`,
      code: "not_cancellable",
    });
  }

  // Redis first: once it is gone from the queue no worker can pick it up, so
  // the document can't end up saying "cancelled" while a worker runs it anyway.
  try {
    const queued = await getQueue().getJob(String(job._id));
    await queued?.remove();
  } catch (err) {
    console.error(`[jobs] could not remove ${job._id} from the queue:`, err.message);
    return res.status(502).json({
      status: "error",
      message: "could not reach the job queue — try again",
      code: "queue_unavailable",
    });
  }

  job.status = "cancelled";
  job.finishedAt = new Date();
  await job.save();

  logAudit({
    ...actorFrom(req),
    ...requestMeta(req),
    tenantId: job.tenantId,
    action: "job.cancelled",
    status: "success",
    targetType: "job",
    targetId: String(job._id),
    message: `cancelled queued ${job.tool} job`,
    metadata: { tool: job.tool, jobType: job.type },
  });

  res.json({ status: "success", job: toPublicJob(job) });
});

module.exports = router;
