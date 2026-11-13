extern alias CatalogApi;

using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;

using CatalogApi::eShop.Catalog.API.Infrastructure;

using eShop.Ordering.Infrastructure;

using Microsoft.EntityFrameworkCore;

using Npgsql;

namespace eShop.Mcp.FunctionalTests;

public sealed class McpDatabaseFixture : IAsyncLifetime
{
    private const string McpPassword = "mcp-test-password";

    private readonly DistributedApplication _app;
    private readonly IResourceBuilder<PostgresServerResource> _postgres;
    private string _serverCs = default!;

    public string ReadOnlyCatalogCs { get; private set; } = default!;
    public string ReadOnlyOrderingCs { get; private set; } = default!;
    public string SuperuserOrderingCs { get; private set; } = default!;

    public McpDatabaseFixture()
    {
        var options = new DistributedApplicationOptions { AssemblyName = typeof(McpDatabaseFixture).Assembly.FullName, DisableDashboard = true };
        var appBuilder = DistributedApplication.CreateBuilder(options);
        _postgres = appBuilder.AddPostgres("McpPostgres")
            .WithImage("ankane/pgvector")
            .WithImageTag("latest");
        _app = appBuilder.Build();
    }

    public async ValueTask InitializeAsync()
    {
        await _app.StartAsync();
        await _app.ResourceNotifications.WaitForResourceHealthyAsync("McpPostgres");
        _serverCs = await _postgres.Resource.GetConnectionStringAsync() ?? throw new InvalidOperationException("No connection string");

        await CreateDatabaseAsync("catalogdb");
        await CreateDatabaseAsync("orderingdb");

        var catalogSuper = WithDatabase(_serverCs, "catalogdb");
        SuperuserOrderingCs = WithDatabase(_serverCs, "orderingdb");

        var catalogOptions = new DbContextOptionsBuilder<CatalogContext>()
            .UseNpgsql(catalogSuper, o => o.UseVector())
            .Options;
        await using (var catalogContext = new CatalogContext(catalogOptions, new ConfigurationBuilder().Build())
        {
            CatalogItems = null!,
            CatalogBrands = null!,
            CatalogTypes = null!
        })
        {
            await catalogContext.Database.MigrateAsync();
        }

        var orderingOptions = new DbContextOptionsBuilder<OrderingContext>()
            .UseNpgsql(SuperuserOrderingCs)
            .Options;
        await using (var orderingContext = new OrderingContext(orderingOptions))
        {
            await orderingContext.Database.MigrateAsync();
        }

        var roleScript = Path.Combine(AppContext.BaseDirectory, "create-readonly-role.sql");
        await RunSqlFileAsync(roleScript, catalogSuper);
        await RunSqlFileAsync(roleScript, SuperuserOrderingCs);

        ReadOnlyCatalogCs = AsReadOnly(catalogSuper);
        ReadOnlyOrderingCs = AsReadOnly(SuperuserOrderingCs);
    }

    public Task RunSqlFileAsync(string path)
    {
        return RunSqlFileAsync(path, SuperuserOrderingCs);
    }

    public async Task RunAdminSqlAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(SuperuserOrderingCs);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task RunSqlFileAsync(string path, string connectionString)
    {
        // The file uses a psql variable; Npgsql has no psql, so substitute the literal here.
        var sql = (await File.ReadAllTextAsync(path))
            .Replace(":'mcp_password'", $"'{McpPassword}'");
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private async Task CreateDatabaseAsync(string name)
    {
        await using var connection = new NpgsqlConnection(_serverCs);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE {name}", connection);
        await command.ExecuteNonQueryAsync();
    }

    private static string WithDatabase(string connectionString, string database)
    {
        return new NpgsqlConnectionStringBuilder(connectionString) { Database = database }.ConnectionString;
    }

    private static string AsReadOnly(string connectionString)
    {
        return new NpgsqlConnectionStringBuilder(connectionString)
        {
            Username = "mcp_readonly",
            Password = McpPassword
        }.ConnectionString;
    }

    public async ValueTask DisposeAsync()
    {
        await _app.StopAsync();
        if (_app is IAsyncDisposable asyncDisposable)
        {
            await asyncDisposable.DisposeAsync().ConfigureAwait(false);
        }
        else
        {
            _app.Dispose();
        }
    }
}
