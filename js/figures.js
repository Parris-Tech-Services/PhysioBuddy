// Exercise illustrations. Each figure is data: a view, props and keyframe
// poses. Renderers turn a pose into SVG; the player interpolates keyframes
// for the animated demonstration. Colours come from CSS custom properties so
// the figures follow light and dark mode.

const L = { torso: 70, neck: 14, head: 18, upperArm: 40, forearm: 38, thigh: 54, shin: 52 };
const rad = (d) => (d * Math.PI) / 180;
const dir = (deg) => [Math.cos(rad(deg)), Math.sin(rad(deg))];
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
const lerp = (a, b, t) => a + (b - a) * t;
const f = (n) => Math.round(n * 10) / 10;

// Two-link inverse kinematics: elbow/knee position reaching `target` from
// `root`. `bend` picks the solution whose joint is highest ('up'), lowest
// ('down'), furthest right ('fwd') or left ('back').
export function solveTwoLink(root, target, a, b, bend) {
  const dx = target[0] - root[0];
  const dy = target[1] - root[1];
  const d = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(a - b) + 0.5), a + b - 0.01);
  const base = Math.atan2(dy, dx);
  const alpha = Math.acos((a * a + d * d - b * b) / (2 * a * d));
  const options = [base + alpha, base - alpha].map((ang) => [root[0] + Math.cos(ang) * a, root[1] + Math.sin(ang) * a]);
  const pick = { up: (p) => -p[1], down: (p) => p[1], fwd: (p) => p[0], back: (p) => -p[0] }[bend] || ((p) => -p[1]);
  const joint = pick(options[0]) >= pick(options[1]) ? options[0] : options[1];
  const toT = Math.atan2(target[1] - joint[1], target[0] - joint[0]);
  return { joint, end: [joint[0] + Math.cos(toT) * b, joint[1] + Math.sin(toT) * b] };
}

// Side-view skeleton from absolute segment angles (degrees, SVG convention:
// 0 = right, 90 = down). Arms/legs use angles or an IK target.
export function sideSkeleton(pose) {
  const P = pose.pelvis;
  const S = add(P, dir(pose.torso), L.torso);
  const N = add(S, dir(pose.neck), L.neck);
  let H = add(N, dir(pose.neck), L.head);
  if (pose.retract) H = add(H, dir(pose.face), -pose.retract);
  const face = pose.face;
  let E;
  let W;
  const handTarget = pose.handAt === 'occiput' ? add(add(H, dir(face), -15), dir(face + 90), 8) : pose.handAt;
  if (handTarget) ({ joint: E, end: W } = solveTwoLink(S, handTarget, L.upperArm, L.forearm, pose.armBend || 'down'));
  else {
    E = add(S, dir(pose.upperArm), L.upperArm);
    W = add(E, dir(pose.forearm), L.forearm);
  }
  let K;
  let F;
  if (pose.footAt) ({ joint: K, end: F } = solveTwoLink(P, pose.footAt, L.thigh, L.shin, pose.legBend || 'up'));
  else {
    K = add(P, dir(pose.thigh), L.thigh);
    F = add(K, dir(pose.shin), L.shin);
  }
  return { P, S, N, H, E, W, K, F, face, nose: add(H, dir(face), L.head) };
}

function seg(a, b, cls) {
  return `<line class="${cls}" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"/>`;
}

function sideBody(pose, focus, cls = '') {
  const k = sideSkeleton(pose);
  const on = (area) => (focus.includes(area) ? ' focus' : '');
  const eye = add(add(k.H, dir(k.face), 8), dir(k.face - 90), 5);
  const chin = add(add(k.H, dir(k.face), 12), dir(k.face + 90), 12);
  // Hands behind the head are drawn see-through on top so the support
  // position stays visible without hiding the face.
  const armBehind = pose.handAt === 'occiput';
  const arm = `${seg(k.S, k.E, 'limb arm' + on('shoulders'))}${seg(k.E, k.W, 'limb arm' + on('shoulders'))}<circle class="hand${pose.handAt ? ' hand-cue' : ''}" cx="${f(k.W[0])}" cy="${f(k.W[1])}" r="6"/>`;
  return `<g class="body ${cls}">
    ${seg(k.P, k.K, 'limb' + on('legs'))}${seg(k.K, k.F, 'limb' + on('legs'))}
    ${seg(k.P, k.S, 'trunk' + on('back'))}
    ${seg(k.S, k.N, 'neck' + on('neck'))}
    ${armBehind ? '' : arm}
    <circle class="head" cx="${f(k.H[0])}" cy="${f(k.H[1])}" r="${L.head}"/>
    <circle class="nose" cx="${f(k.nose[0])}" cy="${f(k.nose[1])}" r="4.5"/>
    <circle class="chin" cx="${f(chin[0])}" cy="${f(chin[1])}" r="5"/>
    <circle class="eye" cx="${f(eye[0])}" cy="${f(eye[1])}" r="2.4"/>
    ${armBehind ? `<g class="behind">${arm}</g>` : ''}
  </g>`;
}

// Front view of head and shoulders; `turn` -1..1, positive = turning to the
// person's left (the viewer's right).
function frontHead(pose, focus, cls = '') {
  const t = pose.turn;
  const cx = 160 + t * 4;
  const rx = 34 - Math.abs(t) * 4;
  const leftEarOpacity = 1 - Math.max(0, -t);
  const rightEarOpacity = 1 - Math.max(0, t);
  const eyeL = cx - 12 + t * 18;
  const eyeR = cx + 12 + t * 18;
  const nose = cx + t * 24;
  return `<g class="body ${cls}">
    <path class="trunk-fill" d="M62 236 Q70 176 160 168 Q250 176 258 236 Z"/>
    <rect class="neck-fill${focus.includes('neck') ? ' focus' : ''}" x="141" y="118" width="38" height="60" rx="14"/>
    <ellipse class="ear" cx="${f(126 + t * 12)}" cy="98" rx="7" ry="11" opacity="${f(leftEarOpacity)}"/>
    <ellipse class="ear" cx="${f(194 + t * 12)}" cy="98" rx="7" ry="11" opacity="${f(rightEarOpacity)}"/>
    <ellipse class="head" cx="${f(cx)}" cy="94" rx="${f(rx)}" ry="40"/>
    <path class="hair" d="M${f(cx - rx)} 86 Q${f(cx - rx + 4 + t * 6)} 50 ${f(cx + t * 8)} 54 Q${f(cx + rx - 4 + t * 6)} 50 ${f(cx + rx)} 86 Q${f(cx + t * 10)} 66 ${f(cx - rx)} 86 Z"/>
    <circle class="eye" cx="${f(eyeL)}" cy="92" r="3.2" opacity="${f(1 - Math.max(0, -t) * 0.7)}"/>
    <circle class="eye" cx="${f(eyeR)}" cy="92" r="3.2" opacity="${f(1 - Math.max(0, t) * 0.7)}"/>
    <path class="feature" d="M${f(nose)} 96 L${f(nose + t * 8)} 108 L${f(nose - 3 + t * 3)} 110"/>
    <path class="feature" d="M${f(cx - 7 + t * 20)} 120 Q${f(cx + t * 21)} 125 ${f(cx + 7 + t * 20)} 120"/>
  </g>`;
}

// Supine knee rolling, viewed from the feet end.
function kneesEnd(pose, focus, cls = '') {
  const a = pose.roll;
  return `<g class="body ${cls}">
    <circle class="head" cx="160" cy="132" r="20" opacity="0.55"/>
    <ellipse class="trunk-fill${focus.includes('back') ? ' focus' : ''}" cx="160" cy="176" rx="62" ry="20"/>
    <g transform="rotate(${f(a)} 160 196)">
      <path class="limb" d="M138 186 L148 108 L146 196"/>
      <path class="limb" d="M182 186 L172 108 L174 196"/>
      <circle class="knee" cx="148" cy="108" r="9"/><circle class="knee" cx="172" cy="108" r="9"/>
    </g>
  </g>`;
}

// Doorway stretch, viewed from above.
function doorwayTop(pose, focus, cls = '') {
  const y = pose.y;
  const sx = [114, 206];
  return `<g class="body ${cls}">
    <ellipse class="foot" cx="146" cy="${f(y + 44)}" rx="9" ry="15"/><ellipse class="foot" cx="174" cy="${f(y + 34 - pose.step)}" rx="9" ry="15"/>
    <path class="limb arm${focus.includes('chest') ? ' focus' : ''}" d="M${sx[0]} ${f(y + 6)} L78 102"/>
    <path class="limb arm${focus.includes('chest') ? ' focus' : ''}" d="M${sx[1]} ${f(y + 6)} L242 102"/>
    <circle class="hand hand-cue" cx="78" cy="102" r="7"/><circle class="hand hand-cue" cx="242" cy="102" r="7"/>
    <ellipse class="trunk-fill${focus.includes('chest') ? ' focus' : ''}" cx="160" cy="${f(y + 6)}" rx="50" ry="17"/>
    <circle class="head" cx="160" cy="${f(y - 4)}" r="19"/>
    <circle class="nose" cx="160" cy="${f(y - 24)}" r="4.5"/>
  </g>`;
}

const RENDERERS = { side: sideBody, front: frontHead, knees: kneesEnd, doorway: doorwayTop };

const PROPS = {
  floor: (y = 206) => `<line class="floor" x1="0" y1="${y}" x2="320" y2="${y}"/>`,
  mat: (y = 206) => `<rect class="mat" x="18" y="${y}" width="284" height="8" rx="4"/>`,
  pillow: (x, y) => `<ellipse class="pillow" cx="${x}" cy="${y}" rx="28" ry="9"/>`,
  pillowFront: () => '<ellipse class="pillow" cx="160" cy="96" rx="78" ry="58"/><rect class="mat" x="22" y="40" width="276" height="200" rx="18" opacity="0.35"/>',
  wall: (x) => `<rect class="wall" x="${x}" y="-20" width="14" height="270"/>`,
  mirror: (x) => `<rect class="mirror" x="${x}" y="0" width="26" height="150" rx="6"/><line class="mirror-shine" x1="${x + 7}" y1="22" x2="${x + 14}" y2="12"/><line class="mirror-shine" x1="${x + 7}" y1="40" x2="${x + 18}" y2="26"/>`,
  doorway: () => '<rect class="wall" x="0" y="94" width="72" height="16"/><rect class="wall" x="248" y="94" width="72" height="16"/><rect class="door-post" x="66" y="88" width="14" height="28" rx="3"/><rect class="door-post" x="240" y="88" width="14" height="28" rx="3"/>',
};

const up = { pelvis: [150, 132], torso: -90, neck: -90, face: 0, upperArm: 95, forearm: 88, thigh: 92, shin: 90 };
const supine = { pelvis: [178, 190], torso: 180, neck: 190, face: -90, upperArm: 2, forearm: -2, footAt: [262, 193], legBend: 'up' };
const pose = (base, extra) => ({ ...base, ...extra });
const UPPER = '58 -14 210 168';
const SUPINE_NECK = '26 138 170 78';

export const FIGURES = {
  'head-rotate-upright': {
    view: 'front', viewBox: '40 20 240 230', focus: ['neck'], caption: 'Front view',
    sides: { left: { turn: 1 }, right: { turn: -1 } }, neutral: { turn: 0 },
  },
  'head-rotate-supine': {
    view: 'front', viewBox: '20 20 280 230', focus: ['neck'], caption: 'Lying on your back — view from above', props: [PROPS.pillowFront()],
    sides: { left: { turn: 1 }, right: { turn: -1 } }, neutral: { turn: 0 },
  },
  'neck-flexion-upright': {
    view: 'side', viewBox: UPPER, focus: ['neck'], caption: 'Side view', track: 'nose',
    keys: [pose(up, {}), pose(up, { neck: -52, face: 58 })],
  },
  'neck-extension-supported': {
    view: 'side', viewBox: UPPER, focus: ['neck'], caption: 'Side view — fingers support the back of the head', track: 'nose',
    keys: [pose(up, { handAt: 'occiput', armBend: 'fwd' }), pose(up, { neck: -110, face: -42, handAt: 'occiput', armBend: 'fwd' })],
  },
  'posture-mirror': {
    view: 'side', viewBox: '40 -14 260 260', focus: ['neck'], caption: 'Side view — using a mirror', props: [PROPS.floor(240), PROPS.mirror(236)], track: 'nose',
    keys: [pose(up, { torso: -86, neck: -52, face: 14 }), pose(up, {})],
  },
  'chin-tuck-supine': {
    view: 'side', viewBox: SUPINE_NECK, focus: ['neck'], caption: 'Lying on your back — side view', props: [PROPS.mat(202), PROPS.pillow(64, 198)], track: 'nose',
    keys: [pose(supine, {}), pose(supine, { face: -66, retract: 3 })],
  },
  'retraction-supine': {
    view: 'side', viewBox: SUPINE_NECK, focus: ['neck'], caption: 'Lying on your back — side view', props: [PROPS.mat(202), PROPS.pillow(64, 198)], track: 'nose',
    keys: [pose(supine, {}), pose(supine, { face: -84, retract: 8 })],
  },
  'extension-supine': {
    view: 'side', viewBox: SUPINE_NECK, focus: ['neck'], caption: 'Lying on your back — side view', props: [PROPS.mat(202), PROPS.pillow(64, 198)], track: 'nose',
    keys: [pose(supine, {}), pose(supine, { face: -128, neck: 182 })],
  },
  'knee-rolling': {
    view: 'knees', viewBox: '20 60 280 170', focus: ['back'], caption: 'Lying on your back — view from your feet', props: [PROPS.mat(204)],
    sides: { left: { roll: 38 }, right: { roll: -38 } }, neutral: { roll: 0 },
  },
  'wall-stretch': {
    view: 'side', viewBox: '40 -40 250 290', focus: ['shoulders', 'back'], caption: 'Side view — facing the wall', props: [PROPS.floor(240), PROPS.wall(206)], track: 'hand',
    keys: [pose(up, { handAt: [204, 74], armBend: 'down' }), pose(up, { torso: -86, neck: -88, handAt: [203, -6], armBend: 'down' })],
  },
  'doorway-stretch': {
    view: 'doorway', viewBox: '20 40 280 200', focus: ['chest'], caption: 'View from above — forearms on the door frame', props: [PROPS.doorway()], track: 'head',
    keys: [{ y: 168, step: 0 }, { y: 140, step: 14 }],
  },
  'childs-pose': {
    view: 'side', viewBox: '40 4 260 216', focus: ['back'], caption: 'Side view', props: [PROPS.mat(204)], track: 'shoulder',
    keys: [
      { pelvis: [122, 162], torso: -84, neck: -86, face: 0, thigh: 36, shin: 180, handAt: [150, 170], armBend: 'back' },
      { pelvis: [118, 168], torso: 6, neck: 0, face: 80, thigh: 30, shin: 180, handAt: [262, 194], armBend: 'up' },
    ],
  },
  'prone-press-up': {
    view: 'side', viewBox: '20 80 290 140', focus: ['back'], caption: 'Lying on your stomach — side view', props: [PROPS.mat(204)], track: 'shoulder',
    keys: [
      { pelvis: [132, 194], torso: 0, neck: 0, face: 62, thigh: 180, shin: 180, handAt: [226, 200], armBend: 'up' },
      { pelvis: [132, 194], torso: -40, neck: -32, face: 10, thigh: 180, shin: 180, handAt: [226, 200], armBend: 'back' },
    ],
  },
};

function interpolate(a, b, t) {
  const out = {};
  for (const key of Object.keys(b)) {
    const va = a[key];
    const vb = b[key];
    if (typeof vb === 'number') out[key] = lerp(va ?? vb, vb, t);
    else if (Array.isArray(vb) && Array.isArray(va)) out[key] = [lerp(va[0], vb[0], t), lerp(va[1], vb[1], t)];
    else out[key] = t < 0.5 ? va ?? vb : vb;
  }
  return out;
}

// Ordered keyframes for a figure; side-to-side figures can be limited to the
// side currently being exercised.
export function keyframes(fig, side = null) {
  if (fig.keys) return fig.keys;
  const order = side ? [side] : ['left', 'right'];
  return order.flatMap((s) => [fig.neutral, fig.sides[s]]);
}

function trackPoint(fig, p) {
  if (fig.view === 'doorway') return [160, p.y - 4];
  if (fig.view !== 'side') return null;
  const k = sideSkeleton(p);
  return { nose: k.nose, head: k.H, hand: k.W, shoulder: k.S }[fig.track] || null;
}

function arrowPath(fig, from, to) {
  if (fig.view === 'front') return frontArrows(from, to);
  if (fig.view === 'knees') return kneeArrows(to);
  const a = trackPoint(fig, from);
  const b = trackPoint(fig, to);
  if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) < 6) return '';
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const nx = -(b[1] - a[1]);
  const ny = b[0] - a[0];
  const n = Math.hypot(nx, ny) || 1;
  const bow = 14;
  const c = [mx + (nx / n) * bow, my + (ny / n) * bow];
  return `<path class="arrow" marker-end="url(#ah)" d="M${f(a[0])} ${f(a[1])} Q${f(c[0])} ${f(c[1])} ${f(b[0])} ${f(b[1])}"/>`;
}

function frontArrows(from, to) {
  const dirs = to.turn > 0 ? [1] : to.turn < 0 ? [-1] : [1, -1];
  return dirs.map((d) => `<path class="arrow" marker-end="url(#ah)" d="M${160 + d * 14} 34 Q${160 + d * 46} 26 ${160 + d * 70} 52"/>`).join('');
}

function kneeArrows(to) {
  const dirs = to.roll < 0 ? [-1] : to.roll > 0 ? [1] : [1, -1];
  return dirs.map((d) => `<path class="arrow" marker-end="url(#ah)" d="M${160 + d * 18} 88 Q${160 + d * 60} 86 ${160 + d * 86} 130"/>`).join('');
}

const DEFS = '<defs><marker id="ah" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path class="arrow-head" d="M0 0 L10 5 L0 10 z"/></marker></defs>';

export function poseSvg(fig, p, cls) {
  return RENDERERS[fig.view](p, fig.focus, cls);
}

// Static figure: faint start pose, solid end pose and the movement arrow.
export function renderDiagram(figId, { side = null, label = '' } = {}) {
  const fig = FIGURES[figId];
  if (!fig) return null;
  const keys = keyframes(fig, side);
  const start = keys[0];
  const end = keys[1];
  return wrap(fig, `${poseSvg(fig, start, 'ghost')}${poseSvg(fig, end, '')}${arrowPath(fig, start, end)}`, label);
}

// Two panels, "Start" and "End".
export function renderPictures(figId, { side = null } = {}) {
  const fig = FIGURES[figId];
  if (!fig) return null;
  const keys = keyframes(fig, side);
  return `<div class="fig-pair"><figure>${wrap(fig, poseSvg(fig, keys[0], ''), 'Start position')}<figcaption>Start</figcaption></figure><figure>${wrap(fig, poseSvg(fig, keys[1], '') + arrowPath(fig, keys[0], keys[1]), 'End position')}<figcaption>End</figcaption></figure></div>`;
}

function wrap(fig, inner, label) {
  return `<svg class="figure" viewBox="${fig.viewBox}" role="img" aria-label="${label || fig.caption}">${DEFS}${(fig.props || []).join('')}${inner}</svg>`;
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// Pose at time `ms` in a looping timeline: move 1.4 s between keyframes and
// pause 0.9 s on each.
export function poseAt(fig, ms, side = null) {
  const keys = keyframes(fig, side);
  const loop = fig.keys ? [...keys, ...keys.slice(1, -1).reverse()] : keys;
  const move = 1400;
  const rest = 900;
  const step = move + rest;
  const n = loop.length;
  // rAF timestamps can be slightly earlier than the mount time, so clamp.
  const tt = Math.max(0, ms) % (step * n);
  const i = Math.floor(tt / step);
  const within = tt - i * step;
  const a = loop[i];
  const b = loop[(i + 1) % n];
  return within < rest ? a : interpolate(a, b, ease((within - rest) / move));
}

// Mounts an animated demonstration. Returns a controller; `stop()` cancels
// the animation frame loop. Respects reduced-motion by drawing the diagram.
export function mountFigure(el, figId, { mode = 'animated', side = null, reducedMotion = false } = {}) {
  const fig = FIGURES[figId];
  if (!fig) {
    el.innerHTML = '';
    return { stop() {} };
  }
  if (mode === 'pictures') {
    el.innerHTML = renderPictures(figId, { side });
    return { stop() {} };
  }
  if (mode === 'diagram' || reducedMotion) {
    el.innerHTML = renderDiagram(figId, { side });
    return { stop() {} };
  }
  const keys = keyframes(fig, side);
  el.innerHTML = wrap(fig, `${poseSvg(fig, keys[0], 'ghost')}${arrowPath(fig, keys[0], keys[1])}<g class="live"></g>`, `${fig.caption}, animated`);
  const live = el.querySelector('.live');
  let raf = 0;
  const t0 = performance.now();
  let last = -Infinity;
  // ~30 fps is smooth for these slow movements and halves battery use.
  const frame = (t) => {
    if (!el.isConnected) return;
    if (t - last >= 32) {
      last = t;
      live.innerHTML = poseSvg(fig, poseAt(fig, t - t0, side), '');
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { stop: () => cancelAnimationFrame(raf) };
}
