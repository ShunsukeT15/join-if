import type { CommunitySummary, EventAdminViewResponse, InviteMode } from '@himitsu/contracts';
import { LIMITS } from '@himitsu/contracts';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useApi } from '../api/ApiProvider';
import { ApiError } from '../api/client';
import { DangerZone } from '../components/DangerZone';
import { ErrorView } from '../components/room';
import { Notice, Spinner, UrlBox, useToast } from '../components/ui';
import { formatDeadline, fromLocalInput, urls } from '../lib/format';
import { tokenFromHash } from '../lib/tokenStore';
import { useLoad } from '../lib/useAsync';

/**
 * Organizer's page for an event: communities (each a room with its own invitation,
 * deadline and result) and the event totals. Only the organizer ever sees this page.
 */
export function EventAdminPage() {
  const { eventId = '' } = useParams();
  const location = useLocation();
  const token = tokenFromHash(location.hash);
  const justCreated = Boolean((location.state as { justCreated?: boolean } | null)?.justCreated);
  const api = useApi();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, setData, error, loading, reload } = useLoad(`${eventId}:${token}`, () =>
    api.getEventAdminView(eventId, token),
  );

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorView error={error} />;

  const adminUrl = urls.eventAdmin(eventId, token);

  return (
    <>
      {justCreated && (
        <section className="card stack">
          <Notice tone="warn" title="この管理用URLを必ず保存してください">
            イベントと、すべてのコミュニティを管理できるのはこのURLだけです。なくすと復旧できません。
          </Notice>
          <UrlBox url={adminUrl} />
          <p className="muted small" style={{ margin: 0 }}>
            このURLは誰にも送らないでください。次に、下の「コミュニティを追加」から招待するグループを作ります。
          </p>
        </section>
      )}

      <EventHeaderCard
        data={data}
        onSave={async (patch) => {
          try {
            setData(await api.updateEvent(eventId, token, patch));
            toast('保存しました');
            return true;
          } catch (e) {
            toast(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : '保存できませんでした');
            return false;
          }
        }}
      />

      <Totals data={data} />

      <section className="card">
        <h2 className="card__title">
          コミュニティ
          <span className="muted small">
            {data.communities.length} / {LIMITS.maxCommunities}
          </span>
        </h2>
        <p className="card__sub">招待・締め切り・結果はコミュニティごとです。回答者には自分のコミュニティしか見えません。</p>
        {data.communities.length === 0 ? (
          <p className="empty">まだコミュニティがありません。下から追加してください。</p>
        ) : (
          <div className="community-list">
            {data.communities.map((c) => (
              <CommunityCard key={c.roomId} c={c} href={`/r/${c.roomId}/admin#${token}`} />
            ))}
          </div>
        )}
      </section>

      {data.communities.length < LIMITS.maxCommunities && (
        <AddCommunityForm
          onAdd={async (req) => {
            await api.addCommunity(eventId, token, req);
            await reload();
            toast('コミュニティを追加しました');
          }}
        />
      )}

      {data.attendees.length > 0 && <Attendees data={data} />}

      <DangerZone
        title="イベントの削除"
        description="イベントと、すべてのコミュニティのメンバー・回答・結果を削除します。すべてのURLが使えなくなります。"
        buttonLabel="このイベントを削除"
        confirmName={data.event.title}
        onDelete={async () => {
          try {
            await api.deleteEvent(eventId, token);
            toast('削除しました');
            navigate('/', { replace: true, state: { deleted: true } });
          } catch (e) {
            toast(e instanceof ApiError ? e.message : '削除できませんでした');
          }
        }}
      />

      {!justCreated && (
        <section className="card stack">
          <h2 className="card__title" style={{ margin: 0 }}>
            管理用URL
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            このページのURLです。各コミュニティの管理画面もこのURLの権限で開けます。誰にも送らないでください。
          </p>
          <UrlBox url={adminUrl} />
        </section>
      )}
    </>
  );
}

function EventHeaderCard({
  data,
  onSave,
}: {
  data: EventAdminViewResponse;
  onSave: (patch: { title: string; message: string }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(data.event.title);
  const [message, setMessage] = useState(data.event.message);
  const [busy, setBusy] = useState(false);

  if (!editing) {
    return (
      <section className="card">
        <div className="status-banner">
          <span className="pill pill--event">イベント</span>
        </div>
        <h1 className="page-title">{data.event.title}</h1>
        {data.event.message && <p className="message">{data.event.message}</p>}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setTitle(data.event.title);
              setMessage(data.event.message);
              setEditing(true);
            }}
          >
            ✎ イベント情報を編集
          </button>
        </div>
      </section>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave({ title, message });
    setBusy(false);
    if (ok) setEditing(false);
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2 className="card__title">イベント情報</h2>
      <div className="field">
        <label className="field__label" htmlFor="e-title">
          イベント名
        </label>
        <input id="e-title" className="input" value={title} maxLength={LIMITS.titleMax} onChange={(e) => setTitle(e.target.value)} />
        <span className="field__hint">すべてのコミュニティの回答画面に表示されます。</span>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="e-message">
          メッセージ
        </label>
        <textarea
          id="e-message"
          className="textarea"
          value={message}
          maxLength={LIMITS.messageMax}
          onChange={(e) => setMessage(e.target.value)}
        />
        <span className="field__hint">これから追加するコミュニティの初期メッセージになります。</span>
      </div>
      <div className="btn-row">
        <button type="submit" className="btn btn--primary" disabled={busy || !title.trim()}>
          保存
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => setEditing(false)} disabled={busy}>
          キャンセル
        </button>
      </div>
    </form>
  );
}

function Totals({ data }: { data: EventAdminViewResponse }) {
  const t = data.totals;
  const all = data.communities.length;
  return (
    <section className="card">
      <h2 className="card__title">イベント全体</h2>
      <div className="stat-grid">
        <div className="stat">
          <span className="stat__label">回答</span>
          <span className="stat__value">
            {t.answeredCount}
            <small> / {t.memberCount}人</small>
          </span>
        </div>
        <div className="stat stat--accent">
          <span className="stat__label">参加（確定分）</span>
          <span className="stat__value">
            {t.attendingCount}
            <small>人</small>
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">締め切り済み</span>
          <span className="stat__value">
            {t.closedCount}
            <small> / {all}</small>
          </span>
        </div>
      </div>
      {all > 0 && t.closedCount < all && (
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          参加人数は、締め切ったコミュニティの分だけを数えています。
        </p>
      )}
    </section>
  );
}

function CommunityCard({ c, href }: { c: CommunitySummary; href: string }) {
  const pct = c.memberCount ? Math.round((c.answeredCount / c.memberCount) * 100) : 0;
  return (
    <Link to={href} className="community">
      <div className="community__top">
        <span className="community__name">{c.name}</span>
        {c.status === 'open' ? <span className="pill pill--done">受付中</span> : <span className="pill pill--used">締切済み</span>}
      </div>
      <div className="community__meta">
        <span>{c.inviteMode === 'group' ? 'グループ招待' : '一人ずつ招待'}</span>
        {c.deadlineAt && c.status === 'open' && <span>締切 {formatDeadline(c.deadlineAt)}</span>}
      </div>
      <div className="progress" style={{ margin: '8px 0 0' }}>
        <span>
          回答 {c.answeredCount} / {c.memberCount}
        </span>
        <div className="progress__bar" aria-hidden>
          <div className="progress__fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="community__bottom">
        <span>{c.attendingCount === null ? '結果：締め切り後に表示' : `参加 ${c.attendingCount}人`}</span>
        <span className="community__open">管理する ›</span>
      </div>
    </Link>
  );
}

function AddCommunityForm({
  onAdd,
}: {
  onAdd: (req: { name: string; inviteMode: InviteMode; deadlineAt: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [inviteMode, setInviteMode] = useState<InviteMode>('group');
  const [deadlineLocal, setDeadlineLocal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onAdd({ name, inviteMode, deadlineAt: fromLocalInput(deadlineLocal) });
      setName('');
      setDeadlineLocal('');
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'internal', '追加できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2 className="card__title">コミュニティを追加</h2>
      <div className="field">
        <label className="field__label" htmlFor="c-name">
          コミュニティ名
        </label>
        <input
          id="c-name"
          className={`input${error?.fields.name ? ' input--error' : ''}`}
          value={name}
          maxLength={LIMITS.communityNameMax}
          placeholder="例：新郎 大学の友人"
          onChange={(e) => setName(e.target.value)}
        />
        {error?.fields.name && <span className="field__error">{error.fields.name}</span>}
      </div>
      <fieldset className="field mode-field">
        <legend className="field__label">招待のしかた</legend>
        <div className="mode-options">
          {(
            [
              ['group', 'グループにまとめて招待', 'LINE グループなどに URL を1つ送る'],
              ['individual', '一人ずつ招待', 'メンバーごとに専用の招待URLを送る'],
            ] as const
          ).map(([value, title, body]) => (
            <label key={value} className="mode-option" data-selected={inviteMode === value}>
              <input type="radio" name="c-mode" checked={inviteMode === value} onChange={() => setInviteMode(value)} />
              <span className="mode-option__title">{title}</span>
              <span className="mode-option__body">{body}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label className="field__label" htmlFor="c-deadline">
          自動で締め切る日時 <span className="field__hint">任意</span>
        </label>
        <input
          id="c-deadline"
          type="datetime-local"
          className={`input${error?.fields.deadlineAt ? ' input--error' : ''}`}
          value={deadlineLocal}
          onChange={(e) => setDeadlineLocal(e.target.value)}
        />
        {error?.fields.deadlineAt && <span className="field__error">{error.fields.deadlineAt}</span>}
      </div>
      {error && !Object.keys(error.fields).length && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="danger">{error.message}</Notice>
        </div>
      )}
      <button type="submit" className="btn btn--primary btn--block" disabled={busy || !name.trim()}>
        {busy ? '追加中…' : '追加する'}
      </button>
      <p className="muted small" style={{ margin: '10px 0 0' }}>
        追加したら「管理する」からメンバーを登録して、招待を送ります。
      </p>
    </form>
  );
}

function Attendees({ data }: { data: EventAdminViewResponse }) {
  const byCommunity = new Map<string, string[]>();
  for (const a of data.attendees) byCommunity.set(a.community, [...(byCommunity.get(a.community) ?? []), a.name]);
  return (
    <section className="card">
      <h2 className="card__title">
        参加者一覧
        <span className="muted small">{data.attendees.length}人</span>
      </h2>
      <p className="card__sub">締め切ったコミュニティの参加者です。</p>
      <div className="stack">
        {[...byCommunity].map(([community, names]) => (
          <div key={community} className="result-col result-col--attend">
            <h3>
              {community} <span>{names.length}人</span>
            </h3>
            <ul>
              {names.map((n, i) => (
                <li key={`${n}-${i}`}>{n}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
