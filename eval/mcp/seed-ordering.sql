-- Eval seed for orderingdb. Idempotent: touches only ids 9001-9099 (buyers, orders, order items).
-- Never truncates. OrderDate is relative to now(), so re-running refreshes the ages.
BEGIN;

DELETE FROM ordering."orderItems" WHERE "OrderId" BETWEEN 9001 AND 9099 OR "Id" BETWEEN 9001 AND 9099;
DELETE FROM ordering.orders WHERE "Id" BETWEEN 9001 AND 9099;
DELETE FROM ordering.buyers WHERE "Id" BETWEEN 9001 AND 9099;

INSERT INTO ordering.buyers ("Id", "IdentityGuid", "Name") VALUES
    (9001, 'seed-buyer-9001', 'Jane Fox'),
    (9002, 'seed-buyer-9002', 'Marcus Lee'),
    (9003, 'seed-buyer-9003', 'Priya Nair'),
    (9004, 'seed-buyer-9004', 'Tomas Berg'),
    (9005, 'seed-buyer-9005', 'Olga Smirnova');

INSERT INTO ordering.orders
    ("Id", "BuyerId", "OrderStatus", "OrderDate", "Description", "PaymentMethodId",
     "Address_Street", "Address_City", "Address_State", "Address_Country", "Address_ZipCode")
SELECT o.id, o.buyer, o.status, now() - o.age, NULL, NULL,
       '1 Seed Street', 'Seedville', 'WA', 'USA', '98052'
FROM (VALUES
    (9001, 9001, 'Submitted',          interval '10 minutes'),
    (9002, 9001, 'AwaitingValidation', interval '3 hours'),
    (9003, 9001, 'Paid',               interval '2 days'),
    (9004, 9001, 'Shipped',            interval '10 days'),
    (9005, 9001, 'Cancelled',          interval '20 days'),
    (9006, 9002, 'StockConfirmed',     interval '5 hours'),
    (9007, 9002, 'AwaitingValidation', interval '30 minutes'),
    (9008, 9002, 'Shipped',            interval '5 days'),
    (9009, 9002, 'Paid',               interval '1 day'),
    (9010, 9003, 'StockConfirmed',     interval '26 hours'),
    (9011, 9003, 'Shipped',            interval '8 days'),
    (9012, 9003, 'Cancelled',          interval '3 days'),
    (9013, 9003, 'Submitted',          interval '1 hour'),
    (9014, 9004, 'AwaitingValidation', interval '4 hours'),
    (9015, 9004, 'Paid',               interval '3 hours'),
    (9016, 9004, 'Shipped',            interval '12 days'),
    (9017, 9005, 'Paid',               interval '6 hours'),
    (9018, 9005, 'Shipped',            interval '2 days'),
    (9019, 9005, 'Cancelled',          interval '6 days'),
    (9020, 9005, 'Submitted',          interval '90 minutes')
) AS o(id, buyer, status, age);

INSERT INTO ordering."orderItems" ("Id", "OrderId", "ProductId", "ProductName", "UnitPrice", "Discount", "Units", "PictureUrl") VALUES
    (9001, 9001,    1, 'Wanderer Black Hiking Boots', 109.99,  0, 1, NULL),
    (9002, 9002,    2, 'Summit Pro Harness',           89.99,  0, 1, NULL),
    (9003, 9002,    3, 'Alpine Fusion Goggles',        79.99,  0, 2, NULL),
    (9004, 9003,    4, 'Expedition Backpack',         129.99,  0, 1, NULL),
    (9005, 9004,    1, 'Wanderer Black Hiking Boots', 109.99,  0, 2, NULL),
    (9006, 9004,    6, 'Carbon Fiber Trekking Poles',  69.99,  0, 1, NULL),
    (9007, 9005,    5, 'Blizzard Rider Snowboard',    299.99,  0, 1, NULL),
    (9008, 9006,    7, 'Explorer 45L Backpack',       149.99,  0, 1, NULL),
    (9009, 9006, 9002, 'Summit Alpine Gaiters',         34.00,  0, 2, NULL),
    (9010, 9007,    3, 'Alpine Fusion Goggles',        79.99,  0, 1, NULL),
    (9011, 9008,    8, 'Frostbite Insulated Jacket',  179.99,  0, 1, NULL),
    (9012, 9009,    6, 'Carbon Fiber Trekking Poles',  69.99,  0, 2, NULL),
    (9013, 9010,    1, 'Wanderer Black Hiking Boots', 109.99,  0, 1, NULL),
    (9014, 9010,    2, 'Summit Pro Harness',           89.99,  0, 1, NULL),
    (9015, 9011,    4, 'Expedition Backpack',         129.99,  0, 2, NULL),
    (9016, 9012, 9001, 'Trail Guide Map',               14.50,  0, 3, NULL),
    (9017, 9013, 9001, 'Trail Guide Map',               14.50,  0, 1, NULL),
    (9018, 9014, 9002, 'Summit Alpine Gaiters',         34.00,  0, 1, NULL),
    (9019, 9015,    5, 'Blizzard Rider Snowboard',    299.99, 30, 1, NULL),
    (9020, 9016,    7, 'Explorer 45L Backpack',       149.99,  0, 1, NULL),
    (9021, 9016,    8, 'Frostbite Insulated Jacket',  179.99,  0, 1, NULL),
    (9022, 9017, 9001, 'Trail Guide Map',               14.50,  0, 2, NULL),
    (9023, 9017,    3, 'Alpine Fusion Goggles',        79.99,  0, 1, NULL),
    (9024, 9018,    2, 'Summit Pro Harness',           89.99,  0, 2, NULL),
    (9025, 9019,    1, 'Wanderer Black Hiking Boots', 109.99,  0, 1, NULL),
    (9026, 9020,    6, 'Carbon Fiber Trekking Poles',  69.99,  0, 1, NULL);

COMMIT;
