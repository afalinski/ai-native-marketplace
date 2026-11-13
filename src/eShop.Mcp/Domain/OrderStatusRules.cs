namespace eShop.Mcp.Domain;

// Mirrors the rules in Ordering.Domain's Order aggregate; the MCP server reads the database only and does not reference the domain.
public static class OrderStatusRules
{
    public static readonly IReadOnlyList<string> AllStatuses =
    [
        "Submitted",
        "AwaitingValidation",
        "StockConfirmed",
        "Paid",
        "Shipped",
        "Cancelled"
    ];

    public static bool IsKnown(string status)
    {
        return AllStatuses.Contains(status);
    }

    public static bool IsFinal(string status)
    {
        return status is "Shipped" or "Cancelled";
    }

    public static (bool CanCancel, string Reason) CanCancel(string status)
    {
        return status switch
        {
            "Paid" => (false, "A paid order cannot be cancelled."),
            "Shipped" => (false, "A shipped order cannot be cancelled."),
            "Cancelled" => (false, "The order is already cancelled."),
            _ => (true, "The order can be cancelled.")
        };
    }

    public static string NextStep(string status)
    {
        return status switch
        {
            "Submitted" => "grace period, then stock validation by order-processor",
            "AwaitingValidation" => "stock check by Catalog.API",
            "StockConfirmed" => "payment by payment-processor",
            "Paid" => "shipping",
            _ => "none (final status)"
        };
    }
}
