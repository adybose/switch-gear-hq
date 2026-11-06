-- Human order numbers: ORD-1001, ORD-1002, ... (see src/server/checkout.ts).
-- Not owned by a column, so demo reset restarts it explicitly (src/server/seed/seed.ts).
CREATE SEQUENCE "order_number_seq" START WITH 1001;
