using Microsoft.Extensions.Http.Resilience;

namespace eShop.Mcp.Ordering;

public static class OrderingClientRegistration
{
    // AddServiceDefaults gives every HttpClient the standard resilience handler, which retries 5xx, 408, 429 and timeouts.
    // A retried cancel could report success after a failure or leave the state unknown, so this client keeps the handler
    // (timeout, circuit breaker) but gets no retry for unsafe methods such as PUT.
    public static IServiceCollection AddOrderingClient(this IServiceCollection services)
    {
        // RemoveAllResilienceHandlers is marked experimental in Microsoft.Extensions.Http.Resilience 10.10.0.
#pragma warning disable EXTEXP0001
        services
            .AddHttpClient<IOrderingCommands, OrderingApiClient>(client => client.BaseAddress = new Uri("http://ordering-api"))
            .RemoveAllResilienceHandlers()
            .AddStandardResilienceHandler(options => options.Retry.DisableForUnsafeHttpMethods());
#pragma warning restore EXTEXP0001
        return services;
    }
}
