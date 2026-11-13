using System.Net;
using System.Net.Http;
using System.Threading;

using eShop.Mcp.Ordering;

namespace eShop.Mcp.FunctionalTests;

public sealed class TokenProviderTests
{
    [Fact]
    public async Task Two_requests_reuse_one_token_until_invalidated()
    {
        var handler = new CountingHandler();
        var provider = new ClientCredentialsTokenProvider(
            new StubFactory(handler),
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Identity:Url"] = "http://identity.test",
                ["Identity:ClientSecret"] = "secret"
            }).Build(),
            TimeProvider.System);

        var first = await provider.GetTokenAsync(CancellationToken.None);
        var second = await provider.GetTokenAsync(CancellationToken.None);

        Assert.Equal(first, second);
        Assert.Equal(1, handler.Requests);

        provider.Invalidate();
        await provider.GetTokenAsync(CancellationToken.None);

        Assert.Equal(2, handler.Requests);
    }

    private sealed class CountingHandler : HttpMessageHandler
    {
        public int Requests { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($"{{\"access_token\":\"token-{Requests}\",\"expires_in\":3600,\"token_type\":\"Bearer\"}}", System.Text.Encoding.UTF8, "application/json")
            });
        }
    }

    private sealed class StubFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;

        public StubFactory(HttpMessageHandler handler)
        {
            _handler = handler;
        }

        public HttpClient CreateClient(string name)
        {
            return new HttpClient(_handler, disposeHandler: false);
        }
    }
}
