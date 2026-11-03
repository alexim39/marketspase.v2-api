/**
 * MarketSpase clothing-line economics simulation.
 *
 * Standalone model — does not touch the database or production code.
 * Adjust the assumptions below as real supplier, payment, refund and CAC data
 * arrives. Run with:
 *
 *   node scripts/marketspase-economics-simulation.js
 *   node scripts/marketspase-economics-simulation.js --json
 *
 * This is an illustrative planning model, not financial or legal advice.
 */

const assumptions = {
  price: 38000,
  shippingAndPackaging: 3000,
  paymentFeeRate: 0.015,
  refundReserveRate: 0.03,
  platformOpsPerActivation: 2000,
  commissionRates: [0.09, 0.045, 0.025, 0.015, 0.01],
  mentorBonus: 1000,
  rankBonusReserveRate: 0.015,
  partnerCacShare: 0.5,
  monthlyReorderValue: 5000,
  reorderGrossMarginRate: 0.4,
  cogsScenarios: [15000, 16000, 17500, 20000],
  cacScenarios: [5000, 6000, 8000],
};

const naira = (value) => {
  const rounded = Math.round(value);
  return `${rounded < 0 ? '-' : ''}₦${Math.abs(rounded).toLocaleString('en-NG')}`;
};
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const sum = (values) => values.reduce((total, value) => total + value, 0);

const commissionRate = sum(assumptions.commissionRates);
const levelOneRate = assumptions.commissionRates[0];

const productRows = assumptions.cogsScenarios.map((cogs) => {
  const paymentFee = assumptions.price * assumptions.paymentFeeRate;
  const grossMargin = assumptions.price - cogs - assumptions.shippingAndPackaging - paymentFee;
  const commissionPool = grossMargin * commissionRate;
  const rankBonusReserve = grossMargin * assumptions.rankBonusReserveRate;
  const refundReserve = assumptions.price * assumptions.refundReserveRate;
  const contributionBeforeCac =
    grossMargin -
    commissionPool -
    assumptions.mentorBonus -
    rankBonusReserve -
    refundReserve -
    assumptions.platformOpsPerActivation;

  return {
    cogs,
    paymentFee,
    grossMargin,
    grossMarginRate: grossMargin / assumptions.price,
    commissionPool,
    rankBonusReserve,
    refundReserve,
    contributionBeforeCac,
  };
});

const platformRows = [];
const partnerRows = [];

for (const row of productRows) {
  for (const cac of assumptions.cacScenarios) {
    const platformContribution = row.contributionBeforeCac - cac;
    const contributionPct = platformContribution / assumptions.price;
    let verdict = 'CAUTION';
    if (platformContribution <= 0) verdict = 'NO-GO';
    else if (row.cogs <= 16000 && cac <= 6000 && contributionPct >= 0.10) verdict = 'GO';

    platformRows.push({
      COGS: naira(row.cogs),
      CAC: naira(cac),
      'Platform contribution': naira(platformContribution),
      '% of price': percent(contributionPct),
      Verdict: verdict,
    });

    const levelOnePayout = row.grossMargin * levelOneRate + assumptions.mentorBonus;
    const partnerCac = cac * assumptions.partnerCacShare;
    const shortfall = Math.max(0, partnerCac - levelOnePayout);
    const residual =
      assumptions.monthlyReorderValue *
      assumptions.reorderGrossMarginRate *
      levelOneRate;
    const paybackMonths = shortfall > 0 ? shortfall / residual : 0;

    partnerRows.push({
      COGS: naira(row.cogs),
      CAC: naira(cac),
      'Partner CAC share': naira(partnerCac),
      'L1 payout + mentor': naira(levelOnePayout),
      'Gap after activation': naira(shortfall),
      'Residual/month': naira(residual),
      'Payback months': shortfall > 0 ? paybackMonths.toFixed(1) : 'Immediate',
    });
  }
}

const productTable = productRows.map((row) => ({
  COGS: naira(row.cogs),
  'Gross margin': naira(row.grossMargin),
  'GM %': percent(row.grossMarginRate),
  'Commission 18.5%': naira(row.commissionPool),
  'Mentor bonus': naira(assumptions.mentorBonus),
  'Rank reserve': naira(row.rankBonusReserve),
  'Refund reserve': naira(row.refundReserve),
  'Ops': naira(assumptions.platformOpsPerActivation),
  'Before CAC': naira(row.contributionBeforeCac),
}));

const recommended = {
  cogs: 16000,
  cac: 6000,
};
const recommendedRow = productRows.find((row) => row.cogs === recommended.cogs);
const recommendedPlatform = recommendedRow.contributionBeforeCac - recommended.cac;
const recommendedPct = recommendedPlatform / assumptions.price;
const recommendedL1 = recommendedRow.grossMargin * levelOneRate + assumptions.mentorBonus;
const recommendedPartnerCac = recommended.cac * assumptions.partnerCacShare;
const recommendedGap = Math.max(0, recommendedPartnerCac - recommendedL1);
const recommendedResidual =
  assumptions.monthlyReorderValue *
  assumptions.reorderGrossMarginRate *
  levelOneRate;

const result = {
  assumptions,
  commissionRate,
  recommendation: {
    price: assumptions.price,
    cogs: recommended.cogs,
    cac: recommended.cac,
    grossMargin: recommendedRow.grossMargin,
    platformContribution: recommendedPlatform,
    platformContributionPct: recommendedPct,
    levelOnePayout: recommendedL1,
    partnerCacShare: recommendedPartnerCac,
    gapAfterActivation: recommendedGap,
    residualPerMonth: recommendedResidual,
    paybackMonths: recommendedGap > 0 ? recommendedGap / recommendedResidual : 0,
  },
  productTable,
  platformTable: platformRows,
  partnerTable: partnerRows,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log('\nMarketSpase clothing-line economics — illustrative model\n');
console.log(
  `Price ${naira(assumptions.price)} · commission ${(commissionRate * 100).toFixed(1)}% of gross margin · ` +
    `mentor bonus ${naira(assumptions.mentorBonus)} · rank reserve ${(assumptions.rankBonusReserveRate * 100).toFixed(1)}% of GM · ` +
    `refund reserve ${(assumptions.refundReserveRate * 100).toFixed(1)}% of price\n`,
);

console.log('Product economics');
console.table(productTable);

console.log('\nPlatform contribution after CAC');
console.table(platformRows);

console.log('\nPartner activation economics (50/50 CAC co-funding)');
console.table(partnerRows);

console.log('\nRecommended scenario');
console.log({
  'Price': naira(assumptions.price),
  'COGS': naira(recommended.cogs),
  'CAC': naira(recommended.cac),
  'Gross margin': naira(recommendedRow.grossMargin),
  'Platform contribution': `${naira(recommendedPlatform)} (${percent(recommendedPct)} of price)`,
  'Partner Level 1 + mentor': naira(recommendedL1),
  'Partner CAC share': naira(recommendedPartnerCac),
  'Gap after activation': naira(recommendedGap),
  'Residual per month': naira(recommendedResidual),
  'Partner payback': recommendedGap > 0 ? `${(recommendedGap / recommendedResidual).toFixed(1)} months` : 'Immediate',
});

console.log('\nInterpretation');
console.log('- GO only when COGS <= ₦16,000, CAC <= ₦6,000 and platform contribution is at least 10% of price.');
console.log('- CAUTION means the platform still makes a contribution, but the margin is below the target.');
console.log('- NO-GO means the platform loses money; do not launch that combination.');
console.log('- Partner payback assumes a ₦5,000 monthly reorder at 40% gross margin and excludes team growth.');
console.log('- Replace the assumptions with real supplier, payment, refund, CAC and retention data before launch.\n');
