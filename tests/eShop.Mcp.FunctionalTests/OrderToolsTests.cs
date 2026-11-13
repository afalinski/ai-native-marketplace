using System.Linq;
using System.Reflection;
using System.Text.Json;

using eShop.Mcp.Domain;
using eShop.Ordering.Domain.AggregatesModel.OrderAggregate;

using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace eShop.Mcp.FunctionalTests;

[Collection(McpDatabaseCollection.Name)]
public sealed class OrderToolsTests : IAsyncLifetime
{
    private readonly McpDatabaseFixture _fixture;
    private McpServerFactory _factory = default!;
    private McpClient _client = default!;

    public OrderToolsTests(McpDatabaseFixture fixture)
    {
        _fixture = fixture;
    }

    public async ValueTask InitializeAsync()
    {
        await _fixture.SeedAsync();
        _factory = new McpServerFactory(_fixture.ReadOnlyCatalogCs, _fixture.ReadOnlyOrderingCs);
        _client = await _factory.CreateClientAsync();
    }

    public async ValueTask DisposeAsync()
    {
        await _client.DisposeAsync();
        await _factory.DisposeAsync();
    }

    [Fact]
    public async Task Get_order_returns_lines_and_total()
    {
        var order = await CallAsync("get_order", new() { ["order_id"] = 9002 });

        Assert.Equal(249.97m, order.GetProperty("total").GetDecimal());
        Assert.Equal(2, order.GetProperty("lines").GetArrayLength());
        Assert.Equal("Jane Fox", order.GetProperty("buyerName").GetString());
        Assert.Equal("AwaitingValidation", order.GetProperty("status").GetString());
        Assert.True(order.GetProperty("canCancel").GetBoolean());
    }

    [Fact]
    public async Task Get_order_applies_discount()
    {
        var order = await CallAsync("get_order", new() { ["order_id"] = 9015 });

        Assert.Equal(269.99m, order.GetProperty("total").GetDecimal());
    }

    [Fact]
    public async Task Get_order_paid_cannot_be_cancelled()
    {
        var order = await CallAsync("get_order", new() { ["order_id"] = 9003 });

        Assert.False(order.GetProperty("canCancel").GetBoolean());
        Assert.Equal("shipping", order.GetProperty("nextStep").GetString());
    }

    [Fact]
    public async Task Get_order_unknown_id_is_actionable()
    {
        var error = await CallExpectingErrorAsync("get_order", new() { ["order_id"] = 424242 });

        Assert.Equal("Order 424242 not found. Use find_orders to search.", error);
    }

    [Fact]
    public async Task Find_stuck_orders_oldest_first()
    {
        var result = await CallAsync("find_stuck_orders", new() { ["min_age_minutes"] = 120 });

        var orders = result.GetProperty("orders").EnumerateArray().ToList();
        Assert.Equal([9010, 9006, 9014, 9002], orders.Select(o => o.GetProperty("id").GetInt32()).ToList());
        Assert.All(orders, o => Assert.False(string.IsNullOrEmpty(o.GetProperty("nextStep").GetString())));
    }

    [Fact]
    public async Task Find_orders_unknown_status_lists_valid_values()
    {
        var error = await CallExpectingErrorAsync("find_orders", new() { ["status"] = "Bogus" });

        Assert.Equal("Unknown status 'Bogus'. Valid: Submitted, AwaitingValidation, StockConfirmed, Paid, Shipped, Cancelled.", error);
    }

    [Fact]
    public async Task Find_orders_filters_by_status_and_buyer()
    {
        var result = await CallAsync("find_orders", new() { ["status"] = "Shipped", ["buyer"] = "marcus" });

        var order = Assert.Single(result.GetProperty("orders").EnumerateArray());
        Assert.Equal(9008, order.GetProperty("id").GetInt32());
        Assert.Equal(179.99m, order.GetProperty("total").GetDecimal());
    }

    [Fact]
    public async Task Buyer_summary_excludes_cancelled()
    {
        var summary = await CallAsync("get_buyer_summary", new() { ["buyer"] = "Marcus Lee" });

        Assert.Equal(4, summary.GetProperty("orderCount").GetInt32());
        Assert.Equal(617.95m, summary.GetProperty("totalSpent").GetDecimal());
    }

    [Fact]
    public async Task Buyer_summary_unknown_is_actionable()
    {
        var error = await CallExpectingErrorAsync("get_buyer_summary", new() { ["buyer"] = "Nobody" });

        Assert.Equal("Buyer 'Nobody' not found. Use find_orders with a partial name.", error);
    }

    [Fact]
    public async Task Buyer_summary_ambiguous_lists_names()
    {
        // "a" matches several seeded buyers.
        var error = await CallExpectingErrorAsync("get_buyer_summary", new() { ["buyer"] = "a" });

        Assert.Contains("Several buyers match 'a'", error);
        Assert.Contains("Marcus Lee", error);
    }

    [Fact]
    public void OrderStatusRules_matches_domain()
    {
        var property = typeof(Order).GetProperty(nameof(Order.OrderStatus), BindingFlags.Public | BindingFlags.Instance)!;

        foreach (var status in Enum.GetValues<OrderStatus>())
        {
            var name = status.ToString();
            Assert.True(OrderStatusRules.IsKnown(name));
            Assert.Equal(status is OrderStatus.Shipped or OrderStatus.Cancelled, OrderStatusRules.IsFinal(name));

            var order = Order.NewDraft();
            property.SetValue(order, status);
            var domainAllowsCancel = Record.Exception(order.SetCancelledStatus) is null;

            var (canCancel, reason) = OrderStatusRules.CanCancel(name);
            Assert.False(string.IsNullOrEmpty(reason));
            if (status == OrderStatus.Cancelled)
            {
                // The domain re-cancels silently; the tool reports it as not cancellable on purpose.
                Assert.False(canCancel);
            }
            else
            {
                Assert.Equal(domainAllowsCancel, canCancel);
            }
        }
    }

    private async Task<JsonElement> CallAsync(string tool, Dictionary<string, object?> arguments)
    {
        var response = await _client.CallToolAsync(tool, arguments, cancellationToken: TestContext.Current.CancellationToken);

        Assert.NotEqual(true, response.IsError);
        var text = response.Content.OfType<TextContentBlock>().Single().Text;
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private async Task<string> CallExpectingErrorAsync(string tool, Dictionary<string, object?> arguments)
    {
        var response = await _client.CallToolAsync(tool, arguments, cancellationToken: TestContext.Current.CancellationToken);

        Assert.True(response.IsError);
        var text = response.Content.OfType<TextContentBlock>().Single().Text;

        // The SDK prefixes the McpException message with the tool name; the message itself is passed through unchanged.
        var prefix = $"An error occurred invoking '{tool}': ";
        Assert.StartsWith(prefix, text);
        return text[prefix.Length..];
    }
}
