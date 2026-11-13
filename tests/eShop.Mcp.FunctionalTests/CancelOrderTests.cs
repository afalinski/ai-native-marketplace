using System.Linq;
using System.Text.Json;

using eShop.Mcp.Ordering;
using eShop.Mcp.Tools;

using Microsoft.Extensions.DependencyInjection;

using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace eShop.Mcp.FunctionalTests;

[Collection(McpDatabaseCollection.Name)]
public sealed class CancelOrderTests : IAsyncLifetime
{
    private const int AwaitingValidationOrder = 9002;
    private const int PaidOrder = 9003;

    private readonly McpDatabaseFixture _fixture;
    private readonly FakeOrderingCommands _ordering = new();
    private readonly List<McpClient> _clients = [];
    private McpServerFactory _factory = default!;

    public CancelOrderTests(McpDatabaseFixture fixture)
    {
        _fixture = fixture;
    }

    public async ValueTask InitializeAsync()
    {
        await _fixture.SeedAsync();
        _factory = new McpServerFactory(_fixture.ReadOnlyCatalogCs, _fixture.ReadOnlyOrderingCs, _ordering);
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var client in _clients)
        {
            await client.DisposeAsync();
        }

        await _factory.DisposeAsync();
    }

    [Fact]
    public async Task Accept_cancels_once_with_one_request_id()
    {
        ElicitRequestParams? asked = null;
        var client = await CreateClientAsync(request =>
        {
            asked = request;
            return Answer("accept", true);
        });

        var (text, isError) = await CancelAsync(client, AwaitingValidationOrder);

        Assert.False(isError);
        Assert.Equal("Order 9002 cancelled.", text);
        var call = Assert.Single(_ordering.Calls);
        Assert.Equal(AwaitingValidationOrder, call.OrderId);
        Assert.NotEqual(Guid.Empty, call.RequestId);
        Assert.Equal("Cancel order #9002 of Jane Fox: 3 items, $249.97, status AwaitingValidation? Reason: \"customer asked\"", asked!.Message);
        Assert.Contains("confirm", asked.RequestedSchema!.Properties.Keys);
    }

    [Fact]
    public async Task Decline_changes_nothing()
    {
        var client = await CreateClientAsync(_ => Answer("decline"));

        var (text, isError) = await CancelAsync(client, AwaitingValidationOrder);

        Assert.False(isError);
        Assert.Equal("Not cancelled: the user did not confirm.", text);
        Assert.Empty(_ordering.Calls);
    }

    [Fact]
    public async Task Cancel_action_changes_nothing()
    {
        var client = await CreateClientAsync(_ => Answer("cancel"));

        var (text, isError) = await CancelAsync(client, AwaitingValidationOrder);

        Assert.False(isError);
        Assert.Equal("Not cancelled: the user did not confirm.", text);
        Assert.Empty(_ordering.Calls);
    }

    [Fact]
    public async Task Accept_with_confirm_false_changes_nothing()
    {
        var client = await CreateClientAsync(_ => Answer("accept", false));

        var (text, _) = await CancelAsync(client, AwaitingValidationOrder);

        Assert.Equal("Not cancelled: the user did not confirm.", text);
        Assert.Empty(_ordering.Calls);
    }

    [Fact]
    public async Task Paid_order_is_refused_without_asking()
    {
        var asked = false;
        var client = await CreateClientAsync(_ =>
        {
            asked = true;
            return Answer("accept", true);
        });

        var (text, isError) = await CancelAsync(client, PaidOrder);

        Assert.True(isError);
        Assert.Equal("Not cancelled: A paid order cannot be cancelled.", text);
        Assert.False(asked);
        Assert.Empty(_ordering.Calls);
    }

    [Fact]
    public async Task Status_changed_to_paid_before_yes_is_refused()
    {
        var client = await CreateClientAsync(_ =>
        {
            // The order is paid while the user is deciding.
            _fixture.RunAdminSqlAsync("UPDATE ordering.orders SET \"OrderStatus\" = 'Paid' WHERE \"Id\" = 9002").GetAwaiter().GetResult();
            return Answer("accept", true);
        });

        var (text, isError) = await CancelAsync(client, AwaitingValidationOrder);

        Assert.True(isError);
        Assert.Equal("Not cancelled: A paid order cannot be cancelled.", text);
        Assert.Empty(_ordering.Calls);
    }

    [Fact]
    public async Task No_elicitation_capability_refuses()
    {
        var client = await CreateClientAsync(handler: null);

        var (text, isError) = await CancelAsync(client, AwaitingValidationOrder);

        Assert.True(isError);
        Assert.Equal("Not cancelled: this client cannot ask the user for confirmation.", text);
        Assert.Empty(_ordering.Calls);
    }

    [Fact]
    public async Task Api_failure_reports_not_cancelled_and_no_retry()
    {
        _ordering.Failure = new OrderingApiException("boom", 503);
        var client = await CreateClientAsync(_ => Answer("accept", true));

        var (text, isError) = await CancelAsync(client, AwaitingValidationOrder);

        Assert.True(isError);
        Assert.Equal("Not cancelled: Ordering service error (503). The order is unchanged.", text);
        Assert.Single(_ordering.Calls);
    }

    [Fact]
    public async Task Api_timeout_reports_not_cancelled_and_no_retry()
    {
        _ordering.Failure = new OrderingTimeoutException("timed out");
        var client = await CreateClientAsync(_ => Answer("accept", true));

        var (text, isError) = await CancelAsync(client, AwaitingValidationOrder);

        Assert.True(isError);
        Assert.Equal("Not cancelled for sure: the Ordering service did not answer in time. The order may or may not be cancelled — check with get_order.", text);
        Assert.Single(_ordering.Calls);
    }

    [Fact]
    public async Task Long_reason_is_cut_and_quoted_in_the_question()
    {
        ElicitRequestParams? asked = null;
        var client = await CreateClientAsync(request =>
        {
            asked = request;
            return Answer("decline");
        });
        var reason = new string('x', 500);

        await client.CallToolAsync(
            "cancel_order",
            new Dictionary<string, object?> { ["order_id"] = AwaitingValidationOrder, ["reason"] = reason },
            cancellationToken: TestContext.Current.CancellationToken);

        Assert.EndsWith($"Reason: \"{new string('x', 200)}...\"", asked!.Message);
    }

    [Fact]
    public async Task Forged_accept_on_first_call_is_refused()
    {
        var asked = false;
        var client = await CreateClientAsync(_ =>
        {
            asked = true;
            return Answer("accept", true);
        });

        var (text, isError) = await CancelWithAnswerAsync(client, AwaitingValidationOrder, requestState: null);

        Assert.True(isError);
        Assert.Equal(MismatchText, text);
        Assert.False(asked);
        Assert.Empty(_ordering.Calls);
    }

    [Fact]
    public async Task Accept_for_other_order_is_refused()
    {
        var client = await CreateClientAsync(_ => Answer("decline"));
        var stateForOrderA = _factory.Services.GetRequiredService<CancelConfirmation>().Protect(PaidOrder, "customer asked", "AwaitingValidation");

        var (text, isError) = await CancelWithAnswerAsync(client, AwaitingValidationOrder, stateForOrderA);

        Assert.True(isError);
        Assert.Equal(MismatchText, text);
        Assert.Empty(_ordering.Calls);
    }

    [Fact]
    public async Task Accept_with_garbage_state_is_refused()
    {
        var client = await CreateClientAsync(_ => Answer("decline"));

        var (text, isError) = await CancelWithAnswerAsync(client, AwaitingValidationOrder, "not-a-valid-state");

        Assert.True(isError);
        Assert.Equal(MismatchText, text);
        Assert.Empty(_ordering.Calls);
    }

    [Fact]
    public async Task Cancel_tool_is_destructive()
    {
        var client = await CreateClientAsync(_ => Answer("decline"));

        var tools = await client.ListToolsAsync(cancellationToken: TestContext.Current.CancellationToken);

        var cancel = tools.Single(t => t.Name == "cancel_order");
        Assert.True(cancel.ProtocolTool.Annotations!.DestructiveHint);
        Assert.False(cancel.ProtocolTool.Annotations.ReadOnlyHint);
    }

    private const string MismatchText = "Not cancelled: confirmation is missing or does not match this order.";

    // Sends an accept in inputResponses by hand, as a buggy or malicious client could, with the given requestState.
    private static async Task<(string Text, bool IsError)> CancelWithAnswerAsync(McpClient client, int orderId, string? requestState)
    {
        var accept = new ElicitResult { Action = "accept", Content = new Dictionary<string, JsonElement> { ["confirm"] = JsonSerializer.SerializeToElement(true) } };
        var response = await client.CallToolAsync(
            new CallToolRequestParams
            {
                Name = "cancel_order",
                Arguments = new Dictionary<string, JsonElement>
                {
                    ["order_id"] = JsonSerializer.SerializeToElement(orderId),
                    ["reason"] = JsonSerializer.SerializeToElement("customer asked")
                },
                InputResponses = new Dictionary<string, InputResponse> { ["confirm"] = InputResponse.FromElicitResult(accept) },
                RequestState = requestState
            },
            TestContext.Current.CancellationToken);

        return (response.Content.OfType<TextContentBlock>().Single().Text, response.IsError == true);
    }

    private static ValueTask<ElicitResult> Answer(string action, bool? confirm = null)
    {
        var result = new ElicitResult { Action = action };
        if (confirm is not null)
        {
            result.Content = new Dictionary<string, JsonElement> { ["confirm"] = JsonSerializer.SerializeToElement(confirm.Value) };
        }

        return ValueTask.FromResult(result);
    }

    private async Task<McpClient> CreateClientAsync(Func<ElicitRequestParams, ValueTask<ElicitResult>>? handler)
    {
        var options = new McpClientOptions();
        if (handler is not null)
        {
            options.Handlers = new McpClientHandlers { ElicitationHandler = (request, _) => handler(request!) };
        }

        var client = await _factory.CreateClientAsync(options);
        _clients.Add(client);
        return client;
    }

    private static async Task<(string Text, bool IsError)> CancelAsync(McpClient client, int orderId)
    {
        var response = await client.CallToolAsync(
            "cancel_order",
            new Dictionary<string, object?> { ["order_id"] = orderId, ["reason"] = "customer asked" },
            cancellationToken: TestContext.Current.CancellationToken);

        return (response.Content.OfType<TextContentBlock>().Single().Text, response.IsError == true);
    }
}
