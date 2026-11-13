using System.Linq;
using System.Text.Json;

using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace eShop.Mcp.FunctionalTests;

[Collection(McpDatabaseCollection.Name)]
public sealed class CatalogToolsTests : IAsyncLifetime
{
    private readonly McpDatabaseFixture _fixture;
    private McpServerFactory _factory = default!;
    private McpClient _client = default!;

    public CatalogToolsTests(McpDatabaseFixture fixture)
    {
        _fixture = fixture;
    }

    public async ValueTask InitializeAsync()
    {
        await _fixture.SeedCatalogFromJsonAsync();
        _factory = new McpServerFactory(_fixture.ReadOnlyCatalogCs, _fixture.ReadOnlyOrderingCs);
        _client = await _factory.CreateClientAsync();
    }

    public async ValueTask DisposeAsync()
    {
        await _client.DisposeAsync();
        await _factory.DisposeAsync();
    }

    [Fact]
    public async Task Lists_search_catalog_as_read_only()
    {
        var tools = await _client.ListToolsAsync(cancellationToken: TestContext.Current.CancellationToken);

        var tool = Assert.Single(tools, t => t.Name == "search_catalog");
        Assert.True(tool.ProtocolTool.Annotations?.ReadOnlyHint);
    }

    [Fact]
    public async Task Max_price_filters()
    {
        var result = await CallAsync(new Dictionary<string, object?> { ["max_price"] = 30 });

        var items = result.GetProperty("items").EnumerateArray().ToList();
        Assert.NotEmpty(items);
        Assert.All(items, i => Assert.True(i.GetProperty("price").GetDecimal() <= 30));
    }

    [Fact]
    public async Task Limit_is_clamped()
    {
        var result = await CallAsync(new Dictionary<string, object?> { ["limit"] = 1000 });

        Assert.True(result.GetProperty("items").GetArrayLength() <= 50);
        Assert.True(result.GetProperty("truncated").GetBoolean());
    }

    [Fact]
    public async Task Special_characters_are_literal()
    {
        var result = await CallAsync(new Dictionary<string, object?> { ["query"] = "O'Neil 100%_" });

        Assert.Equal(0, result.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task Description_is_in_untrusted_text()
    {
        var result = await CallAsync(new Dictionary<string, object?> { ["limit"] = 1 });

        var item = result.GetProperty("items")[0];
        Assert.True(item.TryGetProperty("untrusted_text", out _));
        Assert.False(item.TryGetProperty("untrustedText", out _));
        Assert.False(item.TryGetProperty("description", out _));
    }

    private async Task<JsonElement> CallAsync(Dictionary<string, object?> arguments)
    {
        var response = await _client.CallToolAsync("search_catalog", arguments, cancellationToken: TestContext.Current.CancellationToken);

        Assert.NotEqual(true, response.IsError);
        var text = response.Content.OfType<TextContentBlock>().Single().Text;
        return JsonDocument.Parse(text).RootElement.Clone();
    }
}
