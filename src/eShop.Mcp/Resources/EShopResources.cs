using System.ComponentModel;

using ModelContextProtocol;
using ModelContextProtocol.Server;

namespace eShop.Mcp.Resources;

[McpServerResourceType]
public sealed class EShopResources
{
    private static readonly string ArchitectureRoot = Path.Combine(AppContext.BaseDirectory, "architecture");

    [McpServerResource(UriTemplate = "eshop://ordering/status-lifecycle", Name = "order-status-lifecycle", MimeType = "text/markdown")]
    [Description("Order statuses, which service moves each one, and which integration event triggers the move.")]
    public static string StatusLifecycle()
    {
        return File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Resources", "status-lifecycle.md"));
    }

    [McpServerResource(UriTemplate = "eshop://docs/architecture/{+name}", Name = "architecture-doc", MimeType = "text/markdown")]
    [Description("A page of the eShop architecture notes. The name is the path inside docs/architecture without .md, for example overview or services/ordering.")]
    public static string ArchitectureDoc(string name)
    {
        var names = ListNames();
        if (!names.Contains(name))
        {
            throw new McpException($"Unknown architecture doc '{name}'. Valid names: {string.Join(", ", names)}.");
        }

        return File.ReadAllText(Path.Combine(ArchitectureRoot, name + ".md"));
    }

    private static List<string> ListNames()
    {
        if (!Directory.Exists(ArchitectureRoot))
        {
            return [];
        }

        return Directory.EnumerateFiles(ArchitectureRoot, "*.md", SearchOption.AllDirectories)
            .Select(file => Path.GetRelativePath(ArchitectureRoot, file).Replace('\\', '/'))
            .Select(path => path[..^3])
            .Where(name => !Path.GetFileName(name).StartsWith('_'))
            .Order(StringComparer.Ordinal)
            .ToList();
    }
}
