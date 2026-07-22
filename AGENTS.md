# Trialr Project Instructions

- Trialr uses the V2 industrial editorial interface at every route. Preserve that visual system.
- Keep the Zernio API key server-side. Never expose it in client code, logs, screenshots, or commits.
- Never commit `.env` or `data/experiments.json`.
- Do not publish a real Reel during setup, testing, or debugging without the user's explicit confirmation.
- Run `npm test` and `npm run build` after code changes.
- Keep local experiment persistence backward-compatible unless a migration is included.
- Light, System, and Dark appearance modes must remain functional.
- Published experiment rows use compact 9:16 media thumbnails and open the Instagram Reel when a platform URL is available.
