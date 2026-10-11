// One canonical form for phones: digits only, Jordan local 07xxxxxxxx -> 9627xxxxxxxx.
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^07\d{8}$/.test(d)) d = '962' + d.slice(1);
  return d;
}
module.exports = { normalizePhone };
