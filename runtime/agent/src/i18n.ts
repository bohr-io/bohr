import type { Locale } from '@bohr/shared';

// Every line the runner writes for the user. The agent writes its own messages in the user's language.

const en = {
  preparing: 'Preparing the repository',
  editing: 'Editing {path}',
  reading: 'Reading {path}',
  running: 'Running: {command}',
  searching: 'Searching {pattern}',
  webSearch: 'Searching the web: {query}',
  webFetch: 'Opening {url}',
  delegating: 'Delegating: {task}',
  using: 'Using {tool}',
  publishing: 'Publishing the changes to the preview',
  done: 'Done.',
  failedBudget: 'The request reached its limit before the work was done. Nothing was changed.',
  failedTurns: 'The request needed more steps than allowed, so it was stopped. Nothing was changed.',
  failedError: 'Something went wrong, so the request was stopped. Nothing was changed.',
  cancelled: 'The request was cancelled. Nothing was changed.',
  workflowsLeftOut: 'Changes to GitHub Actions workflows were left out, because this request may not edit them.',
};

export type MessageKey = keyof typeof en;

const messages: Record<Locale, Record<MessageKey, string>> = {
  en,
  'pt-BR': {
    preparing: 'Preparando o repositório',
    editing: 'Editando {path}',
    reading: 'Lendo {path}',
    running: 'Executando: {command}',
    searching: 'Buscando {pattern}',
    webSearch: 'Pesquisando na web: {query}',
    webFetch: 'Abrindo {url}',
    delegating: 'Delegando: {task}',
    using: 'Usando {tool}',
    publishing: 'Publicando as alterações na homologação',
    done: 'Pronto.',
    failedBudget: 'O pedido chegou ao limite antes de o trabalho terminar. Nada foi alterado.',
    failedTurns: 'O pedido precisou de mais passos do que o permitido e foi interrompido. Nada foi alterado.',
    failedError: 'Algo deu errado e o pedido foi interrompido. Nada foi alterado.',
    cancelled: 'O pedido foi cancelado. Nada foi alterado.',
    workflowsLeftOut:
      'As alterações nos workflows do GitHub Actions ficaram de fora, porque este pedido não pode editá-los.',
  },
  es: {
    preparing: 'Preparando el repositorio',
    editing: 'Editando {path}',
    reading: 'Leyendo {path}',
    running: 'Ejecutando: {command}',
    searching: 'Buscando {pattern}',
    webSearch: 'Buscando en la web: {query}',
    webFetch: 'Abriendo {url}',
    delegating: 'Delegando: {task}',
    using: 'Usando {tool}',
    publishing: 'Publicando los cambios en la vista previa',
    done: 'Listo.',
    failedBudget: 'La solicitud llegó a su límite antes de terminar el trabajo. No se cambió nada.',
    failedTurns: 'La solicitud necesitó más pasos de los permitidos y se detuvo. No se cambió nada.',
    failedError: 'Algo salió mal y la solicitud se detuvo. No se cambió nada.',
    cancelled: 'La solicitud fue cancelada. No se cambió nada.',
    workflowsLeftOut:
      'Los cambios en los workflows de GitHub Actions se dejaron fuera, porque esta solicitud no puede editarlos.',
  },
};

/** A message in the user's language, with {placeholders} filled in. */
export function t(locale: Locale, key: MessageKey, values: Record<string, string> = {}): string {
  return messages[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}
