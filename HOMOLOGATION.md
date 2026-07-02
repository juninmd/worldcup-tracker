# Homologacao FIFA / Producao

Gate definitivo:

```bash
bunx tsc --noEmit
bun test
bun run src/cli.ts homologate full
bun run src/cli.ts homologate telegram-dry-run
```

Contrato validado pelo `homologate full`:

- Fonte unica de dados esportivos: FIFA API (`api.fifa.com/api/v3`).
- Copa 2026: `IdCompetition=17`, `IdSeason=285023`.
- 104 jogos oficiais.
- 48 selecoes oficiais.
- 1.248 jogadores de elenco oficial.
- Jogos finalizados com timeline de gols FIFA, incluindo gol normal, gol contra e penalti convertido.
- Jogos ao vivo presentes no snapshot FIFA.
- Escalacao live via `/live/football/{IdMatch}`: 11 titulares por lado e foto para todos os jogadores publicados.
- Gols live via timeline FIFA: cada gol validado precisa de jogador e foto antes de ser enviado ao Telegram.
- Estatisticas de time derivadas da timeline FIFA.
- Estatisticas de jogadores via artilharia, com fotos/perfis FIFA quando publicados.
- Endpoints FIFA ativos no gate:
  - `/calendar/matches?idSeason=285023&idCompetition=17&count=120`
  - `/teams/squads/all/17/285023`
  - `/timelines/{IdMatch}`
  - `/live/football/{IdMatch}`
- Artefatos de producao presentes: `Dockerfile` e `.github/workflows/deploy.yml`.
- Forecast/chama: 12 grupos, 32 classificados, chave 16/8/4/2/1 e PNG valido.
- Dry-run Telegram: monta payloads sem enviar, valida grupos de mídia da escalação, captions de gol com placar e URLs de foto.

Ultima evidencia local:

```json
{
  "matches": 104,
  "teams": 48,
  "rosterPlayers": 1248,
  "finishedMatches": 78,
  "liveMatches": 1,
  "timelineChecked": 78,
  "timelineGoals": 241,
  "endpoints": [
    { "name": "calendar", "ok": true, "count": 104 },
    { "name": "squads", "ok": true, "count": 1248 },
    { "name": "timeline", "ok": true },
    { "name": "live", "ok": true }
  ],
  "liveMedia": {
    "match": "Mexico vs Ecuador",
    "lineupPlayers": 52,
    "lineupPlayersWithPhoto": 52,
    "starters": 22,
    "goals": 2,
    "goalsWithPlayerPhoto": 2
  },
  "playerStats": {
    "scorers": 157,
    "leader": "Kylian Mbappe",
    "leaderGoals": 6
  },
  "problems": []
}
```

Evidencia dry-run Telegram:

```json
{
  "match": "Mexico vs Ecuador",
  "lineup": {
    "players": 52,
    "playersWithPhoto": 52,
    "starters": 22,
    "mediaGroups": 6
  },
  "goals": {
    "total": 2,
    "withPlayerPhoto": 2
  },
  "mediaSummary": {
    "checked": 54,
    "ok": 54,
    "lineupOk": 52,
    "goalOk": 2
  },
  "problems": []
}
```

Observacao operacional: build Docker local depende do daemon Docker ativo. Nesta maquina o CLI existe, mas o daemon nao estava rodando durante a homologacao local.
