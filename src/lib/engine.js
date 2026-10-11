// NEXORA's decision engine. The bot only reports what it SAW in the group;
// every decision (offer, request, confirmation, settlement) is made here.
const { settle, canAccept } = require('./settlement');
const { parsePrice, isRequestText, isLike } = require('./parse');
const { normalizePhone } = require('./phone');

const ignore = (reason) => ({ action: 'ignored', reason });
const who = (ev) => normalizePhone(ev.senderPhone || ev.senderId);

// store: getCaptain, findBookingByOffer, createBooking, addRequest, findRequest, confirmBooking
async function handleEvent(store, rules, botId, ev) {
  if (ev.type === 'message') {
    const sender = who(ev);
    if (!ev.quotedMsgId) {
      // Step 1: an offer. Price word/number in the first line.
      const price = parsePrice(ev.text);
      if (price === null) return ignore('no_price');
      const owner = await store.getCaptain(botId, sender);
      if (!owner || owner.status !== 'active') return ignore('owner_not_registered');
      const b = await store.createBooking({
        botId, offerMsgId: ev.msgId, ownerCaptainId: owner.id, priceFils: price });
      return { action: 'offer_recorded', bookingId: b.id, priceFils: b.priceFils };
    }
    // Step 2: a reply to an offer, by someone else, saying تم / تم معك / محجوز / Mark.
    if (!isRequestText(ev.text)) return ignore('not_request_text');
    const b = await store.findBookingByOffer(botId, ev.quotedMsgId);
    if (!b) return ignore('not_an_offer');
    if (b.status !== 'offered') return ignore('offer_closed');
    const ex = await store.getCaptain(botId, sender);
    if (!ex || ex.status !== 'active') return ignore('executor_not_registered');
    if (ex.id === b.ownerCaptainId) return ignore('same_person');
    if (!canAccept(ex.balanceFils, rules.debtLimitFils)) {
      return { action: 'rejected', reason: 'debt_limit',
        reply: 'تعذّر قبول الطلب: رصيدك تجاوز حد المديونية. يرجى الشحن أولاً.' };
    }
    const created = await store.addRequest({
      bookingId: b.id, requestMsgId: ev.msgId, executorCaptainId: ex.id });
    return created ? { action: 'request_recorded', bookingId: b.id } : ignore('duplicate_request');
  }

  if (ev.type === 'reaction') {
    // Step 3: like/heart from the OFFER OWNER on the reply. First valid like closes the offer.
    if (!isLike(ev.emoji)) return ignore('not_like');
    const rq = await store.findRequest(botId, ev.targetMsgId);
    if (!rq) return ignore('not_a_request');
    const reactor = await store.getCaptain(botId, who(ev));
    if (!reactor || reactor.id !== rq.ownerCaptainId) return ignore('reactor_not_offer_owner');
    if (rq.bookingStatus !== 'offered') return ignore('already_confirmed');
    const s = settle(rq.priceFils, rules); // price frozen at step 1
    const r = await store.confirmBooking({
      bookingId: rq.bookingId, requestMsgId: ev.targetMsgId,
      executorCaptainId: rq.executorCaptainId, ownerCaptainId: rq.ownerCaptainId, settlement: s });
    if (!r.ok) return ignore(r.reason);
    return { action: 'confirmed', bookingId: rq.bookingId, settlement: s, reply: '✅ تم تثبيت الحجز.' };
  }
  return ignore('unknown_event');
}

// OWNER AUTHORITY: the admin adds a booking from the two phone numbers and a price, and may
// confirm it on the spot. It goes through the same ledger as a group booking. The debt limit
// does not stop the admin, but it is reported in the result.
async function adminBooking(store, rules, { botId, ownerPhone, executorPhone, priceFils, confirm = true, newId }) {
  if (!Number.isSafeInteger(priceFils) || priceFils <= 0 || priceFils > 1_000_000) return { error: 'bad_price' };
  const op = normalizePhone(ownerPhone);
  const ep = normalizePhone(executorPhone);
  if (!op || !ep) return { error: 'bad_phone' };
  if (op === ep) return { error: 'same_person' };
  const [o, e] = await Promise.all([store.getCaptain(botId, op), store.getCaptain(botId, ep)]);
  if (!o) return { error: 'owner_not_found' };
  if (!e) return { error: 'executor_not_found' };
  if (o.status !== 'active') return { error: 'owner_inactive' };
  if (e.status !== 'active') return { error: 'executor_inactive' };
  const b = await store.createBooking({ botId, offerMsgId: 'admin:' + newId, ownerCaptainId: o.id, priceFils });
  const requestMsgId = 'admin:' + newId + ':r';
  await store.addRequest({ bookingId: b.id, requestMsgId, executorCaptainId: e.id });
  if (!confirm) return { bookingId: b.id, status: 'offered' };
  const s = settle(priceFils, rules);
  const r = await store.confirmBooking({
    bookingId: b.id, requestMsgId, executorCaptainId: e.id, ownerCaptainId: o.id, settlement: s });
  if (!r.ok) return { error: r.reason };
  return { bookingId: b.id, status: 'confirmed', settlement: s,
    overLimit: !canAccept(e.balanceFils - s.executorFee, rules.debtLimitFils), // balance AFTER settlement
    executorBalanceAfter: e.balanceFils - s.executorFee, ownerBalanceAfter: o.balanceFils + s.ownerNet };
}

module.exports = { handleEvent, adminBooking };
