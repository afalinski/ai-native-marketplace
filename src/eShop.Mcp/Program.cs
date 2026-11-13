using eShop.Mcp.Data;
using eShop.Mcp.Ordering;
using eShop.Mcp.Tools;
using eShop.ServiceDefaults;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

using Npgsql;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

builder.AddKeyedNpgsqlDataSource("catalogdb-readonly");
builder.AddKeyedNpgsqlDataSource("orderingdb-readonly");
builder.Services.AddSingleton(sp => new ReadOnlyDb(
    sp.GetRequiredKeyedService<NpgsqlDataSource>("catalogdb-readonly"),
    sp.GetRequiredKeyedService<NpgsqlDataSource>("orderingdb-readonly")));

// Identity:Url and Identity:ClientSecret are read when the first token is requested, so the server starts without them.
builder.Services.TryAddSingleton(TimeProvider.System);
builder.Services.AddHttpClient(ClientCredentialsTokenProvider.HttpClientName);
builder.Services.AddSingleton<ClientCredentialsTokenProvider>();
builder.Services.AddDataProtection();
builder.Services.AddSingleton<CancelConfirmation>();
builder.Services.AddOrderingClient();

builder.Services
    .AddMcpServer(options => options.ServerInfo = new() { Name = "eshop", Version = "1.0.0" })
    .WithHttpTransport()
    .WithToolsFromAssembly()
    .WithResourcesFromAssembly()
    .WithPromptsFromAssembly();

var app = builder.Build();

// Fail before serving anything if either connection could write.
await ReadOnlyRoleGuard.EnsureAsync(app.Services.GetRequiredKeyedService<NpgsqlDataSource>("catalogdb-readonly"), CancellationToken.None);
await ReadOnlyRoleGuard.EnsureAsync(app.Services.GetRequiredKeyedService<NpgsqlDataSource>("orderingdb-readonly"), CancellationToken.None);

app.MapDefaultEndpoints();
app.MapMcp("/mcp");

app.Run();

public partial class Program;
