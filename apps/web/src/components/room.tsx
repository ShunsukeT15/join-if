import type { MemberSummary, ResultDto, RoomInfo } from '@himitsu/contracts';
import { Link } from 'react-router';
import { ApiError } from '../api/client';
import { deadlineLabel, formatDateTime } from '../lib/format';
import { Notice } from './ui';

export function EventHeader({ room }: { room: RoomInfo }) {
  return (
    <section className="card">
      <div className="status-banner">
        {room.status === 'open' ? (
          <span className="pill pill--done">受付中</span>
        ) : (
          <span className="pill pill--used">締切済み</span>
        )}
      </div>
      <h1 className="page-title">{room.title}</h1>
      {deadlineLabel(room) && <div className="event-meta">回答締切：{deadlineLabel(room)}</div>}
      {room.deadlineAt && room.deadlineText && <div className="event-meta">{room.deadlineText}</div>}
      {room.message && <p className="message">{room.message}</p>}
    </section>
  );
}

export function AnsweredPill({ answered }: { answered: boolean }) {
  return answered ? <span className="pill pill--done">回答済み</span> : <span className="pill pill--todo">未回答</span>;
}

export function AnswerProgress({ members }: { members: { answered: boolean }[] }) {
  const done = members.filter((m) => m.answered).length;
  const pct = members.length ? Math.round((done / members.length) * 100) : 0;
  return (
    <div className="progress">
      <span>
        回答 {done} / {members.length} 人
      </span>
      <div className="progress__bar" aria-hidden>
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function MemberStatusList({ members, selfId }: { members: MemberSummary[]; selfId?: string }) {
  if (members.length === 0) return <p className="empty">まだメンバーがいません</p>;
  return (
    <ul className="member-list">
      {members.map((m) => (
        <li key={m.id} className="member-row">
          <span className="member-row__name">
            {m.name}
            {m.id === selfId && <span className="member-row__you">あなた</span>}
          </span>
          <AnsweredPill answered={m.answered} />
        </li>
      ))}
    </ul>
  );
}

/** Final result: attending / not attending only. No reasons, ever. */
export function ResultCard({ result, members }: { result: ResultDto; members: MemberSummary[] }) {
  const attending = new Set(result.attending);
  const yes = members.filter((m) => attending.has(m.id));
  const no = members.filter((m) => !attending.has(m.id));
  return (
    <section className="card" aria-labelledby="result-title">
      <h2 className="card__title" id="result-title">
        最終結果
        <span className="muted small">{formatDateTime(result.computedAt)} 集計</span>
      </h2>
      <div className="result-grid">
        <div className="result-col result-col--attend">
          <h3>
            参加 <span>{yes.length}人</span>
          </h3>
          {yes.length ? (
            <ul>
              {yes.map((m) => (
                <li key={m.id}>{m.name}</li>
              ))}
            </ul>
          ) : (
            <span className="muted small">なし</span>
          )}
        </div>
        <div className="result-col result-col--absent">
          <h3>
            不参加 <span>{no.length}人</span>
          </h3>
          {no.length ? (
            <ul>
              {no.map((m) => (
                <li key={m.id}>{m.name}</li>
              ))}
            </ul>
          ) : (
            <span className="muted small">なし</span>
          )}
        </div>
      </div>
      <p className="muted small" style={{ margin: '12px 0 0' }}>
        「行かない」と「条件が合わず不参加」は区別していません。
      </p>
    </section>
  );
}

export function ErrorView({ error }: { error: unknown }) {
  const e = error instanceof ApiError ? error : null;
  let title = 'エラーが発生しました';
  let body = '時間をおいて、もう一度お試しください。';
  if (e?.status === 404) {
    title = 'ページが見つかりません';
    body =
      'URLが間違っているか、無効になっています。招待URLが再発行された・メンバーから外れた・ルームが削除された可能性があります。招待した人に確認してください。';
  } else if (e?.code === 'network') {
    body = e.message;
  } else if (e?.status === 429) {
    body = e.message;
  }
  return (
    <section className="card stack">
      <Notice tone="danger" title={title}>
        {body}
      </Notice>
      <div className="btn-row">
        <button type="button" className="btn btn--secondary" onClick={() => location.reload()}>
          再読み込み
        </button>
        <Link to="/" className="btn btn--ghost">
          トップへ
        </Link>
      </div>
    </section>
  );
}
