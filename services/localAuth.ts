import { Person, LogAction } from '../types';
import taskStoreBridge from '../context/taskStoreBridge';
import { hashPassword } from '../services/cryptoService';

// Local account store, persisted in localStorage. This replaces the previous
// hosted identity provider: accounts live under one key, sessions under
// another. No third-party SDK is involved at any point.
const ACCOUNTS_KEY = 't3.accounts.v1';
const SESSION_KEY = 't3.session.v1';

export type LocalAccount = {
    uid: string;
    name: string;
    email: string;
    passwordHash: string;
};

export type SessionUser = {
    uid: string;
    email: string;
};

function readAccounts(): LocalAccount[] {
    try {
        const raw = localStorage.getItem(ACCOUNTS_KEY);
        return raw ? (JSON.parse(raw) as LocalAccount[]) : [];
    } catch {
        return [];
    }
}

function writeAccounts(accounts: LocalAccount[]): void {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function getSessionUser(): SessionUser | null {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? (JSON.parse(raw) as SessionUser) : null;
    } catch {
        return null;
    }
}

export function clearSession(): void {
    localStorage.removeItem(SESSION_KEY);
}

export async function signUpLocally(name: string, email: string, password: string): Promise<SessionUser> {
    const normalizedEmail = email.trim().toLowerCase();
    const accounts = readAccounts();
    if (accounts.some(a => a.email === normalizedEmail)) {
        throw new Error('An account with this email already exists.');
    }
    const uid = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    accounts.push({ uid, name, email: normalizedEmail, passwordHash });
    writeAccounts(accounts);

    // Seed the user's profile document so the rest of the app sees a Person.
    const newUserProfile: Person = {
        id: uid,
        name,
        email: normalizedEmail,
        mobile: '',
        avatarUrl: '',
        aiPrompt: `A busy professional named ${name}.`,
    };
    await taskStoreBridge.current?.upsertPerson(newUserProfile, uid);

    const session: SessionUser = { uid, email: normalizedEmail };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
}

export async function signInLocally(email: string, password: string): Promise<SessionUser> {
    const normalizedEmail = email.trim().toLowerCase();
    const account = readAccounts().find(a => a.email === normalizedEmail);
    if (!account) {
        throw new Error('Invalid email or password.');
    }
    const passwordHash = await hashPassword(password);
    if (passwordHash !== account.passwordHash) {
        throw new Error('Invalid email or password.');
    }

    taskStoreBridge.current?.addLogEntry({
        userId: account.uid,
        action: LogAction.LOGIN,
        details: 'User logged in.',
    });

    const session: SessionUser = { uid: account.uid, email: account.email };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
}

export async function sendPasswordResetLocally(email: string): Promise<void> {
    // No mail infrastructure is wired up in the local-first client; reset is a
    // local no-op that behaves consistently for existing addresses only.
    const normalizedEmail = email.trim().toLowerCase();
    const account = readAccounts().find(a => a.email === normalizedEmail);
    if (!account) {
        throw new Error('No account found for this email address.');
    }
}

export async function changePasswordLocally(uid: string, newPassword: string): Promise<void> {
    const accounts = readAccounts();
    const account = accounts.find(a => a.uid === uid);
    if (!account) {
        throw new Error('You must be logged in to change your password.');
    }
    account.passwordHash = await hashPassword(newPassword);
    writeAccounts(accounts);
}
