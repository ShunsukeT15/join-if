import type { Tx, UnitOfWork } from '../../../application/ports/persistence.js';
import { notFound } from '../../../domain/errors.js';
import type {
  Answer,
  AuditEvent,
  Choice,
  Event,
  InviteMode,
  Member,
  Pattern,
  Result,
  Room,
  RoomStatus,
} from '../../../domain/types.js';
import type { SqlClient, SqlPool } from './pgClient.js';

interface EventRow {
  id: string;
  title: string;
  message: string;
  admin_token_hash: string;
  created_at: Date;
  purge_after: Date;
}
interface RoomRow {
  id: string;
  event_id: string | null;
  community_name: string | null;
  title: string;
  deadline_text: string;
  message: string;
  status: RoomStatus;
  invite_mode: InviteMode;
  admin_token_hash: string;
  group_token_hash: string | null;
  group_token_enc: string | null;
  deadline_at: Date | null;
  created_at: Date;
  closed_at: Date | null;
  purge_after: Date;
}
interface MemberRow {
  id: string;
  room_id: string;
  display_name: string;
  invite_token_hash: string | null;
  invite_token_enc: string | null;
  invite_used_at: Date | null;
  member_token_hash: string | null;
  sort_order: number;
  created_at: Date;
}
interface AnswerRow {
  member_id: string;
  choice: Choice;
  cond_patterns: Pattern[] | string;
  updated_at: Date;
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));
const toDateOrNull = (v: Date | string | null): Date | null => (v === null ? null : toDate(v));

const event = (r: EventRow): Event => ({
  id: r.id,
  title: r.title,
  message: r.message,
  adminTokenHash: r.admin_token_hash,
  createdAt: toDate(r.created_at),
  purgeAfter: toDate(r.purge_after),
});

const room = (r: RoomRow): Room => ({
  id: r.id,
  eventId: r.event_id,
  communityName: r.community_name,
  title: r.title,
  deadlineText: r.deadline_text,
  message: r.message,
  status: r.status,
  inviteMode: r.invite_mode,
  adminTokenHash: r.admin_token_hash,
  groupTokenHash: r.group_token_hash,
  groupTokenEnc: r.group_token_enc,
  deadlineAt: toDateOrNull(r.deadline_at),
  createdAt: toDate(r.created_at),
  closedAt: toDateOrNull(r.closed_at),
  purgeAfter: toDate(r.purge_after),
});

const member = (r: MemberRow): Member => ({
  id: r.id,
  roomId: r.room_id,
  displayName: r.display_name,
  inviteTokenHash: r.invite_token_hash,
  inviteTokenEnc: r.invite_token_enc,
  inviteUsedAt: toDateOrNull(r.invite_used_at),
  memberTokenHash: r.member_token_hash,
  sortOrder: r.sort_order,
  createdAt: toDate(r.created_at),
});

const answer = (r: AnswerRow): Answer => ({
  memberId: r.member_id,
  choice: r.choice,
  patterns: (typeof r.cond_patterns === 'string' ? JSON.parse(r.cond_patterns) : r.cond_patterns ?? []).map(
    (p: Pattern) => ({ people: p.people ?? [], need: p.need ?? 0, minTotal: p.minTotal ?? 0 }),
  ),
  updatedAt: toDate(r.updated_at),
});

const MEMBER_COLS =
  'id, room_id, display_name, invite_token_hash, invite_token_enc, invite_used_at, member_token_hash, sort_order, created_at';

function makeTx(db: SqlClient): Tx {
  return {
    ops: {
      async counts() {
        const { rows } = await db.query<{ events: number; rooms: number; open_rooms: number; members: number; answers: number }>(
          `select (select count(*)::int from events) as events,
                  (select count(*)::int from rooms) as rooms,
                  (select count(*)::int from rooms where status = 'open') as open_rooms,
                  (select count(*)::int from members) as members,
                  (select count(*)::int from answers) as answers`,
        );
        const r = rows[0]!;
        return { events: r.events, rooms: r.rooms, openRooms: r.open_rooms, members: r.members, answers: r.answers };
      },
      async findByTitlePrefix(prefix) {
        // Escape LIKE wildcards so the prefix is matched literally.
        const pattern = prefix.replace(/[\\%_]/g, (c) => `\\${c}`) + '%';
        const rooms = await db.query<{ id: string }>(`select id from rooms where event_id is null and title like $1`, [pattern]);
        const events = await db.query<{ id: string }>(`select id from events where title like $1`, [pattern]);
        return { roomIds: rooms.rows.map((r) => r.id), eventIds: events.rows.map((r) => r.id) };
      },
      async deleteAll() {
        const ev = await db.query('delete from events');
        const rm = await db.query('delete from rooms');
        return { events: ev.rowCount, rooms: rm.rowCount };
      },
    },
    events: {
      async delete(id) {
        await db.query('delete from events where id = $1', [id]);
      },
      async insert(e) {
        await db.query(
          `insert into events (id, title, message, admin_token_hash, created_at, purge_after) values ($1,$2,$3,$4,$5,$6)`,
          [e.id, e.title, e.message, e.adminTokenHash, e.createdAt, e.purgeAfter],
        );
      },
      async findById(id) {
        const { rows } = await db.query<EventRow>('select * from events where id = $1', [id]);
        return rows[0] ? event(rows[0]) : null;
      },
      async update(e) {
        const { rowCount } = await db.query(`update events set title=$2, message=$3, purge_after=$4 where id=$1`, [
          e.id,
          e.title,
          e.message,
          e.purgeAfter,
        ]);
        if (rowCount === 0) throw notFound();
      },
      async deleteExpired({ closedBefore, createdBefore }) {
        const { rowCount } = await db.query(
          `delete from events e
           where e.created_at <= $2
              or (e.created_at <= $1 and not exists (select 1 from rooms r where r.event_id = e.id))`,
          [closedBefore, createdBefore],
        );
        return rowCount;
      },
    },
    rooms: {
      async delete(id) {
        await db.query('delete from rooms where id = $1', [id]);
      },
      async listByEvent(eventId) {
        const { rows } = await db.query<RoomRow>('select * from rooms where event_id = $1 order by created_at, id', [eventId]);
        return rows.map(room);
      },
      async insert(r) {
        await db.query(
          `insert into rooms (id, title, deadline_text, message, status, admin_token_hash, created_at, closed_at, purge_after,
             invite_mode, group_token_hash, group_token_enc, deadline_at, event_id, community_name)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            r.id,
            r.title,
            r.deadlineText,
            r.message,
            r.status,
            r.adminTokenHash,
            r.createdAt,
            r.closedAt,
            r.purgeAfter,
            r.inviteMode,
            r.groupTokenHash,
            r.groupTokenEnc,
            r.deadlineAt,
            r.eventId,
            r.communityName,
          ],
        );
      },
      async findById(id) {
        const { rows } = await db.query<RoomRow>('select * from rooms where id = $1', [id]);
        return rows[0] ? room(rows[0]) : null;
      },
      async update(r) {
        const { rowCount } = await db.query(
          `update rooms set title=$2, deadline_text=$3, message=$4, status=$5, closed_at=$6, purge_after=$7,
             group_token_hash=$8, group_token_enc=$9, deadline_at=$10, community_name=$11
           where id=$1`,
          [
            r.id,
            r.title,
            r.deadlineText,
            r.message,
            r.status,
            r.closedAt,
            r.purgeAfter,
            r.groupTokenHash,
            r.groupTokenEnc,
            r.deadlineAt,
            r.communityName,
          ],
        );
        if (rowCount === 0) throw notFound();
      },
      async findOpenDue(now) {
        const { rows } = await db.query<{ id: string }>(
          `select id from rooms where status = 'open' and deadline_at is not null and deadline_at <= $1`,
          [now],
        );
        return rows.map((r) => r.id);
      },
      async deleteExpired({ closedBefore, createdBefore }) {
        const { rowCount } = await db.query(
          `delete from rooms
           where (status = 'closed' and closed_at <= $1)
              or (status = 'open' and created_at <= $2 and (closed_at is null or closed_at <= $1))`,
          [closedBefore, createdBefore],
        );
        return rowCount;
      },
    },
    members: {
      async listByRoom(roomId) {
        const { rows } = await db.query<MemberRow>(
          `select ${MEMBER_COLS} from members where room_id = $1 order by sort_order, created_at`,
          [roomId],
        );
        return rows.map(member);
      },
      async findInRoom(roomId, memberId) {
        const { rows } = await db.query<MemberRow>(
          `select ${MEMBER_COLS} from members where room_id = $1 and id = $2::uuid`,
          [roomId, memberId],
        );
        return rows[0] ? member(rows[0]) : null;
      },
      async findByInviteTokenHash(hash) {
        const { rows } = await db.query<MemberRow>(`select ${MEMBER_COLS} from members where invite_token_hash = $1`, [hash]);
        return rows[0] ? member(rows[0]) : null;
      },
      async findByMemberTokenHash(hash) {
        const { rows } = await db.query<MemberRow>(`select ${MEMBER_COLS} from members where member_token_hash = $1`, [hash]);
        return rows[0] ? member(rows[0]) : null;
      },
      async countByRoom(roomId) {
        const { rows } = await db.query<{ n: number }>('select count(*)::int as n from members where room_id = $1', [roomId]);
        return rows[0]?.n ?? 0;
      },
      async insert(m) {
        await db.query(
          `insert into members (${MEMBER_COLS}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [m.id, m.roomId, m.displayName, m.inviteTokenHash, m.inviteTokenEnc, m.inviteUsedAt, m.memberTokenHash, m.sortOrder, m.createdAt],
        );
      },
      async update(m) {
        const { rowCount } = await db.query(
          `update members set display_name=$3, invite_token_hash=$4, invite_token_enc=$5, invite_used_at=$6,
             member_token_hash=$7, sort_order=$8
           where room_id=$1 and id=$2::uuid`,
          [m.roomId, m.id, m.displayName, m.inviteTokenHash, m.inviteTokenEnc, m.inviteUsedAt, m.memberTokenHash, m.sortOrder],
        );
        if (rowCount === 0) throw notFound();
      },
      async delete(roomId, memberId) {
        await db.query('delete from members where room_id = $1 and id = $2::uuid', [roomId, memberId]);
      },
      async claimInvite(roomId, memberId, memberTokenHash, usedAt) {
        const { rowCount } = await db.query(
          `update members set member_token_hash=$3, invite_used_at=$4, invite_token_enc=null
           where room_id=$1 and id=$2::uuid and invite_used_at is null`,
          [roomId, memberId, memberTokenHash, usedAt],
        );
        return rowCount === 1;
      },
    },
    answers: {
      async findByMember(memberId) {
        const { rows } = await db.query<AnswerRow>('select * from answers where member_id = $1::uuid', [memberId]);
        return rows[0] ? answer(rows[0]) : null;
      },
      async listByRoom(roomId) {
        const { rows } = await db.query<AnswerRow>(
          `select a.* from answers a join members m on m.id = a.member_id where m.room_id = $1`,
          [roomId],
        );
        return rows.map(answer);
      },
      async upsert(a) {
        await db.query(
          `insert into answers (member_id, choice, cond_patterns, updated_at)
           values ($1::uuid, $2, $3::jsonb, $4)
           on conflict (member_id) do update set choice=excluded.choice, cond_patterns=excluded.cond_patterns,
             updated_at=excluded.updated_at`,
          [
            a.memberId,
            a.choice,
            JSON.stringify(a.patterns.map((p) => ({ people: p.people, need: p.need, minTotal: p.minTotal }))),
            a.updatedAt,
          ],
        );
      },
      async delete(memberId) {
        await db.query('delete from answers where member_id = $1::uuid', [memberId]);
      },
    },
    results: {
      async find(roomId) {
        const { rows } = await db.query<{ room_id: string; attending: string[]; computed_at: Date }>(
          'select * from results where room_id = $1',
          [roomId],
        );
        const r = rows[0];
        return r ? ({ roomId: r.room_id, attending: r.attending ?? [], computedAt: toDate(r.computed_at) } satisfies Result) : null;
      },
      async save(r) {
        await db.query(
          `insert into results (room_id, attending, computed_at) values ($1, $2::uuid[], $3)
           on conflict (room_id) do update set attending=excluded.attending, computed_at=excluded.computed_at`,
          [r.roomId, r.attending, r.computedAt],
        );
      },
      async delete(roomId) {
        await db.query('delete from results where room_id = $1', [roomId]);
      },
    },
    audit: {
      async append(e: AuditEvent) {
        await db.query(
          'insert into audit_events (room_id, member_id, actor, action, created_at) values ($1, $2::uuid, $3, $4, $5)',
          [e.roomId, e.memberId, e.actor, e.action, e.createdAt],
        );
      },
      async countAnswerSavesSinceLastClaim(roomId, memberId) {
        const { rows } = await db.query<{ n: number }>(
          `select count(*)::int as n from audit_events
           where room_id = $1 and member_id = $2::uuid and action = 'answer_saved'
             and id > coalesce((select max(id) from audit_events
                                where room_id = $1 and member_id = $2::uuid and action = 'invite_claimed'), 0)`,
          [roomId, memberId],
        );
        return rows[0]?.n ?? 0;
      },
    },
  };
}

/** PostgreSQL adapter (also used with Supabase via its connection string). */
export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: SqlPool) {}

  async read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const conn = await this.pool.connect();
    try {
      return await fn(makeTx(conn));
    } finally {
      conn.release();
    }
  }

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.inTransaction((conn) => fn(makeTx(conn)));
  }

  withRoomLock<T>(roomId: string, fn: (tx: Tx, room: Room) => Promise<T>): Promise<T> {
    return this.inTransaction(async (conn) => {
      const { rows } = await conn.query<RoomRow>('select * from rooms where id = $1 for update', [roomId]);
      if (!rows[0]) throw notFound();
      return fn(makeTx(conn), room(rows[0]));
    });
  }

  withEventLock<T>(eventId: string, fn: (tx: Tx, event: Event) => Promise<T>): Promise<T> {
    return this.inTransaction(async (conn) => {
      const { rows } = await conn.query<EventRow>('select * from events where id = $1 for update', [eventId]);
      if (!rows[0]) throw notFound();
      return fn(makeTx(conn), event(rows[0]));
    });
  }

  private async inTransaction<T>(fn: (conn: SqlClient) => Promise<T>): Promise<T> {
    const conn = await this.pool.connect();
    try {
      await conn.query('begin');
      try {
        const result = await fn(conn);
        await conn.query('commit');
        return result;
      } catch (e) {
        await conn.query('rollback');
        throw e;
      }
    } finally {
      conn.release();
    }
  }
}
