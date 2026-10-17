import type { Locale } from '@bohr/shared';

// What the platform bot (onboarding) says, in the user's language.

const ptBR = {
  welcome:
    'Olá, {name}! Eu sou o bot da sua instância bohr. Primeiro conecto suas contas; depois você cria projetos com /novo e pede mudanças no site conversando com o bot de cada projeto.',
  linked: 'Pronto: este Telegram agora está ligado à sua conta da bohr na web.',
  linkInvalid: 'Este link expirou. Gere outro na interface web.',
  confirmLink: 'Vincular este Telegram à conta da bohr {account}? Só confirme se a conta for sua.',
  confirmLinkButton: 'Vincular',
  cancelButton: 'Cancelar',
  linkCancelled: 'Nada foi vinculado.',
  askSubscription:
    'O bohr.io Cloud custa US$20 por mês: a bohr opera a instância, e os seus projetos rodam na sua própria conta da Cloudflare. Assine para continuar e, quando terminar, toque em "Já assinei".',
  notSubscribedYet:
    'Ainda não encontrei a sua assinatura. Se você acabou de pagar, espere alguns segundos e toque de novo em "Já assinei".',
  payButton: 'Assinar (US$20/mês)',
  paidButton: 'Já assinei',
  askCloudflare:
    '1/2 · Cloudflare\nCrie um token de API com este link e me mande o token aqui (vou apagar a mensagem em seguida):\n{url}\n\nUma conta gratuita basta. Com o plano Workers Paid e a permissão "Containers: Edit" (o link não a preenche), o agente roda na sua própria conta.',
  cloudflareMissing: 'O token não tem estas permissões: {missing}. Ajuste o token e mande de novo.',
  chooseAccount: 'Este token vê mais de uma conta. Qual delas vai rodar seus projetos?',
  cloudflareConnected: 'Cloudflare conectada ({account}).',
  askGithub:
    '2/2 · GitHub\nInstale o GitHub App da instância nos repositórios que a bohr pode usar. Quando terminar, toque em "Já instalei".',
  installButton: 'Instalar o GitHub App',
  installedButton: 'Já instalei',
  noRepositories:
    'Ainda não vejo nenhum repositório. Instale o App (ou dê acesso a um repositório) e toque em "Já instalei".',
  chooseRepository: 'Qual repositório vira um projeto na bohr?',
  moreButton: 'Mais…',
  provisioning: 'Preparando {repo} na sua conta da Cloudflare. Isso leva de 1 a 3 minutos; eu aviso quando terminar.',
  provisionFailed: 'Não consegui preparar o projeto: {error}\nMande /tentar para tentar de novo.',
  onboardingDone:
    'Tudo configurado! Mande /novo para escolher o repositório do seu primeiro projeto. Para o agente trabalhar, escolha o modelo dele em Conta › Agente na interface web.',
  provisionedAgentWorking:
    '{repo} está pronto na sua conta da Cloudflare, e o agente já está preparando o repositório para o primeiro deploy.',
  provisionedNoAgent:
    '{repo} está pronto na sua conta da Cloudflare. Para o agente começar, configure-o em Conta › Agente na interface web.',
  agentUnavailable:
    '{repo} virou um projeto: os deploys do GitHub já publicam o site na sua conta da Cloudflare. O agente fica para depois: a sandbox dele é um Container, que precisa do plano Workers Paid e da permissão "Containers: Edit" no token. Depois de ativar, abra o projeto na interface web para ligar o agente.',
  projectBotSkipped: 'Tudo bem. Você acompanha o projeto pela interface web e pode criar o bot depois.',
  askProjectBot:
    'Quer um bot do Telegram só para este projeto? Toque no botão abaixo e confirme no Telegram; eu cuido do resto. Para não criar agora, mande /pular.',
  askProjectBotManual:
    'Quer um bot do Telegram só para este projeto? Crie no @BotFather (/newbot) e me mande o token que ele der. Para não criar agora, mande /pular.',
  createBotButton: 'Criar o bot do projeto',
  done: 'Tudo pronto! Converse com @{bot} para pedir mudanças. Já pedi ao agente para preparar o repositório; ele avisa por lá quando a primeira homologação estiver pronta.',
  doneNoAgent:
    'Tudo pronto! O bot do projeto é @{bot}. Para o agente trabalhar, configure-o em Conta › Agente na interface web.',
  status: 'Seus projetos:\n{list}',
  noProjects: 'Você ainda não tem projetos. Mande /novo para criar um.',
  help: 'Comandos: /novo cria um projeto, /status lista seus projetos, /tentar refaz o último passo que falhou.',
  notConfigured: 'Esta instância ainda não foi configurada. Peça ao administrador para concluir o /setup.',
  invalidInput: 'Não entendi. {hint}',
  error: 'Algo deu errado: {error}',
};

type Messages = typeof ptBR;
export type PlatformMessage = keyof Messages;

const en: Messages = {
  welcome:
    "Hi, {name}! I'm your bohr instance's bot. First I connect your accounts; then you create projects with /new and change each site by chatting with its bot.",
  linked: 'Done: this Telegram account is now linked to your bohr account on the web.',
  linkInvalid: 'This link expired. Create another one in the web interface.',
  confirmLink: 'Link this Telegram account to the bohr account {account}? Only confirm if it is yours.',
  confirmLinkButton: 'Link',
  cancelButton: 'Cancel',
  linkCancelled: 'Nothing was linked.',
  askSubscription:
    'bohr.io Cloud costs US$20 per month: bohr runs the instance, and your projects run in your own Cloudflare account. Subscribe to continue and, when you are done, tap "I subscribed".',
  notSubscribedYet:
    'I could not find your subscription yet. If you just paid, wait a few seconds and tap "I subscribed" again.',
  payButton: 'Subscribe (US$20/month)',
  paidButton: 'I subscribed',
  askCloudflare:
    '1/2 · Cloudflare\nCreate an API token with this link and send it to me here (I will delete the message right away):\n{url}\n\nA free account is enough. With the Workers Paid plan and the "Containers: Edit" permission (the link cannot prefill it), the agent runs in your own account.',
  cloudflareMissing: 'The token lacks these permissions: {missing}. Fix the token and send it again.',
  chooseAccount: 'This token sees more than one account. Which one should run your projects?',
  cloudflareConnected: 'Cloudflare connected ({account}).',
  askGithub:
    '2/2 · GitHub\nInstall the instance\'s GitHub App on the repositories bohr may use. When you are done, tap "I installed it".',
  installButton: 'Install the GitHub App',
  installedButton: 'I installed it',
  noRepositories:
    'I don\'t see any repository yet. Install the App (or grant it a repository) and tap "I installed it".',
  chooseRepository: 'Which repository becomes a bohr project?',
  moreButton: 'More…',
  provisioning:
    'Setting up {repo} in your Cloudflare account. It takes 1 to 3 minutes; I will tell you when it is done.',
  provisionFailed: "I couldn't set up the project: {error}\nSend /retry to try again.",
  onboardingDone:
    'All set! Send /new to pick the repository of your first project. For the agent to work, choose its model in Account › Agent in the web interface.',
  provisionedAgentWorking:
    '{repo} is ready in your Cloudflare account, and the agent is already preparing the repository for the first deploy.',
  provisionedNoAgent:
    '{repo} is ready in your Cloudflare account. For the agent to start, set it up in Account › Agent in the web interface.',
  agentUnavailable:
    '{repo} is now a project: GitHub deploys already publish the site to your Cloudflare account. The agent waits: its sandbox is a Container, which needs the Workers Paid plan and the "Containers: Edit" permission on the token. Once you have them, open the project in the web interface to turn the agent on.',
  projectBotSkipped: 'Fine. You follow the project in the web interface and can create the bot later.',
  askProjectBot:
    "Want a Telegram bot just for this project? Tap the button below and confirm in Telegram; I'll do the rest. To skip it for now, send /skip.",
  askProjectBotManual:
    'Want a Telegram bot just for this project? Create it with @BotFather (/newbot) and send me the token it gives you. To skip it for now, send /skip.',
  createBotButton: "Create the project's bot",
  done: 'All set! Talk to @{bot} to ask for changes. I already asked the agent to prepare the repository; it will tell you there when the first preview is ready.',
  doneNoAgent:
    'All set! The project bot is @{bot}. For the agent to work, set it up in Account › Agent in the web interface.',
  status: 'Your projects:\n{list}',
  noProjects: "You don't have projects yet. Send /new to create one.",
  help: 'Commands: /new creates a project, /status lists your projects, /retry repeats the last step that failed.',
  notConfigured: 'This instance is not set up yet. Ask the administrator to finish /setup.',
  invalidInput: "I didn't understand. {hint}",
  error: 'Something went wrong: {error}',
};

const es: Messages = {
  welcome:
    '¡Hola, {name}! Soy el bot de tu instancia de bohr. Primero conecto tus cuentas; luego creas proyectos con /new y cambias cada sitio conversando con el bot del proyecto.',
  linked: 'Listo: esta cuenta de Telegram ya está vinculada a tu cuenta de bohr en la web.',
  linkInvalid: 'Este enlace venció. Genera otro en la interfaz web.',
  confirmLink: '¿Vincular esta cuenta de Telegram a la cuenta de bohr {account}? Confirma solo si es tuya.',
  confirmLinkButton: 'Vincular',
  cancelButton: 'Cancelar',
  linkCancelled: 'No se vinculó nada.',
  askSubscription:
    'bohr.io Cloud cuesta US$20 al mes: bohr opera la instancia y tus proyectos se ejecutan en tu propia cuenta de Cloudflare. Suscríbete para continuar y, cuando termines, toca "Ya me suscribí".',
  notSubscribedYet:
    'Todavía no encuentro tu suscripción. Si acabas de pagar, espera unos segundos y toca de nuevo "Ya me suscribí".',
  payButton: 'Suscribirme (US$20/mes)',
  paidButton: 'Ya me suscribí',
  askCloudflare:
    '1/2 · Cloudflare\nCrea un token de API con este enlace y envíamelo aquí (borraré el mensaje enseguida):\n{url}\n\nUna cuenta gratuita es suficiente. Con el plan Workers Paid y el permiso "Containers: Edit" (el enlace no lo completa), el agente se ejecuta en tu propia cuenta.',
  cloudflareMissing: 'Al token le faltan estos permisos: {missing}. Corrígelo y envíalo de nuevo.',
  chooseAccount: 'Este token ve más de una cuenta. ¿Cuál ejecutará tus proyectos?',
  cloudflareConnected: 'Cloudflare conectada ({account}).',
  askGithub:
    '2/2 · GitHub\nInstala la GitHub App de la instancia en los repositorios que bohr puede usar. Cuando termines, toca "Ya la instalé".',
  installButton: 'Instalar la GitHub App',
  installedButton: 'Ya la instalé',
  noRepositories:
    'Todavía no veo ningún repositorio. Instala la App (o dale acceso a un repositorio) y toca "Ya la instalé".',
  chooseRepository: '¿Qué repositorio se convierte en un proyecto de bohr?',
  moreButton: 'Más…',
  provisioning: 'Preparando {repo} en tu cuenta de Cloudflare. Tarda de 1 a 3 minutos; te aviso cuando termine.',
  provisionFailed: 'No pude preparar el proyecto: {error}\nEnvía /retry para intentarlo de nuevo.',
  onboardingDone:
    '¡Todo configurado! Envía /new para elegir el repositorio de tu primer proyecto. Para que el agente trabaje, elige su modelo en Cuenta › Agente en la interfaz web.',
  provisionedAgentWorking:
    '{repo} está listo en tu cuenta de Cloudflare, y el agente ya está preparando el repositorio para el primer deploy.',
  provisionedNoAgent:
    '{repo} está listo en tu cuenta de Cloudflare. Para que el agente empiece, configúralo en Cuenta › Agente en la interfaz web.',
  agentUnavailable:
    '{repo} ya es un proyecto: los deploys de GitHub publican el sitio en tu cuenta de Cloudflare. El agente queda para después: su sandbox es un Container, que necesita el plan Workers Paid y el permiso "Containers: Edit" en el token. Cuando los tengas, abre el proyecto en la interfaz web para activar el agente.',
  projectBotSkipped: 'De acuerdo. Sigues el proyecto en la interfaz web y puedes crear el bot más tarde.',
  askProjectBot:
    '¿Quieres un bot de Telegram solo para este proyecto? Toca el botón de abajo y confirma en Telegram; yo hago el resto. Para no crearlo ahora, envía /skip.',
  askProjectBotManual:
    '¿Quieres un bot de Telegram solo para este proyecto? Créalo en @BotFather (/newbot) y envíame el token que te dé. Para no crearlo ahora, envía /skip.',
  createBotButton: 'Crear el bot del proyecto',
  done: '¡Todo listo! Habla con @{bot} para pedir cambios. Ya le pedí al agente que prepare el repositorio; te avisará allí cuando la primera versión de prueba esté lista.',
  doneNoAgent:
    '¡Todo listo! El bot del proyecto es @{bot}. Para que el agente trabaje, configúralo en Cuenta › Agente en la interfaz web.',
  status: 'Tus proyectos:\n{list}',
  noProjects: 'Todavía no tienes proyectos. Envía /new para crear uno.',
  help: 'Comandos: /new crea un proyecto, /status lista tus proyectos, /retry repite el último paso que falló.',
  notConfigured: 'Esta instancia aún no está configurada. Pide al administrador que termine el /setup.',
  invalidInput: 'No entendí. {hint}',
  error: 'Algo salió mal: {error}',
};

const MESSAGES: Record<Locale, Messages> = { 'pt-BR': ptBR, en, es };

export function pt(locale: Locale, key: PlatformMessage, params: Record<string, string | number> = {}): string {
  return MESSAGES[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export const PLATFORM_COMMANDS: Record<string, string> = {
  start: 'start',
  novo: 'new',
  new: 'new',
  nuevo: 'new',
  status: 'status',
  estado: 'status',
  tentar: 'retry',
  retry: 'retry',
  reintentar: 'retry',
  pular: 'skip',
  skip: 'skip',
  omitir: 'skip',
  ajuda: 'help',
  help: 'help',
  ayuda: 'help',
};
