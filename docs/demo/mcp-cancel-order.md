# Demo script: cancel an order with human confirmation

This is a script for the owner. Follow the steps in a terminal and take the screenshots. The goal: show that the agent finds stuck orders, asks the human before it cancels, and that "No" changes nothing.

Screenshots go to `docs/demo/img/`. Use the exact file names below. Each place that needs a screenshot is marked `TODO (owner): screenshot`.

## 0. Before you start

1. Check the secrets. Both must be set (see [src/eShop.Mcp/README.md](../../src/eShop.Mcp/README.md)):
   ```powershell
   dotnet user-secrets list --project src/eShop.AppHost
   ```
   You must see `Parameters:mcp-readonly-password` and `Parameters:mcp-client-secret`.
2. Terminal 1. Start the eval AppHost and leave it running:
   ```powershell
   dotnet run --project src/eShop.AppHost -- --McpEval=true
   ```
3. Terminal 2. Create the read-only role and load the seed data. Use the same password as the AppHost secret `Parameters:mcp-readonly-password`:
   ```powershell
   pwsh eval/mcp/setup-db.ps1 -Password <password>
   ```
   Expected last line: `Seed OK: 20 orders`.
4. Open the Aspire dashboard (the link is in terminal 1). If `eshop-mcp` shows Failed or Exited (this happens on the first start on a new volume, because the role did not exist yet), restart it from the dashboard. Wait until it is Running and healthy.
5. Terminal 2, from the repo root. Start Claude Code:
   ```powershell
   claude
   ```
   Run `/mcp`. You should see `eshop` as connected. If Claude Code asks to trust the project MCP server `eshop`, choose yes.

   TODO (owner): screenshot `docs/demo/img/01-mcp-connected.png` (the `/mcp` screen with `eshop` connected).

## 1. Find the stuck orders

Type to Claude:

```
Which orders are stuck for more than 2 hours?
```

You should see:
- Claude calls `find_stuck_orders` (the tool name is shown in the output).
- Four orders, oldest first: 9010 (about 26 hours), 9006 (5 hours), 9014 (4 hours), 9002 (3 hours). The oldest is 9010.
- Without a time, the tool uses 60 minutes, so 9020 and 9013 can also appear.
- For each order: the status and the step it waits for.

TODO (owner): screenshot `docs/demo/img/02-stuck-orders.png`.

## 2. Cancel, answer No

Type:

```
Cancel the oldest one. The reason is "demo: stuck for too long".
```

You should see:
- Claude asks permission to call `cancel_order` (client prompt). Choose to allow this one call.
- Then the confirmation dialog from the server. It shows order 9010, the buyer, the items, the total, the status and your reason.

TODO (owner): screenshot `docs/demo/img/03-confirm-dialog.png` (the dialog before you answer).

Answer **No** (decline).

You should see: Claude says the order was not cancelled because you did not confirm (`Not cancelled: the user did not confirm.`).

Now type:

```
Show me order 9010 again.
```

You should see: the status is still `StockConfirmed`, and the order can still be cancelled.

TODO (owner): screenshot `docs/demo/img/04-declined-order-unchanged.png` (the "not cancelled" message and the unchanged order).

## 3. Cancel, answer Yes

Type the same request again:

```
Cancel the oldest one. The reason is "demo: stuck for too long".
```

Allow the tool call, and when the dialog appears, answer **Yes** (accept and confirm).

You should see:
- Claude says order 9010 is cancelled.

Type:

```
Show me order 9010 again.
```

You should see: status `Cancelled`.

TODO (owner): screenshot `docs/demo/img/05-cancelled.png` (the success message and status `Cancelled`).

## 4. Check the trace in the dashboard

Open the Aspire dashboard (link in terminal 1). Go to **Traces** (or **Structured logs**) and filter by the `eshop-mcp` and `ordering-api` resources.

You should see:
- In `eshop-mcp`: a call to `identity-api` (`/connect/token`) and then `PUT /api/orders/cancel` to `ordering-api`.
- In `ordering-api`: the cancel command for order 9010 (`IdentifiedCommand<CancelOrderCommand,Boolean>`, result `True`) and the order status change.

TODO (owner): screenshot `docs/demo/img/06-dashboard-trace.png`.

Note: in the "No" run in step 2 there is no call to `ordering-api` at all. This is the point of the demo. You can show that in the same trace list.

## 5. Optional: reset the data

```powershell
pwsh eval/mcp/setup-db.ps1 -Password <password>
```

This puts order 9010 back to `StockConfirmed` and refreshes all order ages, so you can run the demo again.

## 6. Clean up

Press Ctrl+C in terminal 1 to stop the AppHost.

## File list

| File | Shows |
|------|-------|
| `img/01-mcp-connected.png` | `eshop` connected in `/mcp` |
| `img/02-stuck-orders.png` | the four orders stuck for more than 2 hours |
| `img/03-confirm-dialog.png` | the confirmation dialog |
| `img/04-declined-order-unchanged.png` | answer No, order unchanged |
| `img/05-cancelled.png` | answer Yes, order Cancelled |
| `img/06-dashboard-trace.png` | the trace in the Aspire dashboard |
