import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const owner = "11111111-1111-4111-8111-111111111111";
const stranger = "22222222-2222-4222-8222-222222222222";
const migration = name => readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8");

test("private access preserves records and rejects unapproved direct reads, writes and paid API reservations in PostgreSQL", async () => {
  const db = await PGlite.create({ extensions:{ pgcrypto } });
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated,anon;
      alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
      alter default privileges in schema public grant usage,select on sequences to authenticated;
      insert into auth.users values ('${owner}');`);
    for (const name of ["0001_initial_schema.sql","0002_core_image_notes.sql","0003_organization_workflow.sql","0004_append_vocabulary_details.sql","0005_sentence_study.sql","0006_knowledge_notes.sql","0007_learning_activity.sql"]) await db.exec(await migration(name));
    const sentence = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const word = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await db.exec(`insert into public.sentences(id,user_id,original_text,translation,note) values('${sentence}','${owner}','Keep going.','続けて。','自分のメモ');
      insert into public.vocabulary_items(id,user_id,term,normalized_term,meaning) values('${word}','${owner}','keep going','keep going','続ける');`);
    const sql = await migration("0008_private_app_access.sql");
    await db.exec(`insert into auth.users values('${stranger}')`);
    await assert.rejects(db.exec(sql), /Set v_owner_id/);
    await db.exec("rollback");
    assert.equal((await db.query("select to_regclass('phrasenest_private.allowed_users') as name")).rows[0].name,null);
    await db.exec(`delete from auth.users where id='${stranger}'`);
    await db.exec(sql); // A single existing Auth user is enrolled by the administrator.
    await db.exec(`insert into auth.users values('${stranger}')`);
    await db.exec(sql); // Re-running must not enroll the new user.

    const login = async (id, role="authenticated") => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
      await db.exec(`set role ${role}`);
    };
    await login(owner);
    assert.equal((await db.query("select public.app_access_status() as allowed")).rows[0].allowed,true);
    assert.equal((await db.query("select note from public.sentences")).rows[0].note,"自分のメモ");
    await db.query("select public.reserve_cloud_translation(10)");
    await db.query("select public.reserve_ai_request(0.001)");
    await db.query("select public.record_learning_review('sentence',$1)",[sentence]);
    await db.query("select public.record_learning_lookup()");
    await db.query("select public.record_review($1,'remembered')",[word]);
    await db.query("select public.record_sentence_review($1,'cccccccc-cccc-4ccc-8ccc-cccccccccccc')",[sentence]);
    const unchanged = (await db.query("select status,next_review_at from public.vocabulary_items")).rows[0];
    await assert.rejects(db.query("select public.reserve_cloud_translation(5000) from generate_series(1,91)"), /Monthly cloud translation limit/);
    assert.equal((await db.query("select cloud_translation_characters from public.monthly_usage")).rows[0].cloud_translation_characters,10);

    await login(stranger);
    assert.equal((await db.query("select public.app_access_status() as allowed")).rows[0].allowed,false);
    for (const table of ["sentences","vocabulary_items","sentence_vocabulary","review_logs","monthly_usage","custom_phrase_patterns","organization_changes","sentence_review_events","knowledge_notes","learning_activity_events"]) assert.equal((await db.query(`select * from public.${table}`)).rows.length,0,table);
    await assert.rejects(db.query("select * from phrasenest_private.allowed_users"), /permission denied/);
    await assert.rejects(db.query("insert into phrasenest_private.allowed_users(user_id) values($1)",[stranger]), /permission denied/);
    await assert.rejects(db.query("insert into public.sentences(user_id,original_text) values($1,'No access')",[stranger]), /not allowed|row-level security/);
    await assert.rejects(db.query("select public.reserve_cloud_translation(1)"), /not allowed/);
    await assert.rejects(db.query("select public.reserve_ai_request(0.001)"), /not allowed/);
    await assert.rejects(db.query("select public.record_learning_lookup()"), /not allowed/);
    await assert.rejects(db.query("select public.record_learning_review('sentence',$1)",[sentence]), /not allowed/);
    await db.query("update public.sentences set note='Must not replace' where id=$1",[sentence]);
    await login("","anon");
    await assert.rejects(db.query("select public.reserve_cloud_translation(1)"), /permission denied/);
    await assert.rejects(db.query("select public.app_access_status()"), /permission denied/);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    assert.equal((await db.query("select count(*)::int as total from public.monthly_usage")).rows[0].total,1);
    assert.equal((await db.query("select note from public.sentences where id=$1",[sentence])).rows[0].note,"自分のメモ");
    assert.deepEqual((await db.query("select status,next_review_at from public.vocabulary_items")).rows[0],unchanged);
    await db.query("delete from phrasenest_private.allowed_users where user_id=$1",[owner]);
    await login(owner);
    assert.equal((await db.query("select public.app_access_status() as allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select * from public.sentences")).rows.length,0);
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::int as total from public.sentences")).rows[0].total,1);
  } finally { await db.close(); }
});
