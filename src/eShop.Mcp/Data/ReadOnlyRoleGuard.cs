using Npgsql;

namespace eShop.Mcp.Data;

public static class ReadOnlyRoleGuard
{
    private const string Prefix = "eShop.Mcp must connect as a read-only role";

    public static async Task EnsureAsync(NpgsqlDataSource source, CancellationToken ct)
    {
        await using var connection = await source.OpenConnectionAsync(ct);

        await using (var command = new NpgsqlCommand("SELECT rolsuper FROM pg_roles WHERE rolname = current_user", connection))
        {
            // Fail closed: a missing row or null counts as unsafe.
            var isSuper = await command.ExecuteScalarAsync(ct) as bool? ?? true;
            if (isSuper)
            {
                throw new InvalidOperationException($"{Prefix}, but the current role is a superuser or could not be checked.");
            }
        }

        // has_table_privilege and pg_has_role follow role membership, PUBLIC grants and column grants.
        await using (var command = new NpgsqlCommand(
            """
            SELECT count(*)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p')
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND n.nspname NOT LIKE 'pg_toast%'
              AND has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
            """,
            connection))
        {
            var writableTables = Convert.ToInt64(await command.ExecuteScalarAsync(ct));
            if (writableTables > 0)
            {
                throw new InvalidOperationException($"{Prefix}, but the current role can write to {writableTables} tables.");
            }
        }

        await using (var command = new NpgsqlCommand("SELECT pg_has_role(current_user, 'pg_write_all_data', 'USAGE')", connection))
        {
            var writesAll = await command.ExecuteScalarAsync(ct) as bool? ?? true;
            if (writesAll)
            {
                throw new InvalidOperationException($"{Prefix}, but the current role is a member of pg_write_all_data.");
            }
        }
    }
}
