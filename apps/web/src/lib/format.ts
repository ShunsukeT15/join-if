const pad = (n: number) => String(n).padStart(2, '0');

/** "11/20 21:03" in the viewer's local time. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const urls = {
  admin: (roomId: string, token: string) => `${location.origin}/r/${roomId}/admin#${token}`,
  invite: (roomId: string, token: string) => `${location.origin}/r/${roomId}/i#${token}`,
  member: (roomId: string, token: string) => `${location.origin}/r/${roomId}/m#${token}`,
};

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

/** Human-readable summary of a conditional answer. */
export function describeCondition(opts: {
  people: string[];
  need: number;
  minTotal: number;
}): string {
  const parts: string[] = [];
  if (opts.people.length > 0 && opts.need > 0) {
    const names = opts.people.join('・');
    if (opts.people.length === 1) parts.push(`${names}さんが来るなら`);
    else if (opts.need === opts.people.length) parts.push(`${names}さんが全員来るなら`);
    else if (opts.need === 1) parts.push(`${names}さんのうち誰か1人でも来るなら`);
    else parts.push(`${names}さんのうち${opts.need}人以上が来るなら`);
  }
  if (opts.minTotal > 0) parts.push(`自分以外の参加者が${opts.minTotal}人以上なら`);
  return parts.length ? `${parts.join('、かつ')}行く` : '';
}
