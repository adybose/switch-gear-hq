-- Human ticket numbers: TCK-1, TCK-2, ... (see src/server/tickets.ts).
-- Not owned by a column, so demo reset restarts it like order_number_seq (src/server/seed/seed.ts).
CREATE SEQUENCE "ticket_number_seq" START WITH 1;
