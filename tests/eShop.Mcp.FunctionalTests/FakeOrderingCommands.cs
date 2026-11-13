using System.Collections.Concurrent;
using System.Threading;

using eShop.Mcp.Ordering;

namespace eShop.Mcp.FunctionalTests;

public sealed class FakeOrderingCommands : IOrderingCommands
{
    private readonly ConcurrentQueue<(int OrderId, Guid RequestId)> _calls = new();

    public IReadOnlyList<(int OrderId, Guid RequestId)> Calls => _calls.ToArray();

    // When set, every call throws it after being recorded.
    public Exception? Failure { get; set; }

    public Task CancelOrderAsync(int orderId, Guid requestId, CancellationToken ct)
    {
        _calls.Enqueue((orderId, requestId));
        return Failure is null ? Task.CompletedTask : Task.FromException(Failure);
    }
}
