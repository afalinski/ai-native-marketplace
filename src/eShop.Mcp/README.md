# eShop.Mcp

A custom MCP (Model Context Protocol) server for eShop. It lets an AI agent, for example Claude Code, answer questions about the catalog and the orders. It can also cancel an order, but only after a human says yes.

- Design: [docs/superpowers/specs/2026-11-13-eshop-mcp-server-design.md](../../docs/superpowers/specs/2026-11-13-eshop-mcp-server-design.md)
- Decision record: [ADR-007](../../docs/adr/0007-custom-mcp-server.md)
- Demo script: [docs/demo/mcp-cancel-order.md](../../docs/demo/mcp-cancel-order.md)

## What it is and why

A generic Postgres MCP server gives the agent one tool: "run SQL". The agent must guess the table names, the status rules and the joins. It can also write, if the database user can write.

This server knows the eShop domain:

- **Task tools.** One tool for one job, for example `find_stuck_orders`. The business rules are inside the tool (what "stuck" means, whether an order can still be cancelled).
- **Resources and prompts.** The order status lifecycle and the architecture docs are MCP resources. Two prompts give a ready workflow.
- **Actions go through eShop.** `cancel_order` calls Ordering.API. The domain rules and the integration events run as for a real user. The server never writes to the database.
- **Human in the loop.** The agent cannot cancel an order alone. The user must confirm in a dialog.

The server is for one developer on a local machine. It has no OAuth for MCP clients.

## How to run

### Secrets (set up for every AppHost mode)

The AppHost has two parameters in every mode, also when you do not use the MCP server. Both have a generated default (32 characters) that Aspire keeps in the AppHost user secrets, so a fresh clone starts without any setup. To choose the values yourself, set them once:

```powershell
dotnet user-secrets set "Parameters:mcp-readonly-password" "<choose a password>" --project src/eShop.AppHost
dotnet user-secrets set "Parameters:mcp-client-secret" "<choose a secret>" --project src/eShop.AppHost
```

- `mcp-readonly-password` is the password of the Postgres role `mcp_readonly`.
- To read the generated values, run `dotnet user-secrets list --project src/eShop.AppHost` after the first start. `eval/mcp/setup-db.ps1` needs the same `mcp-readonly-password`, so either read it from there or set it with the command above before the first start.
- `mcp-client-secret` is the secret of the Identity.API client `eshop-mcp`. The server uses it to get a token for Ordering.API.

### Normal mode

Starts the full eShop app and the MCP server:

```powershell
dotnet run --project src/eShop.AppHost
```

The `mcp_readonly` role must exist in `catalogdb` and `orderingdb` (see the next section). If it does not, the server stops at startup.

### Eval mode

Starts only what the MCP server needs: Postgres, Identity.API, Catalog.API, Ordering.API and eShop.Mcp. It does not start `order-processor` and `payment-processor`, because they would move the seeded orders.

```powershell
dotnet run --project src/eShop.AppHost -- --McpEval=true
pwsh eval/mcp/setup-db.ps1 -Password <the mcp-readonly-password>
```

`eval/mcp/setup-db.ps1` creates the read-only role and loads fixed seed data (orders 9001-9020, four of them stuck for more than 2 hours). It is safe to run again. More details: [eval/mcp/README.md](../../eval/mcp/README.md).

"Stuck" means: an order in Submitted, AwaitingValidation or StockConfirmed that waits longer than the threshold. A Paid order is not stuck, because it waits for a person to ship it.

### Connect Claude Code

The repo file `.mcp.json` has the entry `eshop` (HTTP, `http://localhost:5230/mcp`). Start the AppHost, then check:

```powershell
claude mcp list
```

`cancel_order` is not allowed automatically in `.claude/settings.json`. Claude Code asks you before it calls the tool, and the server asks you again with the confirmation dialog.

## Tools, resources and prompts

| Kind | Name | Hints | What it does |
|------|------|-------|--------------|
| Tool | `search_catalog` | ReadOnly | Search products by text, brand, type, max price, stock. Descriptions come back as `untrusted_text`. |
| Tool | `get_order` | ReadOnly | One order with lines, total, "can it be cancelled?" and the next step. |
| Tool | `find_orders` | ReadOnly | Find orders by status, buyer name or minimum age. |
| Tool | `find_stuck_orders` | ReadOnly | Orders stuck in the saga for longer than a threshold, with the step they wait for. |
| Tool | `get_buyer_summary` | ReadOnly | Number of orders, total spent and last order date for one buyer. |
| Tool | `cancel_order` | Destructive | Cancel an order through Ordering.API, after the human confirms. |
| Resource | `eshop://ordering/status-lifecycle` | | The order status lifecycle and which service moves each step. |
| Resource | `eshop://docs/architecture/{+name}` | | The architecture docs of the repo. |
| Prompt | `investigate-stuck-order` | | Steps to find out why one order does not move forward. |
| Prompt | `daily-ordering-report` | | Steps to write a daily report with counts and stuck orders. |

List tools return at most 50 rows (default 20) and say when the result was cut.

## Security layers

Reads:

1. **Read-only database role.** The server connects as `mcp_readonly`. At startup a guard checks the role: it is not a superuser, it has no INSERT, UPDATE, DELETE or TRUNCATE on any table, and it is not a member of `pg_write_all_data`. If a check fails, the server does not start.
2. **Safe queries.** Each query runs in a read-only transaction with a 5 second statement timeout and a row limit. The result says when it was cut. All values are SQL parameters.
3. **Untrusted text.** Free text from the database (product descriptions) is returned in a field named `untrusted_text`. The tool description tells the model not to follow instructions inside it.

Action:

4. **Cancel only through the API.** `cancel_order` never touches the database. It calls Ordering.API with a client-credentials token (client `eshop-mcp`, scope `orders`). The domain rules run as normal.
5. **Elicitation.** Before the call, the server asks the human to confirm. The dialog shows the order id, buyer, items, total, status and the reason.
6. **Signed state.** The question carries a `requestState`. It is signed, valid for 5 minutes, and bound to the order id and the reason. An answer without a matching state is refused, with no database read and no API call.
7. **Re-check.** After the yes, the server loads the order again. If the order can no longer be cancelled (for example it is now Paid), nothing is sent.
8. **Client permission prompt.** `cancel_order` is not in the allow list of `.claude/settings.json`, so the client asks first.

## Threat model

The model cannot set `inputResponses`. The MCP client sets them, after it has shown the question to the human. The signed state protects against a buggy or malicious client, and against an answer that is attached to the wrong question (another order, or no question at all).

Prompt injection is handled by the human. The confirmation dialog shows the exact order and the reason, so the human can see what will happen. The model cannot skip the dialog.

The `orders` scope of the `eshop-mcp` client covers all Ordering.API endpoints (it can also ship or cancel any order). The server exposes only cancel, but the token itself is not limited to it.

Not covered: a human who confirms without reading, and an attacker who controls the MCP client on the developer machine.

## Known limitations

- **Data Protection keys are per machine and user.** The default key ring is not shared. On Windows it is kept under `%LOCALAPPDATA%`, so a restart on the same machine keeps the keys. A signed state that comes from another machine or replica is refused. The user asks again. A multi-instance setup needs a shared key ring.
- **The startup guard does not detect column-only grants.** A role that has INSERT or UPDATE on single columns only would pass the table-level check. The role made by `eval/mcp/create-readonly-role.sql` has SELECT only.
- **Totals differ from the eShop code.** eShop `Order.GetTotal()` ignores the item discount. `get_order` subtracts it. Only one seeded order (9015) has a discount.
- **No nonce store.** The same order and reason can be replayed with the same valid state for 5 minutes. The order is re-checked, so a second cancel is blocked by the status.
- **No retry for cancel.** `AddServiceDefaults` gives every HttpClient a retry policy. The Ordering client keeps the timeout and the circuit breaker but has retries switched off for PUT, so one cancel sends one request. A failed call is reported, not retried. Ordering can hide a failed command behind a 500, so the message may only say "Ordering service error". After a timeout the state is unknown: the message says so and tells the user to check with `get_order`.
- **Local use only.** No OAuth for MCP clients and no TLS on the MCP port.
