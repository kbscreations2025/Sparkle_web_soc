const { registerJobHandler } = require("./registry");
const { runGenerationJob } = require("./generationRunner");
const { buildViewPrompt } = require("../prompts/productViews");
const Generation = require("../models/generation");

const PRODUCT_VIEWS_JOB = "productViews.generate";

/**
 * Product Views (an Image Cleaning card): the standard angles the person had
 * no photo for, one image per angle. Every image gets all their photos,
 * labelled by the angle each one shows, so the views show one piece rather
 * than several interpretations of it.
 */
registerJobHandler(PRODUCT_VIEWS_JOB, (context) =>
  runGenerationJob({
    ...context,
    tool: "cleaning",
    params: {
      mode: "product_views",
      category: context.data.category ?? "ring",
      views: context.data.views,
      // The angle each input photo shows, in input order — so a reopened run
      // puts every photo back in its own box.
      photoViews: context.data.photoViews ?? [],
    },
    buildShots: ({ data }) =>
      data.views.map((viewId) => ({
        viewId,
        prompt: buildViewPrompt({ viewId, photoViews: data.photoViews, notes: data.notes, category: data.category }),
      })),
    /*
     * Which angle each delivered image is, in output order. A failed angle
     * drops out of the outputs, so neither the page nor a reopened thread can
     * assume they line up with what was asked for. Stored on the generation
     * too, since only it outlives the job.
     */
    persist: async ({ saved, delivered }) => {
      const views = delivered.map((shot) => shot.viewId);
      await Generation.updateOne({ _id: saved.generationId }, { $set: { "request.params.outputViews": views } });
      return { views };
    },
  })
);

module.exports = { PRODUCT_VIEWS_JOB };
