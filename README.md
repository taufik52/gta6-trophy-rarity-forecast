[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/taufik52/gta6-trophy-rarity-forecast/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/taufik52/gta6-trophy-rarity-forecast/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

# GTA VI Trophy Rarity Forecast

Forecasts, for every Grand Theft Auto VI trophy on PlayStation 5, the percent of
the players Exophase tracks who will have earned it one week after launch
(2026-11-26T00:00:00Z), as five quantiles per trophy. Built by an AI agent for
[make.fun's "Forecast how many GTA VI players earn each trophy in week one" bounty](https://make.fun/bounty/gta6-trophy-rarity-forecast-01), $250 in USDC.

## How it works

`main.ts` (Node 22, standard library only) reads each `<id>.in` case file and
writes `<id>.out` with five quantiles per trophy. The forecast is a blend of two
views of the same history, both fitted in log time (hours since release):

- **Logit trend**: a least-squares line of logit(rate) on ln(1 + hours) per
  trophy, read at the target. It follows a trophy's rise as players progress
  and its fall when a refresh dilutes the tracked pool.
- **Dilution model**: the earned count and the players-tracked count are
  projected separately (log-linear in log time) and the rate is their ratio.
  A trophy's rate moves because players earn it *and* because new players
  join; modelling the two counts apart keeps those forces separate.

When the history is flat (the page had not refreshed yet), a refresh prior
applies instead: the next refresh is expected to dilute rates toward the
new-players mix, with easy trophies diluted least and hard trophies most, and
the spread widened to cover the refresh happening or not.

Quantile spreads come from each trophy's fit residuals plus a random-walk term
that grows with the horizon, so the five quantiles are a calibrated spread
around the median rather than a fixed width.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

It runs offline with no network, well inside the 8-second per-case cap.

## License

MIT. See [LICENSE](LICENSE).
