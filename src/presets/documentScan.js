/**
 * Make a photographed document legible.
 *
 * From Tutor App, where parents photograph handwritten exam papers on a phone
 * and the image goes to a model to be marked. Kitchen lighting, shadow across
 * the page and phone-camera noise all cost accuracy, and this is the pipeline
 * that recovers it: cap the size, lift brightness and contrast, denoise,
 * sharpen, drop to greyscale, then encode as progressive JPEG.
 *
 * NOT applied by default anywhere. It is a strong, opinionated transformation —
 * greyscale in particular is right for handwriting and wrong for a recipe photo.
 * Opt in when the subject is a document, and override any of it.
 *
 * @param {object} [settings]
 * @param {number}  [settings.brightness=1.12]  multiplier; 1.12 = +12%
 * @param {number}  [settings.contrast=1.3]     multiplier; 1.3 = +30%
 * @param {number}  [settings.sharpness=1.0]    0 disables sharpening
 * @param {boolean} [settings.noiseReduction=true]
 * @param {boolean} [settings.grayscale=true]
 * @param {number}  [settings.maxWidth=1600]
 * @param {number}  [settings.maxHeight=2000]
 * @param {number}  [settings.quality=85]
 * @returns {Array<object>} a Cloudinary transformation array
 */
export function documentScanTransformations(settings = {}) {
  const {
    brightness = 1.12,
    contrast = 1.3,
    sharpness = 1.0,
    noiseReduction = true,
    grayscale = true,
    maxWidth = 1600,
    maxHeight = 2000,
    quality = 85,
  } = settings;

  const transformations = [{ crop: 'limit', width: maxWidth, height: maxHeight }];

  // Cloudinary takes brightness/contrast as additive -100..100, so a 1.12
  // multiplier becomes +12.
  const brightnessAdjustment = Math.round((brightness - 1) * 100);
  if (brightnessAdjustment !== 0) transformations.push({ effect: `brightness:${brightnessAdjustment}` });

  const contrastAdjustment = Math.round((contrast - 1) * 100);
  if (contrastAdjustment !== 0) transformations.push({ effect: `contrast:${contrastAdjustment}` });

  if (noiseReduction) transformations.push({ effect: 'denoise' });
  if (sharpness > 0) transformations.push({ effect: 'sharpen' });
  if (grayscale) transformations.push({ effect: 'grayscale' });

  transformations.push({ fetch_format: 'jpg', quality, flags: 'progressive' });

  return transformations;
}

/**
 * The same pipeline as a URL-string transformation, for signing or delivery.
 *
 * `denoise` is dropped here deliberately: it has no string form Cloudinary
 * accepts in a delivery URL, and including it produces a 400.
 */
export function documentScanString(settings = {}) {
  return documentScanTransformations(settings)
    .map((t) => {
      if (t.crop && t.width && t.height) return `c_${t.crop},w_${t.width},h_${t.height}`;
      if (t.effect) return t.effect === 'denoise' ? null : `e_${t.effect}`;
      if (t.fetch_format) return `f_${t.fetch_format},q_${t.quality},fl_${t.flags}`;
      return null;
    })
    .filter(Boolean)
    .join('/');
}
