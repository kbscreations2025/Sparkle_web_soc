/**
 * How a result is saved again after this app has changed some of its pixels:
 * the white-background clean-up, the colour correction, a Replacement
 * composite, a Product Background. Everything else is stored exactly as the
 * model returned it, byte for byte.
 *
 * As close to the model's own output as each format allows, because image
 * quality is the product here. PNG and WebP are written losslessly. JPEG is
 * written at quality 100 with full colour resolution (4:4:4).
 *
 * Measured on a clean source: one save at quality 95 moved 3–4% of colour
 * values by more than 3 levels, with some pixels off by 12–20, mostly along
 * metal edges and fine detail, which is exactly where jewellery photos live.
 * Quality 100 with 4:4:4 moved 0.02%, none by more than 4. The cost is file
 * size, about twice that of quality 95, and only these re-saved results pay it.
 *
 * `image` is a sharp instance holding the final pixels; `mimeType` is the
 * format to write. Returns `{ buffer, mimeType }`.
 */
async function encodeOutput(image, mimeType) {
  if (/png/i.test(mimeType)) {
    return { buffer: await image.png({ compressionLevel: 8 }).toBuffer(), mimeType: "image/png" };
  }
  if (/webp/i.test(mimeType)) {
    return { buffer: await image.webp({ lossless: true }).toBuffer(), mimeType: "image/webp" };
  }
  return {
    buffer: await image.jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer(),
    mimeType: "image/jpeg",
  };
}

module.exports = { encodeOutput };
