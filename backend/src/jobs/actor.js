const { loadTenantOrThrow } = require("../aiRouting");
const User = require("../models/user");

/**
 * The person who queued a job, and their organization — what every handler
 * loads before it does anything else.
 *
 * The worker has no request context, so the actor is re-loaded from the job.
 * `.lean()` is deliberately NOT used: recordGeneration reads `user.name`/
 * `user.email` and passes `user._id` straight into other documents.
 */
async function loadJobActor(job) {
  const dbUser = await User.findById(job.userId);
  if (!dbUser) throw new Error("the user who queued this job no longer exists");
  return { dbUser, tenant: await loadTenantOrThrow(dbUser) };
}

module.exports = { loadJobActor };
