using System.Linq;

using ModelContextProtocol;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace eShop.Mcp.FunctionalTests;

[Collection(McpDatabaseCollection.Name)]
public sealed class ResourcesAndPromptsTests : IAsyncLifetime
{
    private readonly McpDatabaseFixture _fixture;
    private McpServerFactory _factory = default!;
    private McpClient _client = default!;

    public ResourcesAndPromptsTests(McpDatabaseFixture fixture)
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
    public async Task Lists_status_lifecycle_resource()
    {
        var resources = await _client.ListResourcesAsync(cancellationToken: TestContext.Current.CancellationToken);
        var lifecycle = Assert.Single(resources, r => r.Uri == "eshop://ordering/status-lifecycle");
        Assert.Equal("text/markdown", lifecycle.MimeType);

        var templates = await _client.ListResourceTemplatesAsync(cancellationToken: TestContext.Current.CancellationToken);
        Assert.Contains(templates, t => t.UriTemplate.StartsWith("eshop://docs/architecture/"));

        var result = await _client.ReadResourceAsync("eshop://ordering/status-lifecycle", cancellationToken: TestContext.Current.CancellationToken);
        var text = Assert.IsType<TextResourceContents>(Assert.Single(result.Contents)).Text;
        Assert.Contains("AwaitingValidation", text);
        Assert.Contains("OrderStatusChangedToPaidIntegrationEvent", text);
        Assert.Contains("manual", text);
    }

    [Fact]
    public async Task Reads_architecture_doc_by_name()
    {
        var overview = await _client.ReadResourceAsync("eshop://docs/architecture/overview", cancellationToken: TestContext.Current.CancellationToken);
        Assert.False(string.IsNullOrWhiteSpace(Assert.IsType<TextResourceContents>(Assert.Single(overview.Contents)).Text));

        var ordering = await _client.ReadResourceAsync("eshop://docs/architecture/services/ordering", cancellationToken: TestContext.Current.CancellationToken);
        Assert.Contains("Ordering", Assert.IsType<TextResourceContents>(Assert.Single(ordering.Contents)).Text);
    }

    [Fact]
    public async Task Unknown_doc_name_lists_valid_names()
    {
        var ex = await Assert.ThrowsAsync<McpProtocolException>(
            () => _client.ReadResourceAsync("eshop://docs/architecture/nope", cancellationToken: TestContext.Current.CancellationToken).AsTask());

        Assert.Contains("overview", ex.Message);
        Assert.Contains("services/ordering", ex.Message);
        Assert.DoesNotContain("_card-template", ex.Message);
    }

    [Fact]
    public async Task Investigate_prompt_mentions_order_id_and_tools()
    {
        var prompt = await _client.GetPromptAsync("investigate-stuck-order", new Dictionary<string, object> { ["order_id"] = 9002 }, cancellationToken: TestContext.Current.CancellationToken);

        var text = string.Join("\n", prompt.Messages.Select(m => ((TextContentBlock)m.Content).Text));
        Assert.Contains("get_order", text);
        Assert.Contains("9002", text);
        Assert.Contains("eshop://ordering/status-lifecycle", text);
    }

    [Fact]
    public async Task Daily_report_prompt_mentions_tools()
    {
        var prompt = await _client.GetPromptAsync("daily-ordering-report", cancellationToken: TestContext.Current.CancellationToken);

        var text = string.Join("\n", prompt.Messages.Select(m => ((TextContentBlock)m.Content).Text));
        Assert.Contains("find_orders", text);
        Assert.Contains("find_stuck_orders", text);
    }
}
