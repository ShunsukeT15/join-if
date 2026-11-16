import type { AdminMember, AdminViewResponse, UpdateSettingsRequest } from '@himitsu/contracts';
import { LIMITS } from '@himitsu/contracts';
import { useState, type FormEvent } from 'react';
import { useLocation, useParams } from 'react-router';
import { useApi } from '../api/ApiProvider';
import { ApiError } from '../api/client';
import { AnsweredPill, AnswerProgress, ErrorView, EventHeader, ResultCard } from '../components/room';
import { CopyButton, Notice, Spinner, UrlBox, useConfirm, useToast } from '../components/ui';
import {
  deadlineLabel,
  formatDeadline,
  fromLocalInput,
  groupMessage,
  inviteMessage,
  reminderMessage,
  toLocalInput,
  urls,
} from '../lib/format';
import { tokenFromHash } from '../lib/tokenStore';
import { useLoad } from '../lib/useAsync';

export function AdminPage() {
  const { roomId = '' } = useParams();
  const location = useLocation();
  const token = tokenFromHash(location.hash);
  const justCreated = Boolean((location.state as { justCreated?: boolean } | null)?.justCreated);
  const api = useApi();
  const toast = useToast();
  const { ask, dialog } = useConfirm();
  const { data, setData, error, loading, reload } = useLoad(`${roomId}:${token}`, () => api.getAdminView(roomId, token));

  /** Runs a mutation; returns false (after showing the error) when it failed. */
  const run = async (fn: () => Promise<AdminViewResponse | void>, done?: string): Promise<boolean> => {
    try {
      const v = await fn();
      if (v) setData(v);
      else await reload();
      if (done) toast(done);
      return true;
    } catch (e) {
      const fieldMsg = e instanceof ApiError ? Object.values(e.fields)[0] : undefined;
      toast(fieldMsg ?? (e instanceof ApiError ? e.message : 'エラーが発生しました'));
      await reload();
      return false;
    }
  };

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorView error={error} />;

  const isOpen = data.room.status === 'open';
  const isGroup = data.room.inviteMode === 'group';
  const adminUrl = urls.admin(roomId, token);
  const deadline = deadlineLabel(data.room);

  return (
    <>
      {justCreated ? (
        <section className="card stack">
          <Notice tone="warn" title="この管理用URLを必ず保存してください">
            ルームを管理できるのはこのURLだけです。なくすと復旧できません。ブックマークするか、自分だけが見られる場所にメモしてください。
          </Notice>
          <UrlBox url={adminUrl} />
          <p className="muted small" style={{ margin: 0 }}>
            {isGroup
              ? 'このURLはメンバーに送らないでください。メンバーには下の「グループ用URL」を送ります。'
              : 'このURLはメンバーに送らないでください。メンバーには下の「招待URL」を一人ずつ送ります。'}
          </p>
        </section>
      ) : null}

      <EventHeader room={data.room} />

      <SettingsCard data={data} onSave={(patch) => run(() => api.updateSettings(roomId, token, patch), '保存しました')} />

      {data.result && <ResultCard result={data.result} members={data.members} />}

      {isGroup && data.groupToken && (
        <GroupInviteCard
          url={urls.group(roomId, data.groupToken)}
          title={data.room.title}
          deadline={deadline}
          unanswered={data.members.filter((m) => !m.answered).map((m) => m.name)}
          isOpen={isOpen}
          hasMembers={data.members.length > 0}
          onReissue={() =>
            ask(
              {
                title: 'グループ用URLを作り直しますか？',
                body: (
                  <>
                    今のグループ用URLは使えなくなります。新しいURLをグループに送り直してください。
                    <br />
                    すでに名前を選んだ人の回答用URLと回答は、そのまま使えます。
                  </>
                ),
                confirmLabel: '作り直す',
                danger: true,
              },
              async () => {
                await run(() => api.reissueGroupToken(roomId, token).then(() => undefined), 'グループ用URLを作り直しました');
              },
            )
          }
        />
      )}

      <section className="card">
        <h2 className="card__title">メンバー</h2>
        <p className="card__sub">回答済みかどうかだけが表示されます。回答の内容は誰にも見えません。</p>
        <AnswerProgress members={data.members} />
        {isOpen && (
          <AddMemberForm
            disabled={data.members.length >= LIMITS.maxMembers}
            onAdd={async (name) => {
              await api.addMember(roomId, token, name);
              await reload();
            }}
          />
        )}
        {data.members.length === 0 ? (
          <p className="empty">
            {isGroup
              ? '名前を追加すると、グループ用URLを開いた人がその名前を選べるようになります'
              : '名前を追加すると、その人専用の招待URLが発行されます'}
          </p>
        ) : (
          <div>
            {data.members.map((m) => (
              <MemberAdminRow
                key={m.id}
                member={m}
                isOpen={isOpen}
                isGroup={isGroup}
                inviteText={
                  m.inviteToken
                    ? inviteMessage({
                        name: m.name,
                        title: data.room.title,
                        deadlineText: deadline,
                        url: urls.invite(roomId, m.inviteToken),
                      })
                    : ''
                }
                inviteUrl={m.inviteToken ? urls.invite(roomId, m.inviteToken) : ''}
                onReissue={() =>
                  ask(
                    isGroup
                      ? {
                          title: `「${m.name}」をリセットしますか？`,
                          body: (
                            <>
                              この名前をもう一度選べるようにします。今の回答用URLは使えなくなります。
                              <br />
                              <strong>この人の回答は削除され、名前を選び直して回答してもらう必要があります。</strong>
                            </>
                          ),
                          confirmLabel: 'リセットする',
                          danger: true,
                        }
                      : {
                          title: `${m.name}さんの招待URLを再発行しますか？`,
                          body: (
                            <>
                              古い招待URLと回答用URLは使えなくなります。
                              <br />
                              <strong>この人の回答は削除され、もう一度回答してもらう必要があります。</strong>
                            </>
                          ),
                          confirmLabel: '再発行する',
                          danger: true,
                        },
                    async () => {
                      await run(
                        () => api.reissueInvite(roomId, token, m.id).then(() => undefined),
                        isGroup ? 'リセットしました' : '再発行しました',
                      );
                    },
                  )
                }
                onRemove={() =>
                  ask(
                    {
                      title: `${m.name}さんをメンバーから外しますか？`,
                      body: 'この人の招待URL・回答用URLは使えなくなり、回答も削除されます。',
                      confirmLabel: '削除する',
                      danger: true,
                    },
                    async () => {
                      await run(() => api.removeMember(roomId, token, m.id), '削除しました');
                    },
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className="card stack">
        {isOpen ? (
          <>
            <h2 className="card__title" style={{ margin: 0 }}>
              締め切り
            </h2>
            <p className="muted small" style={{ margin: 0 }}>
              締め切るとサーバーで集計し、参加・不参加の結果を全員に表示します。あとから受付を再開することもできます。
            </p>
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={data.members.length === 0}
              onClick={() =>
                ask(
                  {
                    title: '締め切って結果を出しますか？',
                    body:
                      data.unansweredCount > 0 ? (
                        <>
                          <strong>未回答の人が {data.unansweredCount} 人います。</strong>
                          <br />
                          未回答の人は「不参加」として扱われます。
                          {data.room.deadlineAt && (
                            <>
                              <br />
                              自動締切（{formatDeadline(data.room.deadlineAt)}）を待たずに締め切ります。
                            </>
                          )}
                        </>
                      ) : (
                        '全員が回答済みです。'
                      ),
                    confirmLabel: '締め切る',
                  },
                  async () => {
                    await run(() => api.closeRoom(roomId, token), '締め切りました');
                  },
                )
              }
            >
              締め切って結果を出す
            </button>
          </>
        ) : (
          <>
            <h2 className="card__title" style={{ margin: 0 }}>
              受付の再開
            </h2>
            <p className="muted small" style={{ margin: 0 }}>
              再開すると結果は非表示になります。回答はそのまま残り、メンバーは回答を変更できるようになります。
              過ぎた自動締切の日時は解除されるので、必要なら「イベント情報を編集」で設定し直してください。
            </p>
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() =>
                ask(
                  {
                    title: '受付を再開しますか？',
                    body: '結果は非表示になります。回答はそのまま残ります。',
                    confirmLabel: '再開する',
                  },
                  async () => {
                    await run(() => api.reopenRoom(roomId, token), '受付を再開しました');
                  },
                )
              }
            >
              受付を再開する
            </button>
          </>
        )}
      </section>

      {!justCreated && (
        <section className="card stack">
          <h2 className="card__title" style={{ margin: 0 }}>
            管理用URL
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            このページのURLです。メンバーには送らず、自分だけで保管してください。
          </p>
          <UrlBox url={adminUrl} />
        </section>
      )}
      {dialog}
    </>
  );
}

function SettingsCard({
  data,
  onSave,
}: {
  data: AdminViewResponse;
  onSave: (patch: UpdateSettingsRequest) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(data.room.title);
  const [deadlineText, setDeadlineText] = useState(data.room.deadlineText);
  const [deadlineLocal, setDeadlineLocal] = useState(toLocalInput(data.room.deadlineAt));
  const [message, setMessage] = useState(data.room.message);
  const [busy, setBusy] = useState(false);

  if (!editing) {
    return (
      <div className="btn-row" style={{ marginTop: -8 }}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            setTitle(data.room.title);
            setDeadlineText(data.room.deadlineText);
            setDeadlineLocal(toLocalInput(data.room.deadlineAt));
            setMessage(data.room.message);
            setEditing(true);
          }}
        >
          ✎ イベント情報を編集
        </button>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const patch: UpdateSettingsRequest = { title, deadlineText, message };
    // Send the deadline only when it changed (an unchanged past value would be rejected).
    if (deadlineLocal !== toLocalInput(data.room.deadlineAt)) patch.deadlineAt = fromLocalInput(deadlineLocal);
    const ok = await onSave(patch);
    setBusy(false);
    if (ok) setEditing(false);
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2 className="card__title">イベント情報</h2>
      <div className="field">
        <label className="field__label" htmlFor="s-title">
          イベント名
        </label>
        <input id="s-title" className="input" value={title} maxLength={LIMITS.titleMax} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="s-deadline-at">
          自動で締め切る日時
        </label>
        <div className="inline-form">
          <input
            id="s-deadline-at"
            type="datetime-local"
            className="input"
            value={deadlineLocal}
            onChange={(e) => setDeadlineLocal(e.target.value)}
          />
          {deadlineLocal && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setDeadlineLocal('')}>
              解除
            </button>
          )}
        </div>
        <span className="field__hint">空欄なら手動で締め切ります。</span>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="s-deadline">
          締切のメモ（表示のみ）
        </label>
        <input
          id="s-deadline"
          className="input"
          value={deadlineText}
          maxLength={LIMITS.deadlineTextMax}
          onChange={(e) => setDeadlineText(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="s-message">
          メッセージ
        </label>
        <textarea
          id="s-message"
          className="textarea"
          value={message}
          maxLength={LIMITS.messageMax}
          onChange={(e) => setMessage(e.target.value)}
        />
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

function AddMemberForm({ onAdd, disabled }: { onAdd: (name: string) => Promise<void>; disabled: boolean }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onAdd(name);
      setName('');
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.name ?? err.message) : '追加できませんでした');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} style={{ margin: '14px 0 6px' }}>
      <label htmlFor="new-member" className="visually-hidden">
        メンバーの名前
      </label>
      <div className="inline-form">
        <input
          id="new-member"
          className={`input${error ? ' input--error' : ''}`}
          placeholder="名前（ニックネーム可）"
          value={name}
          maxLength={LIMITS.nameMax}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
        />
        <button type="submit" className="btn btn--primary" disabled={busy || disabled || !name.trim()}>
          追加
        </button>
      </div>
      {error && <div className="field__error" style={{ marginTop: 6 }}>{error}</div>}
      {disabled && <div className="field__hint" style={{ marginTop: 6 }}>メンバーは{LIMITS.maxMembers}人までです</div>}
    </form>
  );
}

function MemberAdminRow({
  member,
  isOpen,
  isGroup,
  inviteUrl,
  inviteText,
  onReissue,
  onRemove,
}: {
  member: AdminMember;
  isOpen: boolean;
  isGroup: boolean;
  inviteUrl: string;
  inviteText: string;
  onReissue: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="member-admin">
      <div className="member-admin__top">
        <span className="member-row__name">{member.name}</span>
        <AnsweredPill answered={member.answered} />
      </div>
      <div className="member-admin__bottom">
        {isGroup ? (
          member.inviteUsed ? (
            <span className="pill pill--used">名前 選択済み</span>
          ) : (
            <span className="pill pill--todo">名前 未選択</span>
          )
        ) : member.inviteToken ? (
          <>
            <CopyButton text={inviteText} label="案内文をコピー" size="sm" variant="primary" done="案内文をコピーしました" />
            <CopyButton text={inviteUrl} label="URLのみ" size="sm" done="招待URLをコピーしました" />
          </>
        ) : (
          <span className="pill pill--used">招待URL 使用済み</span>
        )}
        {isOpen && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
            {(!isGroup || member.inviteUsed) && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={onReissue}>
                {isGroup ? 'リセット' : '再発行'}
              </button>
            )}
            <button type="button" className="btn btn--ghost btn--sm" onClick={onRemove}>
              削除
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function GroupInviteCard({
  url,
  title,
  deadline,
  unanswered,
  isOpen,
  hasMembers,
  onReissue,
}: {
  url: string;
  title: string;
  deadline: string;
  unanswered: string[];
  isOpen: boolean;
  hasMembers: boolean;
  onReissue: () => void;
}) {
  return (
    <section className="card stack">
      <h2 className="card__title" style={{ margin: 0 }}>
        グループ用URL
      </h2>
      <p className="muted small" style={{ margin: 0 }}>
        LINE グループなどに、このURLを1つ送るだけで全員が回答できます。各自が自分の名前を選んで回答します（名前は先着1回）。
      </p>
      <UrlBox url={url} />
      <div className="btn-row btn-row--stack">
        <CopyButton text={groupMessage({ title, deadline, url })} label="案内文をコピー" variant="primary" done="案内文をコピーしました" />
        {isOpen && unanswered.length > 0 && (
          <CopyButton
            text={reminderMessage({ title, deadline, unanswered, url })}
            label={`リマインド文をコピー（未回答 ${unanswered.length}人）`}
            done="リマインド文をコピーしました"
          />
        )}
      </div>
      {!hasMembers && <Notice tone="info">先に下でメンバーの名前を追加してください。追加した名前が選択肢になります。</Notice>}
      <div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onReissue}>
          URLを作り直す（外部に漏れたとき）
        </button>
      </div>
    </section>
  );
}
