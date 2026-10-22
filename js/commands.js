// Spoken-command parser. Pure: maps a recognised phrase to one command.
// Order matters — longer, more specific phrases are matched before the short
// words they contain ("finish session" before "finish", "start timer" before
// "start"). Negated phrases ("not done", "don't skip") never match, so a
// half-heard sentence cannot tick an exercise off by mistake.

const RULES = [
  ['hurt', /\b(that|it|this) hurts?\b|\bhurts?\b|\bpain(ful)?\b|\bouch\b|\bheadache\b/],
  ['finish', /\b(finish|end|stop) (the )?(session|exercises|workout)\b/],
  ['stop', /\bstop\b/],
  ['startTimer', /\bstart (the )?(timer|hold|holding|countdown)\b|\bhold now\b/],
  ['repeat', /\brepeat( that)?\b|\bsay (that )?again\b|\bwhat was that\b|\bpardon\b/],
  ['howMany', /\bhow many\b|\bhow much (more|longer)\b|\bwhat'?s left\b/],
  ['skip', /\bskip\b/],
  ['next', /\bnext( exercise| one)?\b/],
  ['pause', /\bpause\b|\bhold on\b|\bwait\b/],
  ['resume', /\bresume\b|\bcontinue\b|\bcarry on\b|\bunpause\b/],
  ['ready', /\bi'?m ready\b|\bready\b|\blet'?s go\b|\bstart( my)? exercises\b|\bbegin\b|\bstart\b/],
  ['done', /\bdone\b|\bfinished\b|\bcompleted?\b|\bthat'?s it\b|\bgot it\b/],
  ['yes', /^(yes|yeah|yep|confirm|correct|sure)\b/],
  ['no', /^(no|nope|cancel|not yet)\b/],
];

const NEGATION = /\b(not|don'?t|do not|never|isn'?t|haven'?t|no)\s+(\w+\s+)?(done|ready|finished|skip|next|start|complete)/;

export function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCommand(text) {
  const t = normalise(text);
  if (!t) return null;
  if (NEGATION.test(t)) return null;
  for (const [command, re] of RULES) {
    if (re.test(t)) return command;
  }
  return null;
}

// Speech engines report 0 when they have no confidence estimate, so 0 is
// accepted; a low but non-zero score is treated as "probably misheard".
export function acceptResult({ transcript, confidence, isFinal }) {
  if (!isFinal) return null;
  if (confidence > 0 && confidence < 0.45) return null;
  return parseCommand(transcript);
}

export const COMMAND_HELP = [
  ['Start exercises / I\'m ready', 'Begin the exercise on screen'],
  ['Start timer', 'Start the hold countdown'],
  ['Done', 'Count a rep, or finish an exercise'],
  ['Next exercise', 'Move on after finishing'],
  ['Repeat that', 'Hear the instructions again'],
  ['How many left?', 'Hear what is left'],
  ['Pause / Resume', 'Pause or carry on'],
  ['Skip this one', 'Skip the current exercise'],
  ['That hurts', 'Stop and choose what to do'],
  ['Finish session', 'End the session'],
];
