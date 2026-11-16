import { LIMITS } from '@himitsu/contracts';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../api/ApiProvider';
import { ApiError } from '../api/client';
import { Notice } from '../components/ui';

export function TopPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [deadlineText, setDeadlineText] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.createRoom({ title, deadlineText, message });
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
          <b>ルームを作る</b>アカウント登録は不要です
        </li>
        <li className="step">
          <span className="step__num">2</span>
          <b>招待URLを送る</b>一人ずつ専用のURLをLINEなどで
        </li>
        <li className="step">
          <span className="step__num">3</span>
          <b>締め切って結果</b>参加・不参加だけが表示されます
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
        <div className="field">
          <label className="field__label" htmlFor="deadline">
            回答締切 <span className="field__hint">任意・表示のみ</span>
          </label>
          <input
            id="deadline"
            className="input"
            value={deadlineText}
            onChange={(e) => setDeadlineText(e.target.value)}
            placeholder="例：12月20日まで"
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
          <li>招待URLは1回だけ使えます。開いた本人にだけ、招待した人も知らない回答用URLが発行されます。</li>
          <li>結婚式のほか、同窓会や旅行など、グループの集まり全般に使えます。</li>
        </ul>
      </section>
    </>
  );
}
