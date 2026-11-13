using IdentityModel.Client;

using Polly.CircuitBreaker;
using Polly.Timeout;

namespace eShop.Mcp.Ordering;

// Gets a client-credentials token from Identity.API and keeps it until 60 seconds before it expires.
public sealed class ClientCredentialsTokenProvider
{
    private static readonly TimeSpan ExpirySkew = TimeSpan.FromSeconds(60);

    public const string HttpClientName = "identity";

    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _configuration;
    private readonly TimeProvider _time;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private string? _token;
    private DateTimeOffset _validUntil;

    public ClientCredentialsTokenProvider(IHttpClientFactory httpFactory, IConfiguration configuration, TimeProvider time)
    {
        _httpFactory = httpFactory;
        _configuration = configuration;
        _time = time;
    }

    // Called when Ordering.API answers 401, so the next cancel asks Identity for a fresh token.
    public void Invalidate()
    {
        _token = null;
    }

    public async Task<string> GetTokenAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_token is not null && _time.GetUtcNow() < _validUntil)
            {
                return _token;
            }

            var authority = _configuration["Identity:Url"];
            var secret = _configuration["Identity:ClientSecret"];
            if (string.IsNullOrEmpty(authority) || string.IsNullOrEmpty(secret))
            {
                throw new OrderingApiException("Identity:Url or Identity:ClientSecret is not configured.");
            }

            var http = _httpFactory.CreateClient(HttpClientName);
            TokenResponse response;
            try
            {
                response = await http.RequestClientCredentialsTokenAsync(
                    new ClientCredentialsTokenRequest
                    {
                        Address = authority.TrimEnd('/') + "/connect/token",
                        ClientId = "eshop-mcp",
                        ClientSecret = secret,
                        Scope = "orders"
                    },
                    ct);
            }
            catch (HttpRequestException ex)
            {
                throw new OrderingApiException("Identity.API is not reachable.", null, ex);
            }
            catch (Exception ex) when (ex is TimeoutRejectedException or BrokenCircuitException)
            {
                // Nothing was sent to Ordering yet, so the order is unchanged.
                throw new OrderingApiException("Identity.API did not answer in time.", null, ex);
            }

            if (response.IsError || string.IsNullOrEmpty(response.AccessToken))
            {
                throw new OrderingApiException(
                    $"Token request failed: {response.Error ?? response.ErrorDescription ?? "no token returned"}",
                    (int?)response.HttpStatusCode,
                    response.Exception);
            }

            _token = response.AccessToken;
            _validUntil = _time.GetUtcNow().AddSeconds(response.ExpiresIn) - ExpirySkew;
            return _token;
        }
        finally
        {
            _gate.Release();
        }
    }
}
