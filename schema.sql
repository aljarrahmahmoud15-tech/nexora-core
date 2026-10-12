-- NEXORA core schema (idempotent)
create table if not exists bots (
  id          text primary key,
  name        text not null,
  code        text not null unique,
  wa_status   text not null default 'off' check (wa_status in ('ready','off','qr')),
  group_invite text,
  group_id    text,
  token_hash  text,
  last_seen   timestamptz
);

create table if not exists captains (
  id          bigserial primary key,
  bot_id      text not null references bots(id),
  phone       text not null unique,
  name        text,
  status      text not null default 'active' check (status in ('active','suspended')),
  balance_fils bigint not null default 0,
  joined_at   timestamptz not null default now()
);
create index if not exists captains_bot_idx on captains(bot_id, status);

create table if not exists requests (
  id          bigserial primary key,
  bot_id      text not null references bots(id),
  kind        text not null,
  status      text not null default 'open',
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists requests_bot_idx on requests(bot_id, status);

-- Rules: the instructions NEXORA enforces on every bot
create table if not exists rules (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Anything sensitive waits here for the owner's explicit decision
create table if not exists approvals (
  id          bigserial primary key,
  bot_id      text references bots(id),
  kind        text not null check (kind in ('settlement','refund','deduction','new_module','other')),
  payload     jsonb not null default '{}',
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  note        text
);
create index if not exists approvals_status_idx on approvals(status);

create table if not exists modules (
  name        text primary key,
  version     text not null,
  enabled     boolean not null default true
);

create table if not exists audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       text not null,
  action      text not null,
  target      text,
  detail      jsonb not null default '{}'
);
create index if not exists audit_at_idx on audit_log(at desc);

-- Seed: five bots and the base rules
insert into bots (id, name, code) values
  ('b1','وصلني الآن','dc-admin-1'),
  ('b2','الشمال','dc-admin-2'),
  ('b3','البوت الثالث','dc-admin-3'),
  ('b4','البوت الرابع','dc-admin-4'),
  ('b5','البوت الخامس','dc-admin-5')
on conflict (id) do nothing;

insert into rules (key, value) values
  ('captain_capacity', '250'),
  ('gifts', '{"rose":1500,"coffee":1000,"chocolate":2500,"star":5000}')
on conflict (key) do nothing;

-- Shadow settlements: what NEXORA would settle, kept for comparison with V26. Moves no balance.
create table if not exists settlement_shadow (
  id                bigserial primary key,
  bot_id            text not null references bots(id),
  booking_ref       text not null unique,
  price_fils        bigint not null check (price_fils > 0),
  executor_fee_fils bigint not null,
  owner_net_fils    bigint not null,
  company_fee_fils  bigint not null,
  created_at        timestamptz not null default now()
);

insert into rules (key, value) values
  ('commission_executor_pct', '15'),
  ('commission_company_pct', '15'),
  ('wallet_debt_limit_fils', '2000')
on conflict (key) do nothing;

-- ===== NEXORA as the authority =====
-- Who settles a bot's group: the old V26 server or NEXORA. Never both.
alter table bots add column if not exists authority text not null default 'v26'
  check (authority in ('v26','nexora'));

create table if not exists bookings (
  id                      bigserial primary key,
  bot_id                  text not null references bots(id),
  offer_msg_id            text not null,
  owner_captain_id        bigint not null references captains(id),
  price_fils              bigint not null check (price_fils > 0),
  status                  text not null default 'offered' check (status in ('offered','confirmed','void')),
  executor_captain_id     bigint references captains(id),
  confirmed_request_msg_id text,
  executor_fee_fils       bigint,
  owner_net_fils          bigint,
  company_fee_fils        bigint,
  created_at              timestamptz not null default now(),
  confirmed_at            timestamptz,
  unique (bot_id, offer_msg_id)
);

create table if not exists booking_requests (
  id                  bigserial primary key,
  booking_id          bigint not null references bookings(id),
  request_msg_id      text not null unique,
  executor_captain_id bigint not null references captains(id),
  created_at          timestamptz not null default now()
);

-- Append-only ledger: every balance change is a row. One settlement per booking.
create table if not exists ledger (
  id                 bigserial primary key,
  at                 timestamptz not null default now(),
  booking_id         bigint references bookings(id),
  account            text not null,
  captain_id         bigint references captains(id),
  kind               text not null check (kind in ('commission','owner_share','company_fee','card_redeem','adjustment')),
  amount_fils        bigint not null,
  balance_after_fils bigint,
  note               text,
  unique (booking_id, kind)
);
create index if not exists ledger_captain_idx on ledger(captain_id, id desc);

-- Top-up cards. Only the hash of the code is stored.
create table if not exists cards (
  id                  bigserial primary key,
  code_hash           text not null unique,
  value_fils          bigint not null check (value_fils > 0),
  status              text not null default 'active' check (status in ('active','used','void')),
  note                text,
  created_at          timestamptz not null default now(),
  used_at             timestamptz,
  used_by_captain_id  bigint references captains(id)
);

-- Owner-editable bot profile (matches the approved design). All empty by default.
alter table bots add column if not exists admin_url text;
alter table bots add column if not exists captains_manual int;
alter table bots add column if not exists requests_manual int;
alter table bots add column if not exists wa_manual text check (wa_manual in ('ready','off'));
