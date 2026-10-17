// A simulated project runtime for the demo: the conversation, the request queue, the preview
// ("homologação") and the releases of one project, with the shapes of @bohr/shared's runtime API. Requests
// run one at a time: a progress line or two, then the agent's "done" entry and a new preview version.
import type { ChatEntry, MemberView, ProjectState, RequestView } from '@bohr/shared';
import type { Invite, MessagesPage, ProjectSettings, SettingsPatch, Submitted } from '../src/api.ts';

export interface Person {
  key: string;
  name: string;
}

/** An error the runtime would answer: `{ error: code, message }`. */
export class RuntimeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Release = ProjectState['releases'][number];

/** How a simulated request unfolds. */
interface Script {
  progress: string[];
  /** The agent's last message. */
  done: string;
  /** One line for the preview's list of changes. */
  summary: string;
  /** Milliseconds between steps. */
  stepMs: number;
}

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const sha = () => Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

export class DemoAgent {
  readonly state: ProjectState;
  readonly entries: ChatEntry[] = [];
  members: MemberView[];
  /** Scripts of requests that did not run yet, by request id. */
  private scripts = new Map<string, Script>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private nextRequest = 1;
  private nextPullRequest: number;
  /** The seeded request starts moving when someone first looks at the project. */
  private started = false;

  constructor(
    state: ProjectState,
    members: MemberView[],
    private readonly owner: Person,
    options: { nextPullRequest?: number } = {},
  ) {
    this.state = state;
    this.members = members;
    this.nextPullRequest = options.nextPullRequest ?? 1;
  }

  // Seeding

  add(entry: Omit<ChatEntry, 'seq' | 'actions' | 'options'> & Partial<Pick<ChatEntry, 'actions' | 'options'>>) {
    const seq = (this.entries.at(-1)?.seq ?? 0) + 1;
    const full: ChatEntry = { actions: [], options: [], ...entry, seq };
    this.entries.push(full);
    return full;
  }

  request(id: string, text: string, author: Person, extra: Partial<RequestView> = {}): RequestView {
    return {
      id,
      status: 'queued',
      text,
      author,
      source: 'web',
      createdAt: iso(),
      startedAt: null,
      finishedAt: null,
      summary: null,
      costUsd: null,
      progress: null,
      ...extra,
    };
  }

  /** How a seeded request (already in `current` or `queue`) goes on. */
  script(requestId: string, script: Script) {
    this.scripts.set(requestId, script);
  }

  // Reads

  messages(after: number, limit: number): MessagesPage {
    return {
      messages: this.entries.filter((entry) => entry.seq > after).slice(0, limit),
      last: this.entries.at(-1)?.seq ?? 0,
    };
  }

  /** The state, with the time-based changes applied; the first read sets the seeded request going. */
  view(): ProjectState {
    if (!this.started) {
      this.started = true;
      if (this.state.current !== null) this.continueCurrent();
      else this.startNext();
    }
    return this.state;
  }

  // Writes

  send(text: string, author: Person): Submitted {
    const trimmed = text.trim();
    if (trimmed === '') throw new RuntimeError(400, 'invalid_request', 'Escreva uma mensagem.');
    const { id, position } = this.enqueue(trimmed, author, scriptFor(trimmed));
    return {
      requestId: id,
      message:
        position <= 1
          ? 'Recebido! Já estou trabalhando nisso.'
          : `Recebido! Seu pedido está na fila (posição ${position}).`,
    };
  }

  private enqueue(text: string, author: Person, script: Script) {
    const id = `r${Date.now().toString(36)}${this.nextRequest++}`;
    this.add({ at: iso(), kind: 'user', requestId: id, author, text });
    this.state.queue.push(this.request(id, text, author));
    this.scripts.set(id, script);
    const position = this.state.queue.length + (this.state.current === null ? 0 : 1);
    this.startNext();
    return { id, position };
  }

  answer(requestId: string, option: number | undefined, author: Person): Submitted {
    const question = [...this.entries]
      .reverse()
      .find((entry) => entry.requestId === requestId && entry.actions.includes('answer'));
    const choice = option === undefined ? undefined : question?.options[option];
    if (question === undefined || choice === undefined) {
      throw new RuntimeError(409, 'not_waiting', 'Esta pergunta já foi respondida.');
    }
    question.actions = [];
    const { id } = this.enqueue(choice, author, {
      progress: ['Retomando de onde parei', 'Aplicando a cor escolhida'],
      done: `Pronto! Usei a opção “${choice}”.`,
      summary: `Ajuste com a opção “${choice}”`,
      stepMs: 1_000,
    });
    return { requestId: id, message: 'Resposta enviada. O agente continua de onde parou.' };
  }

  cancel(requestId: string, by: Person): { message: string } {
    const queued = this.state.queue.findIndex((request) => request.id === requestId);
    if (queued !== -1) {
      this.state.queue.splice(queued, 1);
    } else if (this.state.current?.id === requestId) {
      this.clearTimers();
      this.state.current = null;
    } else {
      throw new RuntimeError(409, 'not_running', 'Este pedido já terminou.');
    }
    this.add({ at: iso(), kind: 'system', requestId, author: null, text: `${by.name} cancelou o pedido.` });
    this.startNext();
    return { message: 'Pedido cancelado.' };
  }

  decide(action: 'approve' | 'discard', version: number, by: Person): { message: string } {
    const homolog = this.state.homolog;
    if (homolog.status !== 'pending') {
      throw new RuntimeError(409, 'nothing_to_review', 'A homologação não tem mudanças para revisar.');
    }
    if (version !== homolog.version) {
      throw new RuntimeError(409, 'stale_version', 'A homologação mudou desde que você olhou. Confira a versão nova.');
    }
    if (action === 'discard') {
      homolog.status = 'clean';
      homolog.changes = [];
      homolog.version += 1;
      homolog.headSha = sha();
      this.add({
        at: iso(),
        kind: 'system',
        requestId: null,
        author: null,
        text: `${by.name} descartou as mudanças da homologação.`,
      });
      return { message: 'Mudanças descartadas. A homologação voltou a ser igual à produção.' };
    }

    homolog.status = 'publishing';
    const summary = homolog.changes.map((change) => change.summary).join('; ');
    const release: Release = {
      id: `rel_${Date.now().toString(36)}`,
      status: 'deploying',
      pullRequest: this.nextPullRequest++,
      commitSha: homolog.headSha,
      createdAt: iso(),
      summary: summary || 'Mudanças da homologação',
    };
    this.add({
      at: iso(),
      kind: 'system',
      requestId: null,
      author: null,
      text: `${by.name} aprovou a versão ${version}. Publicando em produção…`,
    });
    this.later(3_000, () => {
      this.state.releases.unshift(release);
      homolog.status = 'clean';
      homolog.changes = [];
      this.add({
        at: iso(),
        kind: 'system',
        requestId: null,
        author: null,
        text: `Pull request #${release.pullRequest} mesclado. O deploy de produção começou.`,
      });
    });
    this.later(9_000, () => {
      release.status = 'live';
      this.add({
        at: iso(),
        kind: 'system',
        requestId: null,
        author: null,
        text: 'Publicado! A nova versão já está em produção.',
      });
    });
    return { message: 'Aprovado! Publicando em produção…' };
  }

  rollback(by: Person): { message: string } {
    const target = this.state.releases.find(
      (release) => (release.status === 'live' || release.status === 'deploying') && release.pullRequest !== null,
    );
    if (target === undefined) throw new RuntimeError(409, 'nothing_to_roll_back', 'Não há publicação para desfazer.');
    target.status = 'rolled_back';
    const release: Release = {
      id: `rel_${Date.now().toString(36)}`,
      status: 'deploying',
      pullRequest: null,
      commitSha: sha(),
      createdAt: iso(),
      summary: `Reversão de “${target.summary}”`,
    };
    this.state.releases.unshift(release);
    this.add({
      at: iso(),
      kind: 'system',
      requestId: null,
      author: null,
      text: `${by.name} desfez a publicação do pull request #${target.pullRequest}.`,
    });
    this.later(6_000, () => {
      release.status = 'live';
    });
    return { message: 'Desfazendo a última publicação…' };
  }

  invite(): Invite {
    const part = () => Math.random().toString(36).slice(2, 6).toUpperCase();
    return { code: `${part()}-${part()}`, expiresAt: iso(Date.now() + 24 * 60 * 60 * 1000) };
  }

  revoke(key: string, by: Person): { revoked: boolean } {
    const member = this.members.find((candidate) => candidate.key === key);
    if (member === undefined) throw new RuntimeError(404, 'not_found', 'Membro não encontrado.');
    if (member.role === 'owner') throw new RuntimeError(409, 'cannot_revoke_owner', 'O dono não pode ser removido.');
    this.members = this.members.filter((candidate) => candidate.key !== key);
    this.add({
      at: iso(),
      kind: 'system',
      requestId: null,
      author: null,
      text: `${by.name} removeu ${member.name} do projeto.`,
    });
    return { revoked: true };
  }

  updateSettings(patch: SettingsPatch): ProjectSettings {
    const settings = this.state.settings;
    if (patch.model !== undefined) settings.model = patch.model;
    if (patch.maxBudgetUsd !== undefined) settings.maxBudgetUsd = patch.maxBudgetUsd;
    if (patch.maxTurns !== undefined) settings.maxTurns = patch.maxTurns;
    if (patch.locale !== undefined) settings.locale = patch.locale;
    return settings;
  }

  /** The agent's first run, after the project is created. */
  startImport(): Submitted {
    const id = `import${this.nextRequest++}`;
    this.state.queue.push(this.request(id, 'Preparar o repositório para a bohr', this.owner, { source: 'web' }));
    this.scripts.set(id, {
      progress: ['Lendo o repositório', 'Conferindo o build'],
      done: 'Conheci o projeto! Pode me pedir mudanças por aqui ou pelo bot no Telegram.',
      summary: '',
      stepMs: 1_500,
    });
    this.startNext();
    return { requestId: id, message: 'O agente está conhecendo o projeto.' };
  }

  stop() {
    this.clearTimers();
  }

  // The simulation

  private later(ms: number, run: () => void) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, ms);
    this.timers.add(timer);
  }

  private clearTimers() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private startNext() {
    if (this.state.current !== null) return;
    const next = this.state.queue.shift();
    if (next === undefined) return;
    next.status = 'running';
    next.startedAt = iso();
    this.state.current = next;
    this.run(next, 0);
  }

  private continueCurrent() {
    const current = this.state.current;
    if (current === null) return;
    const script = this.scripts.get(current.id);
    // The seeded request already showed its first progress line.
    this.run(current, script === undefined ? 0 : 1);
  }

  private run(request: RequestView, step: number) {
    const script = this.scripts.get(request.id) ?? scriptFor(request.text);
    const line = script.progress[step];
    const delay = step === 0 ? 900 : script.stepMs;
    this.later(delay, () => {
      if (this.state.current?.id !== request.id) return;
      if (line !== undefined) {
        request.progress = line;
        this.add({ at: iso(), kind: 'progress', requestId: request.id, author: null, text: line });
        this.run(request, step + 1);
        return;
      }
      this.finish(request, script);
    });
  }

  private finish(request: RequestView, script: Script) {
    request.status = 'succeeded';
    request.finishedAt = iso();
    request.progress = null;
    request.summary = script.summary;
    request.costUsd = Math.round((0.15 + Math.random() * 0.6) * 100) / 100;
    this.state.current = null;
    const homolog = this.state.homolog;
    if (script.summary !== '') {
      homolog.version += 1;
      homolog.headSha = sha();
      homolog.changes.push({ requestId: request.id, summary: script.summary });
      if (homolog.status === 'clean') homolog.status = 'pending';
    }
    this.add({
      at: iso(),
      kind: 'agent',
      requestId: request.id,
      author: null,
      text: script.summary === '' ? script.done : `${script.done} (homologação, versão ${homolog.version})`,
      actions: script.summary === '' ? [] : ['approve', 'discard'],
    });
    this.scripts.delete(request.id);
    this.startNext();
  }
}

/** A plausible run for any message. */
function scriptFor(text: string): Script {
  const short = text.length > 80 ? `${text.slice(0, 77)}…` : text;
  return {
    progress: ['Lendo os arquivos do projeto', 'Editando os componentes e rodando o build'],
    done: `Pronto! Fiz o que você pediu: “${short}”. Confira na homologação e me diga se quer publicar.`,
    summary: short,
    stepMs: 1_000,
  };
}
