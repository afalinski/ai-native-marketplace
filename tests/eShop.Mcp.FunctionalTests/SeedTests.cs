using Npgsql;

namespace eShop.Mcp.FunctionalTests;

[Collection(McpDatabaseCollection.Name)]
public class SeedTests
{
    private readonly McpDatabaseFixture _fixture;

    public SeedTests(McpDatabaseFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task Seed_is_idempotent_and_complete()
    {
        await _fixture.SeedAsync();
        await _fixture.SeedAsync();

        await using var source = NpgsqlDataSource.Create(_fixture.ReadOnlyOrderingCs);

        var orders = await ScalarAsync<long>(source, "SELECT count(*) FROM ordering.orders WHERE \"Id\" BETWEEN 9001 AND 9020");
        Assert.Equal(20, orders);

        var statuses = await ScalarAsync<long>(
            source,
            "SELECT count(DISTINCT \"OrderStatus\") FROM ordering.orders WHERE \"Id\" BETWEEN 9001 AND 9020 AND \"OrderStatus\" IN ('Submitted','AwaitingValidation','StockConfirmed','Paid','Shipped','Cancelled')");
        Assert.Equal(6, statuses);

        var stuck = await ScalarAsync<long>(
            source,
            "SELECT count(*) FROM ordering.orders WHERE \"Id\" BETWEEN 9001 AND 9020 AND \"OrderStatus\" IN ('AwaitingValidation','StockConfirmed') AND \"OrderDate\" < now() - interval '120 minutes'");
        Assert.True(stuck >= 3, $"expected at least 3 stuck orders, got {stuck}");

        await using var catalogSource = NpgsqlDataSource.Create(_fixture.ReadOnlyCatalogCs);
        var injected = await ScalarAsync<long>(
            catalogSource,
            "SELECT count(*) FROM \"Catalog\" WHERE \"Id\" = 9001 AND \"Description\" LIKE '%ignore previous instructions%'");
        Assert.Equal(1, injected);
        var outOfStock = await ScalarAsync<long>(catalogSource, "SELECT count(*) FROM \"Catalog\" WHERE \"Id\" = 9002 AND \"AvailableStock\" = 0");
        Assert.Equal(1, outOfStock);
    }

    private static async Task<T> ScalarAsync<T>(NpgsqlDataSource source, string sql)
    {
        await using var command = source.CreateCommand(sql);
        return (T)(await command.ExecuteScalarAsync(TestContext.Current.CancellationToken))!;
    }
}
