import type { AnswerDto, Choice, MemberSummary, MemberViewResponse, SaveAnswerRequest } from '@himitsu/contracts';
import { LIMITS } from '@himitsu/contracts';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useParams } from 'react-router';
import { useApi } from '../api/ApiProvider';
import { ApiError } from '../api/client';
import { AnswerProgress, ErrorView, EventHeader, MemberStatusList, ResultCard } from '../components/room';
import { Notice, Spinner, UrlBox, useToast } from '../components/ui';
import { describeCondition, describePattern, formatDateTime, urls } from '../lib/format';
import { tokenFromHash, tokenStore } from '../lib/tokenStore';
import { useLoad } from '../lib/useAsync';

export function MemberPage() {
  const { roomId = '' } = useParams();
  const location = useLocation();
  const token = tokenFromHash(location.hash);
  const state = (location.state as { justClaimed?: boolean; stored?: boolean } | null) ?? {};
  const api = useApi();
  const { data, setData, error, loading } = useLoad(`${roomId}:${token}`, () => api.getMemberView(roomId, token));

  useEffect(() => {
    if (error instanceof ApiError && error.status === 404 && tokenStore.getMemberToken(roomId) === token) {
      tokenStore.clearMemberToken(roomId); // reissued or removed
    }
  }, [error, roomId, token]);

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorView error={error} />;

  const memberUrl = urls.member(roomId, token);
  const isOpen = data.room.status === 'open';

  return (
    <>
      {state.justClaimed && (
        <section className="card stack">
          <Notice tone="success" title="あなた専用の回答用URLを発行しました">
            このページのURLは、あなたしか知りません（招待した人にも分かりません）。<strong>ブックマークしてください。</strong>
            回答の変更や結果の確認はこのURLから行います。
          </Notice>
          {state.stored === false && (
            <Notice tone="warn">
              このブラウザには保存できませんでした。招待URLはもう使えないため、必ずブックマークするか、下のURLをコピーして保管してください。
            </Notice>
          )}
          <UrlBox url={memberUrl} />
          <p className="muted small" style={{ margin: 0 }}>
            LINEなどのアプリ内で開いている場合は、URLをコピーしていつものブラウザで開くと確実です。
          </p>
        </section>
      )}

      <EventHeader room={data.room} />

      {data.result && <ResultCard result={data.result} members={data.members} />}

      {data.me.conditionNotice && (
        <Notice tone="warn" title="回答を見直してください">
          条件に選んだ人がメンバーから外れました。外れた人は「来ない人」として扱われます。
        </Notice>
      )}

      <section className="card">
        <h2 className="card__title">あなたの回答</h2>
        <MyStatus me={data.me} />
        {isOpen ? (
          <AnswerForm
            key={data.me.answer?.updatedAt ?? 'new'}
            me={data.me.id}
            members={data.members}
            answer={data.me.answer}
            onSave={async (req) => setData(await api.saveAnswer(roomId, token, req))}
          />
        ) : (
          <>
            <SavedAnswerSummary answer={data.me.answer} members={data.members} />
            <Notice tone="info">受付は終了しました。回答は変更できません。</Notice>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">メンバーの回答状況</h2>
        <AnswerProgress members={data.members} />
        <MemberStatusList members={data.members} selfId={data.me.id} />
      </section>

      {!state.justClaimed && (
        <section className="card stack">
          <h2 className="card__title" style={{ margin: 0 }}>
            回答用URL
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            あなただけのURLです。他の人に教えないでください。別の端末で開くときはこのURLを使います。
          </p>
          <UrlBox url={memberUrl} />
        </section>
      )}
    </>
  );
}

function MyStatus({ me }: { me: MemberViewResponse['me'] }) {
  return (
    <div className="stack small muted" style={{ marginBottom: 14, gap: 2 }}>
      {me.answer ? (
        <span>
          <strong style={{ color: 'var(--primary-hover)' }}>回答済み</strong>（最終更新：{formatDateTime(me.answer.updatedAt)}、保存 {me.saveCount} 回）
        </span>
      ) : (
        <span>
          <strong>未回答</strong>
        </span>
      )}
      {me.claimedAt && <span>このURLは {formatDateTime(me.claimedAt)} に有効化されました。</span>}
      <span>覚えのない更新がある場合は、招待した人に再発行を依頼してください。</span>
    </div>
  );
}

const CHOICES: { value: Choice; label: string; icon: string }[] = [
  { value: 'yes', label: '行く', icon: '◯' },
  { value: 'no', label: '行かない', icon: '✕' },
  { value: 'cond', label: '条件付きで行く', icon: '△' },
];

function nameMap(members: MemberSummary[]) {
  return new Map(members.map((m) => [m.id, m.name]));
}

function SavedAnswerSummary({ answer, members }: { answer: AnswerDto | null; members: MemberSummary[] }) {
  if (!answer) return <p className="muted">回答していません（不参加として扱われました）。</p>;
  const names = nameMap(members);
  const label = CHOICES.find((c) => c.value === answer.choice)?.label;
  return (
    <div className="summary" style={{ marginBottom: 12 }}>
      {answer.choice === 'cond'
        ? describeCondition(
            answer.patterns.map((p) => ({
              people: p.people.map((id) => names.get(id) ?? '（外れた人）'),
              need: p.need,
              minTotal: p.minTotal,
            })),
          )
        : label}
    </div>
  );
}

/** Editable state of one pattern. The person part is active when people are selected. */
interface DraftPattern {
  key: number;
  people: string[];
  need: number;
  useTotal: boolean;
  minTotal: number;
}

function patternOk(p: DraftPattern, othersCount: number): boolean {
  const personOk = p.people.length === 0 || (p.need >= 1 && p.need <= p.people.length);
  const totalOk = !p.useTotal || (p.minTotal >= 1 && p.minTotal <= othersCount);
  const hasSomething = p.people.length > 0 || p.useTotal;
  return personOk && totalOk && hasSomething;
}

function AnswerForm({
  me,
  members,
  answer,
  onSave,
}: {
  me: string;
  members: MemberSummary[];
  answer: AnswerDto | null;
  onSave: (req: SaveAnswerRequest) => Promise<void>;
}) {
  const toast = useToast();
  const others = useMemo(() => members.filter((m) => m.id !== me), [members, me]);
  const otherIds = useMemo(() => new Set(others.map((m) => m.id)), [others]);
  const names = useMemo(() => nameMap(members), [members]);
  const nextKey = useRef(0);

  const newPattern = (): DraftPattern => ({ key: nextKey.current++, people: [], need: 1, useTotal: false, minTotal: 1 });

  // Load the saved answer, dropping people who are no longer members (spec §5.5).
  const [patterns, setPatterns] = useState<DraftPattern[]>(() => {
    const loaded = (answer?.patterns ?? [])
      .map((p) => {
        const people = p.people.filter((id) => otherIds.has(id));
        return {
          key: nextKey.current++,
          people,
          need: Math.min(Math.max(p.need, 1), Math.max(people.length, 1)),
          useTotal: p.minTotal > 0,
          minTotal: p.minTotal || 1,
        };
      })
      .filter((p) => p.people.length > 0 || p.useTotal);
    return loaded.length ? loaded : [newPattern()];
  });
  const [choice, setChoice] = useState<Choice | null>(answer?.choice ?? null);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const update = (key: number, fn: (p: DraftPattern) => DraftPattern) =>
    setPatterns((list) => list.map((p) => (p.key === key ? fn(p) : p)));

  const togglePerson = (key: number, id: string) =>
    update(key, (p) => {
      const next = p.people.includes(id) ? p.people.filter((x) => x !== id) : [...p.people, id];
      const upper = Math.max(next.length, 1);
      // Keep "all of them" sticky; otherwise clamp into range.
      const need = p.need === p.people.length || p.people.length === 0 ? upper : Math.min(Math.max(p.need, 1), upper);
      return { ...p, people: next, need };
    });

  const condOk = choice !== 'cond' || (patterns.length > 0 && patterns.every((p) => patternOk(p, others.length)));
  const valid = choice !== null && condOk;

  const toRequestPattern = (p: DraftPattern) => ({
    people: p.people,
    need: p.people.length > 0 ? p.need : 0,
    minTotal: p.useTotal ? p.minTotal : 0,
  });
  const describe = (p: DraftPattern) => {
    const r = toRequestPattern(p);
    return describePattern({ people: r.people.map((id) => names.get(id) ?? ''), need: r.need, minTotal: r.minTotal });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || !choice) return;
    const req: SaveAnswerRequest = choice === 'cond' ? { choice, patterns: patterns.map(toRequestPattern) } : { choice };
    setBusy(true);
    setFieldErrors({});
    try {
      await onSave(req);
      toast('回答を保存しました');
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fields);
        toast(err.message);
      } else toast('保存できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const patternError = (i: number) =>
    fieldErrors[`patterns.${i}.people`] ??
    fieldErrors[`patterns.${i}.need`] ??
    fieldErrors[`patterns.${i}.minTotal`] ??
    fieldErrors[`patterns.${i}`];

  return (
    <form onSubmit={submit}>
      <div className="choices" role="group" aria-label="出欠">
        {CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            className="choice"
            aria-pressed={choice === c.value}
            disabled={c.value === 'cond' && others.length === 0}
            onClick={() => setChoice(c.value)}
          >
            <span className="choice__icon" aria-hidden>
              {c.icon}
            </span>
            {c.label}
          </button>
        ))}
      </div>

      {choice === 'cond' && (
        <div className="cond-box">
          <p className="cond-lead">
            次の条件の<strong>どれか1つでも</strong>満たせば参加になります。
          </p>

          {patterns.map((p, i) => (
            <div key={p.key}>
              {i > 0 && (
                <div className="or-divider" aria-hidden>
                  または
                </div>
              )}
              <fieldset className="pattern" aria-label={`条件${i + 1}`}>
                <div className="pattern__head">
                  <span className="pattern__title">条件 {i + 1}</span>
                  {patterns.length > 1 && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setPatterns((list) => list.filter((x) => x.key !== p.key))}
                      aria-label={`条件${i + 1}を削除`}
                    >
                      削除
                    </button>
                  )}
                </div>

                <div className="pattern__section">
                  <span className="pattern__label">この人たちが来るなら</span>
                  <div className="chips" role="group" aria-label={`条件${i + 1}の人`}>
                    {others.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="chip"
                        aria-pressed={p.people.includes(m.id)}
                        onClick={() => togglePerson(p.key, m.id)}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                  {p.people.length > 1 && (
                    <div className="sentence">
                      選んだ {p.people.length} 人のうち
                      <select
                        className="select"
                        value={p.need}
                        onChange={(e) => update(p.key, (x) => ({ ...x, need: Number(e.target.value) }))}
                        aria-label={`条件${i + 1}の必要な人数`}
                      >
                        {Array.from({ length: p.people.length }, (_, k) => k + 1).map((n) => (
                          <option key={n} value={n}>
                            {n === p.people.length ? `${n}人（全員）` : `${n}人`}
                          </option>
                        ))}
                      </select>
                      以上が来るなら
                    </div>
                  )}
                </div>

                <div className="pattern__section">
                  <label className="cond-section__head">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={p.useTotal}
                      onChange={(e) => update(p.key, (x) => ({ ...x, useTotal: e.target.checked }))}
                    />
                    {p.people.length > 0 ? 'さらに、参加者が一定数以上なら' : '参加者が一定数以上なら'}
                  </label>
                  {p.useTotal && (
                    <div className="sentence">
                      自分以外の参加者が全体で
                      <select
                        className="select"
                        value={p.minTotal}
                        onChange={(e) => update(p.key, (x) => ({ ...x, minTotal: Number(e.target.value) }))}
                        aria-label={`条件${i + 1}の必要な参加人数`}
                      >
                        {Array.from({ length: others.length }, (_, k) => k + 1).map((n) => (
                          <option key={n} value={n}>
                            {n}人
                          </option>
                        ))}
                      </select>
                      以上なら
                    </div>
                  )}
                </div>

                {patternOk(p, others.length) ? (
                  <div className="pattern__summary">{describe(p)}</div>
                ) : (
                  <span className="field__hint">人を選ぶか、参加人数の条件をつけてください</span>
                )}
                {patternError(i) && <span className="field__error">{patternError(i)}</span>}
              </fieldset>
            </div>
          ))}

          {patterns.length < LIMITS.maxPatterns ? (
            <button type="button" className="btn btn--secondary btn--sm add-pattern" onClick={() => setPatterns((l) => [...l, newPattern()])}>
              ＋ 別の条件を追加（または）
            </button>
          ) : (
            <span className="field__hint">条件は{LIMITS.maxPatterns}個までです</span>
          )}

          {condOk && (
            <div className="summary">
              {patterns.length === 1 ? (
                `${describe(patterns[0]!)}行く`
              ) : (
                <>
                  次のどれかを満たせば行く
                  <ul className="summary__list">
                    {patterns.map((p) => (
                      <li key={p.key}>{describe(p)}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {(fieldErrors.patterns || fieldErrors.choice) && (
        <div className="field__error" style={{ marginTop: 8 }}>
          {fieldErrors.patterns ?? fieldErrors.choice}
        </div>
      )}

      <button type="submit" className="btn btn--primary btn--block" style={{ marginTop: 16 }} disabled={!valid || busy}>
        {busy ? '保存中…' : answer ? '回答を更新する' : '回答を保存する'}
      </button>

      <ul className="privacy-note">
        <li>回答内容は、招待した人を含め誰にも表示されません。</li>
        <li>「行かない」と「条件が合わず不参加」は区別されません。</li>
        <li>締め切りまでは何度でも変更できます。</li>
      </ul>
    </form>
  );
}
