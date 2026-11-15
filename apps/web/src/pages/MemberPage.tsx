import type { AnswerDto, Choice, MemberSummary, MemberViewResponse, SaveAnswerRequest } from '@himitsu/contracts';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useParams } from 'react-router';
import { useApi } from '../api/ApiProvider';
import { ApiError } from '../api/client';
import { AnswerProgress, ErrorView, EventHeader, MemberStatusList, ResultCard } from '../components/room';
import { Notice, Spinner, UrlBox, useToast } from '../components/ui';
import { describeCondition, formatDateTime, urls } from '../lib/format';
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
        ? describeCondition({
            people: answer.condPeople.map((id) => names.get(id) ?? '（外れた人）'),
            need: answer.condNeed,
            minTotal: answer.condMinTotal,
          })
        : label}
    </div>
  );
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

  // Drop people who are no longer members when loading a saved answer.
  const initialPeople = (answer?.condPeople ?? []).filter((id) => otherIds.has(id));
  const [choice, setChoice] = useState<Choice | null>(answer?.choice ?? null);
  const [usePeople, setUsePeople] = useState(answer ? answer.condNeed > 0 && initialPeople.length > 0 : true);
  const [people, setPeople] = useState<string[]>(initialPeople);
  const [need, setNeed] = useState(Math.min(Math.max(answer?.condNeed ?? 1, 1), Math.max(initialPeople.length, 1)));
  const [useTotal, setUseTotal] = useState(answer ? answer.condMinTotal > 0 : false);
  const [minTotal, setMinTotal] = useState(answer?.condMinTotal || 1);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const togglePerson = (id: string) => {
    const prev = people;
    const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
    setPeople(next);
    // Keep "all of them" sticky; otherwise clamp into range.
    const upper = Math.max(next.length, 1);
    setNeed(need === prev.length || prev.length === 0 ? upper : Math.min(Math.max(need, 1), upper));
  };

  const peopleOk = !usePeople || (people.length > 0 && need >= 1 && need <= people.length);
  const totalOk = !useTotal || (minTotal >= 1 && minTotal <= others.length);
  const condOk = choice !== 'cond' || ((usePeople || useTotal) && peopleOk && totalOk);
  const valid = choice !== null && condOk;

  const summary =
    choice === 'cond' && condOk
      ? describeCondition({
          people: usePeople ? people.map((id) => names.get(id) ?? '') : [],
          need: usePeople ? need : 0,
          minTotal: useTotal ? minTotal : 0,
        })
      : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || !choice) return;
    const req: SaveAnswerRequest =
      choice === 'cond'
        ? {
            choice,
            condPeople: usePeople ? people : [],
            condNeed: usePeople ? need : 0,
            condMinTotal: useTotal ? minTotal : 0,
          }
        : { choice };
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
          <div>
            <label className="cond-section__head">
              <input type="checkbox" className="checkbox" checked={usePeople} onChange={(e) => setUsePeople(e.target.checked)} />
              特定の人が来るなら
            </label>
            {usePeople && (
              <div className="cond-section__body">
                <div className="chips" role="group" aria-label="条件にする人">
                  {others.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="chip"
                      aria-pressed={people.includes(m.id)}
                      onClick={() => togglePerson(m.id)}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
                {people.length > 1 && (
                  <div className="sentence">
                    選んだ {people.length} 人のうち
                    <select className="select" value={need} onChange={(e) => setNeed(Number(e.target.value))} aria-label="必要な人数">
                      {Array.from({ length: people.length }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n === people.length ? `${n}人（全員）` : `${n}人`}
                        </option>
                      ))}
                    </select>
                    以上が来るなら
                  </div>
                )}
                {people.length === 0 && <span className="field__hint">条件にする人を選んでください</span>}
                {(fieldErrors.condPeople || fieldErrors.condNeed) && (
                  <span className="field__error">{fieldErrors.condPeople ?? fieldErrors.condNeed}</span>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="cond-section__head">
              <input type="checkbox" className="checkbox" checked={useTotal} onChange={(e) => setUseTotal(e.target.checked)} />
              参加者が一定数以上なら
            </label>
            {useTotal && (
              <div className="cond-section__body">
                <div className="sentence">
                  自分以外の参加者が全体で
                  <select className="select" value={minTotal} onChange={(e) => setMinTotal(Number(e.target.value))} aria-label="必要な参加人数">
                    {Array.from({ length: others.length }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}人
                      </option>
                    ))}
                  </select>
                  以上なら
                </div>
                {fieldErrors.condMinTotal && <span className="field__error">{fieldErrors.condMinTotal}</span>}
              </div>
            )}
          </div>

          {!usePeople && !useTotal && <span className="field__error">どちらか一方の条件は必要です</span>}
          {usePeople && useTotal && <span className="field__hint">両方の条件を満たしたときだけ参加になります。</span>}
          {summary && <div className="summary">{summary}</div>}
        </div>
      )}

      {fieldErrors.choice && <div className="field__error" style={{ marginTop: 8 }}>{fieldErrors.choice}</div>}

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
