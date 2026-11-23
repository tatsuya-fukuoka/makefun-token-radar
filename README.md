# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tatsuya-fukuoka/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tatsuya-fukuoka/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar built from make.fun's sealed DefiLlama snapshot (14 November 2026). It ranks 198 protocols that record no token by an implied launch value — TVL × the median market-cap/TVL multiple of token-bearing peers in the same category, adjusted for 7-day TVL momentum and for how long the protocol has run with no token — and gives every ranked protocol a farm plan with costs and durations. Wrapped, staked and bridged products of tokens that already trade, and versioned redeployments, are set apart in their own list with the reason for each, so the ranked board holds only genuine first launches. The static dashboard (no network) is sortable and filterable, with a detail view per protocol showing the model's arithmetic.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

This writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
