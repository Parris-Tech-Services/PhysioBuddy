# PhysioBuddy agent rules

Read `codingprinciples.md` before changing code.

Engineering principles: v5.1
Assurance tier: 3
Canonical repository: https://github.com/Parris-Tech-Services/PhysioBuddy

This app handles personal health and clinical prescription data. The full Tier 3 standard applies.

## Change discipline
- Never push directly to `main`; use one coherent branch and PR.
- `js/data.js` is the only authority for prescribed doses. Transcribe prescriptions exactly; never invent or "fill in" reps, holds, frequency or technique. Unstated values stay `null` and are flagged.
- Never merge older prescriptions into the active programme, and never increase a dose automatically.
- Do not claim the app detects movement, or that notifications/email work, without real-device evidence.
- Keep clinical documents (PDFs) out of the repository and deployment; user data stays on the device.
- Add behavioural tests for changed session, dose, reminder or storage logic. Run `npm test` and `npm run test:browser` before merge.
- Do not weaken tests to make a change pass. Report named evidence only.
