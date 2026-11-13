namespace eShop.Mcp.Ordering;

// The only way the MCP server changes anything: through Ordering.API, never through the database.
public interface IOrderingCommands
{
    Task CancelOrderAsync(int orderId, Guid requestId, CancellationToken ct);
}

public sealed class OrderingApiException : Exception
{
    public OrderingApiException(string message, int? statusCode = null, Exception? inner = null)
        : base(message, inner)
    {
        StatusCode = statusCode;
    }

    public int? StatusCode { get; }
}

// The PUT was sent (or may have been) and no answer came back in time: the order state is unknown.
public sealed class OrderingTimeoutException : Exception
{
    public OrderingTimeoutException(string message, Exception? inner = null)
        : base(message, inner)
    {
    }
}
