# AI-native marketplace

This is a fork of [dotnet/eShop](https://github.com/dotnet/eShop). It shows how an AI team works on a repository it has not seen before: discovery, project instructions, guardrails, a custom MCP server and an issue-to-PR pipeline. The application itself is not ours: the code and the project names stay eShop, and the original README is kept at the end.

## What is here

| Stage | What was done | Decisions | Experiments |
| --- | --- | --- | --- |
| 0. Baseline | Environment set up and measured before any AI tooling: 28 projects, 125 tests, and an estimate of 2–2.5 h by hand for one small task. GitHub MCP server with four toolsets only. | [ADR-001](docs/adr/0001-team-enterprise-rollout.md) | [E0](docs/experiments.md#e0-environment-setup-2026-11-12), [E1](docs/experiments.md#e1-github-mcp-server-2026-11-12) |
| 1. Discovery | An agent team maps the system: 8 service explorers and 2 theme explorers, an architect, and an independent critic. 356 claims checked, 9 rejected. One revision round raised plan soundness from 3 of 13 steps to 10 of 13. Results: the [overview](docs/architecture/overview.md) and its [verification](docs/architecture/verification.md). | [ADR-002](docs/adr/0002-discovery-agent-team.md) | [E2](docs/experiments.md#e2-discovery-agent-team--first-run-2026-11-12-commit-d9aa12b), [E2b](docs/experiments.md#e2b-one-revision-round-2026-11-12) |
| 2. Instructions, guardrails, MCP | A short [CLAUDE.md](CLAUDE.md) and five path-scoped rules, deny rules and hooks, three task skills, layers against prompt injection. A custom MCP server, [src/eShop.Mcp](src/eShop.Mcp/README.md): five read tools and one confirmed action, `cancel_order`. | [ADR-003](docs/adr/0003-project-instructions-layout.md), [ADR-004](docs/adr/0004-guardrails.md), [ADR-005](docs/adr/0005-task-skills.md), [ADR-006](docs/adr/0006-prompt-injection.md), [ADR-007](docs/adr/0007-custom-mcp-server.md) | [E4](docs/experiments.md#e4-is-the-repo-safe-to-auto-format-2026-11-12), [E5](docs/experiments.md#e5-do-the-guard-hooks-really-run-2026-11-12), [E6](docs/experiments.md#e6-do-the-task-skills-trigger-when-they-should-2026-11-13), [E7](docs/experiments.md#e7-does-the-migration-recipe-work-as-written-2026-11-13), [E8](docs/experiments.md#e8-does-the-configuration-make-the-agent-better-a0--b--c-2026-11-13), [E9](docs/experiments.md#e9-prompt-injection-which-layer-stops-what-2026-11-13), [E10](docs/experiments.md#e10-custom-eshop-mcp-vs-generic-postgres-mcp-vs-no-mcp-2026-11-13), [E11](docs/experiments.md#e11-prompt-injection-through-catalog-data-what-stops-a-hijacked-mcp-action-2026-11-13) |
| 3. Pipeline | An issue becomes a branch with five roles: analyst, planner, implementer, reviewer, docs-writer. The tests are plain code, not an agent. The round limit and the escalation are in code. A person approves the spec and merges. | [ADR-008](docs/adr/0008-agent-pipeline.md) | [E12 prelude](docs/experiments.md#e12-prelude-does---resume-keep-the-role-2026-11-16), [E12](docs/experiments.md#e12-agent-pipeline-issue--pr-calibration-run-2026-11-16), [E13](docs/experiments.md#e13-agent-pipeline-on-a-medium-task-issue-4--arch-06-2026-11-16), [E14](docs/experiments.md#e14-ai-review-in-ci-with-a-pro-subscription-token-2026-11-17) |

## Pipeline at a glance

```text
1. A person writes the issue (2-3 lines).
2. spec <n>   - the analyst writes .work/<n>/spec.md and stops. Gate 1: a person approves the spec.
3. build <n>  - the planner writes plan.md.
4. Up to 3 rounds: the implementer changes code, the tests run (plain dotnet build and test), the reviewer returns a JSON verdict.
   A round passes with green tests and no blocking finding. After 3 rounds: escalation.md, exit code 2, no PR.
5. The docs-writer updates the notes the diff makes wrong, then the orchestrator commits on branch agent/<n>.
6. With --pr: push the branch and open a PR with report.md. Gate 2: a person merges.
```

The code is in [tools/pipeline/](tools/pipeline/). To run it, use `node tools/pipeline/pipeline.mjs spec <issue>`, and after you approve the spec, `node tools/pipeline/pipeline.mjs build <issue> [--pr] [--fresh]`. Requirements and details: [tools/pipeline/README.md](tools/pipeline/README.md).

## Results

All costs are client-side estimates from `claude -p`, not bills. Sources: [docs/metrics.md](docs/metrics.md) and [docs/experiments.md](docs/experiments.md).

- **Discovery (E2, E2b):** about 17 minutes, 12 subagents, 728,290 tokens. 356 claims checked, 9 rejected (2.5%). The overview needed a revision: its plan soundness was 3 of 13 steps, then 10 of 13 after one round.
- **One task, by hand and with an agent (E8):** the price filter in Catalog is estimated at 2–2.5 h by hand (an estimate, not a measurement). Every agent run took under 4 minutes of agent time and cost $0.17 to $0.49. That is 1 to 3 runs per setup on one easy task, and review time is not included.
- **Pipeline, small task (E12, issue #1):** success in 1 round of 3, about 4.5 minutes, $0.99, 3 files changed, no human intervention (the spec was approved as written).
- **Pipeline, medium task (E13, issue #4):** escalated after 3 rounds, about 17 minutes, $3.50. The loop fixed two red functional tests in round 2, then stopped on one line in `.claude/rules/ordering.md`, a path the pipeline may not edit. No PR.

## Known limits

- AI review of pull requests in CI does not work yet. The workflow [claude-code-review.yml](.github/workflows/claude-code-review.yml) uses a subscription token, and every run stops on its first request. The same failure is reported in the open upstream issue [anthropics/claude-code-action#1614](https://github.com/anthropics/claude-code-action/issues/1614) ([E14](docs/experiments.md#e14-ai-review-in-ci-with-a-pro-subscription-token-2026-11-17)). Pull requests are reviewed locally with `/code-review <PR>`.
- The "Why" section of [ADR-007](docs/adr/0007-custom-mcp-server.md) and of [ADR-008](docs/adr/0008-agent-pipeline.md) is for the owner to write. ADR-007 is still a draft.
- The MCP comparison (E10) is a pilot with one run per question.
- Issue #4 (`POST /api/orders` returns 200 when the create fails) is still open: the live run escalated, and the fix was not merged.

## The original eShop

## eShop Reference Application - "AdventureWorks"

A reference .NET application implementing an e-commerce website using a services-based architecture with [Aspire](https://aspire.dev/).

![eShop Reference Application architecture diagram](img/eshop_architecture.png)

![eShop homepage screenshot](img/eshop_homepage.png)

### Getting Started

This version of eShop is based on .NET 10.

Previous eShop versions:

* [.NET 8](https://github.com/dotnet/eShop/tree/release/8.0)

#### Prerequisites

1. Install a [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) that satisfies [`global.json`](global.json).
2. Install the [Aspire CLI](https://aspire.dev/get-started/install-cli/) and verify that it is available:

    ```console
    aspire --version
    ```

3. Install and start an OCI-compatible container runtime. [Docker Desktop](https://www.docker.com/products/docker-desktop/) is the recommended default. [Podman](https://podman.io/docs/installation) is also supported; follow the [Aspire prerequisites](https://aspire.dev/get-started/prerequisites/) to configure it.
4. Clone the repository:

    ```console
    git clone https://github.com/dotnet/eShop.git
    cd eShop
    ```

No separate Aspire workload or Visual Studio component is required; the AppHost SDK and hosting integrations are referenced by the projects in this repository.

##### Optional IDE setup

- [Visual Studio](https://visualstudio.microsoft.com/vs/) with the `ASP.NET and web development` workload.
- [Visual Studio Code with C# Dev Kit](https://code.visualstudio.com/docs/csharp/get-started) and the [Aspire extension](https://aspire.dev/get-started/aspire-vscode-extension/).
- The [.NET MAUI workload](https://learn.microsoft.com/dotnet/maui/get-started/installation) if you want to run the client apps.

#### Running the solution

> [!WARNING]
> Ensure that your container runtime is running before starting eShop.

##### From the terminal

From the repository root, run:

```console
aspire run
```

The root [`aspire.config.json`](aspire.config.json) selects `src/eShop.AppHost/eShop.AppHost.csproj`, avoiding ambiguity with the test AppHosts in the repository. When startup completes, the CLI prints a dashboard URL similar to:

```text
Dashboard: https://localhost:<port>/login?t=<token>
```

Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to stop the AppHost. See the [`aspire run` command](https://aspire.dev/reference/cli/commands/aspire-run/) for additional options.

To run the AppHost in the background instead:

```console
aspire start
aspire ps
```

When you are finished, run `aspire stop`. See the [`aspire start` command](https://aspire.dev/reference/cli/commands/aspire-start/) for details.

##### From Visual Studio

1. Open `eShop.Web.slnf`.
2. Set `src/eShop.AppHost/eShop.AppHost.csproj` as the startup project.
3. Press <kbd>Ctrl</kbd>+<kbd>F5</kbd> to start eShop and open the Aspire dashboard.

#### Running tests

Run the server tests:

```powershell
dotnet test --solution eShop.Web.slnf
```

Run the Playwright browser journeys. Playwright starts the AppHost automatically, so ensure your container runtime is running first.

```powershell
npm ci
npx playwright install chromium
npm run test:e2e
```

#### Optional: AI Chatbot with Microsoft Foundry

This option provisions a Microsoft Foundry resource during local development, so first authenticate to Azure and configure the subscription and location:

```powershell
az login
aspire secret set "Azure:SubscriptionId" "<subscription-id>"
aspire secret set "Azure:Location" "eastus"
```

Then enable Foundry and start eShop:

```powershell
$env:UseFoundry = "true"
aspire run
```

Aspire provisions the `gpt-4.1-mini` and `text-embedding-3-small` deployments and injects their connection information into the consuming projects. The Foundry hosting integration currently uses a preview package. See [local Azure provisioning](https://aspire.dev/integrations/cloud/azure/local-provisioning/) and the [Microsoft Foundry hosting integration](https://aspire.dev/integrations/cloud/azure/azure-ai-foundry/azure-ai-foundry-host/) for details.

#### Deploy to Azure Container Apps

The AppHost is already configured with an Azure Container Apps environment, so the Aspire CLI can deploy directly from the application model. See the [Aspire Azure Container Apps deployment guide](https://aspire.dev/deployment/azure/container-apps/) for details.

> [!WARNING]
> This sample deploys PostgreSQL, Redis, and RabbitMQ as containers in Azure Container Apps. This configuration is intended for evaluation and demonstrations, not production data.

Prerequisites:

- The prerequisites listed above, including a running container runtime.
- The [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), an active Azure subscription, and permission to create resources.

Sign in, optionally preview the deployment pipeline, and deploy:

```console
az login
aspire deploy --list-steps
aspire deploy
```

For local interactive use, `aspire deploy` prompts for missing Azure settings. For non-interactive use, provide them explicitly:

```powershell
$env:Azure__SubscriptionId = "<subscription-id>"
$env:Azure__Location = "eastus"
$env:Azure__ResourceGroup = "rg-eshop-demo"
aspire deploy --non-interactive
```

Use [`aspire publish`](https://aspire.dev/reference/cli/commands/aspire-publish/) when you need deployment artifacts for inspection or another deployment tool. Running it first is not required: `aspire deploy` invokes the deployment pipeline and its dependencies directly rather than consuming an earlier publish output.

When you no longer need the deployment, run [`aspire destroy`](https://aspire.dev/reference/cli/commands/aspire-destroy/). This deletes the entire configured resource group, including resources that Aspire did not create, so review the target carefully before confirming.

### Contributing

For more information on contributing to this repo, read [the contribution documentation](./CONTRIBUTING.md) and [the Code of Conduct](CODE-OF-CONDUCT.md).

#### Sample data

The sample catalog data is defined in [catalog.json](https://github.com/dotnet/eShop/blob/main/src/Catalog.API/Setup/catalog.json). Those product names, descriptions, and brand names are fictional and were generated using [GPT-35-Turbo](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/chatgpt), and the corresponding [product images](https://github.com/dotnet/eShop/tree/main/src/Catalog.API/Pics) were generated using [DALL·E 3](https://openai.com/dall-e-3).

### eShop on Azure

For a version of this app configured for deployment on Azure, please view [the eShop on Azure](https://github.com/Azure-Samples/eShopOnAzure) repo.
