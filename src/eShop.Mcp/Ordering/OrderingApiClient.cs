using System.Net.Http.Headers;
using System.Net.Http.Json;

using Polly.CircuitBreaker;
using Polly.Timeout;

namespace eShop.Mcp.Ordering;

public sealed class OrderingApiClient : IOrderingCommands
{
    private readonly HttpClient _http;
    private readonly ClientCredentialsTokenProvider _tokens;

    public OrderingApiClient(HttpClient http, ClientCredentialsTokenProvider tokens)
    {
        _http = http;
        _tokens = tokens;
    }

    public async Task CancelOrderAsync(int orderId, Guid requestId, CancellationToken ct)
    {
        var token = await _tokens.GetTokenAsync(ct);

        using var request = new HttpRequestMessage(HttpMethod.Put, "api/orders/cancel?api-version=1.0")
        {
            Content = JsonContent.Create(new { orderNumber = orderId })
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Add("x-requestid", requestId.ToString());

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, ct);
        }
        catch (HttpRequestException ex)
        {
            throw new OrderingApiException("Ordering.API is not reachable.", ex.StatusCode is { } code ? (int)code : null, ex);
        }
        catch (BrokenCircuitException ex)
        {
            // The circuit is open: the request was not sent.
            throw new OrderingApiException("Ordering.API circuit is open.", null, ex);
        }
        catch (Exception ex) when (ex is TimeoutRejectedException || (ex is OperationCanceledException && !ct.IsCancellationRequested))
        {
            throw new OrderingTimeoutException("Ordering.API did not answer in time.", ex);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                {
                    _tokens.Invalidate();
                }

                throw new OrderingApiException($"Ordering.API returned {(int)response.StatusCode}.", (int)response.StatusCode);
            }
        }
    }
}
