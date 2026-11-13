using System.ComponentModel;

using ModelContextProtocol.Server;

namespace eShop.Mcp.Prompts;

[McpServerPromptType]
public sealed class EShopPrompts
{
    [McpServerPrompt(Name = "investigate-stuck-order")]
    [Description("Find out why an order does not move forward and which service should act next.")]
    public static string InvestigateStuckOrder(
        [Description("The order id")] int order_id)
    {
        return $"""
            Investigate why order {order_id} does not move forward.

            1. Call the tool get_order with order_id {order_id}. Note its status, its age and the next step.
            2. Read the resource eshop://ordering/status-lifecycle. Find the row for the order status.
            3. Explain which service should act next and which integration event it waits for.
            4. Say if the order is really stuck. A Paid order is not stuck: it waits for a manual ship action.
            5. Suggest what to check next, for example the service that should send the event. Do not change any data.
            """;
    }

    [McpServerPrompt(Name = "daily-ordering-report")]
    [Description("Write a short daily report about orders and stuck orders.")]
    public static string DailyOrderingReport()
    {
        return """
            Write a daily ordering report.

            1. Call the tool find_orders once for each status: Submitted, AwaitingValidation, StockConfirmed, Paid, Shipped and Cancelled. Count the orders in each status.
            2. Call the tool find_stuck_orders. List each stuck order with its id, status, age and next step.
            3. Read the resource eshop://ordering/status-lifecycle if you need to explain a status.
            4. Give the counts in a small table, then the stuck orders, then one or two lines of advice.
            """;
    }
}
