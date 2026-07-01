# Homologacao FIFA / Producao

Gate definitivo:

```bash
bunx tsc --noEmit
bun test
bun run src/cli.ts homologate full
```

Contrato validado pelo `homologate full`:

- Fonte unica de dados esportivos: FIFA API (`api.fifa.com/api/v3`).
- Copa 2026: `IdCompetition=17`, `IdSeason=285023`.
- 104 jogos oficiais.
- 48 selecoes oficiais.
- 1.248 jogadores de elenco oficial.
- Jogos finalizados com timeline de gols FIFA, incluindo gol normal, gol contra e penalti convertido.
- Jogos ao vivo presentes no snapshot FIFA.
- Estatisticas de time derivadas da timeline FIFA.
- Estatisticas de jogadores via artilharia, com fotos/perfis FIFA quando publicados.
- Artefatos de producao presentes: `Dockerfile` e `.github/workflows/deploy.yml`.
- Forecast/chama: 12 grupos, 32 classificados, chave 16/8/4/2/1 e PNG valido.

Ultima evidencia local:

```json
{
  "matches": 104,
  "teams": 48,
  "rosterPlayers": 1248,
  "finishedMatches": 58,
  "liveMatches": 2,
  "timelineChecked": 58,
  "timelineGoals": 172,
  "playerStats": {
    "scorers": 119,
    "leader": "Lionel Messi",
    "leaderGoals": 5
  },
  "problems": []
}
```

Observacao operacional: build Docker local depende do daemon Docker ativo. Nesta maquina o CLI existe, mas o daemon nao estava rodando durante a homologacao local.
