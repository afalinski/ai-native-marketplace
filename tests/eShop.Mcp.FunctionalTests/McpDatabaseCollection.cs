namespace eShop.Mcp.FunctionalTests;

// One Postgres container for every test class; two fixtures started in parallel fail to come up.
[CollectionDefinition(Name)]
public sealed class McpDatabaseCollection : ICollectionFixture<McpDatabaseFixture>
{
    public const string Name = "mcp-database";
}
