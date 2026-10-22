// Drafts of messages to the physiotherapist. There is no server: drafts open
// in the person's email/SMS app and they choose whether to send. Pure text
// builders so templates can be tested.

export const TEMPLATES = Object.freeze({
  symptom: { label: 'An exercise caused symptoms', subject: 'Symptoms during my home exercises' },
  question: { label: 'Question about my exercises', subject: 'Question about my home exercises' },
  update: { label: 'Update on how I\'m going', subject: 'Update on my home exercises' },
  appointment: { label: 'Ask about an appointment', subject: 'Appointment request' },
});

function symptomLines(symptoms, exerciseName, formatDate) {
  if (!symptoms.length) return ['[Describe what happened, which exercise, and how long it lasted.]'];
  return symptoms.map((e) => `- ${formatDate(e.t)}: ${e.kind}${e.exerciseId ? ` during ${exerciseName(e.exerciseId)}` : ''}`);
}

// Body text for a template. `symptoms` are recent symptom events from
// sessions; `questions` are the person's open questions. Placeholders in
// [brackets] are for the person to fill in before sending.
export function composeMessage({ template, clinician = 'John', symptoms = [], questions = [], report = null, exerciseName = (x) => x, formatDate = (t) => new Date(t).toISOString().slice(0, 10), signOff = '' }) {
  const t = TEMPLATES[template] || TEMPLATES.question;
  const lines = [`Hi ${clinician},`, ''];
  if (template === 'symptom') {
    lines.push('I had some symptoms while doing my home exercises:', ...symptomLines(symptoms, exerciseName, formatDate), '', 'I have stopped that exercise for now. Should I keep going, change anything, or come in?');
  } else if (template === 'update') {
    lines.push("Here's a quick update on how my home exercises are going.", '[How you feel overall]');
  } else if (template === 'appointment') {
    lines.push("I'd like to book a follow-up appointment.", '[Preferred days/times]');
  } else {
    lines.push('I have a question about my home exercises:', ...(questions.length ? questions.map((q) => `- ${q}`) : ['[Your question]']));
  }
  if (report) lines.push('', 'My recent progress (from my exercise app):', '', report.trim());
  lines.push('', 'Thanks,', signOff || '[Your name]');
  return { subject: t.subject, body: lines.join('\n') + '\n' };
}

export function mailtoUrl(to, { subject, body }) {
  return `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function smsUrl(phone, { body }) {
  return `sms:${(phone || '').replace(/[^\d+]/g, '')}?body=${encodeURIComponent(body)}`;
}
