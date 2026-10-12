-- EACH FINISHED GOV.UK REFRESH, so the daily one is timed from the last
-- refresh and not from the newest page (code review 2026-10-10): a page's
-- fetched_at only moves when its text changed, so a quiet day re-ran the
-- whole crawl every hour, and an answer that took in one changed page put
-- the daily refresh off for as long as people kept asking.

CREATE TABLE IF NOT EXISTS tb_hmrc_refreshes (
  id           serial PRIMARY KEY,
  finished_at  timestamptz NOT NULL DEFAULT now(),
  pages        integer,
  changed      integer
);
