import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import { tokenStore } from '../src/lib/tokenStore';
import { fakeApi, memberView } from './fakeApi';
import { renderAt } from './render';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('InvitePage', () => {
  it('claims, stores the member token and shows the member page', async () => {
    const api = fakeApi({
      claimInvite: vi.fn().mockResolvedValue({ memberToken: 'MT1' }),
      getMemberView: vi.fn().mockResolvedValue(memberView()),
    });
    renderAt('/r/room1/i#INV1', api);
    expect(await screen.findByText('あなた専用の回答用URLを発行しました')).toBeTruthy();
    expect(api.claimInvite).toHaveBeenCalledTimes(1);
    expect(api.claimInvite).toHaveBeenCalledWith('room1', 'INV1');
    expect(api.getMemberView).toHaveBeenCalledWith('room1', 'MT1');
    expect(tokenStore.getMemberToken('room1')).toBe('MT1');
  });

  it('used invite + saved token → goes to the member page', async () => {
    tokenStore.setMemberToken('room2', 'SAVED');
    const api = fakeApi({
      claimInvite: vi.fn().mockRejectedValue(new ApiError(410, 'invite_used', 'used')),
      getMemberView: vi.fn().mockResolvedValue(memberView()),
    });
    renderAt('/r/room2/i#INV2', api);
    await waitFor(() => expect(api.getMemberView).toHaveBeenCalledWith('room2', 'SAVED'));
  });

  it('used invite without saved token → "used" guidance', async () => {
    const api = fakeApi({ claimInvite: vi.fn().mockRejectedValue(new ApiError(410, 'invite_used', 'used')) });
    renderAt('/r/room3/i#INV3', api);
    expect(await screen.findByText('このURLは使用済みです')).toBeTruthy();
    expect(screen.getByText(/招待URLの再発行を依頼してください/)).toBeTruthy();
  });

  it('invalid invite → not found', async () => {
    const api = fakeApi({ claimInvite: vi.fn().mockRejectedValue(new ApiError(404, 'not_found', '')) });
    renderAt('/r/room4/i#INV4', api);
    expect(await screen.findByText('ページが見つかりません')).toBeTruthy();
  });
});

describe('MemberPage answer form', () => {
  it('sends a single person pattern', async () => {
    const user = userEvent.setup();
    const saveAnswer = vi.fn().mockResolvedValue(memberView());
    const api = fakeApi({ getMemberView: vi.fn().mockResolvedValue(memberView()), saveAnswer });
    renderAt('/r/room5/m#MT', api);

    await user.click(await screen.findByRole('button', { name: /条件付きで行く/ }));
    const save = screen.getByRole('button', { name: '回答を保存する' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const people = within(screen.getByRole('group', { name: '条件1の人' }));
    await user.click(people.getByRole('button', { name: '鈴木' }));
    expect(screen.getAllByText('鈴木さんが来るなら行く').length).toBeGreaterThan(0);
    await user.click(people.getByRole('button', { name: '高橋' }));
    expect(screen.getAllByText('鈴木・高橋さんが全員来るなら行く').length).toBeGreaterThan(0);
    await user.click(save);

    expect(saveAnswer).toHaveBeenCalledWith('room5', 'MT', {
      choice: 'cond',
      patterns: [{ people: ['a', 'b'], need: 2, minTotal: 0 }],
    });
  });

  it('sends OR patterns: "鈴木 comes, or 2 others come"', async () => {
    const user = userEvent.setup();
    const saveAnswer = vi.fn().mockResolvedValue(memberView());
    const api = fakeApi({ getMemberView: vi.fn().mockResolvedValue(memberView()), saveAnswer });
    renderAt('/r/room8/m#MT', api);

    await user.click(await screen.findByRole('button', { name: /条件付きで行く/ }));
    await user.click(within(screen.getByRole('group', { name: '条件1の人' })).getByRole('button', { name: '鈴木' }));
    await user.click(screen.getByRole('button', { name: /別の条件を追加/ }));
    expect(screen.getByText('または')).toBeTruthy();

    const second = screen.getByRole('group', { name: '条件2' });
    // A new pattern with nothing selected blocks saving.
    expect((screen.getByRole('button', { name: '回答を保存する' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(second).getByRole('checkbox'));
    await user.selectOptions(within(second).getByRole('combobox', { name: '条件2の必要な参加人数' }), '2');

    expect(screen.getByText('次のどれかを満たせば行く')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '回答を保存する' }));
    expect(saveAnswer).toHaveBeenCalledWith('room8', 'MT', {
      choice: 'cond',
      patterns: [
        { people: ['a'], need: 1, minTotal: 0 },
        { people: [], need: 0, minTotal: 2 },
      ],
    });
  });

  it('loads saved OR patterns and can delete one', async () => {
    const user = userEvent.setup();
    const saveAnswer = vi.fn().mockResolvedValue(memberView());
    const api = fakeApi({
      getMemberView: vi.fn().mockResolvedValue(
        memberView({
          me: {
            id: 'me',
            answer: {
              choice: 'cond',
              patterns: [
                { people: ['a', 'b'], need: 2, minTotal: 0 },
                { people: ['b'], need: 1, minTotal: 0 },
              ],
              updatedAt: '2026-11-20T12:03:00Z',
            },
            saveCount: 1,
            claimedAt: '2026-11-18T10:40:00Z',
            conditionNotice: false,
          },
        }),
      ),
      saveAnswer,
    });
    renderAt('/r/room9/m#MT', api);
    expect(await screen.findByRole('group', { name: '条件2' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '条件1を削除' }));
    expect(screen.queryByRole('group', { name: '条件2' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '回答を更新する' }));
    expect(saveAnswer).toHaveBeenCalledWith('room9', 'MT', {
      choice: 'cond',
      patterns: [{ people: ['b'], need: 1, minTotal: 0 }],
    });
  });

  it('shows own status, privacy notes, and stale-condition notice', async () => {
    const api = fakeApi({
      getMemberView: vi.fn().mockResolvedValue(
        memberView({
          me: {
            id: 'me',
            answer: { choice: 'cond', patterns: [{ people: ['gone'], need: 1, minTotal: 0 }], updatedAt: '2026-11-20T12:03:00Z' },
            saveCount: 3,
            claimedAt: '2026-11-18T10:40:00Z',
            conditionNotice: true,
          },
        }),
      ),
    });
    renderAt('/r/room6/m#MT', api);
    expect(await screen.findByText('回答を見直してください')).toBeTruthy();
    expect(screen.getByText(/保存 3 回/)).toBeTruthy();
    expect(screen.getByText(/に有効化されました/)).toBeTruthy();
    expect(screen.getByText('回答内容は、招待した人を含め誰にも表示されません。')).toBeTruthy();
    expect(screen.getByText('「行かない」と「条件が合わず不参加」は区別されません。')).toBeTruthy();
  });

  it('closed: shows the result and hides the form', async () => {
    const api = fakeApi({
      getMemberView: vi.fn().mockResolvedValue(
        memberView({
          room: { title: '結婚式', deadlineText: '', message: '', status: 'closed', inviteMode: 'individual', deadlineAt: null, communityName: null },
          result: { attending: ['a'], computedAt: '2026-12-20T00:00:00Z' },
        }),
      ),
    });
    renderAt('/r/room7/m#MT', api);
    expect(await screen.findByText('最終結果')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /回答を保存する/ })).toBeNull();
    expect(screen.getByText('受付は終了しました。回答は変更できません。')).toBeTruthy();
  });
});

describe('TopPage', () => {
  it('creates a room and opens the admin page with the save-URL warning', async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      createRoom: vi.fn().mockResolvedValue({ roomId: 'r1', adminToken: 'AT' }),
      getAdminView: vi.fn().mockResolvedValue({
        room: { title: '同窓会', deadlineText: '', message: '', status: 'open', inviteMode: 'individual', deadlineAt: null, communityName: null },
        members: [],
        unansweredCount: 0,
        result: null,
      }),
    });
    renderAt('/', api);
    await user.type(screen.getByLabelText(/イベント名/), '同窓会');
    await user.click(screen.getByRole('button', { name: 'ルームを作成する' }));
    expect(await screen.findByText('この管理用URLを必ず保存してください')).toBeTruthy();
    expect(api.getAdminView).toHaveBeenCalledWith('r1', 'AT');
    expect(api.createRoom).toHaveBeenCalledWith(expect.objectContaining({ title: '同窓会', inviteMode: 'individual', deadlineAt: null }));
  });

  it('can create a group-invitation room', async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      createRoom: vi.fn().mockResolvedValue({ roomId: 'r2', adminToken: 'AT' }),
      getAdminView: vi.fn().mockResolvedValue({
        room: { title: '旅行', deadlineText: '', message: '', status: 'open', inviteMode: 'group', deadlineAt: null, communityName: null },
        members: [{ id: 'a', name: '鈴木', answered: false, inviteUsed: false }],
        unansweredCount: 1,
        result: null,
        groupToken: 'GT',
      }),
    });
    renderAt('/', api);
    await user.type(screen.getByLabelText(/イベント名/), '旅行');
    await user.click(screen.getByLabelText(/グループにまとめて招待/));
    await user.click(screen.getByRole('button', { name: 'ルームを作成する' }));
    expect(api.createRoom).toHaveBeenCalledWith(expect.objectContaining({ inviteMode: 'group' }));
    expect(await screen.findByText('グループ用URL')).toBeTruthy();
    expect(screen.getByRole('button', { name: /リマインド文をコピー（未回答 1人）/ })).toBeTruthy();
    expect(screen.getByText('名前 未選択')).toBeTruthy();
  });
});

describe('GroupPage', () => {
  const groupView = {
    room: { title: '同窓会', deadlineText: '', message: '', status: 'open' as const, inviteMode: 'group' as const, deadlineAt: null, communityName: null },
    members: [
      { id: 'a', name: '佐藤', taken: true },
      { id: 'b', name: '鈴木', taken: false },
    ],
  };

  it('picks a free name after confirming and opens the member page', async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      getGroupView: vi.fn().mockResolvedValue(groupView),
      claimName: vi.fn().mockResolvedValue({ memberToken: 'MTG' }),
      getMemberView: vi.fn().mockResolvedValue(memberView()),
    });
    renderAt('/r/g1/g#GT', api);
    expect(((await screen.findByRole('button', { name: /佐藤/ })) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: '鈴木' }));
    expect(screen.getByText('あなたは「鈴木」さんですか？')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '鈴木さんとして回答する' }));
    expect(api.claimName).toHaveBeenCalledWith('g1', 'GT', 'b');
    expect(await screen.findByText('あなた専用の回答用URLを発行しました')).toBeTruthy();
    expect(tokenStore.getMemberToken('g1')).toBe('MTG');
  });

  it('shows guidance when the name was taken meanwhile', async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      getGroupView: vi.fn().mockResolvedValue(groupView),
      claimName: vi.fn().mockRejectedValue(new ApiError(410, 'invite_used', 'taken')),
    });
    renderAt('/r/g2/g#GT', api);
    await user.click(await screen.findByRole('button', { name: '鈴木' }));
    await user.click(screen.getByRole('button', { name: '鈴木さんとして回答する' }));
    expect(await screen.findByText('「鈴木」はすでに選ばれています')).toBeTruthy();
  });

  it('offers the saved member page on a browser that already picked a name', async () => {
    tokenStore.setMemberToken('g3', 'SAVED');
    const api = fakeApi({ getGroupView: vi.fn().mockResolvedValue(groupView) });
    renderAt('/r/g3/g#GT', api);
    expect((await screen.findByRole('link', { name: '自分の回答画面を開く' })).getAttribute('href')).toBe('/r/g3/m#SAVED');
  });
});

describe('Events', () => {
  const eventView = {
    event: { title: '太郎＆花子 結婚式', message: '' },
    communities: [
      { roomId: 'r1', name: '新郎友人', inviteMode: 'group' as const, status: 'closed' as const, deadlineAt: null, memberCount: 3, answeredCount: 3, attendingCount: 2 },
      { roomId: 'r2', name: '新婦同僚', inviteMode: 'individual' as const, status: 'open' as const, deadlineAt: null, memberCount: 4, answeredCount: 1, attendingCount: null },
    ],
    totals: { memberCount: 7, answeredCount: 4, attendingCount: 2, closedCount: 1 },
    attendees: [
      { name: '佐藤', community: '新郎友人' },
      { name: '鈴木', community: '新郎友人' },
    ],
  };

  it('creates an event from the top page and opens its admin page', async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      createEvent: vi.fn().mockResolvedValue({ eventId: 'e1', adminToken: 'EAT' }),
      getEventAdminView: vi.fn().mockResolvedValue({ ...eventView, communities: [], totals: { memberCount: 0, answeredCount: 0, attendingCount: 0, closedCount: 0 }, attendees: [] }),
    });
    renderAt('/', api);
    await user.click(screen.getByRole('tab', { name: '複数のグループで集める' }));
    expect(screen.queryByText('招待のしかた')).toBeNull();
    await user.type(screen.getByLabelText(/イベント名/), '結婚式');
    await user.click(screen.getByRole('button', { name: 'イベントを作成する' }));
    expect(api.createEvent).toHaveBeenCalledWith({ title: '結婚式', message: '' });
    expect(await screen.findByText('この管理用URLを必ず保存してください')).toBeTruthy();
    expect(api.getEventAdminView).toHaveBeenCalledWith('e1', 'EAT');
  });

  it('shows totals, communities linking to their admin pages, and attendees', async () => {
    const api = fakeApi({ getEventAdminView: vi.fn().mockResolvedValue(eventView) });
    renderAt('/e/e1/admin#EAT', api);
    expect(await screen.findByText('イベント全体')).toBeTruthy();
    const link = screen.getByRole('link', { name: /新婦同僚/ });
    expect(link.getAttribute('href')).toBe('/r/r2/admin#EAT');
    expect(screen.getByText('結果：締め切り後に表示')).toBeTruthy();
    expect(screen.getByText('参加者一覧')).toBeTruthy();
    expect(screen.getByText('参加人数は、締め切ったコミュニティの分だけを数えています。')).toBeTruthy();
  });

  it('adds a community', async () => {
    const user = userEvent.setup();
    const addCommunity = vi.fn().mockResolvedValue({ roomId: 'r3' });
    const api = fakeApi({ getEventAdminView: vi.fn().mockResolvedValue(eventView), addCommunity });
    renderAt('/e/e1/admin#EAT', api);
    await user.type(await screen.findByLabelText('コミュニティ名'), 'サークル');
    await user.click(screen.getByRole('button', { name: '追加する' }));
    expect(addCommunity).toHaveBeenCalledWith('e1', 'EAT', { name: 'サークル', inviteMode: 'group', deadlineAt: null });
  });
});

describe('Deletion and retention text', () => {
  const adminView = {
    room: { title: '同窓会', deadlineText: '', message: '', status: 'open' as const, inviteMode: 'individual' as const, deadlineAt: null, communityName: null },
    members: [],
    unansweredCount: 0,
    result: null,
  };

  it('deletes a room only after typing its name', async () => {
    const user = userEvent.setup();
    const deleteRoom = vi.fn().mockResolvedValue(undefined);
    const api = fakeApi({ getAdminView: vi.fn().mockResolvedValue(adminView), deleteRoom });
    renderAt('/r/r9/admin#AT', api);
    await user.click(await screen.findByRole('button', { name: 'このルームを削除' }));
    const confirm = screen.getByRole('button', { name: '削除する' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText('確認のための名前'), '同窓');
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText('確認のための名前'), '会');
    await user.click(confirm);
    expect(deleteRoom).toHaveBeenCalledWith('r9', 'AT');
    expect(await screen.findByText(/削除しました。データはすべて消去され/)).toBeTruthy();
  });

  it('privacy page shows the configured retention', async () => {
    const api = fakeApi({ getMeta: vi.fn().mockResolvedValue({ retention: { afterCloseDays: 30, unclosedDays: 365 } }) });
    renderAt('/privacy', api);
    expect(await screen.findByText(/最後に締め切ってから30日後に/)).toBeTruthy();
    expect(screen.getByText(/作成から1年で削除/)).toBeTruthy();
  });
});
