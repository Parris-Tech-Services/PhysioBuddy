import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeMessage, mailtoUrl, smsUrl, TEMPLATES } from '../js/messages.js';

test('symptom message lists recent symptom reports with exercise names', () => {
  const { subject, body } = composeMessage({
    template: 'symptom',
    symptoms: [{ t: Date.UTC(2026, 9, 22), kind: 'headache', exerciseId: 'x' }],
    exerciseName: () => 'Chin to chest',
    signOff: 'Josh',
  });
  assert.equal(subject, TEMPLATES.symptom.subject);
  assert.match(body, /^Hi John,\n\nI had some symptoms while doing my home exercises:\n- 2026-10-22: headache during Chin to chest\n/);
  assert.match(body, /Thanks,\nJosh\n$/);
});

test('question message uses open questions, or a placeholder when there are none', () => {
  assert.match(composeMessage({ template: 'question', questions: ['Keep going after day 4?'] }).body, /- Keep going after day 4\?/);
  assert.match(composeMessage({ template: 'question' }).body, /\[Your question\]/);
  assert.match(composeMessage({ template: 'nope' }).subject, /Question/);
});

test('report is appended when requested', () => {
  const { body } = composeMessage({ template: 'update', report: 'Home exercise report\n- 3 sessions\n' });
  assert.match(body, /My recent progress \(from my exercise app\):\n\nHome exercise report\n- 3 sessions\n\nThanks,/);
});

test('mailto and sms links are encoded', () => {
  const m = { subject: 'A & B', body: 'Line 1\nLine 2' };
  assert.equal(mailtoUrl('a@b.com', m), 'mailto:a%40b.com?subject=A%20%26%20B&body=Line%201%0ALine%202');
  assert.equal(mailtoUrl('', m).startsWith('mailto:?subject='), true);
  assert.equal(smsUrl('02 6882 0000', m), 'sms:0268820000?body=Line%201%0ALine%202');
});
