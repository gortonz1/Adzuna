// Deterministic sample data so the dashboard renders without Adzuna API keys.
// Every number here is synthetic; the UI shows a demo banner whenever it is used.
// Company names are fictional on purpose.

export const COUNTRIES = [
  { code: 'gb', label: 'United Kingdom' },
  { code: 'us', label: 'United States' },
  { code: 'au', label: 'Australia' },
  { code: 'ca', label: 'Canada' },
  { code: 'de', label: 'Germany' },
  { code: 'fr', label: 'France' },
  { code: 'in', label: 'India' },
  { code: 'nl', label: 'Netherlands' },
  { code: 'nz', label: 'New Zealand' },
  { code: 'pl', label: 'Poland' },
  { code: 'sg', label: 'Singapore' },
  { code: 'za', label: 'South Africa' },
];

// tag, label, share of all vacancies, AI-mention share, typical advertised salary (GBP)
const CATEGORIES = [
  ['it-jobs', 'IT Jobs', 0.085, 0.148, 57500],
  ['scientific-qa-jobs', 'Scientific & QA Jobs', 0.012, 0.094, 41800],
  ['pr-advertising-marketing-jobs', 'PR, Advertising & Marketing Jobs', 0.024, 0.083, 38200],
  ['consultancy-jobs', 'Consultancy Jobs', 0.008, 0.066, 52300],
  ['creative-design-jobs', 'Creative & Design Jobs', 0.009, 0.061, 36400],
  ['engineering-jobs', 'Engineering Jobs', 0.055, 0.052, 44600],
  ['accounting-finance-jobs', 'Accounting & Finance Jobs', 0.048, 0.041, 45200],
  ['legal-jobs', 'Legal Jobs', 0.013, 0.036, 51800],
  ['hr-jobs', 'HR & Recruitment Jobs', 0.021, 0.033, 37900],
  ['graduate-jobs', 'Graduate Jobs', 0.006, 0.031, 29800],
  ['sales-jobs', 'Sales Jobs', 0.046, 0.027, 34100],
  ['energy-oil-gas-jobs', 'Energy, Oil & Gas Jobs', 0.007, 0.024, 48700],
  ['admin-jobs', 'Admin Jobs', 0.035, 0.019, 26400],
  ['teaching-jobs', 'Teaching Jobs', 0.052, 0.017, 33600],
  ['customer-services-jobs', 'Customer Services Jobs', 0.033, 0.015, 24800],
  ['manufacturing-jobs', 'Manufacturing Jobs', 0.024, 0.013, 29700],
  ['healthcare-nursing-jobs', 'Healthcare & Nursing Jobs', 0.13, 0.011, 34900],
  ['retail-jobs', 'Retail Jobs', 0.038, 0.009, 23900],
  ['logistics-warehouse-jobs', 'Logistics & Warehouse Jobs', 0.041, 0.008, 27600],
  ['social-work-jobs', 'Social Work Jobs', 0.028, 0.007, 32800],
  ['property-jobs', 'Property Jobs', 0.009, 0.007, 36700],
  ['trade-construction-jobs', 'Trade & Construction Jobs', 0.036, 0.006, 38300],
  ['travel-jobs', 'Travel Jobs', 0.004, 0.006, 27200],
  ['charity-voluntary-jobs', 'Charity & Voluntary Jobs', 0.007, 0.006, 30100],
  ['maintenance-jobs', 'Maintenance Jobs', 0.014, 0.005, 31500],
  ['hospitality-catering-jobs', 'Hospitality & Catering Jobs', 0.045, 0.004, 24300],
  ['domestic-help-cleaning-jobs', 'Domestic Help & Cleaning Jobs', 0.012, 0.002, 21800],
];

const COUNTRY_SCALE = { gb: 1, us: 6.2, au: 0.55, ca: 0.7, de: 1.4, fr: 1.1, in: 1.8, nl: 0.5, nz: 0.12, pl: 0.4, sg: 0.15, za: 0.2 };
const SALARY_SCALE = { gb: 1, us: 1.55, au: 1.7, ca: 1.45, de: 1.15, fr: 1.05, in: 0.25, nl: 1.1, nz: 1.35, pl: 0.55, sg: 1.5, za: 0.6 };
const BASE_TOTAL = 1_150_000; // GB-sized market

// Small deterministic PRNG so demo numbers are stable across restarts.
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

function monthsBack(n, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// The overview is anchored to the latest demo snapshot so the KPI tiles agree
// with the last point of the trend charts.
export function demoOverview(country) {
  const rand = seeded(`overview:${country}`);
  const latest = demoSnapshots(country).at(-1);
  const total = latest.total;
  const categories = CATEGORIES.map(([tag, label, catShare, aiShare]) => {
    const t = Math.round(total * catShare * (0.9 + rand() * 0.2));
    const a = Math.round(t * aiShare * (0.85 + rand() * 0.3));
    return { tag, label, total: t, ai: a, share: a / t };
  });
  const rawAi = categories.reduce((s, c) => s + c.ai, 0);
  const aiScale = latest.ai / rawAi;
  for (const c of categories) {
    c.ai = Math.min(c.total, Math.round(c.ai * aiScale));
    c.share = c.ai / c.total;
  }
  return {
    country,
    generatedAt: new Date().toISOString(),
    total,
    ai: latest.ai,
    share: latest.share,
    categories,
  };
}

// 18 monthly snapshots: AI-mention share climbing ~2.1% -> ~4.8% of all ads.
export function demoSnapshots(country) {
  const rand = seeded(`snapshots:${country}`);
  const scale = COUNTRY_SCALE[country] ?? 1;
  const months = monthsBack(18);
  return months.map((date, i) => {
    const p = i / (months.length - 1);
    const seasonal = 1 + 0.04 * Math.sin((i / 12) * 2 * Math.PI);
    const total = Math.round(BASE_TOTAL * scale * seasonal * (0.97 + rand() * 0.06));
    const share = 0.021 + p * p * 0.027 + (rand() - 0.5) * 0.0015;
    const ai = Math.round(total * share);
    return { date, total, ai, share: ai / total };
  });
}

export function demoSalaryHistory(country, categoryTag) {
  const cat = CATEGORIES.find((c) => c[0] === categoryTag) || CATEGORIES[0];
  const rand = seeded(`salary:${country}:${categoryTag}`);
  const base = cat[4] * (SALARY_SCALE[country] ?? 1);
  return monthsBack(12).map((date, i) => ({
    month: date.slice(0, 7),
    salary: Math.round((base * (1 + 0.035 * (i / 11)) * (0.985 + rand() * 0.03)) / 50) * 50,
  }));
}

const DEMO_COMPANIES = [
  'Nimbus Analytics', 'Bramblewood Group', 'Quartzline Systems', 'Harborlight Health',
  'Vextral Consulting', 'Openfield Labs', 'Corvid Financial', 'Latticework Media',
  'Peakstone Recruitment', 'Bluewren Technologies', 'Ferngate Logistics', 'Solvenpoint',
];

export function demoTopCompanies(country, categoryTag) {
  const rand = seeded(`companies:${country}:${categoryTag || 'all'}`);
  const scale = COUNTRY_SCALE[country] ?? 1;
  const salaryScale = SALARY_SCALE[country] ?? 1;
  return DEMO_COMPANIES
    .map((name) => ({
      name,
      count: Math.round((40 + rand() * 900) * scale),
      avgSalary: Math.round(((34000 + rand() * 42000) * salaryScale) / 100) * 100,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export function demoCategories() {
  return CATEGORIES.map(([tag, label]) => ({ tag, label }));
}
