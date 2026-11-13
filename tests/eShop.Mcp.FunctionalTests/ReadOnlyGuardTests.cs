using eShop.Mcp.Data;

using Npgsql;

namespace eShop.Mcp.FunctionalTests;

[Collection(McpDatabaseCollection.Name)]
public class ReadOnlyGuardTests
{
    private readonly McpDatabaseFixture _fixture;

    public ReadOnlyGuardTests(McpDatabaseFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task Guard_rejects_superuser()
    {
        await using var source = NpgsqlDataSource.Create(_fixture.SuperuserOrderingCs);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => ReadOnlyRoleGuard.EnsureAsync(source, TestContext.Current.CancellationToken));

        Assert.StartsWith("eShop.Mcp must connect as a read-only role", ex.Message);
    }

    [Fact]
    public async Task Guard_accepts_mcp_readonly()
    {
        await using var source = NpgsqlDataSource.Create(_fixture.ReadOnlyOrderingCs);

        await ReadOnlyRoleGuard.EnsureAsync(source, TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task Guard_rejects_role_with_inherited_write()
    {
        await _fixture.RunAdminSqlAsync(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mcp_writer_group') THEN
                    CREATE ROLE mcp_writer_group NOLOGIN;
                END IF;
                IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mcp_member') THEN
                    CREATE ROLE mcp_member LOGIN PASSWORD 'member-pw';
                END IF;
            END
            $$;
            GRANT USAGE ON SCHEMA ordering TO mcp_writer_group;
            GRANT UPDATE ON ordering.orders TO mcp_writer_group;
            GRANT mcp_writer_group TO mcp_member;
            """);
        var memberCs = new NpgsqlConnectionStringBuilder(_fixture.SuperuserOrderingCs)
        {
            Username = "mcp_member",
            Password = "member-pw"
        }.ConnectionString;
        await using var source = NpgsqlDataSource.Create(memberCs);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => ReadOnlyRoleGuard.EnsureAsync(source, TestContext.Current.CancellationToken));

        Assert.StartsWith("eShop.Mcp must connect as a read-only role", ex.Message);
    }

    [Fact]
    public async Task Update_is_rejected_by_database()
    {
        await using var catalog = NpgsqlDataSource.Create(_fixture.ReadOnlyCatalogCs);
        await using var ordering = NpgsqlDataSource.Create(_fixture.ReadOnlyOrderingCs);
        var db = new ReadOnlyDb(catalog, ordering);

        var ex = await Assert.ThrowsAsync<PostgresException>(
            () => db.QueryAsync<int>(
                EShopDatabase.Ordering,
                "UPDATE ordering.orders SET \"Description\" = 'x'",
                null,
                null,
                TestContext.Current.CancellationToken));

        Assert.Contains(ex.SqlState, new[] { "25006", "42501" });
    }

    [Fact]
    public void ClampLimit_values()
    {
        Assert.Equal(20, ReadOnlyDb.ClampLimit(null));
        Assert.Equal(1, ReadOnlyDb.ClampLimit(0));
        Assert.Equal(50, ReadOnlyDb.ClampLimit(1000));
    }
}
