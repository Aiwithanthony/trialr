# Trialr Project Instructions

- Trialr uses the darkroom studio interface at every route. Read `.impeccable.md` before any design work and preserve that visual system; `src/darkroom.css` holds the tokens and skin.
- Never reintroduce the retired V2 tells: monospace as a "technical" cue, pseudo-terminal kickers such as `SYS_TRIAL_READY // 01`, or a glowing accent on a dark canvas.
- Keep the Zernio API key server-side. Never expose it in client code, logs, screenshots, or commits.
- Never commit `.env` or `data/experiments.json`.
- Do not publish a real Reel during setup, testing, or debugging without the user's explicit confirmation.
- Run `npm test` and `npm run build` after code changes.
- Keep local experiment persistence backward-compatible unless a migration is included.
- Test reports are built client-side in `src/report.js` with no model calls. Escape every value that reaches the HTML, embed only `data:` thumbnails and `https:` links, and keep the caveats section — a report reads as more authoritative than the screen does, so it has to state what would undermine its own verdict.
- Light, System, and Dark appearance modes must remain functional.
- Published experiment rows read as a contact sheet: a 9:16 frame per variant, the leader ringed with registration marks, and the row opening the Instagram Reel when a platform URL is available.
- Never gate content visibility on a CSS animation. A backgrounded tab pauses animations, so anything fading in from `opacity: 0` stays invisible; animate `transform` and leave the resting state visible.
