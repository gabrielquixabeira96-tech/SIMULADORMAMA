# ADR 0006 — Camada do LLM

Status: aceito · Data: 2026-09-26

## Contexto

Restrição inegociável 1: o LLM nunca recebe fotos, malhas nem texturas; só dados estruturados e pseudonimizados; medidas, volumes e simulação são determinísticos. Marco 2b: anamnese (texto livre → JSON validado) e relatório para a paciente (números de template travado, LLM só escreve prosa), teste que falha se um número divergir, modo mock sem `ANTHROPIC_API_KEY`. Motivo técnico: a localização espacial do modelo em imagens é aproximada (docs de visão da Anthropic); motivo jurídico: transferência internacional de dado sensível (ADR 0004).

## Decisão

1. **SDK oficial** `@anthropic-ai/sdk` (MIT), chamado **só no servidor** do Next.js (`apps/web/src/llm/`). A chave nunca vai ao cliente.
2. **Interface única** `ProvedorLLM` com dois métodos: `registrarAnamnese(textoHigienizado) → anamnese/1.0` e `redigirProsaRelatorio(entrada relatorio_entrada/1.0) → relatorio_prosa/1.0`. Duas implementações: `ProvedorAnthropic` e `ProvedorMock`. Seleção: `LLM_MODO=mock` **ou** `ANTHROPIC_API_KEY` ausente → mock. A CI roda sempre em mock; nenhum teste depende de rede.
3. **Tool use com JSON Schema**: cada método define uma ferramenta cujo `input_schema` é o arquivo de `config/schemas/` (`anamnese.schema.json`, `relatorio_prosa.schema.json`), com `tool_choice` forçando a ferramenta. A resposta é validada de novo com zod antes de ser usada; falha → erro tipado, nunca texto livre.
4. **Modelos por variável de ambiente** (`LLM_MODELO_ANAMNESE` rápido, `LLM_MODELO_RELATORIO` padrão), nunca hard-coded; `max_tokens` e `temperature 0`.
5. **Higienização antes do envio** (`higienizar.ts`): remove CPF, RG, telefone, e-mail, URLs, datas completas (`dd/mm/aaaa`) e sequências ≥ 8 dígitos; substitui por `[removido]`. O hash SHA-256 do texto higienizado vai em `texto_fonte_hash`. Teste com fixtures de cada padrão. O texto bruto **não** é persistido.
6. **Relatório: números travados**. O web monta `dados_travados` e `numeros_permitidos` (todas as representações textuais dos números que o template exibirá, ex. `"300"`, `"4,5"`, `"116"`). As seções numéricas do relatório e do PDF são renderizadas por template (JSX), nunca pelo LLM. A prosa retornada passa por `verificarNumeros(prosa, numerosPermitidos)`: toda ocorrência de `\d+([.,]\d+)?` em qualquer parágrafo tem de pertencer ao conjunto; caso contrário a prosa é rejeitada, o evento vai à auditoria e a UI usa a prosa do mock (que não contém dígitos). **Este é o teste que "falha se qualquer número divergir"**, e vale tanto para o provedor real quanto para o mock.
7. **Em `DESENHO=A`** (ADR 0005), `dados_travados.distancias` e `volumes` são `null` e `numeros_permitidos` só contém valores digitados e do catálogo.
8. **Sem RAG, sem regras clínicas no prompt** nesta fase: os alertas TEPID vêm de `config/tepid.json` avaliado em código (só B), e o LLM não sugere implante nem plano. O prompt de sistema diz explicitamente que o modelo não faz recomendação clínica nem cita números fora da lista.
9. **Logs**: registram só `pseudonimo`, `atendimento_id`, modelo, tokens e latência; nunca o texto de entrada ou saída.

## Alternativas

- Saída em texto livre com regex de extração: frágil; tool use + schema é determinístico. Rejeitada.
- LLM gerar o relatório inteiro e depois "auditar" números: inverte a responsabilidade; o teste travado ficaria reativo. Rejeitada.
- Modelo local (open-weights) para eliminar transferência internacional: possível ADR futuro, a interface `ProvedorLLM` já permite.
- Enviar imagem para "descrição da mama": proibido pela restrição 1.

## Consequências

- Qualidade da prosa depende do modelo, mas a exatidão numérica não depende dele nunca.
- Antes de qualquer paciente real: cláusulas-padrão ANPD, aditivo de zero retenção e TCLE informando o uso de IA (Res. CFM 2.454/2026). Pendência de Gabriel, fora do código.
- Mock precisa ser mantido em paridade com os esquemas; o teste de contrato do mock é obrigatório.
