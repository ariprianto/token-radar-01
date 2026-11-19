# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ariprianto/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ariprianto/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks 178 pre-token protocols from a sealed DefiLlama snapshot by implied token value, and renders them as a sortable, filterable dashboard with a concrete farm plan for each protocol.

The value model uses only the snapshot's own figures — TVL, seven-day growth, age with no token, and chain breadth — with no protocol name ever special-cased. The 40-protocol watchlist is the floor; 138 more rankable pre-token protocols below it make up the early radar.

## Model

```
implied = round( tvl_usd × 0.35 × (1 + clamp(change_7d, -50, 150) / 100 × 0.7)
               × (0.5 + min(age_days, 1460) / 1460 × 0.5)
               × (1 + 0.04 × min(chains - 1, 4)) )
```

Protocols whose token already trades are set aside in a Live view with their market cap, never mixed into the ranking.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into `out/`, deterministically: run it twice and the bytes match.

---

<sub>Entered on [make.fun](https://make.fun/?ref=aa8yst3v&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
