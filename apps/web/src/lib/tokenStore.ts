/**
 * Remembers the member token on this browser so reopening the (used) invite URL
 * jumps to the member page (spec F-07, §5.6). Some in-app browsers block storage;
 * every access is guarded and the UI falls back to bookmark guidance.
 */
const key = (roomId: string) => `himitsu:member:${roomId}`;

export const tokenStore = {
  getMemberToken(roomId: string): string | null {
    try {
      return window.localStorage.getItem(key(roomId));
    } catch {
      return null;
    }
  },
  setMemberToken(roomId: string, token: string): boolean {
    try {
      window.localStorage.setItem(key(roomId), token);
      return window.localStorage.getItem(key(roomId)) === token;
    } catch {
      return false;
    }
  },
  clearMemberToken(roomId: string): void {
    try {
      window.localStorage.removeItem(key(roomId));
    } catch {
      /* ignore */
    }
  },
};

/** Token from the URL fragment. Fragments are never sent to servers or in Referer headers. */
export function tokenFromHash(hash: string): string {
  return decodeURIComponent(hash.replace(/^#/, '')).trim();
}
