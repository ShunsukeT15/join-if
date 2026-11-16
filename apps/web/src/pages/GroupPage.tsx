import type { GroupMember } from '@himitsu/contracts';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useApi } from '../api/ApiProvider';
import { ApiError } from '../api/client';
import { ErrorView, EventHeader } from '../components/room';
import { Notice, Spinner, useConfirm, useToast } from '../components/ui';
import { tokenFromHash, tokenStore } from '../lib/tokenStore';
import { useLoad } from '../lib/useAsync';

/**
 * Group invitation: everyone in the group opens the same URL and picks their own name.
 * A name can be picked only once; picking it issues the person's private member URL.
 */
export function GroupPage() {
  const { roomId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const api = useApi();
  const toast = useToast();
  const { ask, dialog } = useConfirm();
  const groupToken = tokenFromHash(location.hash);
  const { data, error, loading, reload } = useLoad(`${roomId}:${groupToken}`, () => api.getGroupView(roomId, groupToken));
  const [takenNotice, setTakenNotice] = useState<string | null>(null);
  const saved = tokenStore.getMemberToken(roomId);

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorView error={error} />;

  const pick = (m: GroupMember) =>
    ask(
      {
        title: `あなたは「${m.name}」さんですか？`,
        body: (
          <>
            一度選ぶと、ほかの人はこの名前を選べなくなります。<strong>自分の名前だけを選んでください。</strong>
            <br />
            選んだあとは、あなた専用の回答用URLが表示されます。
          </>
        ),
        confirmLabel: `${m.name}さんとして回答する`,
      },
      async () => {
        try {
          const { memberToken } = await api.claimName(roomId, groupToken, m.id);
          const stored = tokenStore.setMemberToken(roomId, memberToken);
          navigate(`/r/${roomId}/m#${memberToken}`, { replace: true, state: { justClaimed: true, stored } });
        } catch (e) {
          if (e instanceof ApiError && e.status === 410) {
            setTakenNotice(m.name);
            await reload();
          } else {
            toast(e instanceof ApiError ? e.message : 'エラーが発生しました');
          }
        }
      },
    );

  const available = data.members.filter((m) => !m.taken).length;

  return (
    <>
      <EventHeader room={data.room} />

      {saved && (
        <section className="card stack">
          <Notice tone="info" title="このブラウザで名前を選んだことがあります">
            回答の確認・変更は、回答用URLから行えます。
          </Notice>
          <Link className="btn btn--primary btn--block" to={`/r/${roomId}/m#${saved}`}>
            自分の回答画面を開く
          </Link>
        </section>
      )}

      {takenNotice && (
        <Notice tone="warn" title={`「${takenNotice}」はすでに選ばれています`}>
          自分で選んだ覚えがない場合は、招待した人に「リセット」を依頼してください。リセット後にもう一度選べます。
        </Notice>
      )}

      <section className="card">
        <h2 className="card__title">あなたの名前を選んでください</h2>
        <p className="card__sub">
          名前は1人1回だけ選べます。すでに選ばれた名前は押せません。
          {data.room.status === 'closed' && ' 受付は終了していますが、名前を選ぶと結果を確認できます。'}
        </p>
        {data.members.length === 0 ? (
          <p className="empty">まだメンバーが登録されていません</p>
        ) : (
          <div className="name-grid">
            {data.members.map((m) => (
              <button key={m.id} type="button" className="name-button" disabled={m.taken} onClick={() => pick(m)}>
                {m.name}
                {m.taken && <span className="name-button__state">選択済み</span>}
              </button>
            ))}
          </div>
        )}
        {data.members.length > 0 && available === 0 && (
          <p className="muted small" style={{ margin: '12px 0 0' }}>
            すべての名前が選ばれています。自分の名前が見つからない場合は、招待した人に確認してください。
          </p>
        )}
        <ul className="privacy-note">
          <li>回答内容は、招待した人を含め誰にも表示されません。</li>
          <li>名前を選ぶと、あなただけが知っている回答用URLが発行されます。</li>
        </ul>
      </section>
      {dialog}
    </>
  );
}
