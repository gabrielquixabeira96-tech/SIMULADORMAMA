#!/usr/bin/env node
// Valida arquivos .glb/.gltf com o Khronos glTF-Validator (npm `gltf-validator`, Apache-2.0; devDependency
// da raiz). Substitui a "verificacao manual" dos registros de validacao (RDC 657 art. 5; contratos §15).
//
// Uso: node scripts/validar_gltf.mjs [--json <saida.json>] <arquivo.glb> [...]
// Sai 0 so se TODOS os arquivos forem lidos e tiverem 0 erros e 0 avisos; caso contrario sai 1
// (2 = uso incorreto). A ultima linha da saida padrao e o resumo: "<n> arquivos, <e> erros, <a> avisos".
// Com --json grava {arquivos, erros, avisos, versao, por_arquivo: [...]} (o scripts/validacao.sh copia
// o resumo para `gltf_validator` no v<V>-services-mesh.json).
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { validateBytes, version } from "gltf-validator";

const args = process.argv.slice(2);
let saidaJson = null;
const arquivos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--json") saidaJson = args[++i];
  else arquivos.push(args[i]);
}
if (!arquivos.length || (args.includes("--json") && !saidaJson)) {
  console.error("uso: node scripts/validar_gltf.mjs [--json <saida.json>] <arquivo.glb> [...]");
  process.exit(2);
}

const porArquivo = [];
for (const arq of arquivos) {
  let r;
  try {
    const bytes = new Uint8Array(await readFile(arq));
    const rel = await validateBytes(bytes, { uri: basename(arq), writeTimestamp: false, maxIssues: 0 });
    const is = rel.issues;
    r = {
      arquivo: arq,
      erros: is.numErrors,
      avisos: is.numWarnings,
      infos: is.numInfos,
      dicas: is.numHints,
      mensagens: is.messages.filter((m) => m.severity <= 1).slice(0, 20).map((m) => `${m.code}: ${m.message}${m.pointer ? ` (${m.pointer})` : ""}`),
    };
  } catch (e) {
    // Arquivo ilegivel ou tao corrompido que o validador nem gera relatorio: conta como erro.
    r = { arquivo: arq, erros: 1, avisos: 0, infos: 0, dicas: 0, mensagens: [`falha ao validar: ${e?.message ?? e}`] };
  }
  porArquivo.push(r);
  console.log(`${r.erros === 0 && r.avisos === 0 ? "ok  " : "FALHA"} ${arq}: ${r.erros} erros, ${r.avisos} avisos`);
  for (const m of r.mensagens) console.log(`       ${m}`);
}

const resumo = {
  arquivos: porArquivo.length,
  erros: porArquivo.reduce((s, r) => s + r.erros, 0),
  avisos: porArquivo.reduce((s, r) => s + r.avisos, 0),
  versao: version(),
};
if (saidaJson) await writeFile(saidaJson, JSON.stringify({ ...resumo, por_arquivo: porArquivo }, null, 2) + "\n", "utf8");
console.log(`glTF-Validator ${resumo.versao}: ${resumo.arquivos} arquivos, ${resumo.erros} erros, ${resumo.avisos} avisos`);
process.exit(resumo.erros === 0 && resumo.avisos === 0 ? 0 : 1);
