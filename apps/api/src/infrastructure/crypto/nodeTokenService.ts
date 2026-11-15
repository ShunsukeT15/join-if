import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IdGenerator, TokenService } from '../../application/ports/services.js';

/**
 * Tokens: 32 random bytes (256 bits), base64url.
 * Hash: SHA-256 hex. Encryption: AES-256-GCM with a 32-byte server key.
 */
export class NodeTokenService implements TokenService {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes encoded in base64');
    this.key = key;
  }

  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  encrypt(token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${body.toString('base64url')}.${tag.toString('base64url')}`;
  }

  decrypt(ciphertext: string): string {
    const [version, iv, body, tag] = ciphertext.split('.');
    if (version !== 'v1' || !iv || !body || !tag) throw new Error('Unsupported ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  }
}

const ROOM_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class NodeIdGenerator implements IdGenerator {
  roomId(): string {
    // Rejection sampling for a uniform distribution.
    const out: string[] = [];
    while (out.length < 10) {
      for (const b of randomBytes(16)) {
        if (b < 256 - (256 % ROOM_ALPHABET.length)) out.push(ROOM_ALPHABET[b % ROOM_ALPHABET.length]!);
        if (out.length === 10) break;
      }
    }
    return out.join('');
  }

  memberId(): string {
    return randomUUID();
  }
}

export function generateEncryptionKey(): string {
  return randomBytes(32).toString('base64');
}
