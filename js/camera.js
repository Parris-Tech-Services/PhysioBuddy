// Optional on-device camera rep counter. Loads MediaPipe's face landmarker
// only when the person switches the feature on; frames never leave the
// phone. Turns head angles into MovementCounter events.
import { anglesFromMatrix, MovementCounter } from './headpose.js';

const VENDOR = new URL('../vendor/', import.meta.url);
let landmarkerPromise = null;

async function createLandmarker(delegate) {
  const { FilesetResolver, FaceLandmarker } = await import(new URL('mediapipe/vision_bundle.mjs', VENDOR).href);
  const fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe/wasm', VENDOR).href);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL('models/face_landmarker.task', VENDOR).href, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
  });
}

// One shared landmarker per page; GPU first, CPU if the GPU path fails.
function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = createLandmarker('GPU').catch(() => createLandmarker('CPU'));
    landmarkerPromise.catch(() => (landmarkerPromise = null));
  }
  return landmarkerPromise;
}

const FRAME_MS = 66;
const NO_FACE_FRAMES = 12;

// Status values: 'starting' | 'loading' | 'calibrating' | 'tracking' |
// 'no-face' | 'blocked' | 'no-camera' | 'error' | 'off'
export class CameraTracker {
  constructor({ video, axis, onUpdate, onEvent, onStatus }) {
    Object.assign(this, { video, axis, onUpdate, onEvent, onStatus });
    this.counter = new MovementCounter();
    this.stream = null;
    this.raf = 0;
    this.lastFrame = 0;
    this.missed = 0;
    this.status = 'off';
  }

  setStatus(status, message = '') {
    if (status === this.status) return;
    this.status = status;
    this.onStatus(status, message);
  }

  setAxis(axis) {
    if (axis === this.axis) return;
    this.axis = axis;
    this.counter.reset();
    this.setStatus('calibrating');
  }

  recalibrate() {
    this.counter.recalibrate();
    this.setStatus('calibrating');
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.setStatus('no-camera', 'This browser cannot use the camera.');
      return;
    }
    this.setStatus('starting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (err) {
      const blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      this.setStatus(blocked ? 'blocked' : 'no-camera', blocked ? 'Camera permission is off. Allow the camera for this site in Chrome settings.' : 'No front camera was found.');
      return;
    }
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play().catch(() => {});
    this.setStatus('loading');
    let landmarker;
    try {
      landmarker = await getLandmarker();
    } catch {
      this.setStatus('error', 'The movement tracker could not load on this device. The buttons still work.');
      this.stop(false);
      return;
    }
    if (!this.stream) return;
    this.counter.reset();
    this.setStatus('calibrating');
    const loop = (t) => {
      if (!this.stream) return;
      this.raf = requestAnimationFrame(loop);
      if (t - this.lastFrame < FRAME_MS || this.video.readyState < 2) return;
      this.lastFrame = t;
      this.processFrame(landmarker, t);
    };
    this.raf = requestAnimationFrame(loop);
  }

  processFrame(landmarker, t) {
    let result;
    try {
      result = landmarker.detectForVideo(this.video, t);
    } catch {
      return;
    }
    const matrix = result.facialTransformationMatrixes && result.facialTransformationMatrixes[0];
    if (!matrix) {
      this.missed += 1;
      if (this.missed >= NO_FACE_FRAMES) this.setStatus('no-face');
      return;
    }
    this.missed = 0;
    const angle = anglesFromMatrix(matrix.data)[this.axis];
    const events = this.counter.update(angle, t);
    this.setStatus(this.counter.calibrated ? 'tracking' : 'calibrating');
    this.onUpdate({ value: this.counter.value, progress: this.counter.progress, calibrated: this.counter.calibrated });
    for (const e of events) this.onEvent(e);
  }

  stop(report = true) {
    cancelAnimationFrame(this.raf);
    if (this.stream) for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    if (report) this.setStatus('off');
  }
}
