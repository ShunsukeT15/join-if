import type { ErrorCode } from '@himitsu/contracts';

/**
 * Errors raised by the domain / application layers.
 * The presentation layer maps `code` to an HTTP status.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Missing token, wrong token, other room, unknown member: all indistinguishable. */
export const notFound = () => new AppError('not_found', '見つかりません');
export const inviteUsed = () =>
  new AppError('invite_used', 'このURLは使用済みです。招待した人に再発行を依頼してください');
export const nameTaken = () =>
  new AppError('invite_used', 'この名前はすでに選ばれています。自分が選んだ覚えがない場合は、招待した人にリセットを依頼してください');
export const roomClosed = () => new AppError('closed', '受付は終了しました');
export const conflict = (message: string) => new AppError('conflict', message);
export const validation = (fields: Record<string, string>, message = '入力内容を確認してください') =>
  new AppError('validation', message, fields);
export const rateLimited = () =>
  new AppError('rate_limited', 'アクセスが集中しています。時間をおいて再試行してください');
