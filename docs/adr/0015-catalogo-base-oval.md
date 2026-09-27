# ADR 0015 — Catálogo 1.1: pegada oval (`base_forma`) e catálogo real extraído dos PDFs

Status: aceito · Data: 2026-09-26 · Altera: `contratos.md` §11 (`catalogo/1.1`, aditivo) e `config/schemas/catalogo.schema.json`

## Contexto

Marco 2 (`PROMPT.md`): ≥30 implantes extraídos dos PDFs públicos (Motiva, Polytech, GC Aesthetics), validados por zod, com `verificado: false` e a nota "conferir versão vigente e registro ANVISA com o fabricante". A extração bruta trouxe a Polytech Diagon\Gel® 4Two **AO** ("oval basis, anatomical profile": largura A ≠ altura C) com `forma: "oval"`, que o enum `forma` (`redonda | anatomica`) não aceita.

`forma` já é consumida pelo modelo geométrico (`services/mesh/.../geometrico.py`, ADR 0014) como **perfil sagital**: `anatomica` desloca o ápice para o polo inferior. A pegada já é uma elipse `base_mm × altura_mm`. A Polytech tem os dois eixos independentes: AR = base redonda + perfil anatômico; AO = base oval + perfil anatômico; RR = base redonda + perfil redondo.

## Decisão

1. **Novo campo `base_forma`** no implante: `"circular" | "oval"` (pegada na parede). `forma` continua `"redonda" | "anatomica"` (perfil sagital). AO → `forma: "anatomica"`, `base_forma: "oval"`, `altura_mm = C`.
2. **Aditivo e retrocompatível**: `esquema` passa a aceitar `"catalogo/1.0"` e `"catalogo/1.1"`. Em 1.0 `base_forma` é opcional (ausente = inferida: `altura_mm = base_mm` → circular, senão oval); em 1.1 é obrigatório (`if/then` no JSON Schema, `superRefine` no zod). `exemplo.json` e as fixtures do Python (1.0) continuam válidos; o Python não precisa mudar (usa `base_mm × altura_mm` e `forma` como antes).
3. **Regras semânticas** (testadas; não expressas no JSON Schema): `redonda` ⇒ `circular`; `circular` ⇒ `altura_mm = base_mm`; `oval` ⇒ `altura_mm ≠ base_mm`. Implementadas em `problemasDoImplante` (`packages/contratos`) e aplicadas pelo carregador do web.
4. **Arquivos por fabricante** (`motiva.json`, `polytech.json`, `gc_aesthetics.json`), como já previa o §11 — o arquivo tem `fabricante` e `documento` únicos, e o Python lê `config/catalogo/*.json`.
5. **Id estável** = `slug(fabricante)-slug(referência do fabricante)` (ex.: `motiva-rsd-300`, `polytech-21641-205`, `gc-aesthetics-802300n`); o teste recalcula e compara.
6. **`fonte.pagina`** = página física do PDF (1 = primeira), não o número impresso (o PDF da GC tem páginas duplas).
7. **Perfil normalizado é interpretação**; o nome do fabricante fica em `perfil_fabricante`. Motiva Mini/Demi/Full/Corsé → baixo/moderado/alto/extra_alto; Polytech MP/HP/XP → moderado/alto/extra_alto; GC 802N/805N/810N/812N → moderado/moderado_alto/alto/extra_alto. Superfície: SilkSurface (o PDF a chama de NanoSurface) → `nanotexturizada`; POLYtxt® (o PDF diz só "textured") → `outra`; GC "Microtextured" → `microtexturizada`. `coesividade.nivel = null` em todos (nenhum PDF dá escala numérica).

## Conferência da extração

As tabelas foram relidas direto do texto dos PDFs (`pdftotext -layout` por página) e conferidas por um segundo caminho independente (`pdftotext -raw` para Polytech/GC; tabela-resumo de outra página do mesmo PDF para a Motiva): 186/186 linhas iguais. A extração bruta tinha: 4 linhas GC inexistentes (810270N, 810300N, 810335N, 810365N — o PDF tem 810265N, 810295N, 810320N, 810350N), `forma` errada na Polytech AR (não é redonda) e AO (`oval`), `altura_mm` nula, `perfil` com valor de forma, páginas erradas e `verificado: true`. 19 linhas conferidas à mão viraram teste.

## Alternativas

- `forma: "oval"` como terceiro valor: mistura pegada com perfil, perde a informação "anatômico" da AO e faria o modelo geométrico tratá-la como cúpula simétrica. Rejeitado.
- Um único `implantes.json` multi-fabricante: exigiria mudar `fabricante`/`documento` do nível do arquivo e o carregador do Python. Rejeitado.

## Consequências

- Monotonia volume × dimensões vale por (fabricante, modelo) sem exceção; por (fabricante, perfil) há 1 exceção real do PDF (Polytech 21641-320 oval vs 21622-325 redondo), listada no teste.
- Catálogos são antigos (Polytech 2011-12, Motiva 2015, GC 2019); `registro_anvisa` é `null` em todos. Nada disso é verificado: a UI sempre mostra a nota.
