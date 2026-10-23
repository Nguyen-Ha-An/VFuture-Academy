#!/usr/bin/env node
// Runs ONLY against a disposable local fixture cluster, never an application URL.
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import pg from "pg";
// The standalone local gate provisions its own socket-only fixture. Explicit
// socket/database arguments retain the original guarded expert entry point.
if (process.argv.length === 2) {
  const { runIsolatedStudioConcurrency } = await import('./lib/studio-postgres-fixture.mjs');
  await runIsolatedStudioConcurrency();
  process.exit(0);
}

const [socket, database] = process.argv.slice(2);
if (
  !socket ||
  !database ||
  !/^studio_[a-z0-9_]+$/.test(database) ||
  !/^\/(?:private\/)?tmp\/studio-postgres\.[^/]+\/socket$/.test(
    realpathSync(socket),
  )
) {
  throw new Error(
    "Provide the socket and studio_* database of an isolated /tmp/studio-postgres.* fixture cluster. Connection URLs are not accepted.",
  );
}
const config = { host: socket, database, user: "studio_test", port: 55439 };
const clients = [
  new pg.Client(config),
  new pg.Client(config),
  new pg.Client(config),
];
await Promise.all(
  clients.map(async (c) => {
    await c.connect();
    await c.query("set timezone='UTC'; set statement_timeout='5s'");
  }),
);
const [control, first, second] = clients;
const actor = "00000000-0000-4000-8000-000000000001";
const one = async (client, sql, params = []) =>
  (await client.query(sql, params)).rows[0];
const revision = async (id) =>
  (
    await one(
      control,
      "select cms_current_snapshot('resource',$1)->>'revision_key' as revision",
      [id],
    )
  ).revision;
const review = async (client, id, rev) =>
  (
    await one(
      client,
      "select cms_request_review($1,'resource',$2,$3,null) as result",
      [actor, id, rev],
    )
  ).result;
const approve = (client, r) =>
  one(client, "select cms_approve_and_publish($1,$2,$3,$4,null) as result", [
    actor,
    r.id,
    r.revision,
    "Verified native transaction",
  ]);
const pending = async (id) => {
  const rev = await revision(id);
  return { ...(await review(control, id, rev)), revision: rev };
};
const attempt = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
async function blocked(client) {
  const pid = client.processID;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const row = await one(
      control,
      "select wait_event_type from pg_stat_activity where pid=$1",
      [pid],
    );
    if (row?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Second transaction did not wait for the content lock");
}
try {
  assert.ok(
    (
      await one(
        control,
        "select to_regclass('public.actor_permissions') as fixture",
      )
    ).fixture,
    "Fixture-only permission table required",
  );
  await control.query(
    "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create or replace function public.digest(text,text) returns bytea language sql immutable as $$select extensions.digest($1,$2)$$;",
  );
  const suffix = Date.now().toString(36);
  const ids = ["withdraw", "publish", "save", "duplicate", "failure"].map(
    (name) => `race-${name}-${suffix}`,
  );
  for (const id of ids)
    await control.query(
      "insert into resources(id,document,status,owner_id,branch_scope,updated_at,ownership_kind) values($1,jsonb_build_object('id',$1::text,'title','Original'),'draft',$2,'{\"scope\":\"global\"}',clock_timestamp(),'central')",
      [id, actor],
    );

  // Withdrawal unblocks a waiting save; that save cannot mutate the frozen snapshot.
  const withdrawn = await pending(ids[0]);
  await first.query("begin");
  await first.query("select cms_withdraw_review($1,$2)", [actor, withdrawn.id]);
  const edit = attempt(
    second.query(
      "update resources set document=jsonb_set(document,'{title}','\"Edited\"'),updated_at=clock_timestamp() where id=$1",
      [ids[0]],
    ),
  );
  await blocked(second);
  await first.query("commit");
  assert.ifError((await edit).error);
  assert.equal(
    (
      await one(control, "select status from cms_review_requests where id=$1", [
        withdrawn.id,
      ])
    ).status,
    "withdrawn",
  );
  assert.equal(
    (
      await one(
        control,
        "select source#>>'{document,title}' as title from cms_content_snapshots where id=$1",
        [withdrawn.snapshot_id],
      )
    ).title,
    "Original",
  );
  console.log(
    "PASS withdrawal and save serialize; reviewed snapshot stays immutable",
  );

  const publishing = await pending(ids[1]);
  await first.query("begin");
  await approve(first, publishing);
  const withdraw = attempt(
    second.query("select cms_withdraw_review($1,$2)", [actor, publishing.id]),
  );
  await blocked(second);
  await first.query("commit");
  assert.match((await withdraw).error?.message ?? "", /CMS_REVIEW_NOT_PENDING/);
  assert.equal((await approve(control, publishing)).result.status, "published");
  assert.equal(
    (
      await one(
        control,
        "select count(*)::int as n from audit_log where target_id=$1 and action='content.publish'",
        [ids[1]],
      )
    ).n,
    1,
  );
  console.log(
    "PASS approve wins against withdrawal; retry creates no duplicate publication",
  );

  const before = await revision(ids[2]);
  await first.query("begin");
  await first.query(
    "update resources set document=jsonb_set(document,'{title}','\"New version\"'),updated_at=clock_timestamp() where id=$1",
    [ids[2]],
  );
  const submitting = attempt(review(second, ids[2], before));
  await blocked(second);
  await first.query("commit");
  assert.match((await submitting).error?.message ?? "", /CMS_REVISION_CHANGED/);
  console.log(
    "PASS a request queued behind a save rechecks the committed revision",
  );

  const duplicateRevision = await revision(ids[3]);
  await first.query("begin");
  const original = await review(first, ids[3], duplicateRevision);
  const duplicate = attempt(review(second, ids[3], duplicateRevision));
  await blocked(second);
  await first.query("commit");
  const repeated = await duplicate;
  assert.ifError(repeated.error);
  assert.equal(repeated.value.id, original.id);
  console.log("PASS simultaneous review requests deduplicate after waiting");

  const failure = await pending(ids[4]);
  await control.query(
    `create or replace function cms_test_publish_failure() returns trigger language plpgsql as $$begin if new.id='${ids[4]}' then raise exception 'TEST_PUBLICATION_FAILURE'; end if; return new; end$$; create trigger cms_test_failure before update on resources for each row execute function cms_test_publish_failure();`,
  );
  assert.match(
    (await attempt(approve(control, failure))).error?.message ?? "",
    /TEST_PUBLICATION_FAILURE/,
  );
  assert.equal(
    (
      await one(control, "select status from cms_review_requests where id=$1", [
        failure.id,
      ])
    ).status,
    "pending",
  );
  assert.equal(
    (
      await one(
        control,
        "select count(*)::int as n from audit_log where target_id=$1 and action in ('content.review.approve','content.publish')",
        [ids[4]],
      )
    ).n,
    0,
  );
  await control.query(
    "drop trigger cms_test_failure on resources; drop function cms_test_publish_failure()",
  );
  console.log(
    "PASS publication failure rolls back approval, publication and audit together",
  );

  const assetId = `asset_race_${suffix}`,
    resourceId = `race-dependent-${suffix}`;
  await control.query(
    "insert into media_assets(id,owner_id,bucket,path,mime,size_bytes,alt,ownership_kind) values($1,$2,'media','race.png','image/png',100,'{\"vi\":\"Before\",\"en\":\"Before\"}','central')",
    [assetId, actor],
  );
  await control.query(
    "insert into resources(id,document,status,owner_id,branch_scope,updated_at,ownership_kind) values($1,jsonb_build_object('id',$1::text,'assetId',$2::text),'draft',$3,'{\"scope\":\"global\"}',clock_timestamp(),'central')",
    [resourceId, assetId, actor],
  );
  const dependent = await pending(resourceId);
  // Pause after publication checks, while the transaction must still retain dependency locks.
  await control.query(`alter function cms_finalize_publication(uuid,uuid) rename to cms_finalize_publication_race_original;
    create function cms_finalize_publication(p_actor_user_id uuid,p_review_id uuid) returns jsonb language plpgsql as $$begin perform pg_sleep(1); return cms_finalize_publication_race_original(p_actor_user_id,p_review_id); end$$;`);
  try {
    const publishingDependency = attempt(approve(first, dependent));
    const deadline = Date.now() + 3000;
    let sleeping = false;
    while (Date.now() < deadline) {
      if (
        (
          await one(
            control,
            "select wait_event from pg_stat_activity where pid=$1",
            [first.processID],
          )
        )?.wait_event === "PgSleep"
      ) {
        sleeping = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(sleeping, "Publication reached the after-check pause");
    const changingAsset = attempt(
      second.query(
        'update media_assets set alt=\'{"vi":"After","en":"After"}\' where id=$1',
        [assetId],
      ),
    );
    await blocked(second);
    assert.ifError((await publishingDependency).error);
    assert.ifError((await changingAsset).error);
    console.log(
      "PASS asset dependency remains locked through publication commit",
    );
  } finally {
    await first.query("rollback").catch(() => {});
    await second.query("rollback").catch(() => {});
    await control.query(
      "drop function cms_finalize_publication(uuid,uuid); alter function cms_finalize_publication_race_original(uuid,uuid) rename to cms_finalize_publication",
    );
  }

  const legacyId = `race-legacy-${suffix}`;
  await control.query(
    "insert into resources(id,document,status,owner_id,branch_scope,updated_at,ownership_kind) values($1,jsonb_build_object('id',$1::text,'title','Reviewed'),'draft',$2,'{\"scope\":\"global\"}',clock_timestamp(),'central')",
    [legacyId, actor],
  );
  const legacyRevision = await revision(legacyId);
  const legacyReview = await review(control, legacyId, legacyRevision);
  await control.query("select cms_decide_review($1,$2,'approve','Legacy publish reviewed')", [actor, legacyReview.id]);
  await control.query(`alter function cms_assert_publishable(uuid,text,text,text) rename to cms_assert_publishable_race_original;
    create function cms_assert_publishable(p_actor_user_id uuid,p_content_type text,p_content_id text,p_revision_key text) returns uuid language plpgsql as $$declare result uuid;begin result:=cms_assert_publishable_race_original(p_actor_user_id,p_content_type,p_content_id,p_revision_key);perform pg_sleep(1);return result;end$$;`);
  try {
    const legacyPublishing = attempt(one(first, 'select cms_publish_review($1,$2) result', [actor, legacyReview.id]));
    const deadline = Date.now() + 3000;
    let sleeping = false;
    while (Date.now() < deadline) {
      if ((await one(control, 'select wait_event from pg_stat_activity where pid=$1', [first.processID]))?.wait_event === 'PgSleep') {
        sleeping = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(sleeping, 'Legacy publish reached the after-check pause');
    const legacySave = attempt(one(second, "select cms_save_content_draft($1,'resource',$2,$3,$4,$5) result", [
      actor, legacyId, legacyRevision, { document: { id: legacyId, title: 'Later draft' } }, { scope: 'global' },
    ]));
    await blocked(second);
    assert.ifError((await legacyPublishing).error);
    assert.match((await legacySave).error?.message ?? '', /CMS_REVISION_CHANGED/);
    const legacyState = await one(control, "select document->>'title' live_title from resources where id=$1", [legacyId]);
    assert.equal(legacyState.live_title, 'Reviewed');
    console.log('PASS legacy publish locks source before approval checks and rejects the stale waiting draft');
  } finally {
    await first.query('rollback').catch(() => {});
    await second.query('rollback').catch(() => {});
    await control.query('drop function cms_assert_publishable(uuid,text,text,text); alter function cms_assert_publishable_race_original(uuid,text,text,text) rename to cms_assert_publishable');
  }
} finally {
  for (const client of clients) {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}
