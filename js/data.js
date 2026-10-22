// Clinician-prescribed programmes, transcribed from the Activate Physiotherapy
// (Nookal) summaries John Robins emailed. This module is the single authority
// for prescribed doses: the session engine, voice coach and library all read
// from here. Doses that the summaries do not state are `null` and must stay
// null until John confirms them — never fill them in with "typical" values.

export const CLINICIAN = Object.freeze({
  name: 'John Robins',
  practice: 'Activate Physiotherapy, Dubbo NSW',
});

// Trusted public reading. Links only — the app does not paraphrase them.
export const READING = Object.freeze([
  { area: 'neck', title: 'Neck pain', url: 'https://www.healthdirect.gov.au/amp/article/neck-pain', source: 'healthdirect (Australian Government)' },
  { area: 'headaches', title: 'Headaches', url: 'https://www.healthdirect.gov.au/headaches', source: 'healthdirect (Australian Government)' },
  { area: 'headaches', title: 'Tension headache', url: 'https://www.healthdirect.gov.au/tension-headache', source: 'healthdirect (Australian Government)' },
  { area: 'back', title: 'Low back pain', url: 'https://www.healthdirect.gov.au/low-back-pain', source: 'healthdirect (Australian Government)' },
]);

// Body areas used to organise the Exercise Library.
export const AREAS = Object.freeze({
  neck: 'Neck',
  headaches: 'Headaches',
  back: 'Back',
  shoulders: 'Shoulders',
  chest: 'Chest',
  posture: 'Posture',
});

// Library exercises. `figure` names an illustration in figures.js; an exercise
// whose technique is not described well enough to draw sets `figure: null` and
// carries a clarification flag instead of an improvised picture.
export const EXERCISES = Object.freeze({
  'active-cervical-rotation': {
    name: 'Active neck rotation',
    clinicalName: 'Active cervical rotation',
    areas: ['neck'],
    figure: 'head-rotate-upright',
    start: 'Sit or stand tall, looking straight ahead.',
    movement: 'Turn your head slowly to the left, back to the middle, then to the right.',
    end: 'Looking over each shoulder, only as far as 4–5/10 discomfort.',
    target: 'Neck — turning (rotation).',
    hands: null,
  },
  'passive-rotation-hold': {
    name: 'Rotation hold',
    clinicalName: 'Passive rotation hold',
    areas: ['neck'],
    figure: 'head-rotate-upright',
    start: 'Sit or stand tall, looking straight ahead.',
    movement: 'Turn your head to one side and hold it there, then repeat to the other side.',
    end: 'Head turned to the side, held still for the hold time.',
    target: 'Neck — turning (rotation).',
    hands: 'Not specified in the summary — use your hands only as John showed you.',
  },
  'passive-flexion': {
    name: 'Chin to chest',
    clinicalName: 'Passive flexion',
    areas: ['neck'],
    figure: 'neck-flexion-upright',
    start: 'Sit or stand tall, looking straight ahead.',
    movement: 'Bring your chin down towards your chest, then return.',
    end: 'Chin towards chest.',
    target: 'Neck — bending forward (flexion).',
    hands: 'Not specified in the summary — use your hands only as John showed you.',
  },
  'passive-extension': {
    name: 'Supported look up',
    clinicalName: 'Passive extension',
    areas: ['neck'],
    figure: 'neck-extension-supported',
    start: 'Sit or stand tall with your fingers under the back of your head.',
    movement: 'Gently tip your head back to look up, letting your fingers support it, then return.',
    end: 'Looking gently upwards, head supported by your fingers.',
    target: 'Neck — bending backward (extension).',
    hands: 'Fingers under the back of your head to support it.',
  },
  'posture-drill-mirror': {
    name: 'Mirror posture check',
    clinicalName: 'Posture drill',
    areas: ['posture', 'neck'],
    figure: 'posture-mirror',
    start: 'Stand side-on or facing a mirror.',
    movement: 'Use the mirror to bring your head and neck back to a neutral position.',
    end: 'Head balanced over your shoulders — neutral.',
    target: 'Head and neck posture.',
    hands: null,
  },
  'supine-neck-rotation': {
    name: 'Lying neck rotation',
    clinicalName: 'Supine cervical rotation',
    areas: ['neck', 'headaches'],
    figure: 'head-rotate-supine',
    start: 'Lie on your back, looking at the ceiling.',
    movement: 'Turn your head to the end of its range in one direction, then the other.',
    end: 'Head turned to the end of range, held for the hold time.',
    target: 'Neck — turning (rotation).',
    hands: null,
  },
  'chin-tuck': {
    name: 'Chin tuck',
    clinicalName: 'Chin tuck (flexion)',
    areas: ['neck', 'headaches'],
    figure: 'chin-tuck-supine',
    start: 'Lie on your back, looking at the ceiling.',
    movement: 'Gently nod your chin in towards your neck.',
    end: 'Chin tucked in.',
    target: 'Upper neck — nodding (flexion).',
    hands: null,
  },
  'supine-cervical-retraction': {
    name: 'Lying neck retraction',
    clinicalName: 'Supine cervical retraction',
    areas: ['neck', 'headaches'],
    figure: 'retraction-supine',
    start: 'Lie on your back, looking at the ceiling.',
    movement: 'Draw your head straight back, as if making a double chin.',
    end: 'Head drawn back, chin level.',
    target: 'Neck — gliding back (retraction).',
    hands: null,
  },
  'supine-cervical-extension': {
    name: 'Lying neck extension',
    clinicalName: 'Cervical extension in supine',
    areas: ['neck'],
    figure: 'extension-supine',
    start: 'Lie on your back.',
    movement: 'Tip your head back (extension) as John showed you.',
    end: 'Head tipped back.',
    target: 'Neck — bending backward (extension).',
    hands: null,
  },
  'lumbar-rotation-knee-rolling': {
    name: 'Knee rolling',
    clinicalName: 'Lumbar rotation / rolling knees side to side',
    areas: ['back'],
    figure: 'knee-rolling',
    start: 'Lie on your back with your knees bent and feet on the floor.',
    movement: 'Roll both knees together to one side, back to the middle, then to the other side.',
    end: 'Knees lowered to the side.',
    target: 'Lower back — turning (rotation).',
    hands: null,
  },
  'standing-wall-stretch': {
    name: 'Wall stretch, arms overhead',
    clinicalName: 'Standing wall stretch with arms overhead',
    areas: ['shoulders', 'back'],
    figure: 'wall-stretch',
    start: 'Stand facing a wall with your hands on it.',
    movement: 'Reach your arms up the wall overhead, then return.',
    end: 'Arms overhead on the wall.',
    target: 'Shoulders and upper back.',
    hands: 'Hands on the wall.',
  },
  'doorway-pec-stretch': {
    name: 'Doorway chest stretch',
    clinicalName: 'Doorway pectoral stretch',
    areas: ['chest', 'shoulders'],
    figure: 'doorway-stretch',
    start: 'Stand in a doorway with your forearms on the door frame.',
    movement: 'Step gently forward until you feel a stretch across your chest.',
    end: 'Leaning through the doorway, stretch across the chest.',
    target: 'Chest (pectoral muscles).',
    hands: 'Forearms on the door frame.',
  },
  rocking: {
    name: 'Rocking movements',
    clinicalName: 'Rocking movements',
    areas: ['back'],
    figure: null,
    start: null,
    movement: null,
    end: null,
    target: null,
    hands: null,
  },
  'childs-pose': {
    name: "Child's pose",
    clinicalName: "Child's pose",
    areas: ['back'],
    figure: 'childs-pose',
    start: 'Kneel on the floor.',
    movement: 'Sit back towards your heels and reach your arms forward along the floor.',
    end: 'Resting forward, arms reaching ahead.',
    target: 'Lower back.',
    hands: 'Hands on the floor in front of you.',
  },
  'prone-press-up': {
    name: 'Lying press-up',
    clinicalName: 'Prone lumbar extension / press-up',
    areas: ['back'],
    figure: 'prone-press-up',
    start: 'Lie on your stomach with your hands under your shoulders.',
    movement: 'Push your upper body up with your arms, keeping your hips down, within a comfortable range. Lower back down.',
    end: 'Upper body raised, hips on the floor.',
    target: 'Lower back — bending backward (extension).',
    hands: 'Hands under your shoulders.',
  },
});

// Dose fields:
//   sides        ['left','right'] when the summary counts each side separately
//   reps         repetitions (per side when `sides` is set); null = not stated
//   holdSeconds  hold length; null = no hold stated
//   holdPolicy   'every' | 'last' | 'unclear' | 'none'
//                'unclear' = a hold is prescribed but the summary does not say
//                whether every rep or only one is held; the session offers the
//                hold timer on every rep without requiring it.
//   frequency    free text as prescribed
const dose = (d) => Object.freeze({ sides: null, reps: null, holdSeconds: null, holdPolicy: 'none', frequency: null, ...d });

export const PROGRAMMES = Object.freeze([
  {
    id: 'acute-neck-2026-10-22',
    title: 'Acute neck recovery',
    kind: 'prescribed',
    prescribedOn: '2026-10-22',
    clinician: CLINICIAN.name,
    source: 'Activate Physiotherapy summary emailed 22 October 2026',
    focus: 'Acute neck pain and stiffness',
    frequency: 'About every two hours while awake, including before bed and if awake overnight.',
    // "for 3–4 days": the programme is active for 4 calendar days from the
    // prescription date and then asks for a review rather than continuing.
    durationDays: 4,
    durationText: '3–4 days, then review with John.',
    defaultReminderTimes: ['06:30', '08:30', '16:30', '18:30', '20:30', '22:30'],
    precautions: [
      'Active rotation only: turn to about 4–5/10 discomfort, no further.',
      'This is a temporary programme. Review it with John after 3–4 days rather than continuing indefinitely.',
    ],
    items: [
      {
        exerciseId: 'active-cervical-rotation',
        asPrescribed: 'Active cervical rotation',
        instructions: 'Turn head left and right to about 4–5/10 discomfort. 10 repetitions each side.',
        dose: dose({ sides: ['left', 'right'], reps: 10 }),
        limit: 'Turn only to about 4–5 out of 10 discomfort.',
      },
      {
        exerciseId: 'passive-rotation-hold',
        asPrescribed: 'Passive rotation hold',
        instructions: 'Turn to each side. Hold approximately 30 seconds. Repeat 5 times each side.',
        dose: dose({ sides: ['left', 'right'], reps: 5, holdSeconds: 30, holdPolicy: 'every' }),
      },
      {
        exerciseId: 'passive-flexion',
        asPrescribed: 'Passive flexion',
        instructions: 'Bring chin towards chest. Perform 10 repetitions. Hold for 30 seconds on the tenth repetition.',
        dose: dose({ reps: 10, holdSeconds: 30, holdPolicy: 'last' }),
      },
      {
        exerciseId: 'passive-extension',
        asPrescribed: 'Passive extension',
        instructions: 'Place fingers under the back of the head to support it. Gently extend the neck. Perform 10 repetitions.',
        dose: dose({ reps: 10 }),
      },
      {
        exerciseId: 'posture-drill-mirror',
        asPrescribed: 'Posture drill',
        instructions: 'Use a mirror to correct head and neck posture to neutral.',
        dose: dose({}),
        flags: ['No repetition count specified.'],
      },
    ],
  },
  {
    id: 'neck-headache-2026-03-17',
    title: 'Neck and headache rehabilitation',
    kind: 'prescribed',
    prescribedOn: '2026-03-17',
    clinician: CLINICIAN.name,
    source: 'Activate Physiotherapy summary emailed 17 March 2026',
    focus: 'Neck exercises for headaches',
    frequency: 'Morning and evening.',
    durationDays: null,
    durationText: 'Not specified.',
    defaultReminderTimes: [],
    position: 'Lying on your back unless John advised otherwise.',
    precautions: [
      'Stop and let John know if an exercise triggers a headache.',
      'Exercises were prescribed lying down unless otherwise advised.',
    ],
    items: [
      {
        exerciseId: 'supine-neck-rotation',
        asPrescribed: 'Supine neck rotations',
        instructions: '10 repetitions morning and evening, moving to end of range in each direction, holding for 30 seconds at the end of range.',
        dose: dose({ reps: 10, holdSeconds: 30, holdPolicy: 'unclear', frequency: 'Morning and evening' }),
        flags: ['The summary does not say whether every repetition or only one is held for 30 seconds — check with John.'],
      },
      {
        exerciseId: 'chin-tuck',
        asPrescribed: 'Chin tucks (flexion)',
        instructions: '10 repetitions morning and evening, final repetition held for 30 seconds.',
        dose: dose({ reps: 10, holdSeconds: 30, holdPolicy: 'last', frequency: 'Morning and evening' }),
      },
      {
        exerciseId: 'supine-cervical-retraction',
        asPrescribed: 'Supine cervical retraction',
        instructions: '10 repetitions, holding the tenth for 30 seconds.',
        dose: dose({ reps: 10, holdSeconds: 30, holdPolicy: 'last' }),
      },
    ],
  },
  {
    id: 'neck-back-upper-2026-03-31',
    title: 'Neck, back and upper-body mobility',
    kind: 'prescribed',
    prescribedOn: '2026-03-31',
    clinician: CLINICIAN.name,
    source: 'Activate Physiotherapy summary emailed 31 March 2026',
    focus: 'Neck, lower-back, thoracic and chest',
    frequency: 'Once daily unless stated.',
    durationDays: null,
    durationText: 'Not specified.',
    defaultReminderTimes: [],
    precautions: [],
    items: [
      {
        exerciseId: 'supine-neck-rotation',
        asPrescribed: 'Supine cervical rotations',
        instructions: '10 repetitions, 30-second end-position hold, once daily.',
        dose: dose({ reps: 10, holdSeconds: 30, holdPolicy: 'unclear', frequency: 'Once daily' }),
        flags: ['The summary does not say whether every repetition or only one is held for 30 seconds — check with John.'],
      },
      {
        exerciseId: 'chin-tuck',
        asPrescribed: 'Chin tucks',
        instructions: '10 repetitions, holding each for 30 seconds, once daily.',
        dose: dose({ reps: 10, holdSeconds: 30, holdPolicy: 'every', frequency: 'Once daily' }),
      },
      {
        exerciseId: 'supine-cervical-retraction',
        asPrescribed: 'Cervical retraction',
        instructions: '10 repetitions, holding the last for 30 seconds, once daily.',
        dose: dose({ reps: 10, holdSeconds: 30, holdPolicy: 'last', frequency: 'Once daily' }),
        flags: ['Position (lying or upright) is not stated in this summary.'],
      },
      {
        exerciseId: 'lumbar-rotation-knee-rolling',
        asPrescribed: 'Lumbar rotation / rolling knees side to side while lying down',
        instructions: '10 repetitions, 1–3 times daily.',
        dose: dose({ reps: 10, frequency: '1–3 times daily' }),
        flags: ['The summary does not say whether 10 repetitions means 10 in total or 10 to each side.'],
      },
      {
        exerciseId: 'standing-wall-stretch',
        asPrescribed: 'Standing wall stretch with arms overhead',
        instructions: '10 repetitions, once daily.',
        dose: dose({ reps: 10, frequency: 'Once daily' }),
      },
      {
        exerciseId: 'doorway-pec-stretch',
        asPrescribed: 'Doorway pectoral stretch',
        instructions: 'As tolerated; no fixed dose specified.',
        dose: dose({ frequency: 'As tolerated' }),
        flags: ['No fixed dose specified — as tolerated.'],
      },
    ],
  },
  {
    id: 'neck-lumbar-2026-06-03',
    title: 'Neck and lumbar recovery',
    kind: 'prescribed',
    prescribedOn: '2026-06-03',
    clinician: CLINICIAN.name,
    source: 'Activate Physiotherapy summary emailed 3 June 2026',
    focus: 'Neck and lumbar',
    frequency: 'Daily, with gradual progression.',
    durationDays: null,
    durationText: 'Not specified.',
    defaultReminderTimes: [],
    precautions: [
      'Stop if significant pain occurs.',
      'Exercise daily and progress gradually.',
    ],
    items: [
      {
        exerciseId: 'supine-cervical-retraction',
        asPrescribed: 'Cervical retraction/chin tuck in lying',
        instructions: 'Cervical retraction/chin tuck in lying.',
        dose: dose({}),
        flags: ['Repetitions and holds not stated — confirm with John.'],
      },
      {
        exerciseId: 'supine-cervical-extension',
        asPrescribed: 'Cervical extension in supine',
        instructions: 'Cervical extension in supine.',
        dose: dose({}),
        flags: ['Repetitions and holds not stated — confirm with John.', 'Technique (for example, pillow or bed edge) is not described — do it as John showed you.'],
      },
      {
        exerciseId: 'lumbar-rotation-knee-rolling',
        asPrescribed: 'Rolling knees side to side',
        instructions: 'Rolling knees side to side.',
        dose: dose({}),
        flags: ['Repetitions not stated — confirm with John.'],
      },
      {
        exerciseId: 'rocking',
        asPrescribed: 'Rocking movements',
        instructions: 'Rocking movements.',
        dose: dose({}),
        flags: ['Needs clarification: the summary does not describe the position or movement, so no picture is shown. Ask John to demonstrate.', 'Repetitions not stated — confirm with John.'],
      },
      {
        exerciseId: 'childs-pose',
        asPrescribed: "Child's pose",
        instructions: "Child's pose.",
        dose: dose({}),
        flags: ['Hold time and repetitions not stated — confirm with John.'],
      },
      {
        exerciseId: 'prone-press-up',
        asPrescribed: 'Prone lumbar extension / press-ups',
        instructions: '10 repetitions daily within a comfortable range.',
        dose: dose({ reps: 10, frequency: 'Daily' }),
        limit: 'Stay within a comfortable range.',
      },
    ],
  },
]);

export function getProgramme(id, extra = []) {
  return [...PROGRAMMES, ...extra].find((p) => p.id === id) || null;
}

export function getExercise(id, extra = {}) {
  return EXERCISES[id] || extra[id] || null;
}

// Every prescription of one library exercise, oldest first, so the library can
// show how its dose changed over time without merging the prescriptions.
export function prescriptionHistory(exerciseId, programmes = PROGRAMMES) {
  return programmes
    .flatMap((p) => p.items.filter((it) => it.exerciseId === exerciseId).map((it) => ({ programme: p, item: it })))
    .sort((a, b) => a.programme.prescribedOn.localeCompare(b.programme.prescribedOn));
}

function doseKey(d) {
  return JSON.stringify([d.sides, d.reps, d.holdSeconds, d.holdPolicy]);
}

// Exercises prescribed with different doses on different dates. These are
// shown for review; the app never picks one dose over another by itself.
export function doseChanges(programmes = PROGRAMMES) {
  const ids = [...new Set(programmes.flatMap((p) => p.items.map((it) => it.exerciseId)))];
  return ids
    .map((id) => ({ exerciseId: id, history: prescriptionHistory(id, programmes) }))
    .filter(({ history }) => new Set(history.map((h) => doseKey(h.item.dose))).size > 1);
}

// Plain-English dose line for the session screen, built only from stated
// fields. Missing values read as "not specified", never as a default.
export function describeDose(d) {
  const parts = [];
  if (d.reps != null) parts.push(`${d.reps} reps${d.sides ? ' each side' : ''}`);
  if (d.holdSeconds != null) {
    const holdText = {
      every: `hold each for ${d.holdSeconds} seconds`,
      last: `hold the last one for ${d.holdSeconds} seconds`,
      unclear: `${d.holdSeconds}-second hold at end of range`,
    }[d.holdPolicy];
    if (holdText) parts.push(holdText);
  }
  if (!parts.length) return 'No count specified — do it as John showed you';
  return parts.join(', ');
}
