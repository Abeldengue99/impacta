import {
    createCipheriv,
    createDecipheriv,
    createHmac,
    randomBytes,
    timingSafeEqual
} from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

export function mfaEncryptionKey(): Buffer | null {
    const encoded = process.env.MFA_ENCRYPTION_KEY?.trim() ?? '';
    return /^[a-f0-9]{64}$/i.test(encoded) ? Buffer.from(encoded, 'hex') : null;
}

export function createTotpSecret(): string {
    return encodeBase32(randomBytes(20));
}

export function totpProvisioningUri(secret: string, account: string): string {
    const issuer = 'IMPACTA';
    const label = `${issuer}:${account}`;
    return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

export function encryptTotpSecret(secret: string, key: Buffer): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${nonce.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptTotpSecret(encrypted: string, key: Buffer): string | null {
    const parts = encrypted.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    try {
        const nonce = Buffer.from(parts[1], 'base64url');
        const tag = Buffer.from(parts[2], 'base64url');
        const ciphertext = Buffer.from(parts[3], 'base64url');
        if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length < 16) return null;
        const decipher = createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
}

export function matchingTotpStep(
    secret: string,
    code: string,
    now = Date.now(),
    lastUsedStep = -1
): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    const key = decodeBase32(secret);
    if (!key) return null;
    const currentStep = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
    const supplied = Buffer.from(code, 'ascii');
    for (const step of [currentStep - 1, currentStep, currentStep + 1]) {
        if (step <= lastUsedStep || step < 0) continue;
        const counter = Buffer.alloc(8);
        counter.writeBigUInt64BE(BigInt(step));
        const digest = createHmac('sha1', key).update(counter).digest();
        const offset = digest[digest.length - 1] & 0x0f;
        const binary = ((digest[offset] & 0x7f) << 24)
            | ((digest[offset + 1] & 0xff) << 16)
            | ((digest[offset + 2] & 0xff) << 8)
            | (digest[offset + 3] & 0xff);
        const expected = Buffer.from(String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0'), 'ascii');
        if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return step;
    }
    return null;
}

export function createRecoveryCodes(count = 10): string[] {
    return Array.from({ length: count }, () => randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g)!.join('-'));
}

export function recoveryCodeHash(userId: string, code: string, key: Buffer): string | null {
    const normalized = code.replace(/[\s-]/g, '').toUpperCase();
    if (!/^[A-F0-9]{16}$/.test(normalized)) return null;
    return createHmac('sha256', key).update(`impacta:mfa-recovery:${userId}:${normalized}`).digest('hex');
}

function encodeBase32(input: Buffer): string {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of input) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return output;
}

function decodeBase32(input: string): Buffer | null {
    if (!/^[A-Z2-7]+$/i.test(input)) return null;
    let bits = 0;
    let value = 0;
    const output: number[] = [];
    for (const character of input.toUpperCase()) {
        value = (value << 5) | BASE32_ALPHABET.indexOf(character);
        bits += 5;
        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return output.length >= 16 ? Buffer.from(output) : null;
}
