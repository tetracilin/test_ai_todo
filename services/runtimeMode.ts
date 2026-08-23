// Runtime mode flags resolved once per browser session.
//
// E2E mode (`?e2e=1` query param) boots the whole app without Firebase: auth
// is short-circuited to a deterministic local demo user and the task store
// persists to in-memory React state instead of Firestore. This gives the
// Playwright suite a real, fully interactive scheduling workflow to drive with
// zero network dependencies (see e2e/scheduling.spec.ts). It carries no data:
// everything stays in the tab, and no real backend is ever contacted.
function computeE2EMode(): boolean {
    try {
        return new URLSearchParams(window.location.search).has('e2e');
    } catch {
        return false;
    }
}

export const isE2EMode: boolean = computeE2EMode();

/** The deterministic user id the app runs under in E2E mode. */
export const E2E_DEMO_USER_ID = 'e2e-demo-user';
