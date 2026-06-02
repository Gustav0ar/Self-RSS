import { type JWTPayload, jwtVerify, SignJWT } from 'jose';

export interface TokenPayload extends JWTPayload {
	sub: string;
	role: string;
	type: 'access' | 'refresh';
}

function parseExpiry(exp: string): number {
	const match = exp.match(/^(\d+)([smhd])$/);
	if (!match) throw new Error(`Invalid expiry format: ${exp}`);
	const value = Number.parseInt(match[1]!, 10);
	const unit = match[2]!;
	const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
	return value * (multipliers[unit] ?? 60);
}

export function createTokenUtils(
	jwtSecret: string,
	jwtRefreshSecret: string,
	accessExpiry: string,
	refreshExpiry: string,
) {
	const accessSecret = new TextEncoder().encode(jwtSecret);
	const refreshSecret = new TextEncoder().encode(jwtRefreshSecret);
	const accessSeconds = parseExpiry(accessExpiry);
	const refreshSeconds = parseExpiry(refreshExpiry);

	return {
		async signAccessToken(userId: string, role: string): Promise<string> {
			return new SignJWT({ sub: userId, role, type: 'access' })
				.setProtectedHeader({ alg: 'HS256' })
				.setJti(crypto.randomUUID())
				.setIssuedAt()
				.setExpirationTime(`${accessSeconds}s`)
				.sign(accessSecret);
		},

		async signRefreshToken(userId: string, role: string): Promise<string> {
			return new SignJWT({ sub: userId, role, type: 'refresh' })
				.setProtectedHeader({ alg: 'HS256' })
				.setJti(crypto.randomUUID())
				.setIssuedAt()
				.setExpirationTime(`${refreshSeconds}s`)
				.sign(refreshSecret);
		},

		async verifyAccessToken(token: string): Promise<TokenPayload> {
			const { payload } = await jwtVerify(token, accessSecret, {
				algorithms: ['HS256'],
				requiredClaims: ['sub', 'type', 'jti', 'exp'],
			});
			return payload as TokenPayload;
		},

		async verifyRefreshToken(token: string): Promise<TokenPayload> {
			const { payload } = await jwtVerify(token, refreshSecret, {
				algorithms: ['HS256'],
				requiredClaims: ['sub', 'type', 'jti', 'exp'],
			});
			return payload as TokenPayload;
		},

		accessExpiresIn: accessSeconds,
		refreshExpiresIn: refreshSeconds,
	};
}

export type TokenUtils = ReturnType<typeof createTokenUtils>;
