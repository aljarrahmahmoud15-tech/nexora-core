async function loadRules(q) {
  const { rows } = await q(
    `select key, value #>> '{}' as v from rules
     where key in ('commission_executor_pct','commission_company_pct','wallet_debt_limit_fils')`);
  const m = Object.fromEntries(rows.map((r) => [r.key, Number(r.v)]));
  return {
    executorPct: m.commission_executor_pct ?? 15,
    companyPct: m.commission_company_pct ?? 15,
    debtLimitFils: m.wallet_debt_limit_fils ?? 2000,
  };
}
module.exports = { loadRules };
