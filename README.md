# World Cup Tracker ⚽️🏆

Acompanhamento em tempo real da **Copa do Mundo 2026** com entregas no Telegram:
expectativa de placar antes do jogo, alertas de gol minuto-a-minuto com **foto,
camisa e resumo do jogador**, e comparação **expectativa × realidade** no fim.

**Stack:** Bun + TypeScript. **Dados oficiais:** FIFA API/site (`api.fifa.com`, Copa do Mundo 2026 `IdCompetition=17`, `IdSeason=285023`).

## Recursos

- 🔮 **Expectativa de placar** — modelo interno versionado (Elo treinado + Poisson/Dixon-Coles) → placar provável e probabilidades 1X2. Ranking FIFA e índice manual de elenco aparecem separados.
- ⚽️ **Gol ao vivo** — narra cada gol com placar atualizado, minuto, foto/camisa/posição/bio do autor.
- ⏱ **Fim de jogo** — compara previsto × real (acertou placar? acertou vencedor?) + lista de gols.
- 📅 **Menu do dia** — jogos de hoje (com previsão), últimos resultados, favoritos ao título.
- 🏆 **Favorito ao título** — Monte Carlo respeitando chave e resultados reais; eliminados ficam com 0%. Elo/índice de elenco permanecem visíveis como componentes.
- 🔥 **Chama da Copa diária** — simula grupos + mata-mata (32 classificados), placares e campeão; envia card PNG + texto no Telegram.
- 📋 **Escalações oficiais FIFA** — só publica no Telegram quando o live FIFA traz titulares completos e foto para todos os jogadores da escalação.
- 📈 **Estatísticas oficiais derivadas da timeline FIFA** — finalizações, escanteios, faltas e cartões com barra comparativa.
- 🥇 **Artilharia** — ranking de gols da edição (trata gol contra).
- 🟨 **Cartões** — ranking de cartões amarelos/vermelhos da edição, por jogador.
- 🧠 **Análise da partida com IA** — o LiteLLM do cluster lê os dados oficiais (placar, estatísticas,
  gols, cartões, substituições, VAR, intensidade por período e titulares), lista todas as estatísticas e acontecimentos,
  adiciona chances claras inferidas por posição do chute, xG estimado (pré-jogo/modelo,
  timeline de chutes e IA pós-jogo), avalia se o placar foi justo, se houve azar/ineficiência, quem merecia vencer,
  melhor em campo, destaques e quem mais errou, em português. Inclui mapa de calor
  de intensidade do jogo por período (finalizações/escanteios/faltas/cartões/gols
  ao longo dos minutos — a FIFA não expõe tracking de defensores no feed gratuito).
  Posse de bola e passes certos/errados só aparecem quando o feed FIFA usado pelo app expõe esses campos; quando ausentes, a análise marca explicitamente como indisponível.
- 🧠 **Treinamento** — ratings Elo partem de uma base e são ajustados após cada resultado real
  (peso por saldo de gols), refinando previsões conforme a Copa avança.
- 🧩 **Fallback oficial de grupos** — quando o feed gratuito vem parcial, a simulação usa os 12 grupos oficiais da Copa 2026 e substitui os jogos por resultados reais assim que aparecem.
- ✅ **Chave com dados reais** — assim que um confronto de mata-mata (Rodada de 32 → final) termina, o placar e o vencedor reais sobrescrevem a projeção e propagam para as rodadas seguintes (✅ real · 🔮 projeção). Pênaltis/prorrogação são sinalizados no fim de jogo.
- 🇧🇷 **Raio-X do Brasil** — campanha, gols, xG heurístico, finalizações, conversão, chances claras, escanteios, disciplina, períodos e continuidade dos titulares.
- 🇧🇷 **Seleção Brasileira 360°** — central consolidada com contagem regressiva para o próximo jogo, último resultado, status nas Eliminatórias CONMEBOL e últimas notícias do ge.globo.
- 📰 **Plantão de Notícias** — monitoramento de feeds RSS em tempo real do ge.globo por tópico (Seleção Brasileira, Brasileirão Série A, Copa do Brasil, Libertadores, Champions League e Premier League) com links oficiais e envio formatado ao Telegram.
- 🏆 **Central de Ligas & Tabelas** — classificação completa em tempo real via FotMob (jogos, vitórias, empates, derrotas, saldo de gols e pontos) das principais ligas e Eliminatórias da Copa.
- 📐 **Métricas do modelo** — snapshots pré-jogo imutáveis + backtest temporal sem leakage; Brier, Log Loss, RPS, calibração, acurácia, placar exato, MAE, fase, faixa de confiança e viés do Brasil. Baseline de odds fica `n/d` porque o feed FIFA não fornece mercado.
- 🩺 **Saúde operacional e painel de fontes** — taxa de erro e latência p95 das últimas 24h por subsistema (FIFA, FotMob, Telegram, Poll). Alerta automaticamente no Telegram caso uma fonte registre ≥ 5 falhas consecutivas (alerta único por incidente, sem spam) e emite aviso de recuperação quando o serviço normaliza.

> **Transparência:** o ranking exibido é o snapshot oficial FIFA de 11/06/2026. Elo, qualidade de elenco, xG e chances claras são derivados internos do tracker e são rotulados como estimativas. Quando o feed FIFA não oferece o chaveamento, qualquer fallback é marcado como heurístico e não oficial.

## Configuração

```bash
cd worldcup-tracker
bun install
cp .env.example .env   # preencha as variáveis de ambiente
```

### Variáveis de Ambiente (`.env.example`)

| Variável | Descrição | Padrão / Exemplo |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Token de autenticação do Bot do Telegram gerado via BotFather. | _Obrigatório para envios_ |
| `TELEGRAM_CHAT_ID` | ID numérico do canal ou grupo do Telegram para onde as mensagens serão enviadas. | _Obrigatório para envios_ |
| `POLL_INTERVAL_SEC` | Intervalo do loop de monitoramento contínuo em segundos quando não há jogos ao vivo. | `60` |
| `LITELLM_BASE_URL` | URL base do gateway LiteLLM para análise de partidas com IA (usado pelo comando `analysis`). | `https://litellm.antonio-code.duckdns.org/v1` |
| `LITELLM_API_KEY` | Chave de API para autenticação no gateway LiteLLM. | _Opcional em dev_ |
| `LITELLM_MODEL` | Identificador do modelo de linguagem a ser chamado via LiteLLM. | `cloud/gpt-oss-120b` |

> **Análise com IA:** o comando `analysis` chama o gateway LiteLLM do cluster
> (`LITELLM_BASE_URL`/`LITELLM_API_KEY`/`LITELLM_MODEL` no `.env`). Os demais
> comandos funcionam sem essas variáveis.

### Homologação (`HOMOLOGATION.md`)

O arquivo `HOMOLOGATION.md` documenta os gates de homologação definitivos da aplicação para produção. Ele estabelece o contrato oficial de integridade dos dados e fontes:
- Execução dos testes e verificação de tipagem (`bun test` e `bun run tsc --noEmit`).
- Validação dos dados esportivos oficiais da FIFA (`bun run src/cli.ts homologate full`).
- Validação do chaveamento e renderização de diagramas da Copa (`bun run src/cli.ts homologate forecast`).
- Validação de entrega e formatação de mídia do Telegram em dry-run sem envio real (`bun run src/cli.ts homologate telegram-dry-run`).

> **Importante:** adicione o bot ao canal/grupo de destino e dê permissão de
> postar (admin, em canais). Sem isso o Telegram responde `chat not found`.

## Comandos

```bash
bun run src/cli.ts menu [YYYY-MM-DD]      # envia o menu do dia
bun run src/cli.ts track                  # loop ao vivo (polling minuto-a-minuto)
bun run src/cli.ts homologate 2026-06-13  # replay completo de uma data (homologação)
bun run src/cli.ts homologate forecast    # valida grupos, mata-mata, PNG da chama e invariantes
bun run src/cli.ts homologate full        # gate FIFA/prod: jogos, times, atletas, gols, stats, live, escalação/fotos
bun run src/cli.ts homologate telegram-dry-run # valida payloads Telegram sem enviar
bun run src/cli.ts predict Brazil Morocco # previsão de um confronto (stdout)
bun run src/cli.ts champion               # ranking de favoritos ao título (stdout)
bun run src/cli.ts forecast [--send]      # simulação grupos + mata-mata + campeão
bun run src/cli.ts scorers [--send]       # artilharia (stdout, ou envia ao canal)
bun run src/cli.ts cards [--send]         # ranking de cartões da edição (stdout, ou envia ao canal)
bun run src/cli.ts metrics                # métricas de produção + backtest temporal sem leakage
bun run src/cli.ts brazil                 # raio-X estatístico do Brasil
bun run src/cli.ts status                 # SLOs, cache, painel de saúde das fontes e incidentes (alias: ops, saude)
bun run src/cli.ts news [topic] [--send]      # plantão de notícias (selecao, brasileirao, libertadores, etc.)
bun run src/cli.ts table [league] [--send]    # classificação (brasileirao, champions, libertadores, premier, etc.)
bun run src/cli.ts selecao [--send]           # hub 360° da Seleção (próximo jogo, eliminatórias, notícias)
bun run src/cli.ts details "Brazil vs Morocco"  # escalação completa com fotos + estatísticas no canal
bun run src/cli.ts analysis "Brazil vs Morocco" [--send]  # análise da partida com IA + mapa de calor
bun test                                  # testes do motor de previsão
```

## Arquitetura

```
src/
  config.ts     env
  types.ts      tipos do domínio
  sportsdb.ts   cliente FIFA API (jogos, resultados, live, timeline de gols, escalações, stats)
  telegram.ts   sendMessage / sendPhoto; envio estrito para gols/escalações com foto
  elo.ts        ratings Elo (seed + treino sobre resultados reais)
  predict.ts    modelo Poisson → placar + probabilidades
  champion.ts   força bruta + ajuste pelas probabilidades Monte Carlo da chave
  format.ts     mensagens pt-BR (menu, pré-jogo, gol, fim de jogo)
  scorers.ts    artilharia da edição
  cards.ts      ranking de cartões da edição
  analysis.ts   análise da partida com IA (LiteLLM do cluster) + mapa de calor de intensidade
  metrics.ts    Brier/Log Loss/RPS/calibração/backtest temporal e recorte do Brasil
  brazil.ts     métricas agregadas da campanha brasileira
  operations.ts saúde do polling/FIFA/Telegram, cache, heartbeat e alertas
  db.ts         cache + snapshots imutáveis de previsão + telemetria operacional em SQLite
  news.ts       plantão de notícias RSS ge.globo por campeonato e seleção
  leagues.ts    classificação e tabelas em tempo real via FotMob API
  selecao.ts    hub 360° da Seleção Brasileira (agenda, eliminatórias e notícias)
  charts.ts     cards PNG via QuickChart (artilharia, cartões, mapa de calor, chave, etc.)
  state.ts      dedup (gols/pré-jogo/fim já postados)
  engine.ts     orquestração: menu, poll ao vivo, replay
  cli.ts        entrypoint
```

O `track` usa `data/state.json` para não repetir alertas entre execuções —
seguro rodar via cron/serviço contínuo.

As previsões publicadas são gravadas em `prediction_snapshots` com chave
`evento + versão do modelo`; uma previsão posterior nunca sobrescreve a primeira.
O resultado apenas completa o snapshot para avaliação. O comando `metrics`
também calcula um backtest cronológico em que cada jogo enxerga somente partidas
anteriores.
