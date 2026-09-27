# ADR 0004 — Residência de dados no Brasil

Status: aceito · Data: 2026-09-26

## Contexto

`ESTRATEGIA.md`: dados ficam no Brasil (Vercel funções em `gru1`, Supabase/Postgres em São Paulo, bucket privado), o LLM recebe só números, e mesmo assim o envio de dados de anamnese ao LLM é transferência internacional de dado sensível que exige cláusulas-padrão da ANPD (Res. 19/2024). `PROMPT.md` restrição 6: `vercel.json` com `gru1`, banco em `sa-east-1`, **sem deploy**, sem criar contas.

## Decisão

1. `vercel.json` na raiz com `"regions": ["gru1"]` (funções serverless e edge fixadas em São Paulo). O projeto Vercel não é criado nesta execução; o arquivo só prepara.
2. Banco de produção: Postgres em **`sa-east-1`** (Supabase região South America / São Paulo, ou RDS `sa-east-1`). `.env.example` documenta `DATABASE_URL` com esse alvo comentado; local usa `localhost` (ADR 0007).
3. Arquivos (malhas, PDFs): `DATA_DIR` local agora; em produção, bucket privado na mesma região (Supabase Storage `sa-east-1`), nunca bucket público, nunca CDN global para malhas (ADR 0003).
4. **Nenhum dado sai do Brasil exceto o JSON pseudonimizado enviado ao LLM** (ADR 0006), e isso só com `ANTHROPIC_API_KEY` configurada; sem chave, modo mock. Antes de usar com paciente real: cláusulas-padrão ANPD sem alteração + aditivo de zero retenção/sem treino + informação ao titular no TCLE (pendência jurídica de Gabriel, fora do escopo de código).
5. Observabilidade (Sentry etc.) fica desligada nesta fase; quando entrar, região UE/BR e sem dado pessoal nos eventos (scrub de `pseudonimo` inclusive).
6. Testes automatizados: a CI verifica que `vercel.json` contém `gru1`, que `.env.example` não contém segredos e que `data/` está no `.gitignore`.

## Alternativas

- Hospedar tudo em VPS nacional: mais controle, mais operação; a estratégia já escolheu Vercel+Supabase pela paridade com o ResidênciaMax. Manter.
- Rodar LLM local (open-weights) para evitar transferência internacional: elimina o problema jurídico, mas exige GPU e reduz qualidade da prosa; possível ADR futuro (a camada LLM é isolada atrás de uma interface, ADR 0006).

## Consequências

- Deploy real fica bloqueado até Gabriel criar contas e revisar o jurídico; o código não impede, apenas não executa.
- A escolha de `gru1` limita latência de LLM (chamada sai do Brasil), aceitável porque o LLM só escreve texto assíncrono.
