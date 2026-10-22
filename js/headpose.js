// Head-angle maths and a movement counter for the optional camera feature.
// Pure: fed angles from the face tracker (or from tests), it decides when a
// head movement went out past a threshold and came back. It counts movements
// it can see; it does not judge technique, range or discomfort.

const deg = (r) => (r * 180) / Math.PI;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Yaw (turning), pitch (nodding) and roll from a 4×4 column-major transform,
// as returned in MediaPipe's facialTransformationMatrixes.
export function anglesFromMatrix(m) {
  const r00 = m[0];
  const r10 = m[1];
  const r20 = m[2];
  const r21 = m[6];
  const r22 = m[10];
  return {
    yaw: deg(Math.asin(clamp(-r20, -1, 1))),
    pitch: deg(Math.atan2(r21, r22)),
    roll: deg(Math.atan2(r10, r00)),
  };
}

// Which angle each illustrated exercise moves.
export const AXIS_FOR_FIGURE = Object.freeze({
  'head-rotate-upright': 'yaw',
  'head-rotate-supine': 'yaw',
  'neck-flexion-upright': 'pitch',
  'neck-extension-supported': 'pitch',
});

// Counts out-and-back movements on one axis.
//   - The first `calibrationSamples` readings set the neutral position, so the
//     phone does not need to be perfectly straight.
//   - A movement "reaches" once it stays beyond `threshold` degrees from
//     neutral for `dwellMs`, and counts as a rep when it returns within
//     `returnBand` degrees.
export class MovementCounter {
  constructor({ threshold = 20, returnBand = 8, dwellMs = 250, smoothing = 0.4, calibrationSamples = 12 } = {}) {
    Object.assign(this, { threshold, returnBand, dwellMs, smoothing, calibrationSamples });
    this.reset();
  }

  reset() {
    this.samples = [];
    this.baseline = null;
    this.value = 0;
    this.state = 'centre';
    this.beyondSince = null;
    this.direction = 0;
    this.reps = 0;
  }

  // Re-take neutral from the next readings (e.g. after the person settles).
  recalibrate() {
    this.reset();
  }

  get calibrated() {
    return this.baseline != null;
  }

  // Fraction of the way to the threshold, for a progress bar.
  get progress() {
    return clamp(Math.abs(this.value) / this.threshold, 0, 1);
  }

  update(angle, t) {
    if (!Number.isFinite(angle)) return [];
    if (this.baseline == null) {
      this.samples.push(angle);
      if (this.samples.length < this.calibrationSamples) return [];
      const sorted = [...this.samples].sort((a, b) => a - b);
      this.baseline = sorted[Math.floor(sorted.length / 2)];
      this.value = 0;
      return ['calibrated'];
    }
    const raw = angle - this.baseline;
    this.value = this.value + this.smoothing * (raw - this.value);
    const mag = Math.abs(this.value);
    if (this.state === 'centre') {
      if (mag < this.threshold) {
        this.beyondSince = null;
        return [];
      }
      if (this.beyondSince == null) this.beyondSince = t;
      if (t - this.beyondSince < this.dwellMs) return [];
      this.state = 'out';
      this.direction = Math.sign(this.value);
      return ['reached'];
    }
    if (mag <= this.returnBand) {
      this.state = 'centre';
      this.beyondSince = null;
      this.reps += 1;
      return ['rep'];
    }
    return [];
  }
}
