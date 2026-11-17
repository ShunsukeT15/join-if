import type { MemberViewResponse } from '@himitsu/contracts';
import { vi } from 'vitest';
import type { ApiClient } from '../src/api/client';

export function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  const unimplemented = () => vi.fn(() => Promise.reject(new Error('not mocked')));
  return {
    createRoom: unimplemented(),
    getAdminView: unimplemented(),
    updateSettings: unimplemented(),
    addMember: unimplemented(),
    removeMember: unimplemented(),
    reissueInvite: unimplemented(),
    closeRoom: unimplemented(),
    reopenRoom: unimplemented(),
    claimInvite: unimplemented(),
    getMemberView: unimplemented(),
    saveAnswer: unimplemented(),
    getGroupView: unimplemented(),
    claimName: unimplemented(),
    reissueGroupToken: unimplemented(),
    createEvent: unimplemented(),
    getEventAdminView: unimplemented(),
    updateEvent: unimplemented(),
    addCommunity: unimplemented(),
    deleteRoom: unimplemented(),
    deleteEvent: unimplemented(),
    getMeta: vi.fn(() => Promise.resolve({ retention: { afterCloseDays: 30, unclosedDays: 365 } })),
    ...overrides,
  };
}

export const memberView = (patch: Partial<MemberViewResponse> = {}): MemberViewResponse => ({
  room: { title: '結婚式', deadlineText: '12月20日', message: '', status: 'open', inviteMode: 'individual', deadlineAt: null, communityName: null },
  members: [
    { id: 'me', name: '佐藤', answered: false },
    { id: 'a', name: '鈴木', answered: true },
    { id: 'b', name: '高橋', answered: false },
  ],
  me: { id: 'me', answer: null, saveCount: 0, claimedAt: '2026-11-18T10:40:00Z', conditionNotice: false },
  result: null,
  ...patch,
});
