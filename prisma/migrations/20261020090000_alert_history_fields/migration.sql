-- The alert history the client's spec asks for: what the unit was actually doing when the
-- episode opened and when it closed, why it was called untrustworthy, and room for a
-- technician's note later. An AC cannot be explained by one temperature — the judgement is
-- the difference between the room and the duct, so both are kept at both moments.
--
-- All nullable and all additive: existing alerts keep what they have and gain empty columns.
ALTER TABLE "Alert"
  ADD COLUMN "roomAtOpenF"  DOUBLE PRECISION,
  ADD COLUMN "roomAtCloseF" DOUBLE PRECISION,
  ADD COLUMN "ductAtOpenF"  DOUBLE PRECISION,
  ADD COLUMN "ductAtCloseF" DOUBLE PRECISION,
  ADD COLUMN "error"        INTEGER,
  ADD COLUMN "comment"      TEXT,
  ADD COLUMN "commentById"  TEXT;

ALTER TABLE "Alert"
  ADD CONSTRAINT "Alert_commentById_fkey" FOREIGN KEY ("commentById")
  REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
