#!/usr/bin/env node
// End-to-end smoke test against a running environment (local or AWS).
//
//   node infra/scripts/smoke-test.mjs http://localhost:8787
//   node infra/scripts/smoke-test.mjs https://xxxx.cloudfront.net
//
// It creates one room titled "[smoke] <timestamp>" with two members, answers, and
// closes it. The room is purged automatically 90 days after closing.
// Exit code 0 = all checks passed.
import { createHash } from 'node:crypto';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
if (!BASE) {
  console.error('usage: node infra/scripts/smoke-test.mjs <base-url>');
  process.exit(2);
}

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

async function req(method, path, body, headers = {}) {
  const data = body === undefined ? undefined : JSON.stringify(body);
  const h = { ...headers };
  if (data) h['Content-Type'] = 'application/json';
  // Required by CloudFront OAC in front of the Lambda function URL; harmless elsewhere.
  if (method !== 'GET') h['x-amz-content-sha256'] = createHash('sha256').update(data ?? '').digest('hex');
  const res = await fetch(BASE + path, { method, headers: h, body: data });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

const health = await req('GET', '/api/nope');
check('API reachable (unknown path → 404 JSON)', health.status === 404 && health.json?.error?.code === 'not_found', `status ${health.status}`);

const created = await req('POST', '/api/rooms', { title: `[smoke] ${new Date().toISOString()}` });
check('create room → 201', created.status === 201, `status ${created.status}`);
if (created.status !== 201) process.exit(1);
check('Referrer-Policy: no-referrer', created.headers.get('referrer-policy') === 'no-referrer');

const { roomId, adminToken } = created.json;
const admin = { 'X-Admin-Token': adminToken };
const ids = {};
const tokens = {};
for (const name of ['A', 'B']) {
  const added = await req('POST', `/api/rooms/${roomId}/members`, { name }, admin);
  check(`add member ${name} → 201`, added.status === 201);
  ids[name] = added.json.member.id;
  const invite = added.json.member.inviteToken;
  const claim = await req('POST', `/api/rooms/${roomId}/claim`, undefined, { 'X-Invite-Token': invite });
  check(`claim invite ${name} → 200`, claim.status === 200);
  tokens[name] = claim.json.memberToken;
  const again = await req('POST', `/api/rooms/${roomId}/claim`, undefined, { 'X-Invite-Token': invite });
  check(`second claim ${name} → 410`, again.status === 410);
}

// OR of two patterns: "B comes" or "at least 5 others come" (only the first can hold).
const saveA = await req(
  'PUT',
  `/api/rooms/${roomId}/me/answer`,
  {
    choice: 'cond',
    patterns: [
      { people: [ids.B], need: 1, minTotal: 0 },
      { people: [], need: 0, minTotal: 1 },
    ],
  },
  { 'X-Member-Token': tokens.A },
);
check('save conditional answer (2 OR-patterns) → 200', saveA.status === 200 && saveA.json.me.saveCount === 1 && saveA.json.me.answer?.patterns?.length === 2);
const saveB = await req('PUT', `/api/rooms/${roomId}/me/answer`, { choice: 'yes' }, { 'X-Member-Token': tokens.B });
check('save yes → 200', saveB.status === 200);

const view = await req('GET', `/api/rooms/${roomId}/admin`, undefined, admin);
check('admin view has no answer contents', view.status === 200 && !JSON.stringify(view.json).includes('"choice"'));
check('admin view: everyone answered', view.json.unansweredCount === 0);

const otherView = await req('GET', `/api/rooms/${roomId}/me`, undefined, { 'X-Member-Token': tokens.B });
check("member view hides others' answers", otherView.json.me.id === ids.B && !JSON.stringify(otherView.json.members).includes('choice'));

const closed = await req('POST', `/api/rooms/${roomId}/close`, undefined, admin);
check('close → both attend', closed.status === 200 && closed.json.result?.attending?.length === 2);
check('save after close → 409', (await req('PUT', `/api/rooms/${roomId}/me/answer`, { choice: 'no' }, { 'X-Member-Token': tokens.A })).status === 409);
check('wrong admin token → 404', (await req('GET', `/api/rooms/${roomId}/admin`, undefined, { 'X-Admin-Token': 'wrong' })).status === 404);
check('unknown field → 422', (await req('PUT', `/api/rooms/${roomId}/me/answer`, { choice: 'yes', memberId: 'x' }, { 'X-Member-Token': tokens.B })).status === 422);

// ---- Group invitation: one shared URL, each name can be picked once ----
const g = await req('POST', '/api/rooms', { title: `[smoke] group ${new Date().toISOString()}`, inviteMode: 'group' });
check('create group room → 201', g.status === 201);
const gAdmin = { 'X-Admin-Token': g.json.adminToken };
const gRoom = g.json.roomId;
const gName = await req('POST', `/api/rooms/${gRoom}/members`, { name: 'G1' }, gAdmin);
const gView = await req('GET', `/api/rooms/${gRoom}/admin`, undefined, gAdmin);
const groupToken = gView.json.groupToken;
check('admin view has the group URL token', typeof groupToken === 'string' && groupToken.length > 20);
const gList = await req('GET', `/api/rooms/${gRoom}/group`, undefined, { 'X-Group-Token': groupToken });
check('group view lists names (no answers)', gList.status === 200 && gList.json.members.length === 1 && !JSON.stringify(gList.json).includes('answered'));
const gPick = await req('POST', `/api/rooms/${gRoom}/group/claim`, { memberId: gName.json.member.id }, { 'X-Group-Token': groupToken });
check('pick a name → 200', gPick.status === 200);
check('pick the same name again → 410', (await req('POST', `/api/rooms/${gRoom}/group/claim`, { memberId: gName.json.member.id }, { 'X-Group-Token': groupToken })).status === 410);
check('answer as the picked name → 200', (await req('PUT', `/api/rooms/${gRoom}/me/answer`, { choice: 'yes' }, { 'X-Member-Token': gPick.json.memberToken })).status === 200);
const gClosed = await req('POST', `/api/rooms/${gRoom}/close`, undefined, gAdmin);
check('close group room → attends', gClosed.status === 200 && gClosed.json.result?.attending?.length === 1);

// ---- Event with communities: the organizer sees totals; members see only their community ----
const ev = await req('POST', '/api/events', { title: `[smoke] event ${new Date().toISOString()}` });
check('create event → 201', ev.status === 201);
const evAdmin = { 'X-Admin-Token': ev.json.adminToken };
const comm = await req('POST', `/api/events/${ev.json.eventId}/communities`, { name: 'C1' }, evAdmin);
check('add community → 201', comm.status === 201);
const cRoom = comm.json.roomId;
const cMember = await req('POST', `/api/rooms/${cRoom}/members`, { name: 'E1' }, evAdmin);
check('event token manages the community', cMember.status === 201);
const cClaim = await req('POST', `/api/rooms/${cRoom}/claim`, undefined, { 'X-Invite-Token': cMember.json.member.inviteToken });
const cMe = await req('GET', `/api/rooms/${cRoom}/me`, undefined, { 'X-Member-Token': cClaim.json.memberToken });
check('member sees the community name, no event data', cMe.json.room?.communityName === 'C1' && !/totals|attendees|communities/.test(JSON.stringify(cMe.json)));
await req('PUT', `/api/rooms/${cRoom}/me/answer`, { choice: 'yes' }, { 'X-Member-Token': cClaim.json.memberToken });
await req('POST', `/api/rooms/${cRoom}/close`, undefined, evAdmin);
const evView = await req('GET', `/api/events/${ev.json.eventId}/admin`, undefined, evAdmin);
check('event totals after close', evView.status === 200 && evView.json.totals?.attendingCount === 1 && evView.json.attendees?.[0]?.community === 'C1');
check('room admin token cannot open the event', (await req('GET', `/api/events/${ev.json.eventId}/admin`, undefined, admin)).status === 404);

const spa = await fetch(`${BASE}/r/${roomId}/m`);
const html = await spa.text();
if (html.toLowerCase().includes('<!doctype html')) {
  check('SPA deep link serves index.html', spa.status === 200);
} else {
  console.log('SKIP  SPA deep link (base URL is the API only)');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
