## O que mudou (desde v0.1.0)

Correções dos 18 achados da revisão de código da v0.1.0 (sem mudança numérica no modelo; snapshot de regressão inalterado):

- **Segurança (ADR 0003, revisão v0.1.1):** app só em `127.0.0.1`; proxy do Next (`apps/web/src/proxy.ts`) com token local `APP_TOKEN_LOCAL` (cookie HttpOnly/SameSite=Strict ou `Authorization: Bearer`), host só loopback, e nas rotas `/api/*` que gravam só JSON (multipart só no upload) da própria origem; CSP, HSTS e Permissions-Policy; corpo limitado por stream (upload 500 MB, JSON 1 MB); `sintetica` decidido no servidor.
- **Flag A/B (ADR 0005):** em A o `previsto` dos morphs é `null` no serviço Python, nas rotas do web e no registro de simulações; o gabarito sintético sai sem distâncias e volumes; o e2e do PDF em A usa lista de permitidos.
- **LGPD e LLM (ADR 0006):** texto com nome de pessoa é recusado (422) antes do LLM; CPF com espaço/ponto removido por inteiro; verificador de números normaliza NFKC e recusa numerais não ASCII, romanos e palavras de quantidade.
- **Configuração da simulação 1.2 (ADR 0014):** os coeficientes que estavam fixos no código foram para `config/simulacao.json` (`nao_calibrado`), sem fallback.
- **CI e rastreabilidade (ADR 0009):** banco obrigatório (só `--sem-db` explícito pula, e marca), suíte de contratos na CI, venv antes das licenças, `licencas.sh` falha fechado, checagem de nomes de pacote proibidos por manifesto/lockfile, libgfortran/libquadmath/libgomp documentadas, registro com `git describe --always --dirty`, transações em escrita+auditoria, `DATA_DIR` resolvido pela raiz no Python, `.gitignore` ampliado e limpeza dos diretórios temporários de teste.
