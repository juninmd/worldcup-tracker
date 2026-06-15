# World Cup Tracker ⚽️🏆

Acompanhamento em tempo real da **Copa do Mundo 2026** com entregas no Telegram:
expectativa de placar antes do jogo, alertas de gol minuto-a-minuto com **foto,
camisa e resumo do jogador**, e comparação **expectativa × realidade** no fim.

**Stack:** Bun + TypeScript. **Dados reais:** TheSportsDB (FIFA World Cup, liga `4429`).

## Recursos

- 🔮 **Expectativa de placar** — modelo Elo (treinado) + Poisson → placar provável e probabilidades 1X2.
- ⚽️ **Gol ao vivo** — narra cada gol com placar atualizado, minuto, foto/camisa/posição/bio do autor.
- ⏱ **Fim de jogo** — compara previsto × real (acertou placar? acertou vencedor?) + lista de gols.
- 📅 **Menu do dia** — jogos de hoje (com previsão), últimos resultados, favoritos ao título.
- 🏆 **Favorito ao título** — forecast por força (Elo) das seleções do torneio.
- 📋 **Escalações** — titulares/reservas com número e posição (fonte parcial no tier free).
- 📈 **Estatísticas** — finalizações, posse etc. com barra comparativa.
- 🥇 **Artilharia** — ranking de gols da edição (trata gol contra).
- 🧠 **Treinamento** — ratings Elo partem de uma base e são ajustados após cada resultado real
  (peso por saldo de gols), refinando previsões conforme a Copa avança.

## Configuração

```bash
cd worldcup-tracker
bun install
cp .env.example .env   # preencha TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID
```

> **Importante:** adicione o bot ao canal/grupo de destino e dê permissão de
> postar (admin, em canais). Sem isso o Telegram responde `chat not found`.

## Comandos

```bash
bun run src/cli.ts menu [YYYY-MM-DD]      # envia o menu do dia
bun run src/cli.ts track                  # loop ao vivo (polling minuto-a-minuto)
bun run src/cli.ts homologate 2026-06-13  # replay completo de uma data (homologação)
bun run src/cli.ts predict Brazil Morocco # previsão de um confronto (stdout)
bun run src/cli.ts champion               # ranking de favoritos ao título (stdout)
bun run src/cli.ts scorers [--send]       # artilharia (stdout, ou envia ao canal)
bun run src/cli.ts details "Brazil vs Morocco"  # escalações + estatísticas no canal
bun test                                  # testes do motor de previsão
```

## Arquitetura

```
src/
  config.ts     env
  types.ts      tipos do domínio
  sportsdb.ts   cliente TheSportsDB (eventos, timeline de gols, jogador)
  telegram.ts   sendMessage / sendPhoto (fallback p/ texto)
  elo.ts        ratings Elo (seed + treino sobre resultados reais)
  predict.ts    modelo Poisson → placar + probabilidades
  champion.ts   forecast de campeão (softmax sobre Elo)
  format.ts     mensagens pt-BR (menu, pré-jogo, gol, fim de jogo)
  state.ts      dedup (gols/pré-jogo/fim já postados)
  engine.ts     orquestração: menu, poll ao vivo, replay
  cli.ts        entrypoint
```

O `track` usa `data/state.json` para não repetir alertas entre execuções —
seguro rodar via cron/serviço contínuo.
