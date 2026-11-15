import { cleanup, screen, waitFor } from '@testing-library/react';
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
  it('sends a person condition', async () => {
    const user = userEvent.setup();
    const saveAnswer = vi.fn().mockResolvedValue(memberView());
    const api = fakeApi({ getMemberView: vi.fn().mockResolvedValue(memberView()), saveAnswer });
    renderAt('/r/room5/m#MT', api);

    await user.click(await screen.findByRole('button', { name: /条件付きで行く/ }));
    const save = screen.getByRole('button', { name: '回答を保存する' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: '鈴木' }));
    expect(screen.getByText('鈴木さんが来るなら行く')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '高橋' }));
    expect(screen.getByText('鈴木・高橋さんが全員来るなら行く')).toBeTruthy();
    await user.click(save);

    expect(saveAnswer).toHaveBeenCalledWith('room5', 'MT', {
      choice: 'cond',
      condPeople: ['a', 'b'],
      condNeed: 2,
      condMinTotal: 0,
    });
  });

  it('shows own status, privacy notes, and stale-condition notice', async () => {
    const api = fakeApi({
      getMemberView: vi.fn().mockResolvedValue(
        memberView({
          me: {
            id: 'me',
            answer: { choice: 'cond', condPeople: ['gone'], condNeed: 1, condMinTotal: 0, updatedAt: '2026-11-20T12:03:00Z' },
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
          room: { title: '結婚式', deadlineText: '', message: '', status: 'closed' },
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
        room: { title: '同窓会', deadlineText: '', message: '', status: 'open' },
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
  });
});
