using eShop.Mcp.Data;
using eShop.ServiceDefaults;

using Microsoft.Extensions.DependencyInjection;

using Npgsql;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

builder.AddKeyedNpgsqlDataSource("catalogdb-readonly");
builder.AddKeyedNpgsqlDataSource("orderingdb-readonly");
builder.Services.AddSingleton(sp => new ReadOnlyDb(
    sp.GetRequiredKeyedService<NpgsqlDataSource>("catalogdb-readonly"),
    sp.GetRequiredKeyedService<NpgsqlDataSource>("orderingdb-readonly")));

builder.Services
    .AddMcpServer(options => options.ServerInfo = new() { Name = "eshop", Version = "1.0.0" })
    .WithHttpTransport()
    .WithToolsFromAssembly();

var app = builder.Build();

// Fail before serving anything if either connection could write.
await ReadOnlyRoleGuard.EnsureAsync(app.Services.GetRequiredKeyedService<NpgsqlDataSource>("catalogdb-readonly"), CancellationToken.None);
await ReadOnlyRoleGuard.EnsureAsync(app.Services.GetRequiredKeyedService<NpgsqlDataSource>("orderingdb-readonly"), CancellationToken.None);

app.MapDefaultEndpoints();
app.MapMcp("/mcp");

app.Run();

public partial class Program;
