import { z } from "zod";

/**
 * Sem JIT do zod (revisão v0.1.1): o zod 4 testa `new Function("")` para decidir o JIT, e a CSP do
 * app (sem 'unsafe-eval') registra isso como violação no navegador. O modo sem JIT dá o mesmo
 * resultado; só dispensa o eval. Importado PRIMEIRO pelo `index.ts` (módulos são avaliados na ordem
 * dos imports), antes de qualquer esquema.
 */
z.config({ jitless: true });
