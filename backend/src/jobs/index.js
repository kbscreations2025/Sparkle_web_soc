/**
 * Loading this module registers every job handler. The worker requires it once
 * at boot; routes don't need it, since enqueuing only names a type.
 *
 * A new tool joins the queue by adding its handler file and one line here.
 */
require("./cleaning");

module.exports = { CLEANING_JOB: require("./cleaning").CLEANING_JOB };
