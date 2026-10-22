Engineering principles: v5.1
Assurance tier: 3
Canonical repository: https://github.com/Parris-Tech-Services/PhysioBuddy

# PhysioBuddy

A self-contained, installable web app (PWA) that guides Josh through the home
exercises John Robins (Activate Physiotherapy, Dubbo) prescribed. Plain HTML,
CSS and JavaScript modules — no build step.

## Run it

```bash
npm install          # only needed for browser tests
npm run dev          # http://localhost:5174
npm test             # unit tests (node --test)
npm run test:browser # Playwright end-to-end tests
```

Deployed to Vercel as static files (`vercel.json`); `.vercelignore` keeps
tests, scripts and docs out of the deployment.

## What it does

- **Today**: one-tap *Start My Exercises* for each active programme, with
  today's reminder slots ticked off as sessions are completed.
- **Guided sessions**: one exercise per screen with an animated illustration,
  spoken instructions with captions, rep counter, 30-second hold timer, pause,
  resume, skip, *That hurts*, and a celebration at the end. Discomfort (0–10)
  is recorded before and after.
- **Voice**: Australian-English text-to-speech; spoken commands ("I'm ready",
  "done", "start timer", "how many left?", "pause", "resume", "skip this one",
  "that hurts", "finish session", ...). Every command has a button too.
- **Library**: all four prescriptions, kept separate and dated, with the
  verbatim instructions, dose history per exercise, dose-change flags,
  clarification flags, PDF attachments (stored on the device only) and a link
  to the original email in Gmail.
- **After each exercise**: optional one-tap discomfort and difficulty
  ratings; "more than usual" surfaces the stop-and-contact-John precaution.
- **Daily check-in** on Today: neck discomfort, headache, sleep — trended on
  Progress.
- **Weekly everyday-activity check** (Patient-Specific Functional Scale
  style): up to three activities rated 0–10 once a week; change shown on
  Progress and in the report. Scores are displayed, never interpreted.
- **Milestones** that only accumulate (sessions, movements, a full day of
  reminder slots, check-ins) — no streaks, nothing lost for missed days.
- **Calm breathing break** (optional, labelled as not prescribed): guided
  1–3 minute paced breathing with an animated circle and voice cues.
- **Report for John**: plain-text summary of the last 7/14/30 days (sessions,
  discomfort, symptoms, ratings, check-ins, questions and unclear prescription
  items) to share, copy, email or print.
- **Progress**: weekly summary, 14-day chart, discomfort trend, monthly
  calendar, history, CSV export and print.
- **Reminders**: configurable times in Australia/Sydney; in-app and
  notification reminders (Start / Snooze / Mark done) while Chrome keeps the
  app alive, plus a calendar (.ics) export for reliable alerts. Reminders stop
  automatically after a temporary programme's review date.

## Clinical rules the code enforces

- `js/data.js` is the only source of prescribed doses. Doses
  the summaries do not state are `null` and are shown as "not specified".
- Older prescriptions are never merged into Today; activating one asks for
  confirmation.
- The 4–5/10 discomfort limit applies only to the October active rotation.
- The app never increases reps, holds or frequency, and does not detect
  movement — it trusts what the user reports.
- "Done" counts one rep; finishing an exercise or session early always asks.
- Required holds must be timed; they cannot be skipped by saying "done".

## Layout

| File | Responsibility |
|---|---|
| `js/data.js` | Prescriptions and exercise library (authority for doses) |
| `js/session.js` | Pure session state machine (clock injected) |
| `js/commands.js` | Spoken-phrase → command parser |
| `js/schedule.js` | Sydney time, reminder slots, programme windows, .ics |
| `js/progress.js` | Summaries, charts data, CSV, ratings and check-ins |
| `js/function.js` | Weekly everyday-activity check |
| `js/milestones.js` | Cumulative milestones |
| `js/breathing.js` | Paced-breathing timing |
| `js/report.js` | Plain-text report for the physiotherapist |
| `js/store.js` | Versioned localStorage state, backup/restore |
| `js/docs.js` | PDF attachments in IndexedDB |
| `js/figures.js` | SVG illustrations and animation |
| `js/voice.js` | Speech synthesis and recognition wrappers |
| `js/app.js` | UI, routing and wiring |
| `sw.js` | Offline cache and notification actions |

## Privacy

All data stays in the browser (localStorage + IndexedDB). There is no
account sync; use *Settings → Back up (JSON)* to move or protect data.
The page is marked `noindex`. Original PDFs are never part of the deployment.

## Tests

- `test/*.test.js` (run by `npm test`): prescriptions, session engine,
  holds across pause/reload, voice parsing, Sydney DST, reminders, progress,
  storage, figure rendering.
- `tests/session.spec.js` (run by `npm run test:browser`): a full session in
  Chromium including a reload mid-hold, pause/resume, completion, saved
  history, "That hurts", guided counting and the review prompt.

## Needs real-device checking

Voice quality and recognition, notifications, vibration, wake lock and
Add to Home screen must be checked on the Android phone; headless Chromium
cannot exercise them.
