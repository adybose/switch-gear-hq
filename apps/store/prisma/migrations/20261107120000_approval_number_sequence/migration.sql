-- Human approval numbers: APR-1, APR-2, ... (see src/server/approvals.ts).
-- Not owned by a column, so demo reset restarts it like order_number_seq (src/server/seed/seed.ts).
CREATE SEQUENCE "approval_number_seq" START WITH 1;
