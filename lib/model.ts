// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// Universe: every protocol in the snapshot that records no token (gecko_id and symbol both null). Those that
// look like a wrapped, staked or bridged product of a token that already trades (WBTC, an exchange's bridge,
// a liquid-staking receipt), or whose name ends in a version marker (a redeployment), are not launch candidates: they are set apart in `excluded`, with the reason,
// and never ranked. The rest is the ranked board; the watchlist is a subset of it. Already-trading tokens
// are the peers the model learns its category multiples from.
//
// Implied value, from the snapshot's own figures only:
//
//   implied = round( TVL x category_multiple x momentum x age_factor )
//
//   category_multiple  median(mcap/TVL) of token-bearing protocols in the same category; the global
//                      median when the category has fewer than 3 such peers; clamped to 0.05..3
//   momentum           1 + clamp(change_7d, -60, 120)/100 x 0.35, clamped to 0.7..1.4 (null -> 1)
//   age_factor         0.85 + 0.40 x min(years tokenless, 4)/4  (a long wait with no token raises the
//                      odds a token is near); null listed_at -> 1
//
// The product heuristic (category and name words, the watchlist rule's own) only decides who is ranked; no
// protocol name is special-cased.

export interface SnapshotProtocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  multiple_min: number;
  multiple_max: number;
  min_peers: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  momentum_min: number;
  momentum_max: number;
  age_min: number;
  age_range: number;
  age_cap_years: number;
}

export const MODEL: ModelConstants = {
  multiple_min: 0.05,
  multiple_max: 3,
  min_peers: 3,
  growth_floor: -60,
  growth_cap: 120,
  growth_weight: 0.35,
  momentum_min: 0.7,
  momentum_max: 1.4,
  age_min: 0.85,
  age_range: 0.4,
  age_cap_years: 4,
};

export const MODEL_VERSION = 'radar-3';

/** A flat summary of one board row's model breakdown. */
export interface RowModel {
  category_multiple: number;
  multiple_source: 'category' | 'global';
  peer_count: number;
  growth_pct: number;
  momentum: number;
  years_tokenless: number | null;
  age_factor: number;
  formula_value: number;
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
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  implied_to_tvl: number;
  model: RowModel;
  farm_steps: string[];
}

/** The unrounded factors behind a row, for the dashboard's worked equation only (board.json keeps its 4-decimal fields). */
export interface ExactFactors {
  momentum: number;
  age_factor: number;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  implied_to_tvl: number;
  model: RowModel;
  exact: ExactFactors;
  farm_steps: string[];
}

/** A tokenless protocol that is a product of a traded token or a versioned deployment: shown, never ranked. */
export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

/** One comparables row: a category with token-bearing peers and the multiple the model used for it. */
export interface Comparable {
  category: string;
  peers: number;
  multiple: number;
  source: 'category' | 'global';
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  watchlist_covered: number;
  board_size: number;
  excluded_size: number;
  token_peers: number;
  total_tvl_usd: number;
  multiples: Record<string, { value: number; peers: number; source: 'category' | 'global' }>;
  rows: RadarRow[];
  excluded: ExcludedRow[];
  comparables: Comparable[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return 1;
  const mid = v.length >> 1;
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

// ---------------------------------------------------------------- the product heuristic

const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
/** The kit README's version-marker pattern: a name ending in a release is a redeployment, not a first launch. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_START = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** Why a protocol is not a launch candidate (a product of a traded token, or a versioned deployment), or null. */
export function productReason(p: SnapshotProtocol): string | null {
  if (VERSIONED.test(p.name)) return 'versioned deployment of an existing protocol';
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return `category ${p.category}: its launch would mostly price the parent asset`;
  const word = PRODUCT_WORD.exec(p.name);
  if (word !== null) return `name carries "${word[1]!.toLowerCase()}": a wrapped or staked product of a traded token`;
  if (EXCHANGE_START.test(p.name)) return 'named for an exchange: a product of an exchange that already has a token';
  return null;
}

// ---------------------------------------------------------------- the multiples

interface Multiples {
  global: number;
  peers: number;
  byCategory: Map<string, { value: number; peers: number; source: 'category' | 'global' }>;
}

/** Category multiples learned from the snapshot's token-bearing protocols: median mcap / TVL, clamped. */
export function learnMultiples(protocols: SnapshotProtocol[], model: ModelConstants): Multiples {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    all.push(r);
    const key = p.category ?? '';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [r]);
    else list.push(r);
  }
  const global = clamp(median(all), model.multiple_min, model.multiple_max);
  const byCategory = new Map<string, { value: number; peers: number; source: 'category' | 'global' }>();
  for (const p of protocols) {
    const key = p.category ?? '';
    if (byCategory.has(key)) continue;
    const list = ratios.get(key) ?? [];
    byCategory.set(
      key,
      list.length >= model.min_peers
        ? { value: round4(clamp(median(list), model.multiple_min, model.multiple_max)), peers: list.length, source: 'category' }
        : { value: round4(global), peers: list.length, source: 'global' },
    );
  }
  return { global: round4(global), peers: all.length, byCategory };
}

// ---------------------------------------------------------------- the farm plans

const usd = (n: number): string => `$${n.toLocaleString('en-US')}`;

interface Ctx {
  name: string;
  category: string;
  chain: string;
  chains: string;
  capLo: number;
  capHi: number;
  gasLo: number;
  gasHi: number;
  holdWeeks: number;
  tier: string;
}

type Step = (c: Ctx) => string;

/** Capital tiers from the protocol's own TVL. */
function capitalRange(tvl: number): [number, number, string] {
  if (tvl >= 1_000_000_000) return [250, 500, 'a $1B+ TVL protocol, where points are diluted across many wallets'];
  if (tvl >= 250_000_000) return [150, 300, 'a $250M+ TVL protocol'];
  if (tvl >= 50_000_000) return [100, 200, 'a $50M+ TVL protocol'];
  return [50, 100, 'a smaller protocol under $50M TVL, where each wallet is a larger share of activity'];
}

/** Gas per transaction by the protocol's main chain. */
function gasRange(chain: string): [number, number] {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return [6, 20];
  if (['arbitrum', 'optimism', 'base', 'linea', 'scroll', 'blast', 'mantle', 'zksync era', 'polygon zkevm'].includes(c)) return [0.1, 0.8];
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'ton') return [0.01, 0.1];
  return [0.2, 1.5];
}

const CAP = (c: Ctx): string => `${usd(c.capLo)}-${usd(c.capHi)}`;
const GAS = (c: Ctx): string => `$${c.gasLo}-$${c.gasHi}`;

/** The first step every plan shares in shape: a clean wallet on the protocol's main chain. */
const setup: Step = (c) =>
  `Week 1: create a fresh wallet just for ${c.name} (${c.category}) and fund it on ${c.chain}. It is ${c.tier}: budget ${CAP(c)} of capital plus ${GAS(c)} gas per transaction, about ${usd(Math.round(c.gasHi * 6))} of gas over the plan. Main chains: ${c.chains}.`;

const PLAYBOOKS: Record<string, Step[]> = {
  lending: [
    setup,
    (c) => `Week 1: supply ${CAP(c)} of USDC to ${c.name} on ${c.chain} and enable it as collateral. Time: 15 minutes, ${GAS(c)} gas. Supplying is the first activity lending points count.`,
    (c) => `Weeks 2-3: borrow 20-30% of the collateral value (about ${usd(Math.round(c.capLo * 0.25))}-${usd(Math.round(c.capHi * 0.25))}) from ${c.name} and repay it fully once. Cost: interest of a few dollars and ${GAS(c)} gas per leg. Keep health factor above 2.`,
    (c) => `Weeks 3-${c.holdWeeks}: keep the ${c.name} supply open and add one deposit or repayment each week on ${c.chains}. Cost: ${GAS(c)} gas a week. Weekly cadence beats one big deposit when snapshots are retroactive.`,
    (c) => `Week ${c.holdWeeks}: check ${c.name}'s docs, governance forum and app for a points or rewards page, and use only the link the team publishes. Cost: free, 10 minutes. Never sign an approval to claim.`,
    (c) => `Week ${c.holdWeeks + 1}: decide whether to withdraw the ${CAP(c)} from ${c.name} or keep farming; log wallet, dates and transactions. Withdrawal costs ${GAS(c)} gas, 5 minutes.`,
  ],
  dex: [
    setup,
    (c) => `Week 1: swap ${usd(c.capLo)}-${usd(Math.round(c.capHi / 2))} of ETH or the chain's native asset into a blue-chip stable pair on ${c.name} (${c.chain}). Cost: 0.1-0.3% swap fee plus ${GAS(c)} gas, 10 minutes.`,
    (c) => `Weeks 1-2: add the pair as liquidity on ${c.name} with ${CAP(c)} in a wide range or its main pool. Cost: ${GAS(c)} gas and impermanent loss risk of 1-3% on a stable pair.`,
    (c) => `Weeks 3-${c.holdWeeks}: keep the ${c.name} position in range, and make 2-3 small swaps a week (${usd(20)}-${usd(50)} each) across ${c.chains}. Cost: about ${usd(Math.round(c.gasHi * 3))} of gas a week.`,
    (c) => `Week ${c.holdWeeks}: look at ${c.name}'s volume and incentive pages for a points programme; claim only through its official domain. Cost: free, 10 minutes.`,
    (c) => `Week ${c.holdWeeks + 1}: remove the ${c.name} liquidity or roll it, and record fees earned and wallet history. Cost: ${GAS(c)} gas.`,
  ],
  yield: [
    setup,
    (c) => `Week 1: deposit ${CAP(c)} of USDC or ETH into ${c.name}'s main vault on ${c.chain}, the one with the largest TVL. Cost: ${GAS(c)} gas, 15 minutes. Read the strategy page and fee schedule first.`,
    (c) => `Weeks 2-3: add one more deposit (${usd(c.capLo)}) and one compounding or harvest action on ${c.name}. Cost: ${GAS(c)} gas each; the harvest may carry a 0-10% performance fee.`,
    (c) => `Weeks 3-${c.holdWeeks}: hold the ${c.name} vault shares and check weekly on ${c.chains} that APY and the underlying strategy have not changed. Cost: free, 5 minutes a week.`,
    (c) => `Week ${c.holdWeeks}: open ${c.name}'s rewards or points tab and claim only from its published link. Cost: free, 10 minutes.`,
    (c) => `Week ${c.holdWeeks + 1}: withdraw the ${CAP(c)} from ${c.name} or keep it; export the vault history for your records. Cost: ${GAS(c)} gas and any withdrawal fee, 10 minutes.`,
  ],
  perps: [
    setup,
    (c) => `Week 1: deposit ${CAP(c)} of USDC as margin on ${c.name} (${c.chain}). Cost: ${GAS(c)} gas, 15 minutes. Do not use leverage above 2x.`,
    (c) => `Weeks 1-2: open and close two small positions of ${usd(c.capLo)}-${usd(c.capLo * 2)} notional on ${c.name}. Cost: 0.03-0.1% trading fees, a few dollars per round trip.`,
    (c) => `Weeks 3-${c.holdWeeks}: trade a little each week (volume of ${usd(c.capHi * 3)}-${usd(c.capHi * 6)} a week) and keep a hedged, delta-neutral position open on ${c.name} across ${c.chains}. Cost: fees about ${usd(Math.round(c.capHi * 0.003 * 6))} a week.`,
    (c) => `Week ${c.holdWeeks}: look at ${c.name}'s points leaderboard or referral page and claim only via the official link. Cost: free, 10 minutes.`,
    (c) => `Week ${c.holdWeeks + 1}: close every ${c.name} position and withdraw margin. Cost: ${GAS(c)} gas and a few dollars of fees, 10 minutes.`,
  ],
  bridge: [
    setup,
    (c) => `Week 1: bridge ${CAP(c)} of USDC or ETH to ${c.chain} through ${c.name} and keep the receipt. Cost: ${GAS(c)} gas plus a 0.05-0.3% bridge fee, 20 minutes.`,
    (c) => `Weeks 2-3: use the bridged funds on a second chain (${c.chains}) with one swap and one bridge back via ${c.name}. Cost: ${GAS(c)} gas per leg.`,
    (c) => `Weeks 3-${c.holdWeeks}: bridge a small amount (${usd(c.capLo)}) with ${c.name} once a week, so activity spans several snapshots. Cost: ${GAS(c)} gas each.`,
    (c) => `Week ${c.holdWeeks}: check ${c.name}'s official rewards page; never sign a claim from an unverified link. Cost: free, 10 minutes.`,
    (c) => `Week ${c.holdWeeks + 1}: bridge the remaining ${c.name} funds home and log hashes. Cost: ${GAS(c)} gas, 20 minutes.`,
  ],
  staking: [
    setup,
    (c) => `Week 1: stake ${CAP(c)} of the underlying asset through ${c.name} on ${c.chain} and keep the receipt token. Cost: ${GAS(c)} gas, 15 minutes. Check the withdrawal queue length first.`,
    (c) => `Weeks 2-3: deploy part of the ${c.name} receipt (${usd(c.capLo)}) as collateral or liquidity in one integrated app. Cost: ${GAS(c)} gas, with smart-contract risk on both sides.`,
    (c) => `Weeks 3-${c.holdWeeks}: hold the ${c.name} position, and check weekly on ${c.chains} whether points or reward multipliers changed. Cost: free, 5 minutes a week.`,
    (c) => `Week ${c.holdWeeks}: claim any ${c.name} rewards only from its official app. Cost: free, 10 minutes.`,
    (c) => `Week ${c.holdWeeks + 1}: unstake the ${CAP(c)} from ${c.name} if you are done. Expect a withdrawal queue of days; cost ${GAS(c)} gas.`,
  ],
  cdp: [
    setup,
    (c) => `Week 1: deposit ${CAP(c)} of the accepted collateral into ${c.name} (${c.chain}) and mint a small amount of its stable asset, about 30% of collateral value. Cost: ${GAS(c)} gas, 20 minutes.`,
    (c) => `Weeks 2-3: use the minted stable asset in one pool or savings module that ${c.name} supports on ${c.chains}. Cost: ${GAS(c)} gas, with depeg risk to watch.`,
    (c) => `Weeks 3-${c.holdWeeks}: keep the ${c.name} vault above a 200% collateral ratio and top up if the price drops. Cost: free, 5 minutes a week; a top-up costs ${GAS(c)} gas.`,
    (c) => `Week ${c.holdWeeks}: check ${c.name}'s governance and rewards pages and claim only via the official site. Cost: free, 10 minutes.`,
    (c) => `Week ${c.holdWeeks + 1}: repay the ${c.name} debt and withdraw the collateral. Cost: ${GAS(c)} gas plus interest of a few dollars.`,
  ],
  rwa: [
    setup,
    (c) => `Week 1: complete ${c.name}'s KYC or whitelist step if it asks for one, then deposit ${CAP(c)} of USDC to mint its yield asset on ${c.chain}. Cost: ${GAS(c)} gas; KYC is usually free, 1-3 days.`,
    (c) => `Weeks 2-3: use the ${c.name} yield asset once in a partner venue on ${c.chains} (lending or a pool). Cost: ${GAS(c)} gas.`,
    (c) => `Weeks 3-${c.holdWeeks}: hold the ${c.name} position, and read its monthly attestation. Cost: free, 10 minutes a month. Redemption windows may be weekly.`,
    (c) => `Week ${c.holdWeeks}: look for a ${c.name} points or rewards page and claim only through the official link. Cost: free, 10 minutes.`,
    (c) => `Week ${c.holdWeeks + 1}: submit a redemption on ${c.name} for the ${CAP(c)} if you are done. Cost: ${GAS(c)} gas, a redemption window of up to a few days.`,
  ],
  curator: [
    setup,
    (c) => `Week 1: deposit ${CAP(c)} of USDC into one ${c.name} vault on ${c.chain}, the vault with the most deposits and the lowest utilisation risk. Cost: ${GAS(c)} gas, 15 minutes.`,
    (c) => `Weeks 2-3: add a second deposit (${usd(c.capLo)}) in a different ${c.name} vault or market on ${c.chains}. Cost: ${GAS(c)} gas.`,
    (c) => `Weeks 3-${c.holdWeeks}: hold both ${c.name} positions, and check weekly the allocation, caps and any curator changes. Cost: free, 5 minutes a week.`,
    (c) => `Week ${c.holdWeeks}: check ${c.name}'s and the underlying lending market's reward pages and claim only through official links. Cost: free, 10 minutes.`,
    (c) => `Week ${c.holdWeeks + 1}: withdraw from ${c.name} if you are done and log shares and dates. Cost: ${GAS(c)} gas.`,
  ],
  basis: [
    setup,
    (c) => `Week 1: deposit ${CAP(c)} of USDC into ${c.name} (${c.chain}) to take its delta-neutral basis position. Cost: ${GAS(c)} gas, 15 minutes. Read the redemption terms first.`,
    (c) => `Weeks 2-3: stay in ${c.name}'s synthetic dollar or vault, and use the receipt once in a partner pool across ${c.chains}. Cost: ${GAS(c)} gas.`,
    (c) => `Weeks 3-${c.holdWeeks}: watch funding rates and the ${c.name} peg weekly; reduce size if funding turns negative for a week. Cost: free, 5 minutes a week.`,
    (c) => `Week ${c.holdWeeks}: check ${c.name}'s points page and claim only from its official link. Cost: free, 10 minutes.`,
    (c) => `Week ${c.holdWeeks + 1}: redeem the ${CAP(c)} from ${c.name} after any cooldown of 7 days. Cost: ${GAS(c)} gas.`,
  ],
  chain: [
    setup,
    (c) => `Week 1: bridge ${CAP(c)} of ETH or USDC to ${c.name} (${c.category}) from an exchange or bridge, and keep ${usd(10)} for gas. Cost: ${GAS(c)} gas, 20 minutes.`,
    (c) => `Weeks 2-3: use two or three leading apps on ${c.name} (${c.chains}): a swap, a deposit and a name or NFT mint. Cost: ${GAS(c)} gas per action, about ${usd(Math.round(c.gasHi * 6))} in total.`,
    (c) => `Weeks 3-${c.holdWeeks}: make a small transaction on ${c.name} each week, and join its testnet or quest programme if it runs one. Cost: ${GAS(c)} gas a week.`,
    (c) => `Week ${c.holdWeeks}: check ${c.name}'s official channel for an eligibility checker and use only the link it posts. Cost: free, 10 minutes.`,
    (c) => `Week ${c.holdWeeks + 1}: bridge funds out of ${c.name} or keep them, and log the wallet history. Cost: ${GAS(c)} gas.`,
  ],
  generic: [
    setup,
    (c) => `Week 1: read ${c.name}'s docs for the ${c.category} product, then make a first deposit or purchase of ${CAP(c)} on ${c.chain}. Cost: ${GAS(c)} gas, 20 minutes.`,
    (c) => `Weeks 2-3: use the main feature of ${c.name} in two different ways on ${c.chains}, about ${usd(c.capLo)} each. Cost: ${GAS(c)} gas per action.`,
    (c) => `Weeks 3-${c.holdWeeks}: make one small qualifying action a week on ${c.name}, and keep the position open across several snapshots. Cost: ${GAS(c)} gas a week.`,
    (c) => `Week ${c.holdWeeks}: look for a ${c.name} points, rewards or eligibility page and use only the official link. Cost: free, 10 minutes.`,
    (c) => `Week ${c.holdWeeks + 1}: close or keep the ${c.name} position and write down the wallet, dates and transactions. Cost: ${GAS(c)} gas.`,
  ],
};

/** Which playbook a category uses: matched on the category's words, never on a protocol's name. */
function playbookFor(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (/lend|collateral market/.test(c)) return 'lending';
  if (/derivativ|option|prediction/.test(c)) return 'perps';
  if (/dex|liquidity manager/.test(c)) return 'dex';
  if (/bridge/.test(c)) return 'bridge';
  if (/staking|restak|anchor btc|decentralized btc/.test(c)) return 'staking';
  if (/cdp|stablecoin|cedefi/.test(c)) return 'cdp';
  if (/basis/.test(c)) return 'basis';
  if (/rwa/.test(c)) return 'rwa';
  if (/curator|allocator/.test(c)) return 'curator';
  if (/yield|farm|index/.test(c)) return 'yield';
  if (/^chain$/.test(c)) return 'chain';
  return 'generic';
}

function ctxFor(p: SnapshotProtocol, age: number | null): Ctx {
  const chain = p.chains[0] ?? 'its main chain';
  const main = p.chains.slice(0, 3);
  const [capLo, capHi, tier] = capitalRange(p.tvl_usd);
  const [gasLo, gasHi] = gasRange(chain);
  const holdWeeks = age === null ? 6 : age < 180 ? 8 : age < 365 ? 6 : 5;
  return {
    name: p.name,
    category: p.category ?? 'uncategorised',
    chain,
    chains: main.length === 0 ? 'its main chain' : main.join(', ') + (p.chains.length > 3 ? ` (+${p.chains.length - 3} more)` : ''),
    capLo,
    capHi,
    gasLo,
    gasHi,
    holdWeeks,
    tier,
  };
}

/** A protocol's farm plan: six concrete steps with cost and timing, from its category playbook and its own facts. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const ctx = ctxFor(p, age);
  const steps = PLAYBOOKS[playbookFor(p.category)]!.map((s) => s(ctx));
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ---------------------------------------------------------------- the board

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; excluded: ExcludedRow[]; multiples: Multiples; exact: ExactFactors[] } {
  const multiples = learnMultiples(snapshot.protocols, model);
  const watch = new Set(snapshot.watchlist);
  const tokenless = snapshot.protocols.filter(isPreToken);
  const excluded: ExcludedRow[] = [];
  const candidates: SnapshotProtocol[] = [];
  for (const p of tokenless) {
    const reason = productReason(p);
    if (reason === null) candidates.push(p);
    else excluded.push({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, reason });
  }
  excluded.sort((a, b) => b.tvl_usd - a.tvl_usd || byText(a.slug, b.slug));
  const scored = candidates.map((p) => {
    const m = multiples.byCategory.get(p.category ?? '')!;
    const growthPct = clamp(p.change_7d ?? 0, model.growth_floor, model.growth_cap);
    const momentum = p.change_7d === null ? 1 : clamp(1 + (growthPct / 100) * model.growth_weight, model.momentum_min, model.momentum_max);
    const age = ageDays(snapshot.as_of, p.listed_at);
    const years = age === null ? null : age / YEAR_DAYS;
    const ageFactor = years === null ? 1 : model.age_min + model.age_range * (Math.min(years, model.age_cap_years) / model.age_cap_years);
    const formula = p.tvl_usd * m.value * momentum * ageFactor;
    const implied = Math.max(1, Math.round(formula));
    return { p, m, growthPct, momentum, age, years, ageFactor, formula, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || byText(a.p.slug, b.p.slug));
  const board = scored.map((s, i): BoardRow => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_to_tvl: round4(s.implied / Math.max(1, s.p.tvl_usd)),
    model: {
      category_multiple: s.m.value,
      multiple_source: s.m.source,
      peer_count: s.m.peers,
      growth_pct: s.growthPct,
      momentum: round4(s.momentum),
      years_tokenless: s.years === null ? null : Math.round(s.years * 100) / 100,
      age_factor: round4(s.ageFactor),
      formula_value: Math.round(s.formula * 100) / 100,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
  const exact = scored.map((s): ExactFactors => ({ momentum: s.momentum, age_factor: s.ageFactor }));
  return { board, excluded, multiples, exact };
}

export function radarRow(row: BoardRow, exact: ExactFactors): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    implied_to_tvl: row.implied_to_tvl,
    model: row.model,
    exact,
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, excluded, multiples, exact } = buildBoard(snapshot, model);
  const slugs = new Set(board.map((r) => r.slug));
  const mult: RadarData['multiples'] = {};
  for (const [k, v] of multiples.byCategory) mult[k === '' ? 'Uncategorised' : k] = v;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: multiples.global,
    watchlist_size: snapshot.watchlist.length,
    watchlist_covered: snapshot.watchlist.filter((s) => slugs.has(s)).length,
    board_size: board.length,
    excluded_size: excluded.length,
    token_peers: multiples.peers,
    total_tvl_usd: board.reduce((a, r) => a + r.tvl_usd, 0),
    multiples: mult,
    rows: board.map((r, i) => radarRow(r, exact[i]!)),
    excluded,
    comparables: [...multiples.byCategory]
      .filter(([, v]) => v.peers > 0)
      .map(([k, v]): Comparable => ({ category: k === '' ? 'Uncategorised' : k, peers: v.peers, multiple: v.value, source: v.source }))
      .sort((a, b) => b.peers - a.peers || byText(a.category, b.category)),
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const protocols = o.protocols.map((v, i): SnapshotProtocol => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (slugs.size !== board.length) return 'the board repeats a slug';
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all ${board.length} rows share one implied value`;
  for (const r of board) {
    if (r.farm_steps.length < 4 || r.farm_steps.length > 6) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (productReason(r) !== null) return `${r.slug} is a product or versioned deployment and cannot be ranked`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
