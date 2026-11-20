import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDormantNudge,
  buildGoalDone,
  buildGoalRisk,
  buildPromotionUpline,
  buildRecruitAlert,
  buildTrackCompleteUpline,
  buildTrainingRequest,
  buildWelcome,
} from './LifecycleMailer.js';

const assertNoUndefined = (mail) => {
  assert.doesNotMatch(mail.subject, /undefined/i);
  assert.doesNotMatch(mail.html, /undefined/i);
  assert.ok(String(mail.html).trim().length > 0);
};

test('lifecycle mail builders never interpolate undefined names or labels', () => {
  assertNoUndefined(buildGoalRisk({}));
  assertNoUndefined(buildGoalDone({}));
  assertNoUndefined(buildTrackCompleteUpline({}));
  assertNoUndefined(buildWelcome({}));
  assertNoUndefined(buildRecruitAlert({}));
  assertNoUndefined(buildPromotionUpline({}));
  assertNoUndefined(buildTrainingRequest({}));
  assertNoUndefined(buildDormantNudge({}));
});

test('lifecycle mail builders keep real values unchanged', () => {
  const welcome = buildWelcome({ memberName: 'Ada Obi' });
  assert.match(welcome.subject, /Ada Obi/);
  assert.match(welcome.html, /Ada Obi/);

  const risk = buildGoalRisk({
    memberName: 'Ada Obi',
    uplineName: 'Bola Ade',
    title: 'First 3 signups',
    remaining: '2 signups',
    daysLeft: 4,
    requiredDaily: '1 signup',
  });
  assert.match(risk.subject, /Ada Obi/);
  assert.match(risk.subject, /First 3 signups/);
  assert.match(risk.html, /Bola Ade/);
});
