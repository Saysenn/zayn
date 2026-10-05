#!/bin/bash
# ***************************************************
# * THE CLONE SWEEP: real conversations on a copy of live
# ***************************************************
# Every scenario in sweep/ runs twice, auto mode off and on, through the real
# agent on the LOCAL clone (crm_clone, 127.0.0.1:54329). Each one ends by
# undoing what it did, so the clone has to come back exactly as it was. A
# scenario that leaves it changed is a fault: either the undo missed something
# or a write landed that nobody saw.
#
#   bash scripts/nightly/sweep.sh <out dir>
#
# Never live. dianeChat only skips its write guard when DATABASE_URL is the
# clone's own address.
set -u
API_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-/tmp/diane-sweep}"
mkdir -p "$OUT"
CLONE='postgresql://postgres:localtest@127.0.0.1:54329/crm_clone'
psql_clone() { docker exec crm-clone psql -U postgres -d crm_clone -tAc "$1"; }
snap() {
  psql_clone "select md5(string_agg(id||':'||monthly_amount||':'||payable_amount||':'||coalesce(payable_days,0)||':'||coalesce(addon_percent,0)||':'||coalesce(fee_percent,0)||':'||coalesce(stopped_on::text,''), ',' order by id)) from tb_mastersheet"
  psql_clone "select md5(string_agg(person_id||':'||addon_percent||':'||fee_percent, ',' order by person_id)) from tb_people"
}

cd "$API_DIR" || exit 2
failed=0
for mode in false true; do
  psql_clone "update tb_settings set agent_auto_confirm=$mode where id=1" >/dev/null
  for f in scripts/nightly/sweep/*.txt; do
    name="$(basename "$f" .txt)-auto-$mode"
    before="$(snap)"
    DIANE_ON_CLONE=1 DATABASE_URL="$CLONE" DB_SSL=false WHATBOT_WEBHOOK_URL=http://127.0.0.1:9 \
      node scripts/dianeChat.js "$f" > "$OUT/$name.log" 2>&1
    flagged=$?
    after="$(snap)"
    if [ "$before" != "$after" ]; then
      echo "NOT RESTORED  $name"; failed=1
    elif [ $flagged -ne 0 ]; then
      echo "FLAGGED       $name (see $OUT/$name.log)"
    else
      echo "ok            $name"
    fi
  done
done
psql_clone "update tb_settings set agent_auto_confirm=false where id=1" >/dev/null
exit $failed
