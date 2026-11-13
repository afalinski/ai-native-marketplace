using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

using ModelContextProtocol.Client;

namespace eShop.Mcp.FunctionalTests;

public sealed class McpServerFactory : WebApplicationFactory<Program>
{
    private readonly string _catalogCs;
    private readonly string _orderingCs;

    public McpServerFactory(string catalogCs, string orderingCs)
    {
        _catalogCs = catalogCs;
        _orderingCs = orderingCs;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:catalogdb-readonly", _catalogCs);
        builder.UseSetting("ConnectionStrings:orderingdb-readonly", _orderingCs);
    }

    public async Task<McpClient> CreateClientAsync(McpClientOptions? options = null)
    {
        var transport = new HttpClientTransport(
            new HttpClientTransportOptions { Endpoint = new Uri(Server.BaseAddress, "/mcp") },
            CreateClient(),
            ownsHttpClient: true);

        return await McpClient.CreateAsync(transport, options);
    }
}
