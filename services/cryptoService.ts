
// Converts an ArrayBuffer to a hexadecimal string.
const bufferToHex = (buffer: ArrayBuffer): string => {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

/**
 * Hashes a password using SHA-256.
 * In a real application, this should be done on the server with a slow hashing
 * algorithm like bcrypt or Argon2. This is a client-side simulation for a
 * frontend-only app.
 * @param password The password to hash.
 * @returns A promise that resolves to the hexadecimal SHA-256 hash.
 */
export const hashPassword = async (password: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return bufferToHex(hashBuffer);
};
