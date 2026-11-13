using System.ComponentModel;

using eShop.Mcp.Data;
using eShop.Mcp.Domain;

using ModelContextProtocol;
using ModelContextProtocol.Server;

namespace eShop.Mcp.Tools;

public sealed record OrderLineView(string ProductName, int Units, decimal UnitPrice, decimal Discount);

public sealed record OrderView(
    int Id,
    string Status,
    DateTime OrderDate,
    string BuyerName,
    IReadOnlyList<OrderLineView> Lines,
    decimal Total,
    bool CanCancel,
    string CancelReason,
    string NextStep);

public sealed record OrderSummaryView(int Id, string Status, DateTime OrderDate, string BuyerName, decimal Total, int AgeMinutes);

public sealed record StuckOrderView(int Id, string Status, DateTime OrderDate, string BuyerName, decimal Total, int AgeMinutes, string NextStep);

public sealed record OrderListResult(IReadOnlyList<OrderSummaryView> Orders, bool Truncated);

public sealed record StuckOrderListResult(IReadOnlyList<StuckOrderView> Orders, bool Truncated);

public sealed record BuyerSummaryView(string BuyerName, int OrderCount, decimal TotalSpent, DateTime? LastOrderDate);

[McpServerToolType]
public sealed class OrderTools
{
    private const int MaxLines = 50;

    private readonly ReadOnlyDb _db;

    public OrderTools(ReadOnlyDb db)
    {
        _db = db;
    }

    [McpServerTool(Name = "get_order", ReadOnly = true)]
    [Description("Get one order with its lines, total, whether it can still be cancelled, and what happens next. Use this for any question about a single order id.")]
    public async Task<OrderView> GetOrderAsync(
        [Description("The order id")] int order_id,
        CancellationToken cancellationToken = default)
    {
        const string headerSql =
            """
            SELECT o."Id", o."OrderStatus" AS "Status", o."OrderDate", COALESCE(b."Name", '') AS "BuyerName"
            FROM ordering.orders o
            LEFT JOIN ordering.buyers b ON b."Id" = o."BuyerId"
            WHERE o."Id" = @orderId
            LIMIT @fetch
            """;

        var header = await _db.QueryAsync<OrderHeaderRow>(EShopDatabase.Ordering, headerSql, new { orderId = order_id, fetch = 2 }, 1, cancellationToken);
        if (header.Rows.Count == 0)
        {
            throw new McpException($"Order {order_id} not found. Use find_orders to search.");
        }

        const string linesSql =
            """
            SELECT i."ProductName", i."Units", i."UnitPrice", i."Discount"
            FROM ordering."orderItems" i
            WHERE i."OrderId" = @orderId
            ORDER BY i."Id"
            LIMIT @fetch
            """;

        var lines = await _db.QueryAsync<OrderLineView>(EShopDatabase.Ordering, linesSql, new { orderId = order_id, fetch = MaxLines + 1 }, MaxLines, cancellationToken);

        var row = header.Rows[0];
        var total = lines.Rows.Sum(l => (l.Units * l.UnitPrice) - l.Discount);
        var (canCancel, reason) = OrderStatusRules.CanCancel(row.Status);

        return new OrderView(row.Id, row.Status, row.OrderDate, row.BuyerName, lines.Rows, total, canCancel, reason, OrderStatusRules.NextStep(row.Status));
    }

    [McpServerTool(Name = "find_orders", ReadOnly = true)]
    [Description("Find orders by status, buyer name (partial, case-insensitive) or minimum age. Returns newest first. Use this to look orders up when you do not have an id.")]
    public async Task<OrderListResult> FindOrdersAsync(
        [Description("Order status: Submitted, AwaitingValidation, StockConfirmed, Paid, Shipped or Cancelled")] string? status = null,
        [Description("Part of the buyer name")] string? buyer = null,
        [Description("Only orders older than this many minutes")] int? older_than_minutes = null,
        [Description("Maximum number of orders to return (default 20, at most 50)")] int? limit = null,
        CancellationToken cancellationToken = default)
    {
        if (status is not null && !OrderStatusRules.IsKnown(status))
        {
            throw new McpException($"Unknown status '{status}'. Valid: {string.Join(", ", OrderStatusRules.AllStatuses)}.");
        }

        var result = await _db.QueryAsync<OrderSummaryView>(
            EShopDatabase.Ordering,
            OrderSummarySql(
                """
                WHERE (@status::text IS NULL OR o."OrderStatus" = @status)
                  AND (@buyer::text IS NULL OR b."Name" ILIKE @buyer ESCAPE '\')
                  AND (@olderThan::int IS NULL OR o."OrderDate" < now() - make_interval(mins => @olderThan::int))
                ORDER BY o."OrderDate" DESC, o."Id"
                """),
            new
            {
                status,
                buyer = buyer is { Length: > 0 } ? "%" + EscapeLike(buyer) + "%" : null,
                olderThan = older_than_minutes,
                fetch = ReadOnlyDb.ClampLimit(limit) + 1
            },
            limit,
            cancellationToken);

        return new OrderListResult(result.Rows, result.Truncated);
    }

    [McpServerTool(Name = "find_stuck_orders", ReadOnly = true)]
    [Description("Find orders stuck in the saga: Submitted, AwaitingValidation or StockConfirmed for longer than the threshold, oldest first, each with the step it is waiting for. Paid orders are not stuck (they wait for manual shipping).")]
    public async Task<StuckOrderListResult> FindStuckOrdersAsync(
        [Description("Minimum age in minutes (default 60)")] int min_age_minutes = 60,
        [Description("Maximum number of orders to return (default 20, at most 50)")] int? limit = null,
        CancellationToken cancellationToken = default)
    {
        var result = await _db.QueryAsync<OrderSummaryView>(
            EShopDatabase.Ordering,
            OrderSummarySql(
                """
                WHERE o."OrderStatus" IN ('Submitted', 'AwaitingValidation', 'StockConfirmed')
                  AND o."OrderDate" < now() - make_interval(mins => @minAge::int)
                ORDER BY o."OrderDate", o."Id"
                """),
            new { minAge = min_age_minutes, fetch = ReadOnlyDb.ClampLimit(limit) + 1 },
            limit,
            cancellationToken);

        var orders = result.Rows
            .Select(o => new StuckOrderView(o.Id, o.Status, o.OrderDate, o.BuyerName, o.Total, o.AgeMinutes, OrderStatusRules.NextStep(o.Status)))
            .ToList();

        return new StuckOrderListResult(orders, result.Truncated);
    }

    [McpServerTool(Name = "get_buyer_summary", ReadOnly = true)]
    [Description("Summarise one buyer: number of orders, total spent (cancelled orders excluded) and last order date. The buyer name is a case-insensitive partial match; if several buyers match, the error lists their names.")]
    public async Task<BuyerSummaryView> GetBuyerSummaryAsync(
        [Description("Buyer name or part of it")] string buyer,
        CancellationToken cancellationToken = default)
    {
        const string matchSql =
            """
            SELECT b."Id", b."Name"
            FROM ordering.buyers b
            WHERE b."Name" ILIKE @pattern ESCAPE '\'
            ORDER BY b."Name"
            LIMIT @fetch
            """;

        const int maxMatches = 10;
        var matches = await _db.QueryAsync<BuyerRow>(
            EShopDatabase.Ordering,
            matchSql,
            new { pattern = "%" + EscapeLike(buyer) + "%", fetch = maxMatches + 1 },
            maxMatches,
            cancellationToken);

        if (matches.Rows.Count == 0)
        {
            throw new McpException($"Buyer '{buyer}' not found. Use find_orders with a partial name.");
        }

        // An exact (case-insensitive) name wins over longer names that merely contain it.
        var chosen = matches.Rows.Count == 1
            ? matches.Rows[0]
            : matches.Rows.FirstOrDefault(m => string.Equals(m.Name, buyer, StringComparison.OrdinalIgnoreCase));

        if (chosen is null)
        {
            var names = string.Join(", ", matches.Rows.Select(m => m.Name)) + (matches.Truncated ? ", ..." : string.Empty);
            throw new McpException($"Several buyers match '{buyer}': {names}. Use the full name.");
        }

        const string summarySql =
            """
            SELECT b."Name" AS "BuyerName",
                   COUNT(o."Id")::int AS "OrderCount",
                   COALESCE(SUM(t.total) FILTER (WHERE o."OrderStatus" <> 'Cancelled'), 0) AS "TotalSpent",
                   MAX(o."OrderDate") AS "LastOrderDate"
            FROM ordering.buyers b
            LEFT JOIN ordering.orders o ON o."BuyerId" = b."Id"
            LEFT JOIN LATERAL (
                SELECT SUM(i."Units" * i."UnitPrice" - i."Discount") AS total
                FROM ordering."orderItems" i
                WHERE i."OrderId" = o."Id") t ON TRUE
            WHERE b."Id" = @buyerId
            GROUP BY b."Name"
            LIMIT @fetch
            """;

        var summary = await _db.QueryAsync<BuyerSummaryView>(EShopDatabase.Ordering, summarySql, new { buyerId = chosen.Id, fetch = 2 }, 1, cancellationToken);
        return summary.Rows[0];
    }

    private static string OrderSummarySql(string whereAndOrder)
    {
        return
            $"""
            SELECT o."Id", o."OrderStatus" AS "Status", o."OrderDate", COALESCE(b."Name", '') AS "BuyerName",
                   COALESCE((SELECT SUM(i."Units" * i."UnitPrice" - i."Discount") FROM ordering."orderItems" i WHERE i."OrderId" = o."Id"), 0) AS "Total",
                   GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - o."OrderDate")) / 60))::int AS "AgeMinutes"
            FROM ordering.orders o
            LEFT JOIN ordering.buyers b ON b."Id" = o."BuyerId"
            {whereAndOrder}
            LIMIT @fetch
            """;
    }

    private static string EscapeLike(string value)
    {
        return value.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
    }

    private sealed record OrderHeaderRow(int Id, string Status, DateTime OrderDate, string BuyerName);

    private sealed record BuyerRow(int Id, string Name);
}
