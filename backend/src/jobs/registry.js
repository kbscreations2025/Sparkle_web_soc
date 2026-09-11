/**
 * The map from a job's `type` to the function that runs it.
 *
 * This is the seam that keeps one queue serving every tool. A route never
 * names a worker and a worker never names a route: the route enqueues a type,
 * the worker looks that type up here. Adding a tool to the queue means writing
 * a handler and registering it — no change to the queue, the worker, the Job
 * model or the /api/jobs endpoints.
 *
 * A handler is `async ({ job, data, setProgress }) => result`:
 *   - `job`      the Mongo Job document (ownership, request metadata)
 *   - `data`     the BullMQ payload, which is where image bytes travel
 *   - `setProgress(percent)` reports progress to both Mongo and the client
 *   - `result`   is stored on the Job and pushed to the client; keep it small
 *                (ids and urls), never image bytes.
 */
const handlers = new Map();

function registerJobHandler(type, handler) {
  if (handlers.has(type)) {
    // Two handlers for one type means one of them silently never runs, which
    // is far harder to notice later than a crash at boot.
    throw new Error(`a job handler is already registered for "${type}"`);
  }
  handlers.set(type, handler);
}

function getJobHandler(type) {
  const handler = handlers.get(type);
  if (!handler) throw new Error(`no job handler registered for "${type}"`);
  return handler;
}

function registeredTypes() {
  return [...handlers.keys()];
}

module.exports = { registerJobHandler, getJobHandler, registeredTypes };
