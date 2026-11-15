import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import type { ApiClient } from '../api/client';
import { useApi } from '../api/ApiProvider';
import { ApiError } from '../api/client';
import { ErrorView } from '../components/room';
import { Notice, Spinner } from '../components/ui';
import { tokenFromHash, tokenStore } from '../lib/tokenStore';

type Outcome = { kind: 'claimed'; memberToken: string; stored: boolean } | { kind: 'used' } | { kind: 'error'; error: unknown };

/**
 * One claim per invite token per page load. React may run effects twice in development;
 * a second claim would get 410 and wrongly show "used".
 */
const inflight = new Map<string, Promise<Outcome>>();

function claimOnce(api: ApiClient, roomId: string, inviteToken: string): Promise<Outcome> {
  const key = `${roomId}:${inviteToken}`;
  let p = inflight.get(key);
  if (!p) {
    p = api
      .claimInvite(roomId, inviteToken)
      .then<Outcome>(({ memberToken }) => ({
        kind: 'claimed',
        memberToken,
        stored: tokenStore.setMemberToken(roomId, memberToken),
      }))
      .catch<Outcome>((error) => (error instanceof ApiError && error.status === 410 ? { kind: 'used' } : { kind: 'error', error }));
    inflight.set(key, p);
  }
  return p;
}

export function InvitePage() {
  const { roomId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const api = useApi();
  const inviteToken = tokenFromHash(location.hash);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!inviteToken) {
      setOutcome({ kind: 'error', error: new ApiError(404, 'not_found', '') });
      return;
    }
    void claimOnce(api, roomId, inviteToken).then((o) => {
      if (cancelled) return;
      if (o.kind === 'claimed') {
        // replace: the invite URL never stays in history.
        navigate(`/r/${roomId}/m#${o.memberToken}`, { replace: true, state: { justClaimed: true, stored: o.stored } });
        return;
      }
      if (o.kind === 'used') {
        const saved = tokenStore.getMemberToken(roomId);
        if (saved) {
          navigate(`/r/${roomId}/m#${saved}`, { replace: true });
          return;
        }
      }
      setOutcome(o);
    });
    return () => {
      cancelled = true;
    };
  }, [api, roomId, inviteToken, navigate]);

  if (!outcome || outcome.kind === 'claimed') return <Spinner label="招待を確認しています" />;
  if (outcome.kind === 'error') return <ErrorView error={outcome.error} />;

  return (
    <section className="card stack">
      <Notice tone="warn" title="このURLは使用済みです">
        この招待URLは、すでに一度開かれています。
      </Notice>
      <p style={{ margin: 0 }}>
        自分で開いた覚えがある場合は、そのとき表示された<strong>回答用のURL</strong>
        （ブックマークなど）から開いてください。
      </p>
      <p style={{ margin: 0 }}>
        覚えがない場合や回答用URLが分からない場合は、<strong>招待した人に招待URLの再発行を依頼してください。</strong>
        再発行すると、以前のURLは使えなくなります。
      </p>
      <p className="muted small" style={{ margin: 0 }}>
        自分より先に誰かが開いた可能性もあります。その場合も再発行で、あなただけの新しいURLを受け取れます。
      </p>
    </section>
  );
}
