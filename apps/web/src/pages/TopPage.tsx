import type { InviteMode } from '@himitsu/contracts';
import { LIMITS } from '@himitsu/contracts';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../api/ApiProvider';
import { ApiError } from '../api/client';
import { Notice } from '../components/ui';
import { fromLocalInput } from '../lib/format';

const MODES: { value: InviteMode; title: string; body: string }[] = [
  {
    value: 'individual',
    title: '一人ずつ招待',
    body: 'メンバーごとに専用の招待URLを送ります。URLは1回だけ使え、なりすましに強い方式です。',
  },
  {
    value: 'group',
    title: 'グループにまとめて招待',
    body: 'LINE グループなどに URL を1つ送るだけ。各自が名前を選んで回答します。リマインドも一括で送れます。',
  },
];

export function TopPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [deadlineText, setDeadlineText] = useState('');
  const [deadlineLocal, setDeadlineLocal] = useState('');
  const [message, setMessage] = useState('');
  const [inviteMode, setInviteMode] = useState<InviteMode>('individual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.createRoom({
        title,
        deadlineText,
        message,
        inviteMode,
        deadlineAt: fromLocalInput(deadlineLocal),
      });
      navigate(`/r/${res.roomId}/admin#${res.adminToken}`, { state: { justCreated: true } });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'internal', '作成できませんでした'));
      setBusy(false);
    }
  };

  return (
    <>
      <section className="hero">
        <h1>
          誰が何と答えたか、
          <br />
          誰にも見せない出欠確認。
        </h1>
        <p>「Aさんが来るなら行く」のような条件付きの回答もOK。条件を守りながら参加者が最大になる組み合わせを自動で出します。</p>
      </section>

      <ol className="steps">
        <li className="step">
          <span className="step__num">1</span>
          <b>ルームを作る</b>
          <span className="step__desc">アカウント登録は不要です</span>
        </li>
        <li className="step">
          <span className="step__num">2</span>
          <b>URLを送る</b>
          <span className="step__desc">一人ずつでも、グループにまとめてでも</span>
        </li>
        <li className="step">
          <span className="step__num">3</span>
          <b>締め切って結果</b>
          <span className="step__desc">参加・不参加だけが表示されます</span>
        </li>
      </ol>

      <form className="card" onSubmit={submit} noValidate>
        <h2 className="card__title">ルームを作る</h2>
        <div className="field">
          <label className="field__label" htmlFor="title">
            イベント名 <span className="field__hint">必須</span>
          </label>
          <input
            id="title"
            className={`input${error?.fields.title ? ' input--error' : ''}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：太郎＆花子 結婚式"
            maxLength={LIMITS.titleMax}
            required
          />
          {error?.fields.title && <span className="field__error">{error.fields.title}</span>}
        </div>

        <fieldset className="field mode-field">
          <legend className="field__label">招待のしかた</legend>
          <div className="mode-options">
            {MODES.map((m) => (
              <label key={m.value} className="mode-option" data-selected={inviteMode === m.value}>
                <input
                  type="radio"
                  name="inviteMode"
                  value={m.value}
                  checked={inviteMode === m.value}
                  onChange={() => setInviteMode(m.value)}
                />
                <span className="mode-option__title">{m.title}</span>
                <span className="mode-option__body">{m.body}</span>
              </label>
            ))}
          </div>
          <span className="field__hint">あとから変更はできません。</span>
        </fieldset>

        <div className="field">
          <label className="field__label" htmlFor="deadlineAt">
            自動で締め切る日時 <span className="field__hint">任意</span>
          </label>
          <input
            id="deadlineAt"
            type="datetime-local"
            className={`input${error?.fields.deadlineAt ? ' input--error' : ''}`}
            value={deadlineLocal}
            onChange={(e) => setDeadlineLocal(e.target.value)}
          />
          <span className="field__hint">この日時になると回答を締め切り、自動で結果を出します。空欄なら手動で締め切ります。</span>
          {error?.fields.deadlineAt && <span className="field__error">{error.fields.deadlineAt}</span>}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="deadline">
            締切のメモ <span className="field__hint">任意・表示のみ</span>
          </label>
          <input
            id="deadline"
            className="input"
            value={deadlineText}
            onChange={(e) => setDeadlineText(e.target.value)}
            placeholder="例：12月20日ごろまで"
            maxLength={LIMITS.deadlineTextMax}
          />
          {error?.fields.deadlineText && <span className="field__error">{error.fields.deadlineText}</span>}
        </div>
        <div className="field">
          <label className="field__label" htmlFor="message">
            メッセージ <span className="field__hint">任意</span>
          </label>
          <textarea
            id="message"
            className="textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="例：来年5月に式を予定しています。気軽に本音で答えてください。"
            maxLength={LIMITS.messageMax}
          />
          {error?.fields.message && <span className="field__error">{error.fields.message}</span>}
        </div>
        {error && !Object.keys(error.fields).length && (
          <div style={{ marginBottom: 14 }}>
            <Notice tone="danger">{error.message}</Notice>
          </div>
        )}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy || !title.trim()}>
          {busy ? '作成中…' : 'ルームを作成する'}
        </button>
      </form>

      <section className="card">
        <h2 className="card__title">Join if のしくみ</h2>
        <ul className="feature-list">
          <li>個別の回答内容は、招待した人にも他のメンバーにも表示されません。</li>
          <li>「行かない」と「条件が合わず不参加」は、どの画面でも区別されません。</li>
          <li>回答する人には、招待した人も知らない本人専用の回答用URLが発行されます。</li>
          <li>結婚式のほか、同窓会や旅行など、グループの集まり全般に使えます。</li>
        </ul>
      </section>
    </>
  );
}
