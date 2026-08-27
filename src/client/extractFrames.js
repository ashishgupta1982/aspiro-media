/**
 * Pull still frames out of a video, in the browser.
 *
 * Extracted from RunCoach's gait analysis, where the frames are what actually
 * get sent to the model. Kept because almost none of this is about running: the
 * awkward parts are seeking reliably across browsers, knowing when a video is
 * genuinely ready to draw, and not hanging forever when it never becomes ready.
 * Any app that wants stills out of an uploaded video needs all of that.
 *
 * Requires the video to be CORS-readable — Cloudinary delivery URLs are, but a
 * canvas drawn from a tainted source throws on `toBlob`.
 *
 * @param {string} videoUrl
 * @param {object} [options]
 * @param {number} [options.count=25]       maximum frames to capture
 * @param {number} [options.interval=0.1]   seconds between frames
 * @param {number} [options.maxDuration=5]  only look at the first N seconds
 * @param {number} [options.maxDimension=1280] longest edge of each frame
 * @param {number} [options.quality=0.85]   JPEG quality
 * @param {number} [options.loadTimeoutMs=30000] give up if the video never
 *   reports its metadata — see the note on the timer below
 * @param {Function} [options.onProgress]   (done, total) => void
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Array<{file: File, timestamp: string, index: number}>>}
 */
export function extractFrames(videoUrl, {
  count = 25,
  interval = 0.1,
  maxDuration = 5,
  maxDimension = 1280,
  quality = 0.85,
  loadTimeoutMs = 30000,
  onProgress,
  signal,
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Aborted'));

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous'; // required before src, for canvas access
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    let settled = false;
    let metadataSeen = false;
    // Declared up here, not at the setTimeout below: cleanup() closes over it,
    // and a const assigned later would put it in the temporal dead zone for any
    // failure path that runs before then.
    let loadTimer;
    const fail = (error) => { if (!settled) { settled = true; cleanup(); reject(error); } };
    const done = (value) => { if (!settled) { settled = true; cleanup(); resolve(value); } };

    const onAbort = () => fail(new Error('Aborted'));
    signal?.addEventListener('abort', onAbort);

    function cleanup() {
      clearTimeout(loadTimer);
      signal?.removeEventListener('abort', onAbort);
      video.removeAttribute('src');
      try { video.load(); } catch { /* already torn down */ }
    }

    video.addEventListener('error', () => {
      const err = video.error;
      fail(new Error(err ? `Video error (code ${err.code})` : 'Failed to load video'));
    });

    // A video that never loads fires NEITHER 'loadedmetadata' NOR 'error', and
    // without this the promise simply never settles. It is not hypothetical:
    // frames are usually pulled from a Cloudinary URL immediately after upload,
    // and the transcode may not have finished, so the file is briefly not there
    // to load. The per-seek timeouts inside cannot help — they only start once
    // metadata has arrived.
    loadTimer = setTimeout(() => {
      if (!metadataSeen) {
        fail(new Error('Video loading timed out — it may still be processing. Please try again.'));
      }
    }, loadTimeoutMs);

    video.addEventListener('loadedmetadata', async () => {
      metadataSeen = true;
      clearTimeout(loadTimer);
      try {
        // readyState 3 (HAVE_FUTURE_DATA) means we can seek and draw. Some
        // browsers reach it before 'canplay' fires, so check first and only
        // then wait — otherwise the listener never fires and we hang.
        if (video.readyState < 3) {
          await new Promise((ready, notReady) => {
            const timer = setTimeout(() => {
              video.removeEventListener('canplay', onCanPlay);
              // HAVE_CURRENT_DATA is enough to draw a single frame; accept it
              // rather than failing outright on a slow connection.
              if (video.readyState >= 2) ready();
              else notReady(new Error('Video never became ready to seek'));
            }, 15000);
            const onCanPlay = () => { clearTimeout(timer); video.removeEventListener('canplay', onCanPlay); ready(); };
            video.addEventListener('canplay', onCanPlay);
          });
        }

        const duration = video.duration;
        if (!duration || Number.isNaN(duration) || duration <= 0) {
          return fail(new Error('Video has no usable duration'));
        }

        const window_ = Math.min(duration, maxDuration);
        const timestamps = [];
        for (let i = 0; i < count; i += 1) {
          const t = i * interval;
          if (t >= window_ - 0.02) break;
          timestamps.push(Math.min(t, window_ - 0.01));
        }

        let width = video.videoWidth || 1280;
        let height = video.videoHeight || 720;
        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        if (!width || !height) return fail(new Error('Video has no usable dimensions'));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        const frames = [];

        for (let i = 0; i < timestamps.length; i += 1) {
          if (signal?.aborted) return fail(new Error('Aborted'));
          const timestamp = timestamps[i];

          // eslint-disable-next-line no-await-in-loop
          await new Promise((seeked) => {
            const timer = setTimeout(() => {
              video.removeEventListener('seeked', onSeeked);
              seeked(); // skip this frame rather than failing the whole run
            }, 8000);

            function onSeeked() {
              clearTimeout(timer);
              video.removeEventListener('seeked', onSeeked);
              try {
                ctx.drawImage(video, 0, 0, width, height);
                canvas.toBlob((blob) => {
                  if (blob) {
                    frames.push({
                      file: new File([blob], `frame-${i + 1}.jpg`, { type: 'image/jpeg' }),
                      timestamp: `${timestamp.toFixed(1)}s`,
                      index: i,
                    });
                  }
                  onProgress?.(i + 1, timestamps.length);
                  seeked();
                }, 'image/jpeg', quality);
              } catch {
                seeked(); // tainted canvas or a transient decode failure
              }
            }

            video.addEventListener('seeked', onSeeked);
            // Seeking to where we already are fires no 'seeked' event.
            if (Math.abs(video.currentTime - timestamp) < 0.01) onSeeked();
            else video.currentTime = timestamp;
          });
        }

        if (frames.length === 0) return fail(new Error('No frames could be captured'));
        done(frames);
      } catch (error) {
        fail(error);
      }
    });

    video.src = videoUrl;
  });
}
