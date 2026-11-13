using System.Text.Json;

using Microsoft.AspNetCore.DataProtection;

namespace eShop.Mcp.Tools;

// Binds a confirmation answer to the question that was asked. The server keeps no state between the two calls, so the
// question (order id, reason, status) travels in requestState as a signed, encrypted, time-limited payload.
public sealed class CancelConfirmation
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(5);

    private readonly ITimeLimitedDataProtector _protector;

    public CancelConfirmation(IDataProtectionProvider provider)
    {
        _protector = provider.CreateProtector("eShop.Mcp.CancelOrder.v1").ToTimeLimitedDataProtector();
    }

    public string Protect(int orderId, string reason, string statusAtAsk)
    {
        return _protector.Protect(JsonSerializer.Serialize(new Payload(orderId, reason, statusAtAsk)), Lifetime);
    }

    public bool Matches(string? state, int orderId, string reason)
    {
        if (string.IsNullOrEmpty(state))
        {
            return false;
        }

        try
        {
            var payload = JsonSerializer.Deserialize<Payload>(_protector.Unprotect(state));
            return payload is not null && payload.OrderId == orderId && payload.Reason == reason;
        }
        catch (Exception ex) when (ex is System.Security.Cryptography.CryptographicException or JsonException)
        {
            return false;
        }
    }

    private sealed record Payload(int OrderId, string Reason, string StatusAtAsk);
}
