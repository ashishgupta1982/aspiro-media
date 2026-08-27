/**
 * Delivery transformations for the common display sizes.
 *
 * Widths are tuned for retina — roughly twice the CSS width they are shown at.
 * Apply with `transformUrl(url, IMAGE_PRESETS.card)`.
 */
export const IMAGE_PRESETS = {
  /** ~96px display: photo strips, avatars, list thumbnails. */
  thumb: 'c_fill,g_auto,w_300,f_auto,q_auto',
  /** ~300px display: cards in a grid. */
  card: 'c_fill,g_auto,w_600,f_auto,q_auto',
  /** ~600px display: cover images and detail heroes. */
  hero: 'c_limit,w_1200,f_auto,q_auto',
  /**
   * Social share cards. Fixed 1200x630 and explicitly f_jpg, NOT f_auto:
   * WhatsApp's iOS scraper is unreliable with WebP and AVIF and will show no
   * preview at all rather than falling back.
   */
  og: 'c_fill,g_auto,w_1200,h_630,f_jpg,q_auto',
};

/**
 * A sized transformation when the named presets do not fit.
 *
 * @param {number} size longest edge in CSS pixels — `dpr_auto` covers retina.
 * @param {'fill'|'fit'} mode 'fill' crops to a square, 'fit' preserves aspect.
 */
export function sizedTransform(size = 96, mode = 'fill') {
  const crop = mode === 'fit' ? 'c_limit' : 'c_fill';
  return `${crop},w_${size},h_${size},q_auto,f_auto,dpr_auto`;
}

/** The upload-time transformation most photo apps want: cap the stored size. */
export const STORE_LIMIT = 'c_limit,w_1600,h_1600,q_auto,f_auto';
