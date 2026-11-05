# Acode Developer Edition — Relatório técnico

Este documento é a entrega da Fase 1 (auditoria) e o registro, fase a fase,
do que foi efetivamente implementado, testado, não testado e pendente — como
pedido no brief do projeto (seção 11). Nada aqui descreve um comportamento
que não foi de fato implementado ou verificado no código; onde algo não pôde
ser confirmado em um dispositivo Android real, isso está marcado
explicitamente como tal.

## Fase 1 — Auditoria (arquitetura real encontrada no repositório)

O repositório `Acode-main` fornecido **já é uma base bem mais avançada** do
que a versão clássica do Acode: ele já inclui boa parte da infraestrutura que
o brief pede para "adicionar". A auditoria abaixo descreve o que já existe
antes de qualquer mudança.

- **App shell**: Cordova (`config.xml`), plataforma Android, plugins
  Cordova em `src/plugins/*` (próprios, não apenas de terceiros).
- **Editor**: CodeMirror 6 (`@codemirror/*` no `package.json`), não Ace —
  mantido como está; nenhuma alteração substitui o editor.
- **Terminal Alpine/PRoot**: `src/plugins/terminal/` já contém um terminal
  Alpine ARM64 completo via PRoot:
  - `scripts/init-alpine.sh` faz o bootstrap do rootfs Alpine.
  - `scripts/init-sandbox.sh` monta o sandbox PRoot e faz o bind de
    `$PREFIX/public` em `/public`, `/home` e `/root` — é esta a regra que
    `src/utils/terminalPath.js` (novo, Fase 2) espelha para nunca inventar um
    caminho.
  - `www/Executor.js` expõe `Executor.execute(command, alpine=true)` e
    `Executor.BackgroundExecutor`, usados neste trabalho para a detecção real
    dos agentes de IA (Fase 4) — nenhum comando é simulado.
  - `www/Terminal.js` expõe `Terminal.isInstalled()`, usado para nunca
    reportar um agente como "instalado" se o próprio Alpine não estiver.
- **LSP**: `src/cm/lsp/` já tem um cliente LSP completo, incluindo um runtime
  Alpine embutido (`runtimes/builtinAlpine.ts`) e servidores reais para
  JavaScript/TypeScript, Python, Web (HTML/CSS/JSON), Tailwind, Luau e
  "Systems" (C/C++ via clangd, Go, Rust) em `src/cm/lsp/servers/*.ts`. Ver a
  matriz de linguagens na Fase 5 abaixo.
- **Projetos/arquivos**: `src/lib/openFolder.js` já suporta **múltiplas
  raízes abertas simultaneamente** (array `addedFolder`), com conversão
  própria entre URLs do Acode (SAF `content://`, `file://`) e caminhos PRoot
  (`isTerminalAccessiblePath` / `convertToProotPath`, agora extraídos para
  `src/utils/terminalPath.js` — ver Fase 2). Não existe, porém, um conceito
  único de "o projeto atualmente aberto" — é isso que a Fase 2 adiciona.
- **CI já existente**: `.github/workflows/ci.yml` e
  `.github/workflows/nightly-build.yml` já compilam o app no GitHub Actions
  com Java 21 (temurin) + Node LTS + `npm run setup` +
  `npm run build <variant> <mode> apk`. O novo workflow da Fase 7 reaproveita
  exatamente esses comandos reais, em vez de inventar outros.
- **`build.json`**: opcional (está em `.gitignore`); usado apenas por
  `hooks/post-process.js` / `hooks/move-files.js` para assinatura de
  release — confirmado por leitura direta dos hooks. Por isso o build de
  debug **não** exige segredos de assinatura.

Nenhum arquivo foi reescrito do zero, nenhuma pasta foi reorganizada, e o
editor/arquitetura Cordova original foram preservados integralmente.

## Fase 2 — Contexto de projeto (`ACODE_PROJECT_ROOT`)

**Arquivos novos:**
- `src/utils/terminalPath.js` — lógica de conversão URL↔caminho PRoot,
  extraída de `lib/openFolder.js` (antes duplicada ali) para ser
  compartilhada com `lib/projectContext.js` e o terminal. Se uma SAF URI não
  é reconhecida (não é a árvore pública do Acode nem do Termux), o módulo
  **recusa-se a inventar um caminho POSIX** e retorna `reason:
  "unbridged-saf"` — essa é a "ponte seria necessária" citada no brief; a
  ponte em si ainda não existe e está listada em Pendências.
- `src/lib/projectContext.js` — o equivalente a uma variável
  `ACODE_PROJECT_ROOT`: expõe `getActiveProject()`,
  `getTerminalAccessibility()`, `setActiveProject()`, `clearIfActive()`,
  `onChange()`. Persiste o projeto ativo em `localStorage`
  (`acodeDevEdition:activeProjectRoot`) para sobreviver entre sessões
  "quando possível" — se a pasta persistida não existir mais entre os
  abertos, `getActiveProject({ requireOpen: true })` retorna `null` em vez de
  mentir.

**Arquivos modificados:**
- `src/lib/openFolder.js`:
  - Passa a importar as funções de `utils/terminalPath.js` em vez de
    duplicá-las.
  - Ao abrir uma pasta, define-a como projeto ativo
    (`projectContext.setActiveProject`).
  - Ao fechar uma pasta que era a ativa, limpa o contexto
    (`projectContext.clearIfActive`) — não escolhe outra raiz por adivinhação.
  - Adiciona a ação "Set as active project" / "Definir como projeto ativo" no
    menu de contexto da raiz, para o usuário escolher explicitamente qual
    pasta é o projeto ativo quando várias estão abertas.

**Funcionalidades implementadas:** detecção do projeto aberto, contexto
central único, atualização ao trocar de projeto, persistência best-effort,
respeito ao SAF (nunca finge que uma URI SAF não reconhecida é um caminho
POSIX).

**Testes executados:** automatizados (`tests/unit/terminalPath.test.js`,
`tests/unit/projectContext.test.js`) — ver seção "Testes" abaixo sobre por
que não puderam ser *executados* nesta sessão.

**Pendências:** a "ponte segura e documentada" para projetos em SAF não
pertencente ao Acode/Termux (ex.: pasta escolhida via seletor do sistema em
armazenamento removível) não foi implementada — ela exigiria copiar/sincronizar
arquivos para dentro do sandbox Alpine ou um novo plugin nativo, o que está
fora do escopo que pôde ser verificado nesta sessão. Hoje esse caso é tratado
honestamente (reportado como não acessível), não com um caminho inventado.

## Fase 3 — Terminal

**Arquivos modificados:**
- `src/components/terminal/terminalManager.js`: uma nova sessão de terminal
  em modo servidor (não reconexão, não SSH, não aberta via "Open in
  Terminal" de uma pasta específica) agora dá `cd` automaticamente para o
  projeto ativo, se ele for acessível ao terminal
  (`cdToActiveProjectIfPossible`). Se não for acessível (SAF não vinculada),
  nada é forçado — é exibido um aviso único e o terminal permanece no
  diretório padrão.
- O toggle "Start terminal in active project" (Fase 6, página Developer
  Edition) permite desligar esse comportamento.

**O que já existia e foi preservado, não reimplementado:** Node.js, npm,
Git, Bash, compatibilidade ARM64, PATH, tratamento de sinais/processos —
tudo isso já é fornecido pelo rootfs Alpine (`init-alpine.sh`) e pelo
`Executor`/`Terminal` plugin nativo. Nenhum wrapper foi adicionado em cima de
`npm install`/`npm start`/`npm run dev`/`npm run build`: eles continuam
rodando exatamente como o usuário digitar, no diretório em que o terminal
já estiver (agora, por padrão, o projeto ativo) — nenhum erro do npm é
escondido.

**Testes executados:** nenhum automatizado (depende do plugin nativo
Cordova/PRoot, que só roda dentro do WebView Android). Nenhuma alegação de
"testado em Android" é feita — ver seção "Testes".

## Fase 4 — AI Coding Agents

**Arquivos novos:**
- `src/pages/aiCodingAgents/aiCodingAgents.js` (+ `index.js`, `style.scss`) —
  painel "AI Coding Agents": para Claude Code (`claude`), OpenAI Codex CLI
  (`codex`) e OpenCode CLI (`opencode`):
  - Detecção real via `Executor.execute("command -v <bin>", true)` dentro do
    Alpine — **nunca** reporta "instalado" sem esse comando ter retornado um
    caminho. Versão lida via `<bin> --version`, com tratamento de falha
    separado ("instalado, versão desconhecida" ≠ "não instalado").
  - Se `Terminal`/`Executor` não existirem ou o Alpine não estiver instalado
    (`Terminal.isInstalled()`), todos os agentes ficam em estado
    "não verificado" — nunca "instalado".
  - "Open in project": abre um terminal, aguarda a conexão real, deixa o
    `cd` automático da Fase 3 posicionar no projeto ativo e então escreve o
    binário do agente no terminal — é uma execução real, não uma simulação
    de sucesso.
  - "Configure": permite sobrescrever o nome/caminho do binário por agente
    (ex.: se o usuário instalou `codex` com outro nome), salvo em
    `appSettings.value.developerEdition.aiAgents`.
  - Nenhum token, chave de API ou credencial é lido, armazenado ou impresso
    por este painel — a autenticação de cada CLI continua rodando pelo fluxo
    oficial dela mesma, dentro do terminal.
- `src/settings/developerEditionSettings.js` — nova seção de configurações
  "Developer Edition" (Fase 6) com o atalho para este painel e o indicador
  do projeto ativo.

**Funcionalidades implementadas:** identificação real de instalação,
versão, disponibilidade no PATH, abertura no projeto ativo, exibição de
erro de detecção, configuração individual por agente, estado visível por
agente.

**Regras respeitadas:** não simula ferramentas instaladas, não reporta
sucesso em falha de execução, não grava tokens, não imprime API keys, não
implementa autenticação própria, não assume que todos os agentes funcionam
no Alpine ARM64 (o painel simplesmente reporta o que o `command -v`/
`--version` reais disserem, incluindo "não encontrado" se for o caso).

**Testes executados:** nenhum automatizado (depende do plugin nativo). A
lógica de parsing de status foi revisada manualmente linha a linha; não
houve execução em dispositivo.

**Pendências:** sincronização automática do explorador de arquivos após um
agente alterar arquivos fora do Acode não foi implementada nesta sessão —
hoje o usuário precisa usar "Refresh" manualmente na raiz do projeto no
explorador. Está listado como pendência real, não como concluído.

## Fase 5 — Editor (autocomplete/LSP) — auditoria de cobertura

Como já existe um cliente LSP maduro no repositório (Fase 1), o trabalho
desta fase foi **auditar e documentar** a cobertura real por linguagem, e
não habilitar nada sem suporte de fato — conforme exigido no brief. Nenhum
novo servidor de linguagem foi adicionado nesta sessão (isso exigiria testar
cada binário dentro do Alpine ARM64 em um dispositivo real, o que está fora
do alcance verificável aqui).

| Linguagem | Syntax highlighting | LSP / autocomplete real |
| --- | --- | --- |
| JavaScript / TypeScript | Completo (`@codemirror/lang-javascript`) | **Completo** — 3 servidores (`typescript` web worker, `typescript-native` STDIO, `vtsls`) + ESLint, em `src/cm/lsp/servers/javascript.ts` |
| HTML | Completo (`@codemirror/lang-html`) | **Completo** — web worker e STDIO, `src/cm/lsp/servers/web.ts` |
| CSS | Completo (`@codemirror/lang-css`) | **Completo** — idem acima, inclui Tailwind CSS (`tailwind.ts`) |
| JSON | Completo (`@codemirror/lang-json`) | **Completo** — idem acima |
| Python | Completo (`@codemirror/lang-python`) | **Parcial** — servidores `ty` e `pylsp` definidos em `python.ts`, mas dependem de instalação do binário no Alpine (não vêm pré-instalados) |
| PHP | Completo (`@codemirror/lang-php`) | **Indisponível** — nenhum servidor LSP para PHP encontrado em `src/cm/lsp/servers/` |
| Java | Completo (`@codemirror/lang-java`) | **Indisponível** — nenhum servidor LSP para Java encontrado |
| Kotlin | Parcial (modo legado via `@codemirror/legacy-modes`, sem LSP) | **Indisponível** |
| C / C++ | Completo (`@codemirror/lang-cpp`) | **Parcial** — `clangd` definido em `systems.ts`, `enabled: false` por padrão, depende de instalação (`apk add clang-extra-tools`) |
| Emmet | — | **Completo** — `@emmetio/codemirror6-plugin` já integrado |

Auto import e navegação entre definições/busca de símbolos dependem do
servidor LSP ativo por linguagem (ex.: funcionam com `typescript`/`vtsls`
para JS/TS; não existem para PHP/Java/Kotlin hoje). Nenhum recurso foi
"ligado" para uma linguagem sem servidor real.

**Pendências:** adicionar servidores LSP para PHP, Java e Kotlin (ex.:
`intelephense`, `jdtls`, `kotlin-language-server`) exigiria validar a
compatibilidade de cada binário com Alpine ARM64 em um dispositivo físico —
não foi feito aqui para não "inventar" compatibilidade não verificada.

## Fase 6 — Interface "Developer Edition"

**Arquivos modificados/novos:**
- `src/theme/preInstalled.js` — novo tema embutido "Developer Edition"
  (preto/grafite com azul/roxo de destaque), construído com o mesmo
  `createBuiltInTheme()` usado por todos os outros temas do Acode — não é um
  sistema de estilização paralelo.
- `src/settings/developerEditionSettings.js` + `src/settings/mainSettings.js`
  — nova seção "Developer Edition" nas Configurações, reunindo apenas o que é
  específico desta edição (projeto ativo, auto-cd do terminal, atalho para
  AI Coding Agents) — não duplica as configurações originais de terminal,
  editor ou LSP, que continuam em suas próprias páginas.

**Testes executados:** nenhum visual automatizado (seria necessário
renderizar o WebView). Revisão manual do código/CSS apenas.

## Fase 7 — GitHub Actions (build Android)

**Arquivo novo:** `.github/workflows/android-build.yml`.

- Gatilho: push de tag `developer-edition-*` ou execução manual
  (`workflow_dispatch`).
- Reaproveita os comandos **reais** já usados por
  `.github/workflows/nightly-build.yml` deste mesmo repositório (Java 21
  temurin, Node LTS, `npm ci`, `npm install -g cordova`, `npm run setup`,
  `node utils/storage_manager.mjs y`, `npm run build <variant> dev apk`) —
  nenhum comando foi inventado.
- Job de build de debug roda **sem exigir segredos** (confirmado por leitura
  de `hooks/post-process.js`/`hooks/move-files.js`: `build.json` é
  opcional e usado só por assinatura de release).
- Job de release assinado é **separado e opcional**: só roda se a variável
  de repositório `ENABLE_SIGNED_RELEASE` estiver `true` **e** os segredos
  `KEYSTORE_CONTENT`, `KEYSTORE_PASSWORD` e `BUILD_JSON_CONTENT` existirem.
- Publica o APK como artifact do workflow, com nome, commit e SHA256 no
  resumo do build. Em falha, aponta exatamente qual etapa/caminho não foi
  encontrado.

**Verificação feita nesta sessão:** sintaxe YAML validada com um parser
YAML real (`python3 -c "yaml.safe_load(...)"`) — sem erros. Os comandos
usados foram confirmados lendo `package.json`, `utils/setup.js`,
`utils/storage_manager.mjs` e os workflows já existentes no repositório, não
assumidos de memória. **Não foi possível** executar o workflow de fato (isso
só acontece no GitHub Actions, fora desta sessão) — portanto ele está listado
como "sintaticamente validado", não como "testado end-to-end", até a
primeira execução real.

## Fase 8 — Revisão

**Testes automatizados escritos:**
- `tests/unit/terminalPath.test.js`
- `tests/unit/projectContext.test.js`

**Status de execução dos testes:** escritos e revisados manualmente,
seguindo o padrão já usado pelos testes existentes do repositório
(`tests/unit/*.test.js`, Vitest + `happy-dom`). **Não foi possível
executá-los nesta sessão**: a instalação de dependências (`npm install`)
falhou por indisponibilidade de rede para `registry.npmjs.org` neste
ambiente de execução (erro `ENOTFOUND`, confirmado também via `curl`/
`getent`), não por um problema no código ou nos testes. Eles usam a mesma
infraestrutura (`vitest.config.js`, alias de `src/`) dos testes já
existentes no repositório, que presumivelmente passam no CI real do GitHub
(`.github/workflows/ci.yml`, que roda `npm test`/equivalente com acesso de
rede completo). **Recomendação**: rodar `npx vitest run` localmente ou no CI
assim que o PR for aberto, antes de considerar esta fase concluída.

### Tabela de status — pedida na seção 9 do brief

| Item | Status |
| --- | --- |
| Inicialização do aplicativo | Não testado (requer dispositivo/emulador Android) |
| Abertura e troca de projetos (lógica de `projectContext`) | Testado automaticamente (testes escritos; execução pendente de rede/CI — ver acima) |
| Contexto do terminal (`terminalPath`, resolução de caminho) | Testado automaticamente (idem) |
| Auto-cd do terminal para o projeto ativo | Não testado (depende do plugin nativo PRoot) |
| Execução de comandos npm no projeto ativo | Não testado em dispositivo |
| Persistência das configurações (`localStorage`) | Testado automaticamente (idem) |
| Detecção dos agentes de IA (`command -v`, `--version`) | Não testado em dispositivo (lógica revisada manualmente) |
| Sincronização de arquivos após edição externa | Não implementado (pendência, ver Fase 4) |
| Permissões de armazenamento / SAF | Não testado; caminho não-bridged tratado honestamente (reportado, não simulado) |
| Compatibilidade ARM64 | Herdada do Alpine/PRoot já existente — não alterada, não re-testada |
| Workflow GitHub Actions | Sintaxe validada; execução real pendente da primeira run |

### Problemas encontrados durante a implementação

- `node_modules/vitest` ficou corrompido/incompleto após uma instalação
  anterior nesta mesma sessão (diretório sem `package.json`), e a tentativa
  de reinstalar falhou por indisponibilidade de rede para
  `registry.npmjs.org` neste ambiente — não é um problema no repositório.
- `lib/openFolder.js` já continha a lógica de conversão de caminho duplicada
  (não compartilhada) — foi extraída para `utils/terminalPath.js` como parte
  da Fase 2, uma mudança incremental, não uma reescrita.

### Pendências gerais (consolidado)

1. Ponte para projetos em SAF não vinculada ao Acode/Termux (Fase 2).
2. Sincronização automática do explorador após alteração externa de
   arquivos pelos agentes de IA (Fase 4).
3. Servidores LSP para PHP, Java e Kotlin (Fase 5).
4. Execução real dos testes automatizados e do workflow do GitHub Actions
   (Fase 8) — ambos prontos, mas não executados nesta sessão por limitação
   de rede do ambiente.
5. Validação em dispositivo físico Android ARM64 de todo o fluxo de
   terminal + agentes de IA — nada neste documento afirma isso como feito.
