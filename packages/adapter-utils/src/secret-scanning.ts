const PRIVATE_KEY_PEM_RE = /-----BEGIN(?: [A-Z0-9]+)* (?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----/i;
const JWT_RE = /\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/i;
const AUTHORIZATION_RE = /\b(?:bearer|basic)\s+[a-z0-9+/_=-]{12,}/i;
const CREDENTIAL_URI_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;
const COOKIE_ASSIGNMENT_RE = /\b(?:set-cookie|cookie)\s*:\s*[^\r\n;=\s]+\s*=\s*[^\s;,]{8,}/i;
const SESSION_ASSIGNMENT_RE = /\b(?:session(?:[_-]?(?:id|key|token))?|csrf(?:[_-]?token)?)\s*[=:]\s*["']?[^\s"',;}]{8,}/i;
const SENSITIVE_ASSIGNMENT_RE = /(?:^|[\s,{])(?:["']?(?:api[_-]?key|access[_-]?key|aws[_-]?(?:secret[_-]?access[_-]?key|access[_-]?key)|token|password|secret|client[_-]?secret|credential|private[_-]?key)["']?)\s*[=:]\s*["']?[^\s"',;}]{8,}/i;
const PROVIDER_KEY_RE = /\b(?:sk-(?:proj-)?[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[a-z0-9_-]{20,}|xox[baprs]-[a-z0-9-]{10,})\b/i;
const ENTROPY_TOKEN_RE = /[A-Za-z0-9+/_=-]{40,}/g;

export function normalizeSecretScanText(value: string, limit: number): string {
  return Array.from(
    value
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .trim(),
  ).slice(0, limit).join("");
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function isHighConfidenceEntropyToken(value: string): boolean {
  const hasUpper = /[A-Z]/.test(value);
  const hasLower = /[a-z]/.test(value);
  const hasDigit = /\d/.test(value);
  const hasSymbol = /[+/_=-]/.test(value);
  const characterClasses = Number(hasUpper) + Number(hasLower) + Number(hasDigit) + Number(hasSymbol);
  return characterClasses >= 3 && shannonEntropy(value) >= 4;
}

/** Detect credential-like material before untrusted text crosses an agent boundary. */
export function containsStructuredSecret(value: string): boolean {
  const normalized = normalizeSecretScanText(value, Number.MAX_SAFE_INTEGER);
  if (
    PRIVATE_KEY_PEM_RE.test(normalized)
    || JWT_RE.test(normalized)
    || AUTHORIZATION_RE.test(normalized)
    || CREDENTIAL_URI_RE.test(normalized)
    || COOKIE_ASSIGNMENT_RE.test(normalized)
    || SESSION_ASSIGNMENT_RE.test(normalized)
    || SENSITIVE_ASSIGNMENT_RE.test(normalized)
    || PROVIDER_KEY_RE.test(normalized)
  ) return true;

  return Array.from(normalized.matchAll(ENTROPY_TOKEN_RE))
    .some((match) => isHighConfidenceEntropyToken(match[0]));
}
