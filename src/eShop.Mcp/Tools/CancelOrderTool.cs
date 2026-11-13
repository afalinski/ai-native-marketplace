using System.ComponentModel;
using System.Globalization;
using System.Text.Json;

using eShop.Mcp.Data;
using eShop.Mcp.Ordering;

using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace eShop.Mcp.Tools;

// The only state-changing tool. The human confirms through MRTR elicitation: the first call throws InputRequiredException,
// the client asks the user and retries the same call with the answer. The order is loaded again on every call, so a status
// that changed while the user was deciding is caught before anything is sent.
[McpServerToolType]
public sealed class CancelOrderTool
{
    private const string ConfirmKey = "confirm";
    private const int MaxReasonLength = 200;

    private readonly OrderTools _orders;
    private readonly IOrderingCommands _ordering;
    private readonly CancelConfirmation _confirmation;

    public CancelOrderTool(ReadOnlyDb db, IOrderingCommands ordering, CancelConfirmation confirmation)
    {
        _orders = new OrderTools(db);
        _ordering = ordering;
        _confirmation = confirmation;
    }

    // Outcomes: success and "the user said no" are normal text; every case where the order is still not cancelled
    // because something is wrong or missing (not cancellable, no way to ask, Ordering failure) is isError=true.
    [McpServerTool(Name = "cancel_order", Destructive = true, ReadOnly = false)]
    [Description("Cancel an order. Always asks the human to confirm first. Orders that are Paid, Shipped or already Cancelled cannot be cancelled.")]
    public async Task<CallToolResult> CancelOrderAsync(
        McpServer server,
        RequestContext<CallToolRequestParams> context,
        [Description("The order id")] int order_id,
        [Description("Why the order is cancelled")] string reason,
        CancellationToken cancellationToken = default)
    {
        var responses = context.Params?.InputResponses;

        // An answer is only valid together with the state of the question that was asked for this order and reason.
        if (responses is not null && !_confirmation.Matches(context.Params?.RequestState, order_id, reason))
        {
            return Error("Not cancelled: confirmation is missing or does not match this order.");
        }

        var order = await _orders.GetOrderAsync(order_id, cancellationToken);
        if (!order.CanCancel)
        {
            return Error($"Not cancelled: {order.CancelReason}");
        }

        if (responses is null || !responses.TryGetValue(ConfirmKey, out var answer))
        {
            // IsMrtrSupported only reflects the protocol version; a client without an elicitation handler still negotiates it.
            if (!server.IsMrtrSupported || server.ClientCapabilities?.Elicitation is null)
            {
                return Error("Not cancelled: this client cannot ask the user for confirmation.");
            }

            throw new InputRequiredException(
                inputRequests: new Dictionary<string, InputRequest>
                {
                    [ConfirmKey] = InputRequest.ForElicitation(new ElicitRequestParams
                    {
                        Message = BuildMessage(order, reason),
                        RequestedSchema = new ElicitRequestParams.RequestSchema
                        {
                            Properties = new Dictionary<string, ElicitRequestParams.PrimitiveSchemaDefinition>
                            {
                                [ConfirmKey] = new ElicitRequestParams.BooleanSchema { Title = "Confirm", Description = "Cancel this order?" }
                            }
                        }
                    })
                },
                requestState: _confirmation.Protect(order.Id, reason, order.Status));
        }

        var result = answer.Deserialize(InputResponse.ElicitResultJsonTypeInfo);
        var confirmed = result is { IsAccepted: true }
            && result.Content?.TryGetValue(ConfirmKey, out var value) == true
            && value.ValueKind == JsonValueKind.True;
        if (!confirmed)
        {
            return Text("Not cancelled: the user did not confirm.");
        }

        // The Ordering client does not retry (no retry for PUT), so one cancel request is sent at most once.
        try
        {
            await _ordering.CancelOrderAsync(order_id, Guid.NewGuid(), cancellationToken);
        }
        catch (OrderingTimeoutException)
        {
            // The PUT may have reached Ordering before the timeout, so the state is unknown.
            return Error("Not cancelled for sure: the Ordering service did not answer in time. The order may or may not be cancelled — check with get_order.");
        }
        catch (OrderingApiException ex)
        {
            var code = ex.StatusCode is { } status ? status.ToString(CultureInfo.InvariantCulture) : "unreachable";
            return Error($"Not cancelled: Ordering service error ({code}). The order is unchanged.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // A timeout that was not mapped by the client, not the caller giving up: the state is unknown.
            return Error("Not cancelled for sure: the Ordering service did not answer in time. The order may or may not be cancelled — check with get_order.");
        }

        return Text($"Order {order_id} cancelled.");
    }

    private static string BuildMessage(OrderView order, string reason)
    {
        var items = order.Lines.Sum(l => l.Units);
        var total = order.Total.ToString("C", CultureInfo.GetCultureInfo("en-US"));
        var shownReason = reason.Length > MaxReasonLength ? reason[..MaxReasonLength] + "..." : reason;
        return $"Cancel order #{order.Id} of {order.BuyerName}: {items} items, {total}, status {order.Status}? Reason: \"{shownReason}\"";
    }

    private static CallToolResult Text(string text)
    {
        return new CallToolResult { Content = [new TextContentBlock { Text = text }] };
    }

    private static CallToolResult Error(string text)
    {
        return new CallToolResult { IsError = true, Content = [new TextContentBlock { Text = text }] };
    }
}
