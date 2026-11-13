using eShop.Mcp.Ordering;

using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

using ModelContextProtocol.Client;

namespace eShop.Mcp.FunctionalTests;

public sealed class McpServerFactory : WebApplicationFactory<Program>
{
    private readonly string _catalogCs;
    private readonly string _orderingCs;
    private readonly IOrderingCommands? _ordering;

    public McpServerFactory(string catalogCs, string orderingCs, IOrderingCommands? ordering = null)
    {
        _catalogCs = catalogCs;
        _orderingCs = orderingCs;
        _ordering = ordering;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:catalogdb-readonly", _catalogCs);
        builder.UseSetting("ConnectionStrings:orderingdb-readonly", _orderingCs);

        if (_ordering is not null)
        {
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IOrderingCommands>();
                services.AddSingleton(_ordering);
            });
        }
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
