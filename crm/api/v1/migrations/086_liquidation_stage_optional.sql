-- THE PAGE FOLLOWS THE COMPANY STATUS (his call 2026-10-13). A company is on
-- the Liquidations page because its status (tb_companies.status) is
-- liquidation, set on its company page or by Diane; nobody adds it by hand.
-- Its stage is the step it is at inside that process, and it starts unset:
-- nobody has said yet whether it is our liquidation or HMRC's.
--
-- And the stage no longer moves the company status either way: the status
-- is the company's, the stage is the liquidation's.
ALTER TABLE tb_liquidations ALTER COLUMN stage DROP NOT NULL;
ALTER TABLE tb_liquidations ALTER COLUMN stage DROP DEFAULT;
ALTER TABLE tb_liquidation_history ALTER COLUMN to_stage DROP NOT NULL;
