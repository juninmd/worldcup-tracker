# World Cup Tracker ⚽️🏆

Acompanhamento em tempo real da **Copa do Mundo 2026** com entregas no Telegram:
expectativa de placar antes do jogo, alertas de gol minuto-a-minuto com **foto,
camisa e resumo do jogador**, e comparação **expectativa × realidade** no fim.

**Stack:** Bun + TypeScript. **Dados oficiais:** FIFA API/site (`api.fifa.com`, Copa do Mundo 2026 `IdCompetition=17`, `IdSeason=285023`).

## Recursos

- 🔮 **Expectativa de placar** — modelo Elo (treinado) + Poisson → placar provável e probabilidades 1X2.
- ⚽️ **Gol ao vivo** — narra cada gol com placar atualizado, minuto, foto/camisa/posição/bio do autor.
- ⏱ **Fim de jogo** — compara previsto × real (acertou placar? acertou vencedor?) + lista de gols.
- 📅 **Menu do dia** — jogos de hoje (com previsão), últimos resultados, favoritos ao título.
- 🏆 **Favorito ao título** — forecast por força (Elo) das seleções do torneio.
- 🔥 **Chama da Copa diária** — simula grupos + mata-mata (32 classificados), placares e campeão; envia card PNG + texto no Telegram.
- 📋 **Escalações oficiais FIFA** — só publica no Telegram quando o live FIFA traz titulares completos e foto para todos os jogadores da escalação.
- 📈 **Estatísticas oficiais derivadas da timeline FIFA** — finalizações, escanteios, faltas e cartões com barra comparativa.
- 🥇 **Artilharia** — ranking de gols da edição (trata gol contra).
- 🟨 **Cartões** — ranking de cartões amarelos/vermelhos da edição, por jogador.
- 🧠 **Análise da partida com IA** — o LiteLLM do cluster lê os dados oficiais (placar, estatísticas,
  gols, cartões, substituições, VAR, intensidade por período e titulares), lista todas as estatísticas e acontecimentos,
  avalia se o placar foi justo, se houve azar/ineficiência, quem merecia vencer,
  melhor em campo, destaques e quem mais errou, em português. Inclui mapa de calor
  de intensidade do jogo por período (finalizações/escanteios/faltas/cartões/gols
  ao longo dos minutos — a FIFA não expõe posicionamento em campo no feed gratuito).
- 🧠 **Treinamento** — ratings Elo partem de uma base e são ajustados após cada resultado real
  (peso por saldo de gols), refinando previsões conforme a Copa avança.
- 🧩 **Fallback oficial de grupos** — quando o feed gratuito vem parcial, a simulação usa os 12 grupos oficiais da Copa 2026 e substitui os jogos por resultados reais assim que aparecem.
- ✅ **Chave com dados reais** — assim que um confronto de mata-mata (Rodada de 32 → final) termina, o placar e o vencedor reais sobrescrevem a projeção e propagam para as rodadas seguintes (✅ real · 🔮 projeção). Pênaltis/prorrogação são sinalizados no fim de jogo.

## Configuração

```bash
cd worldcup-tracker
bun install
cp .env.example .env   # preencha TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID
```

> **Análise com IA:** o comando `analysis` chama o gateway LiteLLM do cluster
> (`LITELLM_BASE_URL`/`LITELLM_API_KEY`/`LITELLM_MODEL` no `.env`). Os demais
> comandos funcionam sem essas variáveis.

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
  champion.ts   forecast de campeão (softmax sobre Elo)
  format.ts     mensagens pt-BR (menu, pré-jogo, gol, fim de jogo)
  scorers.ts    artilharia da edição
  cards.ts      ranking de cartões da edição
  analysis.ts   análise da partida com IA (LiteLLM do cluster) + mapa de calor de intensidade
  charts.ts     cards PNG via QuickChart (artilharia, cartões, mapa de calor, chave, etc.)
  state.ts      dedup (gols/pré-jogo/fim já postados)
  engine.ts     orquestração: menu, poll ao vivo, replay
  cli.ts        entrypoint
```

O `track` usa `data/state.json` para não repetir alertas entre execuções —
seguro rodar via cron/serviço contínuo.
