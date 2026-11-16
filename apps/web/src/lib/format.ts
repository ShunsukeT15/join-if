const pad = (n: number) => String(n).padStart(2, '0');

/** "11/20 21:03" in the viewer's local time. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** "11/20(金) 21:00" in the viewer's local time. */
export function formatDeadline(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO → value for <input type="datetime-local"> (local time). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value (local time) → ISO, or null when empty. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** Text shown as the deadline: the automatic deadline wins, then the free-text one. */
export function deadlineLabel(room: { deadlineAt: string | null; deadlineText: string }): string {
  if (room.deadlineAt) return `${formatDeadline(room.deadlineAt)}（自動で締め切り）`;
  return room.deadlineText;
}

export const urls = {
  admin: (roomId: string, token: string) => `${location.origin}/r/${roomId}/admin#${token}`,
  invite: (roomId: string, token: string) => `${location.origin}/r/${roomId}/i#${token}`,
  member: (roomId: string, token: string) => `${location.origin}/r/${roomId}/m#${token}`,
  group: (roomId: string, token: string) => `${location.origin}/r/${roomId}/g#${token}`,
};

/** Message for the whole group (group mode). */
export function groupMessage(opts: { title: string; deadline: string; url: string }): string {
  const deadline = opts.deadline ? `（締切：${opts.deadline}）` : '';
  return [
    `「${opts.title}」の出欠確認です${deadline}。`,
    '下のURLを開いて、自分の名前を選んで回答してください。回答内容は招待した人を含め、誰にも表示されません。',
    '※名前は1人1回だけ選べます。他の人の名前は選ばないでください。',
    opts.url,
  ].join('\n');
}

/** Reminder listing who has not answered yet (that list is visible to everyone anyway). */
export function reminderMessage(opts: { title: string; deadline: string; unanswered: string[]; url: string }): string {
  const deadline = opts.deadline ? `締切は${opts.deadline}です。` : '';
  return [
    `「${opts.title}」の出欠確認のリマインドです。${deadline}`,
    `まだ回答していない方: ${opts.unanswered.map((n) => `${n}さん`).join('、')}`,
    '下のURLから回答をお願いします。',
    opts.url,
  ].join('\n');
}

export function inviteMessage(opts: { name: string; title: string; deadlineText: string; url: string }): string {
  const deadline = opts.deadlineText ? `（締切：${opts.deadlineText}）` : '';
  return [
    `${opts.name}さん`,
    `「${opts.title}」の出欠確認です${deadline}。`,
    '下のURLから回答してください。回答内容は招待した人を含め、誰にも表示されません。',
    '※このURLはあなた専用で、1回だけ使えます。開くと回答用のURLに切り替わります。',
    opts.url,
  ].join('\n');
}

export interface PatternText {
  /** Display names of the chosen people. */
  people: string[];
  need: number;
  minTotal: number;
}

/** One pattern as a clause ending in 「なら」, e.g. 「A・Bさんが全員来るなら」. */
export function describePattern(p: PatternText): string {
  const parts: string[] = [];
  if (p.people.length > 0 && p.need > 0) {
    const names = p.people.join('・');
    if (p.people.length === 1) parts.push(`${names}さんが来る`);
    else if (p.need === p.people.length) parts.push(`${names}さんが全員来る`);
    else if (p.need === 1) parts.push(`${names}さんのうち誰か1人でも来る`);
    else parts.push(`${names}さんのうち${p.need}人以上が来る`);
  }
  if (p.minTotal > 0) parts.push(`自分以外の参加者が${p.minTotal}人以上`);
  return parts.length ? `${parts.join('、かつ')}なら` : '';
}

/** Whole conditional answer: patterns joined with 「または」. */
export function describeCondition(patterns: PatternText[]): string {
  const clauses = patterns.map(describePattern).filter(Boolean);
  return clauses.length ? `${clauses.join('、または')}行く` : '';
}
