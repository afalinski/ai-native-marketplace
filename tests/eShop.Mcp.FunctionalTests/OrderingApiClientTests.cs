using System.Net;
using System.Net.Http;
using System.Threading;

using eShop.Mcp.Ordering;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http.Resilience;

using Polly.Timeout;

namespace eShop.Mcp.FunctionalTests;

// The real OrderingApiClient with the real resilience setup, over a stub in place of the network.
public sealed class OrderingApiClientTests
{
    [Fact]
    public async Task Server_error_is_sent_once_and_not_retried()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError));
        using var provider = BuildProvider(handler);

        var ex = await Assert.ThrowsAsync<OrderingApiException>(
            () => provider.GetRequiredService<IOrderingCommands>().CancelOrderAsync(9002, Guid.NewGuid(), CancellationToken.None));

        Assert.Equal(500, ex.StatusCode);
        Assert.Equal(1, handler.OrderingRequests);
    }

    [Fact]
    public async Task Timeout_rejection_is_reported_as_unknown_state()
    {
        var handler = new StubHandler(_ => throw new TimeoutRejectedException("timed out"));
        using var provider = BuildProvider(handler);

        await Assert.ThrowsAsync<OrderingTimeoutException>(
            () => provider.GetRequiredService<IOrderingCommands>().CancelOrderAsync(9002, Guid.NewGuid(), CancellationToken.None));

        Assert.Equal(1, handler.OrderingRequests);
    }

    private static ServiceProvider BuildProvider(StubHandler handler)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<TimeProvider>(TimeProvider.System);
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Identity:Url"] = "http://identity.test",
            ["Identity:ClientSecret"] = "secret"
        }).Build());

        // What AddServiceDefaults does for every client in the real host.
        services.ConfigureHttpClientDefaults(http =>
        {
            http.AddStandardResilienceHandler();
            http.ConfigurePrimaryHttpMessageHandler(() => handler);
        });
        services.AddHttpClient(ClientCredentialsTokenProvider.HttpClientName);
        services.AddSingleton<ClientCredentialsTokenProvider>();
        services.AddOrderingClient();
        return services.BuildServiceProvider();
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _ordering;
        private int _orderingRequests;

        public StubHandler(Func<HttpRequestMessage, HttpResponseMessage> ordering)
        {
            _ordering = ordering;
        }

        public int OrderingRequests => _orderingRequests;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri!.Host == "identity.test")
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"access_token\":\"t\",\"expires_in\":3600,\"token_type\":\"Bearer\"}", System.Text.Encoding.UTF8, "application/json")
                });
            }

            Interlocked.Increment(ref _orderingRequests);
            return Task.FromResult(_ordering(request));
        }
    }
}
