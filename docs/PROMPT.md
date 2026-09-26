# Prompt — Construção do MVP do simulador de mamoplastia de aumento

> Como usar: crie uma pasta vazia, coloque nela o arquivo `ESTRATEGIA.md`, abra o Claude Code nessa pasta e cole tudo abaixo da linha.

---

## Papel

Você é o engenheiro-líder e orquestrador deste projeto. Planeja, delega a subagentes, integra, testa e entrega. Trabalhe de forma autônoma e só me interrompa diante de uma decisão bloqueante que seja minha.

## Objetivo

Construir, em código local e testado, o **MVP técnico (fases 0, 1 e 2)** de um simulador 3D em tempo real do resultado de mamoplastia de aumento com prótese, para uso na consulta. A especificação completa está em `ESTRATEGIA.md`.

## Antes de escrever código

1. Leia `ESTRATEGIA.md` inteiro. Ele é a fonte da verdade. Divergências só entram por ADR justificado.
2. Entre em modo de planejamento e me apresente:
   - os marcos;
   - as tarefas de cada marco;
   - quais tarefas rodam em paralelo;
   - os riscos técnicos.
3. Depois de me apresentar o plano, execute sem esperar aprovação, exceto se houver uma pergunta bloqueante.

## Escopo desta execução

**Dentro:** fases 0, 1 e 2 do roteiro, com dados sintéticos.

**Fora:**
- pacientes reais e deploy em produção;
- criação de contas e compra de serviços;
- a fase 3 em diante;
- o app iOS nativo;
- FEBio e o surrogate neural. Deixe apenas as interfaces preparadas para eles.

## Restrições inegociáveis

**1. LLM sem imagens.** O LLM nunca recebe fotos, malhas nem texturas. Recebe só dados estruturados e pseudonimizados. Medidas, landmarks, volume e simulação são calculados por código determinístico.

**2. Nenhuma imagem real de nudez.** Não baixe nem inclua imagens reais de nudez, em nenhum momento. Todos os testes usam um **torso sintético paramétrico** gerado por código, com dimensões conhecidas.

**3. Incerteza sempre visível.**
- A interface mostra um envelope de ±4,5 mm RMS na superfície simulada, configurável.
- Mostra também o aviso fixo: "Ilustração, não previsão de resultado".
- Nunca há imagem única sem faixa de incerteza.

**4. Sem compartilhamento.** Não há botão de compartilhar, nem exportação para redes sociais ou uso publicitário (Res. CFM 2.336/2023).

**5. Feature flag `DESENHO=A|B`:**
- **B (padrão local):** medição automática, volume calculado e alertas TEPID/High Five ativos.
- **A:** o cirurgião digita as medidas e escolhe o implante. Ficam desligados:
  - medição automática no 3D;
  - volume calculado;
  - alertas de plano;
  - sugestão de implante;
  - números calculados no texto do LLM.
- Crie testes que provem que o modo A desliga tudo isso.

**6. LGPD por padrão:**
- Nenhum dado de paciente no repositório.
- Pasta de dados no `.gitignore`.
- IDs pseudonimizados.
- Tabela de auditoria (quem viu o quê, quando).
- Logs sem dado pessoal.
- Configuração de produção preparada para São Paulo: `vercel.json` com região `gru1` e banco em `sa-east-1`. Não fazer o deploy.

**7. Licenças.** Proibido usar:
- RBSM, iRBSM e liRBSM;
- SMPL-X;
- Depth Anything 2 Base/Large;
- Depth Anything 3 Giant/Large/Nested;
- FLUX dev;
- VGGT original;
- SAM 3D Body.

Só dependências com licença MIT, BSD, Apache-2.0 ou equivalente. Gere `THIRD_PARTY_LICENSES.md`.

**8. Rastreabilidade (art. 5º da RDC 657).** Cada versão registra, em `docs/validacao/`, a versão do software, a data, os parâmetros e os resultados dos testes de acurácia. Registre desde o primeiro commit.

## Stack

Segue a `ESTRATEGIA.md`:
- Next.js com TypeScript, react-three-fiber e three.js;
- Postgres local via Supabase CLI ou Docker;
- Python para processamento de malha (trimesh, numpy, Open3D) e pré-cômputo de morph targets;
- testes com Vitest, Playwright e pytest.

## Marcos e critérios de pronto

### Marco 0 — Fundação

- ADRs em `docs/adr/` cobrindo:
  - o pipeline;
  - o esquema de dados;
  - o upload de malhas;
  - a residência de dados no Brasil;
  - a flag A/B;
  - a camada do LLM.
- Monorepo com `apps/web` e `services/mesh` (Python), CI local (lint e testes) e README com comandos.
- Gerador de torso sintético (Python) que exporta OBJ com textura neutra. Parâmetros:
  - largura torácica;
  - volume mamário de cada lado;
  - ptose;
  - distância N-IMF;
  - assimetria.
- Um JSON acompanha o OBJ com o gabarito das medidas reais.
- **Pronto quando:** 3 torsos sintéticos abrem no viewer com escala correta. O erro é de ±1 mm nas distâncias do gabarito.

### Marco 1 — Viewer e antropometria

- Upload de OBJ/PLY com textura, recorte abaixo do pescoço e decimação para 30–50 mil vértices.
- Calibração de escala por dois pontos de uma régua.
- Marcação por clique de 6 a 8 landmarks:
  - fúrcula;
  - mamilos;
  - sulcos inframamários;
  - linha média;
  - bordas medial e lateral da base.
- Distâncias euclidianas e geodésicas:
  - fúrcula–mamilo (SSN-N);
  - mamilo–sulco (N-IMF);
  - largura da base;
  - distância intermamilar.
- Volume estimado com faixa de incerteza.
- Formulário TEPID com campos digitados:
  - APSS;
  - pinçamento do polo superior;
  - pinçamento no sulco;
  - N-IMF sob estiramento.
- Os pontos de corte do TEPID ficam em arquivo de configuração com a nota "conferir no texto original". Nunca devem ser hard-coded como verdade clínica.
- **Pronto quando:** em ≥30 pares de medida nos torsos sintéticos, o Bland-Altman dá LoA dentro de ±2 mm. O relatório de validação é gerado em `docs/validacao/`.

### Marco 2 — Catálogo e simulação

- Esquema JSON do catálogo (validado com zod), com os campos:
  - fabricante e modelo;
  - base, altura e projeção;
  - volume e perfil;
  - forma e superfície;
  - coesividade;
  - registro na ANVISA;
  - fonte (URL e página).
- Extraia pelo menos 30 implantes dos PDFs públicos citados na `ESTRATEGIA.md` (Motiva, Polytech, GC Aesthetics). Cada linha leva `verificado: false` e a nota "conferir versão vigente e registro ANVISA com o fabricante". Se não conseguir baixar os PDFs, crie uma seed marcada como `exemplo_nao_clinico` e me avise.
- Modelo geométrico-paramétrico:
  - forma do implante (redonda ou anatômica) a partir de base, projeção e volume;
  - posição na parede torácica;
  - deslocamento do tecido mole;
  - coeficientes por plano (subglandular/subfascial vs dual plane);
  - parâmetro de rebaixamento do sulco.
- Todos os coeficientes ficam em configuração, com a marca `nao_calibrado`.
- Morph targets pré-computados em Python (implante × plano × IMF) e exportados em glTF.
- Na interface:
  - slider antes/depois;
  - comparação lado a lado de 2 implantes;
  - envelope de incerteza.
- **Pronto quando:**
  - a latência de interação fica abaixo de 100 ms, medida por benchmark automatizado;
  - existem testes de regressão geométrica;
  - volume maior gera projeção maior (monotonicidade);
  - a simetria é preservada em torso simétrico.

### Marco 2b — Camada de texto e registro

- Claude API com tool use e JSON Schema para dois usos:
  - **Anamnese:** texto livre vira JSON validado.
  - **Relatório para a paciente:** os números vêm de template travado. O LLM escreve só a prosa.
- Um teste falha se qualquer número no texto do LLM divergir dos dados.
- Modo mock quando não houver `ANTHROPIC_API_KEY`.
- PDF do atendimento contendo:
  - versão do software;
  - parâmetros;
  - simulações mostradas;
  - aviso de caráter ilustrativo;
  - campo para assinatura digital (ICP-Brasil, só o placeholder).
- **Pronto quando:** os testes de ponta a ponta com Playwright cobrem o fluxo inteiro, do upload ao PDF, nos modos A e B.

## Modo de trabalho

**Delegação:** use subagentes em paralelo para tarefas independentes (por exemplo, viewer, serviço Python e catálogo), em worktrees separados. Um subagente por tarefa, com prompt contendo:
- objetivo;
- contexto;
- entregável com caminho;
- critério de pronto;
- relatório curto (resultado, arquivos, pendências).

**Modelos, se o ambiente permitir escolher:**
- modelo padrão para código de rotina, testes e documentação;
- o modelo mais forte só para arquitetura e bugs de causa desconhecida;
- o modelo rápido para extração mecânica, como os PDFs do catálogo.

**Qualidade:**
- Ao fim de cada marco, rode lint e todos os testes e faça commit com mensagem descritiva.
- Antes de encerrar, faça uma revisão de código completa (segurança, vazamento de dado pessoal, licenças, flag A/B) e corrija o que achar.

**Quando algo falhar:**
- Diagnostique a causa antes de tentar de novo.
- Não repita a mesma abordagem mais de 2 vezes.
- Não desative testes para fazê-los passar.

## Pare e me pergunte somente se

- Uma decisão exigir gasto, conta nova ou dado real de paciente.
- For preciso violar alguma restrição inegociável.
- A `ESTRATEGIA.md` estiver internamente contraditória num ponto que bloqueia o trabalho.

## Relatório final

Entregue, nesta ordem:
1. Status de cada marco: critério atingido (sim ou não), com os números medidos.
2. Como rodar: comandos exatos de instalação, testes e execução local.
3. Mapa do repositório: pastas principais em uma linha cada.
4. Pendências que dependem de mim:
   - hardware com LiDAR;
   - cirurgião parceiro;
   - TCLE;
   - advogado;
   - contas e chaves;
   - deploy.
5. Suposições tomadas sem confirmação.
