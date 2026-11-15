export interface TokenService {
  /** Unguessable random token (≥128 bits), URL-safe. */
  generate(): string;
  /** Deterministic hash (SHA-256 hex) used for lookups. */
  hash(token: string): string;
  /** Reversible encryption with a server key (invite tokens only). */
  encrypt(token: string): string;
  decrypt(ciphertext: string): string;
}

export interface IdGenerator {
  /** Public room id: 10 random characters. */
  roomId(): string;
  /** Member id (uuid). */
  memberId(): string;
}

export interface Clock {
  now(): Date;
}

export interface RateLimiter {
  /** Records a hit and returns false when the limit for `key` is exceeded. */
  hit(key: string, limit: number, windowMs: number): Promise<boolean>;
}
