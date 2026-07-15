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
- Chave FIFA com exatamente `16,8,4,2,1` jogos por rodada; bronze (partida 103) nunca entra como final e a partida 104 é a única final.
- Campeão precisa participar da final; placeholders `W*`/`RU*` não podem chegar ao forecast publicado.
- Brasil usa ranking FIFA #6 (snapshot 11/06/2026); após eliminação, chance de título é zero e a saída vira campanha encerrada.
- Métricas do modelo precisam ter amostra temporal, Brier, Log Loss e calibração finitos.
- Copa 2026: `IdCompetition=17`, `IdSeason=285023`.
- 104 jogos oficiais.
- 48 selecoes oficiais.
- 1.248 jogadores de elenco oficial.
- Jogos finalizados com timeline de gols FIFA, incluindo gol normal, gol contra e penalti convertido.
- Jogos ao vivo presentes e validados quando houver partida em andamento; ausência fora da janela de partidas é estado válido.
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
  "finishedMatches": 101,
  "liveMatches": 0,
  "timelineChecked": 101,
  "timelineGoals": 319,
  "endpoints": [
    { "name": "calendar", "ok": true, "count": 104 },
    { "name": "squads", "ok": true, "count": 1248 },
    { "name": "timeline", "ok": true },
    { "name": "live", "ok": true, "count": 0 }
  ],
  "forecast": {
    "rounds": [16, 8, 4, 2, 1],
    "champion": "Spain",
    "bracketSource": "fifa",
    "titleFinals": 1,
    "modelMetrics": {
      "matches": 101,
      "brier": 0.4913,
      "logLoss": 0.8444,
      "calibrationError": 0.0803
    }
  },
  "playerStats": {
    "scorers": 187,
    "leader": "Kylian Mbappe",
    "leaderGoals": 8
  },
  "problems": []
}
```

Evidencia dry-run Telegram:

```json
{
  "match": "France vs Spain",
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

Observacao operacional: build Docker local depende do daemon Docker ativo. Nesta maquina o CLI existe, mas o daemon nao estava rodando durante a homologacao local de 14/07/2026.
