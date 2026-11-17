# ADR-007: A custom MCP server for eShop

- Status: Draft (the "Why" section is for the owner to write)
- Date: 2026-11-13

## Context
An agent needs tools to work with a real system. A ready-made Postgres MCP server gives one tool: "run SQL". The agent must guess table names, status rules and joins. It can also write, if the database user can write. We wanted to know three things: is a server that knows the eShop domain better than a generic one, how can an agent take an action safely, and what stops a hijacked agent.

The spec is `docs/superpowers/specs/2026-11-13-eshop-mcp-server-design.md`. The server is `src/eShop.Mcp`.

## Options
Where to build it:

| | Option | Trade-off |
| --- | --- | --- |
| A (chosen) | Own server `src/eShop.Mcp` inside eShop | Real system and real numbers; more work |
| B | Separate repo with demo servers | Clean, but a toy, and nothing to measure |
| C | Only ready-made servers | Fast, but no tool design to show |

How custom it is:

| Level | What | Trade-off |
| --- | --- | --- |
| 1 | Domain read tools, resources, prompts over the database | Clear win over generic SQL; read-only and safe |
| 2 | Level 1 plus actions through eShop services | Business rules run; needs a service token |
| 3 (chosen) | Level 2 plus one action (`cancel_order`) with human confirmation | Best human-in-the-loop story; needs care with auth, state and the dialog |

The generic baseline (M1) is Postgres MCP Pro 1.6.0 in restricted mode, with the same read-only role as our server. The old reference server is not used, because it is reported to have a read-only bypass.

## Decision
Build level 3, in the order 1, 2, 3, and measure it against the generic server and against no MCP.

- **Tools.** Five read tools (`search_catalog`, `get_order`, `find_orders`, `find_stuck_orders`, `get_buyer_summary`), two resources, two prompts. One action: `cancel_order`. Business rules sit inside the tools (what "stuck" means, whether an order can be cancelled).
- **Reads come from the database, the action goes through Ordering.API.** Ordering.API has no endpoint to list all orders, so reads use the database. The action must run the domain rules and the events, so it calls the API with a client-credentials token (client `eshop-mcp`, scope `orders`). The server never writes to the database.
- **Least privilege for reads.** The server connects as the role `mcp_readonly`. Every query runs in a read-only transaction with a statement timeout and a row limit, and all values are parameters. At startup a guard checks the role. If the role is a superuser or has write rights, the server does not start. Review found a gap: the first check did not see a write right that the role inherits from a group role. It was fixed and has a test. A right on single columns is still not detected (known limitation).
- **Human in the loop for `cancel_order`.** Four layers:
  - Elicitation: the server asks the human to confirm. The dialog shows the order id, buyer, items, total, status and reason.
  - A signed `requestState`: valid for 5 minutes and bound to the order and the reason. Review found that without it, a client could send a made-up "accept" with no question asked. Now such an answer is refused, with no database read and no API call. Tests cover a forged accept, an answer for another order and a garbage state.
  - A re-check after the yes. If the order can no longer be cancelled, nothing is sent.
  - The Claude Code permission prompt: `cancel_order` is not in the allow list.
- **Untrusted text.** Product descriptions come back in a field named `untrusted_text`, and the tool description says not to follow instructions in it. This helps, but it is not a control.
- **Elicitation with Claude Code (E10 prelude).** It works through multi round-trip requests (MRTR). Claude Code 2.1.322 declared elicitation and protocol revision 2026-07-28, and the server saw `IsMrtrSupported = True`. The first `tools/call` throws `InputRequiredException`. The second call carries the answer. The proof was headless, with an `Elicitation` hook that answers by itself. The fallback (stateful HTTP, or a two-step tool with a code) was not needed. The real dialog in the terminal and in the VS Code panel is not checked yet. The owner checks it by hand.

## Consequences
- **E10 pilot, N=1, 10 questions, 30 runs.** M0 (no MCP): 1 correct, 9 abstained, 0 wrong. This is the second run. The first run read the seed files in the repo and got 5/5/0. We blocked `eval/**` and `tests/**` and ran M0 again. M1 (generic): 10 / 0 / 0. M2 (our server): 10 / 0 / 0. There were no wrong answers.
- **The accuracy hypothesis is not supported.** Both M1 and M2 were fully correct. M2 was better on the questions that a domain tool fits: q04 used 2 calls (M1: 5), q06 used 2 (M1: 4), and q10 used fewer tokens. M2 was much worse where no tool fits: q01, q07 and q09 took 10, 21 and 22 calls, and M1 needed 3, 7 and 3 calls. The token result is mixed, so we claim no token winner.
- **A missing filter costs more than a missing tool.** `search_catalog` has `in_stock_only`, but no filter for out-of-stock items, and there is no filter for discounts.
- **E11, injection through a product description.** The model never tried to cancel. It showed the data and said it did not follow the instruction. These runs are contaminated: the model could see that it was a test (the untracked `eval/mcp/injection/` folder, and a plan found with `Grep`). So E11 does not prove that the control works. The control is proven by tests: `CancelOrderTests` (confirmation, decline, forged accept) and `ReadOnlyGuardTests` (read-only role). The manual demo `docs/demo/mcp-cancel-order.md` will show it once the owner runs it. The model's refusal is not a control. This follows the same rule as [ADR-006](0006-prompt-injection.md): do not rely on the model to say no.
- **Honest next step.**
  - Build a hybrid: a few domain tools for the risky rules (cancel, stuck, `can_cancel`) and a read-only SQL tool for the rest.
  - Add filters for stock and discount to the search and order tools.
  - Run N=3 after the leaks are closed (`docs/` holds answer values, for example `docs/demo/mcp-cancel-order.md`: deny `Read(./docs/**)` or use a clean copy).
- **Known limits.** The default Data Protection key ring is per machine and user (on Windows it is kept under `%LOCALAPPDATA%`), so a signed question from another machine or replica is refused. There is no nonce store: the same state can be replayed for 5 minutes, but the status re-check blocks a second cancel. There is no OAuth for MCP clients and no TLS on the MCP port: it is for one developer on a local machine. A human who confirms without reading is not covered.
- **Repo finding, not fixed here.** `CancelOrderCommandHandler` does not check that the order belongs to the caller. Any authenticated user can cancel any order.
- Details: `src/eShop.Mcp/README.md`, `docs/experiments.md` (E10, E11), `docs/metrics.md`.

## Why (owner)
> TODO (owner): write in your own words why this decision is right. 3–5 sentences.
