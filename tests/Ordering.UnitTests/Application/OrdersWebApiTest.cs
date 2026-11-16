namespace eShop.Ordering.UnitTests.Application;

using System.Globalization;
using Microsoft.AspNetCore.Http.HttpResults;
using eShop.Ordering.API.Application.Queries;
using Order = eShop.Ordering.API.Application.Queries.Order;
using NSubstitute.ExceptionExtensions;

[TestClass]
public class OrdersWebApiTest
{
    private readonly IMediator _mediatorMock;
    private readonly IOrderQueries _orderQueriesMock;
    private readonly IIdentityService _identityServiceMock;
    private readonly ILogger<OrderServices> _loggerMock;

    public OrdersWebApiTest()
    {
        _mediatorMock = Substitute.For<IMediator>();
        _orderQueriesMock = Substitute.For<IOrderQueries>();
        _identityServiceMock = Substitute.For<IIdentityService>();
        _loggerMock = Substitute.For<ILogger<OrderServices>>();
    }

    [TestMethod]
    public async Task Cancel_order_with_requestId_success()
    {
        // Arrange
        _mediatorMock.Send(Arg.Any<IdentifiedCommand<CancelOrderCommand, bool>>(), default)
            .Returns(Task.FromResult(true));

        // Act
        var orderServices = new OrderServices(_mediatorMock, _orderQueriesMock, _identityServiceMock, _loggerMock);
        var result = await OrdersApi.CancelOrderAsync(Guid.NewGuid(), new CancelOrderCommand(1), orderServices);

        // Assert
        Assert.IsInstanceOfType<Ok>(result.Result);
    }

    [TestMethod]
    public async Task Cancel_order_bad_request()
    {
        // Arrange
        _mediatorMock.Send(Arg.Any<IdentifiedCommand<CancelOrderCommand, bool>>(), default)
            .Returns(Task.FromResult(true));

        // Act
        var orderServices = new OrderServices(_mediatorMock, _orderQueriesMock, _identityServiceMock, _loggerMock);
        var result = await OrdersApi.CancelOrderAsync(Guid.Empty, new CancelOrderCommand(1), orderServices);

        // Assert
        Assert.IsInstanceOfType<BadRequest<string>>(result.Result);
    }

    [TestMethod]
    public async Task Ship_order_with_requestId_success()
    {
        // Arrange
        _mediatorMock.Send(Arg.Any<IdentifiedCommand<ShipOrderCommand, bool>>(), default)
            .Returns(Task.FromResult(true));

        // Act
        var orderServices = new OrderServices(_mediatorMock, _orderQueriesMock, _identityServiceMock, _loggerMock);
        var result = await OrdersApi.ShipOrderAsync(Guid.NewGuid(), new ShipOrderCommand(1), orderServices);

        // Assert
        Assert.IsInstanceOfType<Ok>(result.Result);

    }

    [TestMethod]
    public async Task Ship_order_bad_request()
    {
        // Arrange
        _mediatorMock.Send(Arg.Any<IdentifiedCommand<CreateOrderCommand, bool>>(), default)
            .Returns(Task.FromResult(true));

        // Act
        var orderServices = new OrderServices(_mediatorMock, _orderQueriesMock, _identityServiceMock, _loggerMock);
        var result = await OrdersApi.ShipOrderAsync(Guid.Empty, new ShipOrderCommand(1), orderServices);

        // Assert
        Assert.IsInstanceOfType<BadRequest<string>>(result.Result);
    }

    [TestMethod]
    public async Task Get_orders_success()
    {
        // Arrange
        var fakeDynamicResult = Enumerable.Empty<OrderSummary>();

        _identityServiceMock.GetUserIdentity()
            .Returns(Guid.NewGuid().ToString());

        _orderQueriesMock.GetOrdersFromUserAsync(Guid.NewGuid().ToString())
            .Returns(Task.FromResult(fakeDynamicResult));

        // Act
        var orderServices = new OrderServices(_mediatorMock, _orderQueriesMock, _identityServiceMock, _loggerMock);
        var result = await OrdersApi.GetOrdersByUserAsync(orderServices);

        // Assert
        Assert.IsInstanceOfType<Ok<IEnumerable<OrderSummary>>>(result);
    }

    [TestMethod]
    public async Task Get_order_success()
    {
        // Arrange
        var fakeOrderId = 123;
        var fakeDynamicResult = new Order();
        _orderQueriesMock.GetOrderAsync(Arg.Any<int>())
            .Returns(Task.FromResult(fakeDynamicResult));

        // Act
        var orderServices = new OrderServices(_mediatorMock, _orderQueriesMock, _identityServiceMock, _loggerMock);
        var result = await OrdersApi.GetOrderAsync(fakeOrderId, orderServices);

        // Assert
        Assert.IsInstanceOfType<Ok<Order>>(result.Result);
        Assert.AreSame(fakeDynamicResult, ((Ok<Order>)result.Result).Value);
    }

    [TestMethod]
    public async Task Get_order_fails()
    {
        // Arrange
        var fakeOrderId = 123;
#pragma warning disable NS5003
        _orderQueriesMock.GetOrderAsync(Arg.Any<int>())
            .Throws(new KeyNotFoundException());
#pragma warning restore NS5003

        // Act
        var orderServices = new OrderServices(_mediatorMock, _orderQueriesMock, _identityServiceMock, _loggerMock);
        var result = await OrdersApi.GetOrderAsync(fakeOrderId, orderServices);

        // Assert
        Assert.IsInstanceOfType<NotFound>(result.Result);
    }

    [TestMethod]
    public async Task Get_cardTypes_success()
    {
        // Arrange
        var fakeDynamicResult = Enumerable.Empty<CardType>();
        _orderQueriesMock.GetCardTypesAsync()
            .Returns(Task.FromResult(fakeDynamicResult));

        // Act
        var result = await OrdersApi.GetCardTypesAsync(_orderQueriesMock);

        // Assert
        Assert.IsInstanceOfType<Ok<IEnumerable<CardType>>>(result);
        Assert.AreSame(fakeDynamicResult, result.Value);
    }

    [TestMethod]
    public async Task Cancel_order_returns_problem_when_command_fails()
    {
        _mediatorMock.Send(Arg.Any<IdentifiedCommand<CancelOrderCommand, bool>>(), default)
            .Returns(Task.FromResult(false));
        var services = new OrderServices(_mediatorMock, _orderQueriesMock, _identityServiceMock, _loggerMock);

        var result = await OrdersApi.CancelOrderAsync(Guid.NewGuid(), new CancelOrderCommand(1), services);

        var problem = Assert.IsInstanceOfType<ProblemHttpResult>(result.Result);
        Assert.AreEqual(500, problem.StatusCode);
    }

    [TestMethod]
    public async Task Ship_order_returns_problem_when_command_fails()
    {
        _mediatorMock.Send(Arg.Any<IdentifiedCommand<ShipOrderCommand, bool>>(), default)
            .Returns(Task.FromResult(false));
        var services = new OrderServices(_mediatorMock, _orderQueriesMock, _identityServiceMock, _loggerMock);

        var result = await OrdersApi.ShipOrderAsync(Guid.NewGuid(), new ShipOrderCommand(1), services);

        var problem = Assert.IsInstanceOfType<ProblemHttpResult>(result.Result);
        Assert.AreEqual(500, problem.StatusCode);
    }

    private const string TestUserId = "user-for-log-test";
    private const string TestCardNumber = "4111111111111111";
    private const string TestCardSecurityNumber = "987";

    private static CreateOrderRequest NewCreateOrderRequest()
    {
        return new CreateOrderRequest(
            TestUserId,
            "user-name",
            "city",
            "street",
            "state",
            "country",
            "zip",
            TestCardNumber,
            "Card Holder",
            new DateTime(2030, 1, 1),
            TestCardSecurityNumber,
            1,
            "buyer",
            new List<BasketItem>());
    }

    [TestMethod]
    public async Task Create_order_without_requestId_does_not_log_card_data()
    {
        // Arrange
        var capturingLogger = new CapturingLogger();
        var services = new OrderServices(_mediatorMock, _orderQueriesMock, _identityServiceMock, capturingLogger);

        // Act
        await OrdersApi.CreateOrderAsync(Guid.Empty, NewCreateOrderRequest(), services);

        // Assert
        Assert.IsNotEmpty(capturingLogger.Entries);
        foreach (var entry in capturingLogger.Entries)
        {
            var texts = new List<string> { entry.Message };
            foreach (var pair in entry.State)
            {
                texts.Add(pair.Key);
                texts.Add(Convert.ToString(pair.Value, CultureInfo.InvariantCulture));
            }

            foreach (var text in texts)
            {
                Assert.DoesNotContain(TestCardNumber, text);
                Assert.DoesNotContain(TestCardSecurityNumber, text);
            }
        }
    }

    [TestMethod]
    public async Task Create_order_without_requestId_logs_one_warning_with_userId()
    {
        // Arrange
        var capturingLogger = new CapturingLogger();
        var services = new OrderServices(_mediatorMock, _orderQueriesMock, _identityServiceMock, capturingLogger);

        // Act
        await OrdersApi.CreateOrderAsync(Guid.Empty, NewCreateOrderRequest(), services);

        // Assert
        var warnings = capturingLogger.Entries.Where(e => e.Level == LogLevel.Warning).ToList();
        Assert.HasCount(1, warnings);
        Assert.Contains(TestUserId, warnings[0].Message);
    }

    [TestMethod]
    public async Task Create_order_without_requestId_returns_bad_request_and_sends_no_command()
    {
        // Arrange
        var capturingLogger = new CapturingLogger();
        var services = new OrderServices(_mediatorMock, _orderQueriesMock, _identityServiceMock, capturingLogger);

        // Act
        var result = await OrdersApi.CreateOrderAsync(Guid.Empty, NewCreateOrderRequest(), services);

        // Assert
        var badRequest = Assert.IsInstanceOfType<BadRequest<string>>(result.Result);
        Assert.AreEqual("RequestId is missing.", badRequest.Value);
        Assert.AreEqual(0, _mediatorMock.ReceivedCalls().Count());
    }

    private sealed class CapturingLogger : ILogger<OrderServices>
    {
        public List<(LogLevel Level, string Message, List<KeyValuePair<string, object>> State)> Entries { get; } = new();

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception exception, Func<TState, Exception, string> formatter)
        {
            var pairs = new List<KeyValuePair<string, object>>();
            if (state is IEnumerable<KeyValuePair<string, object>> kvps)
            {
                pairs.AddRange(kvps);
            }

            Entries.Add((logLevel, formatter(state, exception), pairs));
        }

        public bool IsEnabled(LogLevel logLevel) => true;

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

        private sealed class NullScope : IDisposable
        {
            public static readonly NullScope Instance = new();

            public void Dispose()
            {
            }
        }
    }
}
