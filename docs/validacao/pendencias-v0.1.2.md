# Desvios e pendências — v0.1.2

Desvios entre contrato e implementação: aceitos e registrados no ADR 0016 (`docs/adr/0016-desvios-aceitos-v0-1.md`), não repetidos aqui.

Pendências humanas (o software não as fecha sozinho):

- **Bland-Altman com o cirurgião:** ≥ 30 pares em ≥ 5 voluntárias ou manequim, N-IMF relatado à parte (fase 1 da `ESTRATEGIA.md`). A ferramenta existe (`/validacao/bland-altman`, ADR 0017), mas com torsos sintéticos `vale_para_fase1` é sempre `false`; o operador do Marco 1 neste registro continua simulado.
- **Latência no iPad:** medir no hardware-alvo pela página `/benchmark` (instância separada, ADR 0003, nota v0.1.2) e importar com `scripts/importar_latencia.py`. Os números deste registro são de SwiftShader.
- **Plausibilidade visual:** ≥ 8/10 simulações julgadas plausíveis pelo cirurgião (Marco 2).
- **Calibração da simulação:** coeficientes de `config/simulacao.json` continuam `nao_calibrado`; faltam pares pré/pós-operatórios.
- **TEPID:** limiares marcados "conferir no texto original" ainda não conferidos na publicação original.
- **Catálogo:** itens `verificado: false`; falta conferência com fabricante e registro ANVISA.
- **Sugestão de implante no desenho B:** `?sugerir=1` continua `501` em B (`403` em A), aguardando decisão do Gabriel sobre a regra de ranking e a conferência dos limiares TEPID em que ela se apoiaria.
- **Escuta fora do loopback sem o modo benchmark:** pendência registrada no ADR 0003 (nota v0.1.2). Os scripts sobem com `-H 127.0.0.1`; falta a subida recusar escutar fora do loopback fora do modo benchmark na rede.
- **Decisões do ADR 0017 a confirmar pelo Gabriel:** (a) reusar o recurso `medicao_automatica_3d`; (b) padrão de 2 repetições; (c) linhas do operador simulado na mesma planilha, marcadas `tipo_operador = simulado`; (d) CSV em vez de XLSX; (e) sessão aberta em B persiste e bloqueia depois de trocar para A, e sessões inválidas ou do formato anterior exigem remoção manual.
