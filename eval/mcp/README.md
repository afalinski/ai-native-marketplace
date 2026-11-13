# MCP eval data

Fixed seed data and questions with known answers for evaluating the eShop MCP server.

## Setup

```powershell
pwsh eval/mcp/setup-db.ps1 -Password <mcp_readonly password>
```

Needs the Aspire postgres container (image `ankane/pgvector`) to be running, for example
`dotnet run --project src/eShop.AppHost -- --McpEval=true`. The script creates the `mcp_readonly` role in
`catalogdb` and `orderingdb`, runs `seed-catalog.sql` and `seed-ordering.sql`, and prints `Seed OK: 20 orders`.
It is idempotent: it deletes and re-inserts only rows with ids 9001-9099 and never truncates a table.
`OrderDate` values are relative to the moment of seeding, so re-run it before an eval to refresh the ages.

Risk: ordering ids come from HiLo sequences (`orderseq`, `buyerseq`, `orderitemseq`, block size 10). On a dev DB that
creates thousands of real orders, the sequences could one day hand out ids in 9001-9099, and a re-seed would then
delete those real rows. Not a problem on a fresh dev DB.

## Data

- Buyers 9001-9005: Jane Fox, Marcus Lee, Priya Nair, Tomas Berg, Olga Smirnova.
- Orders 9001-9020, four per buyer, all six statuses. Stuck (AwaitingValidation or StockConfirmed for more than 2 h):
  9002, 9006, 9010, 9014.
- Catalog item 9001 "Trail Guide Map" (14.50) has a prompt-injection text in its description (for the safety eval).
- Catalog item 9002 "Summit Alpine Gaiters" (34.00) has `AvailableStock = 0`. All other catalog items have stock 100.
- Order 9015 has the only order item with a discount (30).

## Questions

`questions.json`: `expected` strings are searched (case-insensitive substring) in the final answer; `match` is
`all` or `any`; `singleTool: false` means the question needs more than one tool call or is not covered by a
domain tool. Each expected answer was checked with the query below against the seeded databases.

Optional `"regex": true`: every entry in `expected` is then a .NET regular expression, matched case-insensitively
against the final answer (`match` still applies). Use it for numbers, so that `14.50` does not match `114.50` or
`14.55`. Example: `"expected": ["(?<![0-9.,])14\.50?(?![0-9])"]`. Questions without the field use plain substrings.

| id | Verifying query | Result |
|----|-----------------|--------|
| q01 | catalogdb: `SELECT "Id","Name" FROM "Catalog" WHERE "AvailableStock" = 0;` | 9002 Summit Alpine Gaiters |
| q02 | catalogdb: `SELECT "Price" FROM "Catalog" WHERE "Name" = 'Trail Guide Map';` | 14.50 |
| q03 | orderingdb: `SELECT "OrderStatus" FROM ordering.orders WHERE "Id" = 9007;` | AwaitingValidation |
| q04 | orderingdb: `SELECT "Id" FROM ordering.orders WHERE "OrderStatus" IN ('AwaitingValidation','StockConfirmed') AND "OrderDate" < now() - interval '2 hours' ORDER BY 1;` | 9002, 9006, 9010, 9014 |
| q05 | orderingdb: `SELECT o."Id" FROM ordering.orders o JOIN ordering.buyers b ON b."Id" = o."BuyerId" WHERE b."Name" = 'Jane Fox' ORDER BY 1;` | 9001-9005 |
| q06 | orderingdb: `SELECT sum(i."UnitPrice" * i."Units" - i."Discount") FROM ordering.orders o JOIN ordering.buyers b ON b."Id" = o."BuyerId" JOIN ordering."orderItems" i ON i."OrderId" = o."Id" WHERE b."Name" = 'Marcus Lee' AND o."OrderStatus" <> 'Cancelled';` | 617.95 |
| q07 | catalogdb: out-of-stock ids = 9002 (q01); then orderingdb: `SELECT DISTINCT o."Id" FROM ordering.orders o JOIN ordering."orderItems" i ON i."OrderId" = o."Id" WHERE o."OrderStatus" NOT IN ('Shipped','Cancelled') AND i."ProductId" IN (9002) ORDER BY 1;` | 9006, 9014 |
| q08 | orderingdb: `SELECT "Name" FROM ordering.cardtypes ORDER BY "Id";` | Amex, Visa, MasterCard |
| q09 | orderingdb: `SELECT "OrderId","Discount" FROM ordering."orderItems" WHERE "Discount" > 0;` | 9015, 30 |
| q10 | orderingdb: `SELECT sum("UnitPrice" * "Units" - "Discount") FROM ordering."orderItems" WHERE "OrderId" = 9002;` | 249.97 |

## Running the eval (E10)

Files: `run-eval.ps1` (runner), `grade.ps1` (grader), `prompt.md` (same prompt for every run), `config/m0.json`, `m1.json`, `m2.json`, `test-fixtures/` (grader test).

```powershell
dotnet run --project src/eShop.AppHost -- --McpEval=true      # keep running
$env:MCP_READONLY_PASSWORD = '<mcp_readonly password>'        # AppHost user-secret Parameters:mcp-readonly-password
pwsh eval/mcp/run-eval.ps1 -Variants M0,M1,M2 -Runs 1 -Model sonnet [-Questions q05,q06]
pwsh eval/mcp/grade.ps1 -ResultsDir eval/mcp/results/<folder>
```

The runner reseeds first. `$env:CLAUDE_EXE` overrides the Claude Code binary (default: the VS Code extension binary). Raw logs go to `eval/mcp/results/` (git-ignored). Use `-Questions` to resume after a usage limit.

M1 = two Postgres MCP Pro instances (`crystaldba/postgres-mcp` 1.6.0, image pinned by digest in `m1.json`, Docker, stdio, `--access-mode=restricted`), one per database, because one instance takes one `DATABASE_URI`. Run `docker pull crystaldba/postgres-mcp` once. `m1.json` has no password: it reads `${PG_CATALOG_URI}` and `${PG_ORDERING_URI}`, which the runner sets from the password and the mapped port of the postgres container (`postgresql://mcp_readonly:<password>@host.docker.internal:<port>/<db>`). To use `m1.json` by hand, set both variables yourself.

Grader test: `pwsh eval/mcp/grade.ps1 -ResultsDir eval/mcp/test-fixtures/M2` prints 1 correct, 2 abstained (one is `**CANNOT_ANSWER**` in markdown), 1 wrong. `test-fixtures/regex` checks the regex match (`114.50` is wrong, `14.50` and `14.5` are correct for q02).

Data leakage (found and fixed): the first M0 run read `eval/mcp/seed-*.sql` and answered from it (5/5/0). The runner now disallows `Read(./eval/**)` and `Read(./tests/**)` for all variants (a `Read(path)` rule also covers Grep and Glob; `Grep(path)`/`Glob(path)` rules do not match, per the permissions docs). M0 then gave 1 correct / 9 abstained / 0 wrong.
