using Dapper;
using Npgsql;

namespace eShop.Mcp.Data;

public sealed record QueryResult<T>(IReadOnlyList<T> Rows, bool Truncated);

public sealed class ReadOnlyDb
{
    private const int DefaultLimit = 20;
    private const int MaxLimit = 50;

    private readonly NpgsqlDataSource _catalog;
    private readonly NpgsqlDataSource _ordering;

    public ReadOnlyDb(NpgsqlDataSource catalog, NpgsqlDataSource ordering)
    {
        _catalog = catalog;
        _ordering = ordering;
    }

    public static int ClampLimit(int? requested)
    {
        return Math.Clamp(requested ?? DefaultLimit, 1, MaxLimit);
    }

    public async Task<QueryResult<T>> QueryAsync<T>(EShopDatabase db, string sql, object? args, int? limit, CancellationToken ct)
    {
        var clamped = ClampLimit(limit);
        var source = db == EShopDatabase.Catalog ? _catalog : _ordering;

        await using var connection = await source.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await connection.ExecuteAsync(new CommandDefinition(
            "SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = 5000;",
            transaction: transaction,
            cancellationToken: ct));

        // Read at most limit + 1 rows from the stream; the extra row only tells us the result was cut.
        var rows = new List<T>();
        await foreach (var row in connection.QueryUnbufferedAsync<T>(sql, args, transaction).WithCancellation(ct))
        {
            rows.Add(row);
            if (rows.Count > clamped)
            {
                break;
            }
        }

        var truncated = rows.Count > clamped;
        if (truncated)
        {
            rows.RemoveAt(clamped);
        }

        await transaction.RollbackAsync(ct);
        return new QueryResult<T>(rows, truncated);
    }
}
