extern alias CatalogApi;

using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;

using CatalogApi::eShop.Catalog.API.Infrastructure;

using eShop.Ordering.Infrastructure;

using System.Linq;
using System.Text.Json;

using Microsoft.EntityFrameworkCore;

using Npgsql;

namespace eShop.Mcp.FunctionalTests;

public sealed class McpDatabaseFixture : IAsyncLifetime
{
    private const string McpPassword = "mcp-test-password";

    private readonly DistributedApplication _app;
    private readonly IResourceBuilder<PostgresServerResource> _postgres;
    private string _serverCs = default!;
    private string _catalogSuperCs = default!;

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
        _catalogSuperCs = catalogSuper;
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

    public async Task SeedCatalogFromJsonAsync()
    {
        var json = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "catalog.json"));
        var items = JsonSerializer.Deserialize<List<SeedItem>>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;

        await using var connection = new NpgsqlConnection(_catalogSuperCs);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        await ExecuteAsync(connection, transaction, "TRUNCATE \"Catalog\", \"CatalogBrand\", \"CatalogType\"");

        var brandIds = new Dictionary<string, int>();
        foreach (var brand in items.Select(i => i.Brand).Distinct())
        {
            brandIds[brand] = brandIds.Count + 1;
            await ExecuteAsync(connection, transaction, "INSERT INTO \"CatalogBrand\" (\"Id\", \"Brand\") VALUES (@id, @name)", ("id", brandIds[brand]), ("name", brand));
        }

        var typeIds = new Dictionary<string, int>();
        foreach (var type in items.Select(i => i.Type).Distinct())
        {
            typeIds[type] = typeIds.Count + 1;
            await ExecuteAsync(connection, transaction, "INSERT INTO \"CatalogType\" (\"Id\", \"Type\") VALUES (@id, @name)", ("id", typeIds[type]), ("name", type));
        }

        foreach (var item in items)
        {
            await ExecuteAsync(
                connection,
                transaction,
                """
                INSERT INTO "Catalog" ("Id", "Name", "Description", "Price", "CatalogTypeId", "CatalogBrandId", "AvailableStock", "RestockThreshold", "MaxStockThreshold", "OnReorder")
                VALUES (@id, @name, @description, @price, @typeId, @brandId, 100, 10, 200, false)
                """,
                ("id", item.Id),
                ("name", item.Name),
                ("description", item.Description),
                ("price", item.Price),
                ("typeId", typeIds[item.Type]),
                ("brandId", brandIds[item.Brand]));
        }

        await transaction.CommitAsync();
    }

    private static async Task ExecuteAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string sql, params (string Name, object Value)[] parameters)
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        await command.ExecuteNonQueryAsync();
    }

    private sealed record SeedItem(int Id, string Type, string Brand, string Name, string Description, decimal Price);

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
