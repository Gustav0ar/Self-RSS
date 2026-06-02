import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_KEY_LENGTH = 64;

export async function hashPassword(password: string) {
	if (globalThis.Bun?.password) {
		return globalThis.Bun.password.hash(password, { algorithm: 'argon2id' });
	}

	const salt = randomBytes(16).toString('hex');
	const derivedKey = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
	return `${SCRYPT_PREFIX}$${salt}$${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
	if (passwordHash.startsWith(`${SCRYPT_PREFIX}$`)) {
		const [, salt, storedHash] = passwordHash.split('$');
		if (!salt || !storedHash) {
			return false;
		}

		const derivedKey = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
		const storedBuffer = Buffer.from(storedHash, 'hex');
		if (storedBuffer.length !== derivedKey.length) {
			return false;
		}

		return timingSafeEqual(storedBuffer, derivedKey);
	}

	if (globalThis.Bun?.password) {
		return globalThis.Bun.password.verify(password, passwordHash);
	}

	throw new Error('Cannot verify Bun password hashes outside the Bun runtime');
}
