# Order status lifecycle

Orders are handled by a saga with no central orchestrator. Each service reacts to an integration event.
Ordering.API owns the order status and changes it. All "Published by Ordering" events go through the outbox.

Normal path: Submitted -> AwaitingValidation -> StockConfirmed -> Paid -> Shipped.
Cancelled is a side exit.

| Status | Who moves the order out of this status | Integration event that triggers the move | Event Ordering publishes when it enters the status |
|---|---|---|---|
| Submitted | OrderProcessor finds orders older than the grace period (1 minute, checked every 30 seconds). Ordering.API sets AwaitingValidation. | GracePeriodConfirmedIntegrationEvent (from OrderProcessor) | OrderStatusChangedToSubmittedIntegrationEvent |
| AwaitingValidation | Catalog.API checks the stock. Ordering.API sets StockConfirmed, or Cancelled if stock is rejected. | OrderStockConfirmedIntegrationEvent or OrderStockRejectedIntegrationEvent (from Catalog.API) | OrderStatusChangedToAwaitingValidationIntegrationEvent |
| StockConfirmed | PaymentProcessor simulates the payment. Ordering.API sets Paid, or Cancelled if the payment fails. | OrderPaymentSucceededIntegrationEvent or OrderPaymentFailedIntegrationEvent (from PaymentProcessor) | OrderStatusChangedToStockConfirmedIntegrationEvent |
| Paid | A person or a client calls PUT /ship on Ordering.API. Nothing in the saga moves it. | none (manual action) | OrderStatusChangedToPaidIntegrationEvent (Catalog.API reduces the stock) |
| Shipped | Final status. No further moves. | none | OrderStatusChangedToShippedIntegrationEvent |
| Cancelled | Final status. No further moves. | none | OrderStatusChangedToCancelledIntegrationEvent |

## Rules

- Final statuses: Shipped and Cancelled.
- A user can cancel an order only before it is Paid: Submitted, AwaitingValidation and StockConfirmed can be cancelled. Paid, Shipped and Cancelled cannot.
- Stuck orders: an order in Submitted, AwaitingValidation or StockConfirmed for a long time is stuck, because another service should have moved it.
- A Paid order is not stuck. It waits for a manual ship action, so a long time in Paid is normal.
- When stock is rejected, the order becomes Cancelled but no Cancelled integration event is published on that path.
- Moving an order from a wrong state is a silent no-op for AwaitingValidation, StockConfirmed and Paid. It throws an error for Shipped and Cancelled.
- The handlers for StockConfirmed and Paid wait 10 seconds on purpose, so a short delay between statuses is normal.

## What to check for a stuck order

- Submitted: is OrderProcessor running? Does the order date pass the grace period?
- AwaitingValidation: did Catalog.API receive the event and publish a stock result?
- StockConfirmed: is PaymentProcessor running and connected to RabbitMQ?
- Any status: an event could be lost, because a failed publish is only logged and nothing retries it.

Source: docs/architecture (services/ordering, services/processors, themes/events-consistency).
