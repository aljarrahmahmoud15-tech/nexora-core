// PostgreSQL implementation of the engine's store. Money moves ONLY in confirmBooking,
// inside one transaction, with a ledger row for every change.
class SqlStore {
  constructor(q, tx) { this.q = q; this.tx = tx; }

  async getCaptain(botId, phone) {
    const { rows } = await this.q(
      'select id, status, balance_fils from captains where bot_id=$1 and phone=$2', [botId, phone]);
    return rows[0] ? { id: Number(rows[0].id), status: rows[0].status, balanceFils: Number(rows[0].balance_fils) } : null;
  }

  async findBookingByOffer(botId, offerMsgId) {
    const { rows } = await this.q(
      'select id, status, owner_captain_id, price_fils from bookings where bot_id=$1 and offer_msg_id=$2',
      [botId, offerMsgId]);
    return rows[0] ? { id: Number(rows[0].id), status: rows[0].status,
      ownerCaptainId: Number(rows[0].owner_captain_id), priceFils: Number(rows[0].price_fils) } : null;
  }

  async createBooking({ botId, offerMsgId, ownerCaptainId, priceFils }) {
    await this.q(
      `insert into bookings(bot_id, offer_msg_id, owner_captain_id, price_fils) values($1,$2,$3,$4)
       on conflict (bot_id, offer_msg_id) do nothing`, [botId, offerMsgId, ownerCaptainId, priceFils]);
    return this.findBookingByOffer(botId, offerMsgId);
  }

  async addRequest({ bookingId, requestMsgId, executorCaptainId }) {
    const r = await this.q(
      `insert into booking_requests(booking_id, request_msg_id, executor_captain_id) values($1,$2,$3)
       on conflict (request_msg_id) do nothing returning id`, [bookingId, requestMsgId, executorCaptainId]);
    return r.rowCount > 0;
  }

  async findRequest(botId, requestMsgId) {
    const { rows } = await this.q(
      `select r.booking_id, r.executor_captain_id, b.owner_captain_id, b.price_fils, b.status
       from booking_requests r join bookings b on b.id=r.booking_id
       where b.bot_id=$1 and r.request_msg_id=$2`, [botId, requestMsgId]);
    const x = rows[0];
    return x ? { bookingId: Number(x.booking_id), executorCaptainId: Number(x.executor_captain_id),
      ownerCaptainId: Number(x.owner_captain_id), priceFils: Number(x.price_fils), bookingStatus: x.status } : null;
  }

  async confirmBooking({ bookingId, requestMsgId, executorCaptainId, ownerCaptainId, settlement: s }) {
    return this.tx(async (c) => {
      const b = await c.query('select status from bookings where id=$1 for update', [bookingId]);
      if (!b.rows[0] || b.rows[0].status !== 'offered') return { ok: false, reason: 'already_confirmed' };
      const ids = [executorCaptainId, ownerCaptainId].sort((a, z) => a - z);
      await c.query('select id from captains where id = any($1::bigint[]) order by id for update', [ids]);
      const post = async (account, captainId, amount, kind) => {
        let after = null;
        if (captainId) {
          const u = await c.query(
            'update captains set balance_fils = balance_fils + $2 where id=$1 returning balance_fils',
            [captainId, amount]);
          after = u.rows[0].balance_fils;
        }
        await c.query(
          `insert into ledger(booking_id, account, captain_id, kind, amount_fils, balance_after_fils)
           values($1,$2,$3,$4,$5,$6)`, [bookingId, account, captainId, kind, amount, after]);
      };
      await post('captain:' + executorCaptainId, executorCaptainId, -s.executorFee, 'commission');
      await post('captain:' + ownerCaptainId, ownerCaptainId, s.ownerNet, 'owner_share');
      await post('company', null, s.companyFee, 'company_fee');
      await c.query(
        `update bookings set status='confirmed', confirmed_request_msg_id=$2, executor_captain_id=$3,
           executor_fee_fils=$4, owner_net_fils=$5, company_fee_fils=$6, confirmed_at=now() where id=$1`,
        [bookingId, requestMsgId, executorCaptainId, s.executorFee, s.ownerNet, s.companyFee]);
      return { ok: true };
    });
  }
}
module.exports = { SqlStore };
