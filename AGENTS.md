# AGENTS.md

World Cup tracker: Bun + TypeScript CLI that pulls football data (FIFA, FotMob, SportsDB, news), computes predictions and standings, renders cards and charts, and sends updates to Telegram. Docs in pt-BR.

## Stack

- Bun, TypeScript (`tsconfig.json`, `bun.lock`). Tests with `bun test`.
- Telegram delivery and an optional LiteLLM endpoint (env vars below).
- Docker image (`Dockerfile`) built by the reusable workflow in `juninmd/base-actions`.

## Commands

```bash
bun install
bun test                       # tests/*.test.ts
bunx tsc --noEmit              # typecheck
bun run src/cli.ts menu [YYYY-MM-DD]        # daily menu (sends to Telegram)
bun run src/cli.ts track                    # live polling loop, minute by minute
bun run src/cli.ts homologate full          # FIFA data contract (see HOMOLOGATION.md)
bun run src/cli.ts homologate telegram-dry-run   # Telegram formatting, no real send
```

Package scripts: `menu`, `track`, `predict`, `champion`, `forecast`, `homologate`, `scorers`, `cards`, `analysis`, `metrics`, `brazil`, `status`, `news`, `table`, `selecao`, `test`. Each runs `src/cli.ts <name>`.

Release gate: `HOMOLOGATION.md` lists the gate in order: `bunx tsc --noEmit`, `bun test`, `homologate full`, `homologate telegram-dry-run`. CI (`validate.yml`) runs the reusable validation from `juninmd/base-actions`.

## Structure

- `src/cli.ts`: command dispatch. `src/config.ts`, `src/paths.ts`, `src/types.ts`: shared setup.
- Data sources: `fotmob.ts`, `sportsdb.ts`, `news.ts`, `live.ts`, `injuries.ts`, `venues.ts`, `leagues.ts`.
- Domain: `engine.ts`, `elo.ts`, `predict.ts`, `simulate.ts`, `tournament.ts`, `cycle.ts`, `cycle2030.ts`, `standings.ts`, `analysis.ts`, `metrics.ts`, `scorers.ts`, `cards.ts`, `h2h.ts`, `oracle.ts`.
- Presentation: `format.ts`, `charts.ts`, `cards.ts`, `trivia.ts`, `telegram.ts`.
- Persistence and state: `db.ts`, `state.ts`, `operations.ts`.
- Validation: `homologation.ts`. Tests: `tests/`.
- `REFERENCES.md`: reference material for the data.

## Conventions

- Tests live in `tests/`, named after the module they cover.
- Docs are in pt-BR (`README.md`, `HOMOLOGATION.md`). Code identifiers are in English.

## Gotchas

- Env var names (values never in the repo; `.env.example` lists them): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `POLL_INTERVAL_SEC`, `LIVE_POLL_INTERVAL_SEC`, `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL`.
- `homologate telegram-dry-run` checks Telegram formatting without sending.
- Do not release without the full gate in `HOMOLOGATION.md`.
