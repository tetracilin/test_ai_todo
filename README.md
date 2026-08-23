<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# T3 Task Manager

A team task manager (React 19 + Vite + TypeScript) with a static file server.
AI assistance runs through the Hermes Gateway via the app server — the client
never holds model credentials, and no third-party AI or identity SDKs are used.

## Live build

Every push to `main` that passes CI deploys the latest `dist/` build to GitHub Pages:

https://tetracilin.github.io/test_ai_todo/

See the `deploy` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Supply-chain guarantees

CI enforces two blocking gates against legacy AI-provider contamination:

- `npm run check:no-google-client` — scans all tracked sources for banned
  provider references, secret shapes, and model-credential env wiring. Any
  hit fails the build. Self-test: `npm run test:check-no-google-client`.
- `npm run scan:client-bundle -- dist` — scans the built bundle for the same
  forbidden content after every build. Any hit fails the build.
