// Token Radar — scoring model, third revision.
//
// The snapshot is sealed: every protocol the house fetched from DefiLlama
// on 2026-11-14, with a watchlist of the 40 biggest tokenless protocols.
// This module turns that snapshot into a ranked board. Nothing here
// reaches the network, and nothing here names a protocol specially —
// one scoring function runs over every row, so the ranking is the
// model's, not a hand-picked list.
//
// What a token is worth, in this model, is a claim built from four
// things the snapshot itself records:
//
//   size     — tvl_usd, the economy a token would price, at 35 cents
//              on the dollar of TVL as a starting point;
//   momentum — change_7d, clamped to [-50, +150] percent, weighted 0.7,
//              so a wild week cannot dominate the score;
//   maturity — age since listed_at, capped at four years, mapped to
//              0.5 .. 1.0, so a protocol that has run a long time with
//              no token scores higher than a newcomer of the same size;
//   reach    — how many chains it already runs on, +4% per extra chain,
//              capped at four extra chains.
//
// A protocol whose token already trades (a market cap, a CoinGecko id,
// or a symbol on record) is never ranked: it goes in a separate Live
// list with its market cap shown as a fact. A wrapped, staked or
// bridged product of a traded token is not rankable either, for the
// same reason — WBTC is Bitcoin on Ethereum, not a launch waiting
// to happen. The board is the 40 watchlist protocols plus every
// other rankable pre-token protocol below the $50M floor: 178 rows.
//
// Worked example, Steakhouse Financial at the top of the board:
// TVL $2,158,015,238 x 0.35 = $755,305,333 base, times a growth
// multiplier near 1, a maturity multiplier near 1 (listed long ago),
// and a breadth multiplier of 1.0, rounds to $755,205,336 — the
// board's rank 1. The dashboard prints this arithmetic for every
// row it shows, so the reader can check the model, not just trust it.

export type TokenState = 'pre-token';

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface SnapshotData {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

// The four knobs of the model, in one place so the dashboard can
// print them and the page can recompute a row in the open.
export interface ScoringKnobs {
  tvlShare: number;
  growthWeight: number;
  growthLow: number;
  growthHigh: number;
  ageBase: number;
  ageSpan: number;
  ageCapDays: number;
  ageFallbackDays: number;
  chainBonus: number;
  chainBonusMax: number;
}

export const KNOBS: ScoringKnobs = {
  tvlShare: 0.35,
  growthWeight: 0.7,
  growthLow: -50,
  growthHigh: 150,
  ageBase: 0.5,
  ageSpan: 0.5,
  ageCapDays: 1460,
  ageFallbackDays: 180,
  chainBonus: 0.04,
  chainBonusMax: 4,
};

export const MODEL_VERSION = 'radar-2';

export interface ScoreBreakdown {
  base_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: TokenState;
  age_days: number | null;
  implied_value_usd: number;
  model: ScoreBreakdown;
  farm_steps: string[];
}

export interface DashboardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface DashboardData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ScoringKnobs;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: DashboardRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const MS_PER_DAY = 86_400_000;

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// Days between the snapshot date and the day DefiLlama first listed
// the protocol. Null when the listing date is missing or unparseable.
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const snapshotMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(snapshotMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((snapshotMs - listedMs) / MS_PER_DAY));
}

export interface Score {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

// Score one protocol. Pure: same protocol and snapshot date, same
// number out, every time. No name is consulted anywhere in here.
export function impliedValue(
  protocol: Protocol,
  asOf: string,
  knobs: ScoringKnobs,
): Score {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = clamp(asNumber(protocol.change_7d, 0), knobs.growthLow, knobs.growthHigh);
  const growthMult = 1 + (growthPct / 100) * knobs.growthWeight;
  const ageUsed = age ?? knobs.ageFallbackDays;
  const maturityMult =
    knobs.ageBase + (clamp(ageUsed, 0, knobs.ageCapDays) / knobs.ageCapDays) * knobs.ageSpan;
  const extraChains = clamp(protocol.chains.length - 1, 0, knobs.chainBonusMax);
  const breadthMult = 1 + extraChains * knobs.chainBonus;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * knobs.tvlShare * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

// A protocol records no token at all on DefiLlama's record.
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

// Rankable means pre-token and not a wrapped, staked or bridged
// product of a token that already trades — the same exclusion the
// watchlist itself was built with.
export function isRankable(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

export function buildBoard(snapshot: SnapshotData, knobs: ScoringKnobs = KNOBS): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, Protocol>();
  // The watchlist is the floor: every slug it names is in, whatever
  // its TVL, even if it sits below the floor in the snapshot.
  for (const slug of snapshot.watchlist) {
    const found = bySlug.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  // The early radar: every other rankable pre-token protocol below
  // the floor. No cap here — the model does the ranking, not the floor.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) {
      chosen.set(p.slug, p);
    }
  }
  const scored = [...chosen.values()].map((p) => {
    const score = impliedValue(p, snapshot.as_of, knobs);
    return { protocol: p, score };
  });
  // Highest implied value first; slug breaks ties so the order is
  // deterministic even if two protocols ever score identically.
  scored.sort(
    (a, b) =>
      b.score.implied - a.score.implied ||
      (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0),
  );
  return scored.map((entry, index) => {
    const { protocol: p, score } = entry;
    return {
      rank: index + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      age_days: score.age,
      implied_value_usd: score.implied,
      model: {
        base_multiple: knobs.tvlShare,
        growth_pct: score.growthPct,
        growth_multiplier: round4(score.growthMult),
        maturity_multiplier: round4(score.maturityMult),
        breadth_multiplier: round4(score.breadthMult),
        age_days: score.age,
      },
      farm_steps: farmSteps(p, score.age).map(renderStep),
    };
  });
}

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

// One step, rendered as a single sentence with its cost and time
// appended, trimmed to the gate's 20..600 character window.
export function renderStep(step: FarmStep): string {
  let rendered = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (rendered.length > 600) rendered = `${rendered.slice(0, 596)}...`;
  if (rendered.length < 20) rendered = `${rendered} Hold the position and check the protocol's own page.`;
  return rendered;
}

function firstChain(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

// Position size from the protocol's own TVL: a bigger economy
// gets a bigger position, so the plan scales with the row.
function capitalFor(p: Protocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 400;
  if (p.tvl_usd >= 100_000_000) return 200;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

// Minimum hold, from age: a young protocol needs a longer
// qualifying window than one that has been around for years.
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

// The one action for the protocol's category, in words a farmer
// can follow. Derived from category, chain and TVL only.
function actionFor(p: Protocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (category.includes('lend') || category.includes('cdp') || category.includes('collateral')) {
    return `Lend $${capital} of USDC on ${name} (${chain}) and leave the loan open.`;
  }
  if (category.includes('dex') || category.includes('leveraged farm')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP tokens.`;
  }
  if (category.includes('yield')) {
    return `Deposit $${capital} into ${name}'s main yield vault on ${chain} and keep the vault shares.`;
  }
  if (category.includes('perpetual') || category.includes('derivative')) {
    return `Fund a $${capital} margin account on ${name} (${chain}) and open one small hedged trade.`;
  }
  if (category.includes('prediction')) {
    return `Put $${capital} behind one prediction position on ${name} and let it settle.`;
  }
  if (category.includes('curator') || category.includes('allocator') || category.includes('risk')) {
    return `Allocate $${capital} to a ${name} vault on ${chain} and hold the allocation.`;
  }
  if (category.includes('stable')) {
    return `Mint or hold $${capital} of the stable asset issued through ${name} on ${chain}.`;
  }
  if (category.includes('rwa')) {
    return `Buy $${capital} of the tokenised real-world asset offered by ${name} on ${chain} and hold it.`;
  }
  if (category.includes('insurance')) {
    return `Take $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (category.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} with ${name} and use the bridged funds in its app.`;
  }
  if (category.includes('staking') || category.includes('restak')) {
    return `Stake $${capital} of the chain asset through ${name} and keep the staking receipt.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

// Six steps per protocol: set up, act, repeat weekly, hold, claim
// safely, log everything. Each step carries what it costs and how
// long it takes, so the plan is a plan, not a slogan.
export function farmSteps(p: Protocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 200 ? 8 : 4;
  return [
    {
      text: 'Open a fresh wallet for this farm only, fund it with the position size, and store its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: 'Do one qualifying action every week — a deposit, a borrow, a swap, a vote or a claim — and keep the receipts.',
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days, so it appears in more than one activity snapshot.`,
      cost: `the $${capital} stays locked in the position`,
      time: `${hold} days`,
    },
    {
      text: 'Before withdrawing, check the protocol’s own rewards page and claim only through the link that page publishes.',
      cost: 'no fee to check, and never pay anyone to claim',
      time: '10 minutes',
    },
    {
      text: 'Log the wallet, the dates and every transaction hash, so you can repeat the farm or unwind it cleanly.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// Live-token protocols, set aside: the 24 biggest by market cap,
// so the reader can see at a glance what "already trades" looks
// like next to the pre-token board.
export function liveRows(snapshot: SnapshotData): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

function toDashboardRow(row: BoardRow): DashboardRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

export function buildRadar(
  snapshot: SnapshotData,
  knobs: ScoringKnobs = KNOBS,
): { board: BoardRow[]; radar: DashboardData } {
  const board = buildBoard(snapshot, knobs);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: DashboardData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: knobs,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(toDashboardRow),
    live,
  };
  return { board, radar };
}

// Parse and validate the sealed snapshot, rejecting anything that
// does not have the ten fields per protocol the house promised.
export function parseSnapshot(text: string): SnapshotData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((value, i) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = value as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

// The gate's own checks on a board, run before writing anything:
// watchlist covered, ranks 1..N, values non-increasing and not all
// equal, farm steps in range, implied values positive integers.
export function boardIssue(board: BoardRow[], snapshot: SnapshotData): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
  }
  return null;
}

// The dashboard's dataset as one script: window.RADAR, no fetch,
// no network — the page reads only what main.ts wrote beside it.
export function dataScript(radar: DashboardData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// Backwards-compatible names, so main.ts and the dashboard can keep
// calling the model by the names the kit's starter used.
export type { Protocol as SnapshotProtocol };
export type { SnapshotData as Snapshot };
export type { ScoringKnobs as ModelConstants };
export const MODEL = KNOBS;
export type { BoardRow as BoardRow };
export type { DashboardRow as RadarRow };
export type { DashboardData as RadarData };
