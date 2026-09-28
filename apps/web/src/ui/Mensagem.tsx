"use client";

/**
 * Feedback junto da ação que o gerou (auditoria UX, P0 item 4): cada botão que grava ou processa
 * tem a sua própria mensagem, na mesma seção, e as mensagens não se sobrescrevem entre si.
 * Sucesso e informação usam `role="status"`; erro usa `role="alert"`.
 */
export interface MensagemLocal {
  tipo: "info" | "ok" | "erro";
  texto: string;
  /** Hora da gravação ("Salvo ✓ 14:32"); ausente em mensagens que não gravam nada. */
  hora?: string;
  /** Atributos extras para o e2e ler identificadores sem mostrá-los (ex.: data-malha-id). */
  dados?: Record<`data-${string}`, string>;
}

export const horaAgora = (): string => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function Mensagem({ msg, naoSalvo = false, testId }: { msg: MensagemLocal | null; naoSalvo?: boolean; testId?: string }) {
  if (!msg) return null;
  const erro = msg.tipo === "erro";
  return (
    <p className={`mensagem-local mensagem-${msg.tipo}`} role={erro ? "alert" : "status"} data-testid={testId} {...(msg.dados ?? {})}>
      {msg.texto}
      {msg.hora && <span className="mensagem-hora"> · {msg.hora}</span>}
      {naoSalvo && <span className="nao-salvo"> · alterações não salvas</span>}
    </p>
  );
}
