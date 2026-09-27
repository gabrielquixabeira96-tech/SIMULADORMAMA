# Simulador de mamoplastia de aumento em tempo real: estratégia de construção

## Resposta direta: é viável?

Sim: o Claude consegue escrever praticamente todo o sistema, e a captura por smartphone já foi validada em pacientes. iPhone 15 + 3D Scanner App concordou com o Vectra H2 com LoA < ±2 mm em 40 pacientes de reconstrução ([JPRAS 2025](https://doi.org/10.1016/j.bjps.2025.03.039); acurácia "moderada", fluxo trabalhoso). Com LiDAR, iPhone 15 Pro vs Vectra deu 3,0 ± 1,9 mm ([J Clin Med 2025](https://doi.org/10.3390/jcm14176233)), e N-IMF teve rTEM de 13% ([ASJ 2025](https://doi.org/10.1093/asj/sjae251)).

Morph targets no navegador rodam em <1 ms e um surrogate neural em 5–20 ms (estimativas; o MLP de 5 ms foi medido fora do navegador, [Wang & Kesavadas 2022](https://www.sciencedirect.com/science/article/pii/S2666990022000040)).

O Claude entrega código, arquitetura, testes, documentação, dossiê regulatório e rascunhos jurídicos. Não substitui cinco coisas: dados pré/pós para calibrar; hardware de captura com LiDAR; validação clínica; decisão e assinatura de cirurgião plástico; parecer jurídico e consulta formal à ANVISA.

Duas restrições de desenho são inegociáveis. O LLM nunca mede nem vê fotos em runtime, porque sua localização espacial é aproximada ([Claude Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)). A interface mostra faixas de incerteza, porque até o Vectra erra 4,0–4,5 mm de superfície ([Roostaeian 2014](https://doi.org/10.1177/1090820X14538805); [Assaaeed 2024](https://doi.org/10.1007/s00266-024-04007-z)) e 8,8 mm de projeção.

<!-- SECAO -->
## Estado da arte e concorrentes

Três motores comerciais (Crisalix, Vectra, Arbrea) são as referências, nenhum brasileiro; a meta a igualar é ~4–4,5 mm RMS e volume ±10% em ~73% das mamas ([Lorange 2025](https://doi.org/10.1097/PRS.0000000000012683)).

| Produto | Captura | Preço | Observação |
|---|---|---|---|
| [Crisalix](https://www.crisalix.com/en/doctor) | 3 fotos 2D por smartphone, 3D em nuvem | Não divulgado (planos Gold/Platinum/Diamond) | 5.000+ implantes; declara-se "ilustrativo" ([crisalix.com/pt](https://www.crisalix.com/pt)) |
| [Canfield VECTRA XT](https://www.canfieldsci.com/imaging-systems/vectra-xt-3d-imaging-system/) | Câmera 3D dedicada | Equipamento, US$ 50–150 mil (estimativa) | Mais validado em estudos independentes |
| [Arbrea Breast](https://arbrea-labs.com/breast/) | 3 fotos no iPad, offline | US$ 399/mês (PRO); app Mentor gratuito | Motor do [Mentor Simulator](https://breastimplantsbymentor.net/en-US/breast-implant-simulator); simulação em ~90 s ([JCM 2022](https://doi.org/10.3390/jcm11123464)) |
| [Natrelle 3D Visualizer](https://3d.natrelle.com/) | 3 selfies, web/app | Gratuito para paciente | Motor Crisalix; marketing Allergan |

Nenhum concorrente documenta publicamente a modelagem por plano cirúrgico, o que não prova que não o façam: os algoritmos não são publicados ([Crisalix publications](https://www.crisalix.com/en/publications)). Em 103 pacientes, N-IMF e base reais ficaram 3 mm maiores que os simulados pelo Vectra ([APS 2023](https://doi.org/10.1007/s00266-023-03597-4)).

| Estudo | Sistema | N (mamas) | Erro de volume | Erro de superfície ou observação |
|---|---|---|---|---|
| [Roostaeian 2014](https://doi.org/10.1177/1090820X14538805) | Vectra | 40 | 9,2% (27,2 cc) | 4,0 mm RMS |
| [Assaaeed 2024](https://doi.org/10.1007/s00266-024-04007-z) | Vectra | 84 | 21,5 ± 10,3 cc | 4,5 mm RMS; AP 8,8 mm |
| [Lorange 2025](https://doi.org/10.1097/PRS.0000000000012683) | Vectra | 154 | 73% dentro de ±10%; média 7,5%; pior >650 cc | N-IMF é a medida menos acurada |
| [Mailey 2012](https://doi.org/10.1177/1090820X12469807) | Portrait 3D | 44 | 12,2% (42,5 mL), até 30% | – |
| [FEM, APS 2011](https://doi.org/10.1007/s00266-010-9642-3) | Biomecânico | – | – | <1 mm em 89% da superfície |

Satisfação alta, mas não determinante: impacto 8,4/10 na decisão e similaridade pós-op 7,9/10 ([Ersan 2026](https://doi.org/10.1080/24699322.2026.2614532)); revisão de 17 estudos: insatisfação com a fidelidade "não é desprezível" ([PRS GO 2026](https://doi.org/10.1097/GOX.0000000000007999)).

<!-- SECAO -->
## Arquitetura do sistema

A arquitetura é um web app (Next.js + three.js no Vercel) que recebe malhas métricas de um app nativo. Todo cálculo é determinístico e o LLM só produz texto.

| Estágio | MVP | Versão avançada | Tecnologia |
|---|---|---|---|
| 1. Captura | iPad/iPhone Pro com LiDAR + 3D Scanner App, export OBJ com textura | App iOS próprio (ARKit) com checagem de qualidade | Swift/ARKit |
| 2. Pré-processamento | Recorte do pescoço para baixo, limpeza, decimação a 30–50 mil vértices | Automático com score de qualidade | Python (trimesh, Open3D) |
| 3. Antropometria | Médico toca 6–8 landmarks; distâncias e volume determinísticos; TEPID digitado | Landmarks automáticos por modelo de forma próprio (≤4 mm) | three.js raycast; Python |
| 4. Catálogo | JSON com base, altura, projeção, volume, forma e coesividade | Atualização por fabricante; RAG explicativo | Postgres |
| 5. Simulação | Geométrico-paramétrico + morph targets pré-computados (implante × plano × IMF) | FEBio offline → surrogate MLP/GNN em ONNX Web | numpy; FEBio; ONNX |
| 6. Renderização | three.js WebGL2, textura do scan, slider antes/depois | WebGPURenderer + TSL, pseudo-SSS, splats | react-three-fiber |
| 7. LLM | Anamnese → JSON; relatório e TCLE com campos numéricos travados | Assistente com RAG de catálogo e regras auditáveis (desenho B) | Claude API com tool use |
| 8. Registro | PDF assinável com versão, parâmetros e simulações mostradas | Exportação para o PEP | Postgres + bucket privado (São Paulo) |

Decisões justificadas. Morph targets, não FEM no navegador: interpolação em <1 ms contra 0,5–2 s de convergência do FEM grosso (estimativas; [softbodies WebGPU](https://github.com/holtsetio/softbodies)). O FEM entra offline, alimentando um surrogate com erro de 0,013 mm contra o próprio FEA.

Captura nativa, exibição web: o Safari não expõe LiDAR nem WebXR ([compatibilidade WebXR 2026](https://www.testmuai.com/learning-hub/webxr-compatible-browsers/)). Pinçamento e APSS são digitados, nunca inferidos de foto (base do TEPID, seção 4). IMF é parâmetro explícito, pois é a medida menos acurada em captura ([ASJ 2025](https://doi.org/10.1093/asj/sjae251)) e em simulação ([Lorange 2025](https://doi.org/10.1097/PRS.0000000000012683)).

Sem IA generativa 2D no MVP: nenhum trabalho demonstra fidelidade métrica a implante específico ([BreastGAN 2021](https://doi.org/10.1093/asjof/ojab052)). Dados ficam no Brasil e o LLM recebe só números, o que elimina transferência internacional de imagem íntima; os dados de anamnese enviados ao LLM ainda exigem cláusulas-padrão da ANPD.

<!-- SECAO -->
## Dados necessários

São três conjuntos de dados, e só o terceiro (pares pré/pós) é difícil de obter.

Catálogos de implantes. PDFs públicos cobrem Motiva (105–1.050 cc) ([catálogo](https://garylross.com/wp-content/uploads/2020/10/motiva-breast-implant-catalogue.pdf)), Polytech (140–615 cc) ([catálogo](https://garylross.com/wp-content/uploads/2020/10/polytech-breast-implant-catalogue.pdf)) e GC Aesthetics (100–800 cc) ([catálogo](https://www.eurosilicone.si/wp-content/uploads/2019/06/M_GCA_CombinedCatalogue_2019_ENG.pdf)). São PDFs de 2019/2020 hospedados por terceiros: conferir versão vigente e registro ANVISA de cada modelo com o fabricante; Silimed, Mentor e Allergan exigem representante ([Silimed](https://silimed.com/en/biodesign-line)). Campos: fabricante, modelo, base, altura, projeção, volume, forma, superfície, coesividade e registro.

Medidas digitadas na consulta. Formulário com largura da base, APSS, N-IMF sob estiramento e espessura de pinçamento do polo superior e no sulco inframamário (TEPID/High Five, Tebbetts & Adams 2002/2005, [PRS 2002](https://doi.org/10.1097/00006534-200204010-00030); conferir os pontos de corte no texto original). Eles viram parâmetros do modelo e, só no desenho B, regras de alerta em código.

Dataset pré/pós. Não há dataset público; os casos próprios (pré, pós 3 e 12 meses) são o ativo estratégico. A coleta usa scan padronizado e TCLE específico, com opt-in destacado e não condicionante para melhoria do software ([LGPD art. 11, I](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)). Validação formal de acurácia passa por CEP ([Lei 14.874/2024](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/lei/l14874.htm)).

Meta: 20–30 pares para calibrar os coeficientes; o surrogate é treinado com milhares de simulações FEBio e validado contra pares reais; uma rede treinada direto em pré/pós exigiria centenas a milhares de pares.

<!-- SECAO -->
## Stack técnica e ferramentas

A stack é open source ou de custo mensal baixo e reaproveita o que o ResidênciaMax já usa (Vercel, Postgres, APIs de LLM).

| Camada | Escolha | Licença | Custo (estimativa) |
|---|---|---|---|
| Captura | iPad/iPhone Pro com LiDAR + 3D Scanner App | Proprietário; app gratuito | R$ 0–14 mil |
| Front-end | Next.js + react-three-fiber + three.js | MIT | R$ 0 |
| Hospedagem | Vercel Pro, functions fixadas em São Paulo (gru1; boa prática) | – | US$ 20/mês |
| Banco e arquivos | Supabase (Postgres + Storage, região São Paulo) | Apache-2.0 / PostgreSQL | US$ 25/mês (Pro) |
| Processamento de malha | Python: trimesh, Open3D, numpy | MIT/BSD | Worker Railway/Fly.io, US$ 10–20/mês |
| FEM offline e inferência web | FEBio ([SimTK](https://simtk.org/projects/febio)); ONNX Runtime Web | MIT | R$ 0 |
| LLM em runtime | Claude API (só dados estruturados) | Comercial | US$ 20–60/mês no piloto |
| Autenticação e observabilidade | Supabase Auth; Sentry sem dado pessoal nos logs (boa prática) | – | R$ 0 nos tiers gratuitos |
| Assinatura de PDF | Certificado ICP-Brasil A1 do médico | – | R$ 150–300/ano |
| Evitar em produto comercial | RBSM/iRBSM/liRBSM, SMPL-X, DA2 Base/Large, DA3 Giant/Large/Nested, FLUX dev, VGGT original; SAM 3D Body ("SAM License", ler antes) | Não comerciais ([rbsm.re-mic.de](https://rbsm.re-mic.de/); [SMPL-X](https://smpl-x.is.tue.mpg.de/modellicense.html); [SAM 3D Body](https://github.com/facebookresearch/sam-3d-body)) | – |

Seguros para a fase avançada: Depth Anything 3 Small/Base ([Apache-2.0](https://github.com/bytedance-seed/depth-anything-3)); Anny ([código Apache-2.0, assets CC0](https://github.com/naver/anny); não usar a topologia SMPL-X, que é NC); Spark ([MIT](https://github.com/sparkjsdev/spark)).

<!-- SECAO -->
## Mapeamento de skills, conectores e agentes Claude

Cowork orquestra e documenta, Claude Code constrói e a Claude API roda só a camada de texto; `opus` é o padrão, `fable` fica para arquitetura e bugs difíceis, `haiku` para tarefas mecânicas.

| Fase / tarefa | Ferramenta Claude | Modelo | O que entrega |
|---|---|---|---|
| ADRs, contratos de API, esquema de dados | Cowork + engineering:architecture, system-design | fable | ADRs, diagrama, esquema Postgres |
| Scaffold Next.js + R3F + Supabase, CI | Claude Code + conector Vercel | opus | Repositório e deploy preview |
| Viewer 3D, landmarks, morph targets | Claude Code; Three.js 3D Viewer para protótipos | opus | Componentes R3F testados |
| Modelo geométrico e morphs (Python) | Claude Code, subagentes em worktrees | opus; fable se instável | Scripts, regressão, benchmarks |
| FEBio + surrogate ONNX (avançado) | Claude Code | fable (design) / opus | Templates .feb, dataset sintético, ONNX |
| Catálogo de implantes | Cowork + skill `pdf` ou leitura direta dos PDFs + skill própria | haiku (extração) → opus (validação) | JSON validado por esquema |
| UI da consulta e crítica | Figma (figma-generate-design), frontend-design, design:ux-copy, design-critique, accessibility-review | opus | Protótipo, código, avisos, correções |
| Testes, revisão, deploy e bugs difíceis | engineering:testing-strategy, code-review, deploy-checklist, debug + Vercel | opus; haiku no checklist; fable em bugs | Testes, veredito de merge, rollback, causa raiz |
| Dossiê técnico (IEC 62304, ISO 14971) | engineering:documentation + skill própria | opus | SRS, SDD, matriz de risco |
| LGPD, CFM, ANVISA, TCLE | legal:compliance-check, legal-risk-assessment + Claude Docs | opus | RIPD, DPA e TCLE em rascunho |
| Literatura e validação estatística | PubMed, Scite + data:statistical-analysis | haiku (busca) / opus (análise) | Protocolo, Bland-Altman, ICC, RMS |
| Runtime: anamnese e relatório | Claude API (tool use, JSON Schema) | Rápido na anamnese; padrão no relatório | JSON validado; texto revisável |
| Entrevistas, agenda e rotinas | design:user-research; Cowork + Calendar, Gmail, Drive; tarefas agendadas | opus; haiku nas rotinas | Roteiro de entrevista, plano semanal, relatório de métricas |

Skills próprias a criar com skill-creator:

- `catalogo-implantes`: esquema JSON, extração e validação.
- `protocolo-captura-3d`: posição, luz, escala, nomeação.
- `protocolo-validacao-simulador`: métricas, Bland-Altman, planilha.
- `tcle-simulacao`: as 13 cláusulas mínimas.
- `dossie-samd`: IEC 62304, ISO 14971, registros do art. 5º.
- `morph-pipeline`: convenções de malha e testes de latência.

Conectores a adicionar (verificar disponibilidade): GitHub (Claude Code usa `gh`), Supabase e Sentry; Linear opcional.

<!-- SECAO -->
## Roteiro por fases com critérios de passagem

Sete fases levam do viewer ao SaaS, cada uma com critério objetivo de passagem.

| Fase | Duração estimada | Entregável | Critério para avançar |
|---|---|---|---|
| 0. Fundação | 2 semanas | ADRs, repositório, protocolo de captura, catálogo com 30 implantes, TCLE v1 | 3 scans abertos no viewer com escala correta (régua ±2 mm) |
| 1. Viewer e antropometria | 4 semanas | Landmarks, distâncias, volume, formulário TEPID, PDF | ≥30 pares de medida em ≥5 voluntárias ou manequim, N-IMF relatado à parte; LoA de Bland-Altman dentro de ±3 mm (referência: 3,0 ± 1,9 mm no [J Clin Med 2025](https://doi.org/10.3390/jcm14176233)) |
| 2. Simulação MVP | 6 semanas | Morph targets 30–60 implantes × 2 planos (subglandular/subfascial vs dual plane) × 2 IMF; slider; LLM | Latência <100 ms no iPad; cirurgião julga plausível ≥8 de 10 casos |
| 3. Piloto in house | 3–6 meses (pode ser otimista: CEP + seguimento de 3 m) | 20–30 pacientes do serviço parceiro com pré/pós 3 m e TCLE; registros de validação (art. 5º) | RMS ≤6 mm e volume ±15% em ≥60%; zero incidentes LGPD |
| 4. Calibração e regulatório | 3–6 meses | Coeficientes calibrados; consulta de enquadramento à ANVISA; RIPD; DPA; parecer jurídico | RMS ≤4,5 mm; volume ±10% em ≥70% ([Lorange 2025](https://doi.org/10.1097/PRS.0000000000012683)); resposta da consulta de enquadramento (art. 19) ou parecer jurídico favorável ao desenho A; AFE, BPF e notificação concluídas se for SaMD |
| 5. SaaS beta | 3–6 meses | Multi-tenant, marca própria, desenho A | 3 clínicas com ≥10 simulações/mês; receita cobre custos fixos |
| 6. Avançada | 6–12 meses | FEBio + surrogate; app iOS; landmarks automáticos | Surrogate vs FEM <0,5 mm; landmarks ≤4 mm vs manual |

A fase 3 depende de um cirurgião plástico parceiro, porque Gabriel ainda não opera mamoplastia. O art. 5º só vale se o software for do serviço onde é usado (seção 8). O critério da fase 4 é a paridade com o Vectra, o que sustenta a migração para o desenho B e o dossiê.

<!-- SECAO -->
## Regulatório e ética

O piloto in house pode dispensar notificação pelo art. 5º da RDC 657; o SaaS com desenho B é SaMD provavelmente classe II (notificação, AFE, BPF), e o desenho A pode ficar fora do escopo ou em classe I, a confirmar por consulta de enquadramento.

ANVISA. Software que mede e sugere implante é SaMD provavelmente classe II pela Regra 11, com risco de classe III pela expressão "intervenção cirúrgica" ([RDC 751/2022](https://anvisalegis.datalegis.net/action/ActionDatalegis.php?acao=abrirTextoAto&tipo=RDC&numeroAto=00000751&seqAto=000&valorAno=2022&orgao=RDC%2FDC%2FANVISA%2FMS&codTipo=&desItem=&desItemFim=&cod_menu=1696&cod_modulo=134&pesquisa=true)). O art. 5º da RDC 657/2022 dispensa o SaMD in house de classe I ou II, com registros de validação guardados 10 anos após o descarte ([RDC 657](https://anvisalegis.datalegis.net/action/ActionDatalegis.php?acao=abrirTextoAto&tipo=RDC&numeroAto=00000657&seqAto=000&valorAno=2022&orgao=RDC%2FDC%2FANVISA%2FMS&codTipo=&desItem=&desItemFim=&cod_menu=9434&cod_modulo=310&pesquisa=true)). Vender exige AFE, BPF e dossiê, e a classe não é escolha do fabricante ([Q&A RDC 657](https://www.gov.br/anvisa/pt-br/assuntos/noticias-anvisa/2022/software-como-dispositivo-medico-perguntas-e-respostas/perguntas-respostas-rdc-657-de-2022-v1-01-09-2022.pdf)).

O piloto só se enquadra no art. 5º se o software for do próprio serviço onde é usado e aplicado só nas pacientes dele, com registros de validação desde o 1º dia. Isso exige Gabriel integrado formalmente ao serviço do parceiro, ou o serviço como desenvolvedor por contrato. O §1º proíbe comercializar ou doar sem regularização; confirmar com advogado antes da fase 3.

Estratégia: piloto in house com o desenho B (mede e calcula) sob o art. 5º; SaaS inicial com o desenho A, em que o cirurgião digita medidas e escolhe o implante. No desenho A ficam desligados: medição automática no 3D, volume calculado, alertas TEPID/High Five de plano, sugestão de implante e números calculados no relatório do LLM. Consulta formal de enquadramento (art. 19) antes de escalar, monitorando a revisão da RDC 657 que incluirá IA ([Agenda Regulatória 2026-27](https://www.gov.br/anvisa/pt-br/assuntos/regulamentacao/agenda-regulatoria/agenda-2026-2027/arquivos/lista_preliminar/produtos_para_saude_lista_preliminar_detalhada.pdf)).

LGPD. Imagens de mamas são dado sensível: base assistencial no art. 11, II, "f"; usos secundários exigem consentimento destacado. No SaaS a clínica é controladora e a empresa é operadora com DPA; treinar com imagens das clientes esbarra no art. 11, §4º.

RIPD é recomendado pela ANPD e exigível pelo art. 38; encarregado é obrigatório, por ser alto risco sem a flexibilização da Res. 2/2022 ([ANPD, RIPD](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd)). Enviar só dados estruturados e pseudonimizados ao LLM reduz o risco, mas ainda é transferência internacional de dado sensível: exige as cláusulas-padrão da ANPD ([Res. 19/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024)) sem alteração, aditivo com zero data retention e sem uso para treino, e transparência ao titular; a alternativa é anonimização efetiva. Incidentes: comunicação em 3 dias úteis ([Res. 15/2024](https://dspace.mj.gov.br/bitstream/1/12879/2/RES_ANPD_2024_15.html)).

CFM. A simulação nunca vira publicidade: é vedado prometer resultado e editar imagens ([Res. 2.336/2023](https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2023/2336_2023.pdf)), logo sem botão de compartilhar. A Res. 2.454/2026 obriga informar a paciente, registrar IA no prontuário e avaliar risco ([Res. 2.454/2026](https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2026/2454_2026.pdf)). Monetizar via fabricante conflita com os arts. 68 e 69 do CEM ([Res. 2.217/2018](https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2018/2217_2018.pdf)): catálogo neutro.

TCLE e responsabilidade civil. O maior risco é civil: cirurgia estética é obrigação de resultado ([STJ, REsp 2.173.636](https://www.migalhas.com.br/quentes/421341/stj-medico-responde-por-cirurgia-que-nao-atingiu-senso-comum-estetico)), e uma vara paulista condenou por rinoplastia diferente da simulação ([Diário de Justiça, 2026](https://diariodejustica.com.br/cirurgia-plastica-fica-diferente-da-simulacao-e-medica-indenizara-cliente/)) (fontes secundárias; conferir íntegra). Logo: TCLE específico anterior ao termo cirúrgico, mais de uma opção mostrada, margem de erro declarada e faixas, não imagem única. Simulações e termo ficam no prontuário por no mínimo 20 anos do último registro ([Lei 13.787/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13787.htm)).

<!-- SECAO -->
## Custos, riscos e métricas de validação

O MVP custa menos de R$ 2 mil por mês com um iPhone Pro existente; o custo relevante aparece nas fases 4 e 5. Todos os valores abaixo são estimativas.

| Item | Estimativa | Quando |
|---|---|---|
| Hardware de captura | R$ 0 (iPhone Pro existente) a R$ 14 mil (iPad Pro) | Fase 0 |
| Infraestrutura (Vercel, Supabase, worker, Sentry) | US$ 55–100/mês | Fases 0–5 |
| Claude API em runtime | US$ 20–60/mês no piloto | Fase 2 em diante |
| Advogado regulatório (ANVISA + LGPD) | R$ 8–20 mil | Fase 4 |
| Abertura de empresa, AFE, BPF, notificação e consultoria | R$ 30–80 mil no total | Fase 5 |

Até a fase 3 o gasto é quase só tempo (CEP é gratuito; certificado ICP-Brasil ~R$ 150–300/ano). A fase 5 começa após o enquadramento, e o gasto com empresa e AFE é liberado por cartas de intenção de 3 clínicas.

Riscos técnicos. N-IMF é o ponto fraco na captura ([ASJ 2025](https://doi.org/10.1093/asj/sjae251)) e na simulação ([Lorange 2025](https://doi.org/10.1097/PRS.0000000000012683)), e a projeção AP errou 8,8 mm no Vectra ([Assaaeed 2024](https://doi.org/10.1007/s00266-024-04007-z)). O volume é subestimado em mamas grandes ([Breast Cancer 2024](https://link.springer.com/article/10.1007/s12282-024-01647-6)) e, em manequim, o iPhone errou 14% contra 9,1% do Vectra ([PLoS One 2024](https://doi.org/10.1371/journal.pone.0305059)).

O app pesa mais que o hardware: SureScan 2,9 mm e Heges 3,6 mm contra 4,4 mm do 3D Scanner App e 21,4 mm do Polycam ([Sensors 2025](https://doi.org/10.3390/s25154596)). E o resultado muda com o tempo: N-IMF alonga ~1 cm em 12 meses com implante liso redondo ([ASJ 2026](https://doi.org/10.1093/asj/sjag055)).

Riscos regulatórios e de negócio: reclassificação para classe III, litígio por expectativa, licenças não comerciais, dependência do cirurgião parceiro e execução. Mitigação do último: critérios numéricos por fase, tarefas agendadas semanais e revisão obrigatória antes de qualquer merge.

| Métrica | Meta MVP (fase 3) | Meta paridade (fase 4) | Referência |
|---|---|---|---|
| Captura vs fita ou Vectra | LoA ±3 mm | LoA ±2 mm; ICC ≥0,96 | [JPRAS 2025](https://doi.org/10.1016/j.bjps.2025.03.039) (população de reconstrução) |
| Superfície simulada vs pós-op | RMS ≤6 mm | RMS ≤4,5 mm | [Assaaeed 2024](https://doi.org/10.1007/s00266-024-04007-z) |
| Volume | ±15% em ≥60% | ±10% em ≥70% | [Lorange 2025](https://doi.org/10.1097/PRS.0000000000012683) |
| Projeção AP e N-IMF (à parte) | Relatar | AP ≤8 mm; N-IMF ≤3 mm | [Assaaeed 2024](https://doi.org/10.1007/s00266-024-04007-z); [APS 2023](https://doi.org/10.1007/s00266-023-03597-4) |
| Similaridade percebida pela paciente | ≥7/10 | ≥7,9/10 | [Ersan 2026](https://doi.org/10.1080/24699322.2026.2614532) |
| Latência do slider no iPad | <100 ms (estimativa) | <16 ms (estimativa) | [ORT WebGPU](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html) |

<!-- SECAO -->
## Próximos passos

As próximas 2–4 semanas fecham a fase 0 e iniciam a fase 1, sem gastos além dos tiers gratuitos e do hardware.

- [ ] Confirmar cirurgião plástico parceiro em Cuiabá para testar e ceder casos pré/pós (e-mail via Gmail).
- [ ] Redigir TCLE v1 (13 cláusulas) em Claude Docs e o formulário TEPID (regras de alerta só no desenho B).
- [ ] Verificar iPhone Pro ou iPad Pro com LiDAR; instalar 3D Scanner App e fazer 3 scans de teste em manequim ou voluntário vestido, com régua de escala. Tronco nu só após TCLE assinado e, se for para validação, após aprovação do CEP.
- [ ] Rodar engineering:architecture (`fable`) para os ADRs: pipeline, esquema de dados, upload, dados no Brasil.
- [ ] Abrir o repositório em Claude Code (`opus`): Next.js + react-three-fiber + Supabase (São Paulo), deploy no Vercel, Sentry.
- [ ] Implementar viewer OBJ com textura, 6–8 landmarks e distâncias geodésicas e euclidianas.
- [ ] Criar a skill `catalogo-implantes` e extrair Motiva, Polytech e GC Aesthetics (`haiku` extrai, `opus` valida); pedir Silimed e Mentor.
- [ ] Criar a skill `protocolo-captura-3d` com protocolo de uma página (posição, luz, distância, recorte do rosto).
- [ ] Esboçar em Figma a tela da consulta: viewer, painel de implante, slider, aviso "ilustração, não previsão".
- [ ] Iniciar a planilha de validação do art. 5º da RDC 657: versão, data, scan, medidas e desvios.
- [ ] Agendar tarefa semanal (`haiku`) que compila métricas, pendências e o próximo critério de passagem.
- [ ] Listar 3 advogados regulatórios (ANVISA/LGPD) para orçamento, sem contratar ainda.

<!-- SECAO -->
## Fontes

Captura e acurácia: [JPRAS 2025](https://doi.org/10.1016/j.bjps.2025.03.039) · [J Clin Med 2025](https://doi.org/10.3390/jcm14176233) · [ASJ 2024](https://doi.org/10.1093/asj/sjae170) · [ASJ 2025](https://doi.org/10.1093/asj/sjae251) · [Sensors 2025](https://doi.org/10.3390/s25154596) · [PLoS One 2024](https://doi.org/10.1371/journal.pone.0305059) · [Breast Cancer 2024](https://link.springer.com/article/10.1007/s12282-024-01647-6) · [compatibilidade WebXR 2026](https://www.testmuai.com/learning-hub/webxr-compatible-browsers/)

Simulação e validação clínica: [Roostaeian 2014](https://doi.org/10.1177/1090820X14538805) · [Assaaeed 2024](https://doi.org/10.1007/s00266-024-04007-z) · [Lorange 2025](https://doi.org/10.1097/PRS.0000000000012683) · [Mailey 2012](https://doi.org/10.1177/1090820X12469807) · [APS 2023](https://doi.org/10.1007/s00266-023-03597-4) · [Crisalix JMIR 2012](https://doi.org/10.2196/jmir.1903) · [Arbrea JCM 2022](https://doi.org/10.3390/jcm11123464) · [ASJ 2026](https://doi.org/10.1093/asj/sjag055) · [Ersan 2026](https://doi.org/10.1080/24699322.2026.2614532) · [PRS GO 2026](https://doi.org/10.1097/GOX.0000000000007999) · [FEM APS 2011](https://doi.org/10.1007/s00266-010-9642-3) · [Wang & Kesavadas 2022](https://www.sciencedirect.com/science/article/pii/S2666990022000040) · [BreastGAN 2021](https://doi.org/10.1093/asjof/ojab052) · [TEPID, PRS 2002](https://doi.org/10.1097/00006534-200204010-00030)

Produtos e catálogos: [Crisalix](https://www.crisalix.com/en/doctor) · [Crisalix PT](https://www.crisalix.com/pt) · [Crisalix publications](https://www.crisalix.com/en/publications) · [VECTRA XT](https://www.canfieldsci.com/imaging-systems/vectra-xt-3d-imaging-system/) · [Arbrea](https://arbrea-labs.com/breast/) · [Mentor](https://breastimplantsbymentor.net/en-US/breast-implant-simulator) · [Natrelle](https://3d.natrelle.com/) · [3dMD](https://www.3dmd.com) · [Motiva](https://garylross.com/wp-content/uploads/2020/10/motiva-breast-implant-catalogue.pdf) · [Polytech](https://garylross.com/wp-content/uploads/2020/10/polytech-breast-implant-catalogue.pdf) · [GC Aesthetics](https://www.eurosilicone.si/wp-content/uploads/2019/06/M_GCA_CombinedCatalogue_2019_ENG.pdf) · [Silimed](https://silimed.com/en/biodesign-line)

Software e licenças: [ONNX Runtime WebGPU](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html) · [softbodies WebGPU](https://github.com/holtsetio/softbodies) · [FEBio](https://simtk.org/projects/febio) · [Spark](https://github.com/sparkjsdev/spark) · [Depth Anything 3](https://github.com/bytedance-seed/depth-anything-3) · [Anny](https://github.com/naver/anny) · [SAM 3D Body](https://github.com/facebookresearch/sam-3d-body) · [RBSM licença](https://rbsm.re-mic.de/) · [SMPL-X licença](https://smpl-x.is.tue.mpg.de/modellicense.html) · [Claude Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)

Regulatório: [RDC 657/2022](https://anvisalegis.datalegis.net/action/ActionDatalegis.php?acao=abrirTextoAto&tipo=RDC&numeroAto=00000657&seqAto=000&valorAno=2022&orgao=RDC%2FDC%2FANVISA%2FMS&codTipo=&desItem=&desItemFim=&cod_menu=9434&cod_modulo=310&pesquisa=true) · [RDC 751/2022](https://anvisalegis.datalegis.net/action/ActionDatalegis.php?acao=abrirTextoAto&tipo=RDC&numeroAto=00000751&seqAto=000&valorAno=2022&orgao=RDC%2FDC%2FANVISA%2FMS&codTipo=&desItem=&desItemFim=&cod_menu=1696&cod_modulo=134&pesquisa=true) · [Q&A RDC 657](https://www.gov.br/anvisa/pt-br/assuntos/noticias-anvisa/2022/software-como-dispositivo-medico-perguntas-e-respostas/perguntas-respostas-rdc-657-de-2022-v1-01-09-2022.pdf) · [Agenda Regulatória 2026-27](https://www.gov.br/anvisa/pt-br/assuntos/regulamentacao/agenda-regulatoria/agenda-2026-2027/arquivos/lista_preliminar/produtos_para_saude_lista_preliminar_detalhada.pdf) · [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) · [Res. ANPD 15/2024](https://dspace.mj.gov.br/bitstream/1/12879/2/RES_ANPD_2024_15.html) · [Res. ANPD 19/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024) · [ANPD RIPD](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd) · [Lei 14.874/2024](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/lei/l14874.htm) · [Res. CFM 2.336/2023](https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2023/2336_2023.pdf) · [Res. CFM 2.454/2026](https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2026/2454_2026.pdf) · [Res. CFM 2.217/2018](https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2018/2217_2018.pdf) · [Lei 13.787/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13787.htm) · [STJ REsp 2.173.636 (Migalhas)](https://www.migalhas.com.br/quentes/421341/stj-medico-responde-por-cirurgia-que-nao-atingiu-senso-comum-estetico) · [TJSP 2026 (Diário de Justiça)](https://diariodejustica.com.br/cirurgia-plastica-fica-diferente-da-simulacao-e-medica-indenizara-cliente/)
