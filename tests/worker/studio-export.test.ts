import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { readStudioExport } from "../../worker/infra/d1-studio-export";
import { sha256 } from "../../worker/security/crypto";

const db = env.BOSS_MESSAGE_DB;
const emptyInput = { view: "all" as const, topic: null, snapshot: null, before: null };
const id = (index: number) => `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`;
const content = "完整导出而非240字摘要".repeat(50);
async function seed(index: number, filtered = false) {
  await db.prepare(`INSERT INTO feedback (id, submission_key, douyin_nickname, shop_phone, topic,
    content, internal_status, privacy_policy_version, privacy_agreed_at, livestream_policy_version,
    livestream_agreed_at, moderation_status, created_at, updated_at)
    VALUES (?, ?, '导出测试', '+853 0012-3456', 'appeal', ?, 'unprocessed', 'v1', 1000, 'v1', 1000, ?, 1000, 1000)`)
    .bind(id(index), crypto.randomUUID(), content, filtered ? "filtered" : "kept").run();
}
beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM audit_logs"), db.prepare("DELETE FROM feedback_replies"),
    db.prepare("DELETE FROM feedback_images"), db.prepare("DELETE FROM feedback"),
    db.prepare("DELETE FROM admin_sessions"),
  ]);
});
describe("Studio export", () => {
  it("exports all pages with stable same-time cursors and excludes later arrivals", async () => {
    for (let index = 1; index <= 53; index++) await seed(index, index === 1);
    const first = await readStudioExport(db, emptyInput);
    expect(first.items).toHaveLength(50);
    expect(first.items[0]).toMatchObject({ id: id(53), content, shopPhone: "+853 0012-3456" });
    expect(first.nextCursor).toEqual({ createdAt: 1000, id: id(4) });
    await seed(54);
    const second = await readStudioExport(db, { ...emptyInput, snapshot: first.snapshot, before: first.nextCursor });
    expect(second.items.map(item => item.id)).toEqual([id(3), id(2), id(1)]);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(53);
    expect((await readStudioExport(db, { ...emptyInput, view: "filtered" })).items.map(item => item.id)).toEqual([id(1)]);
    expect((await readStudioExport(db, { ...emptyInput, topic: "released_hardware" })).items).toEqual([]);
  });

  it("includes every reply and image and reuses reply-type/todo filters", async () => {
    await seed(1);
    await db.batch([
      db.prepare("INSERT INTO feedback_replies (id, feedback_id, reply_type, content, admin_id, created_at) VALUES ('r1', ?, 'message', '第一条回复', 'admin-zd', 1001)").bind(id(1)),
      db.prepare("INSERT INTO feedback_replies (id, feedback_id, reply_type, content, admin_id, created_at) VALUES ('r2', ?, 'live', '第二条回复', 'admin-zd', 1002)").bind(id(1)),
      db.prepare("INSERT INTO feedback_images (id, feedback_id, object_key, media_type, byte_size, width, height, sha256, created_at) VALUES ('pic1', ?, 'private-key', 'image/webp', 10, 1, 1, 'test', 1000)").bind(id(1)),
    ]);
    for (const view of ["replied", "message", "live"] as const) {
      const value = await readStudioExport(db, { ...emptyInput, view });
      expect(value.items).toHaveLength(1);
      expect(value.items[0]!.replies.map(reply => reply.content)).toEqual(["第一条回复", "第二条回复"]);
      expect(value.items[0]!.images[0]!.viewUrl).toContain(`/feedbacks/${id(1)}/images/pic1`);
      expect(JSON.stringify(value)).not.toContain("private-key");
    }
    expect((await readStudioExport(db, { ...emptyInput, view: "unreplied" })).items).toEqual([]);
    expect((await readStudioExport(db, { ...emptyInput, view: "todo" })).items).toEqual([]);
  });

  it("requires same-origin normal-mode authentication and validates cursors", async () => {
    const token = "a".repeat(43);
    const tokenHash = await sha256(new TextEncoder().encode(token).slice().buffer);
    await db.prepare("UPDATE admins SET must_change_password = 0 WHERE id = 'admin-zd'").run();
    await db.prepare("INSERT INTO admin_sessions (token_hash, admin_id, mode, created_at, expires_at) VALUES (?, 'admin-zd', 'normal', ?, ?)")
      .bind(tokenHash, Date.now(), Date.now() + 60000).run();
    const call = (body: unknown, cookie = true, origin = "https://message.example") => SELF.fetch("https://message.example/api/studio/export", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: `__Host-boss_studio_session=${token}` } : {}) }, body: JSON.stringify(body),
    });
    expect((await call(emptyInput, false)).status).toBe(401);
    expect((await call(emptyInput, true, "https://elsewhere.example")).status).toBe(403);
    expect((await call({ ...emptyInput, before: { createdAt: 1000, id: id(1) } })).status).toBe(400);
    expect((await call({ ...emptyInput, view: "unknown" })).status).toBe(400);
    const normal = await call(emptyInput);
    expect(normal.status).toBe(200);
    expect(normal.headers.get("Cache-Control")).toContain("no-store");
    await db.prepare("UPDATE admin_sessions SET mode = 'live' WHERE token_hash = ?").bind(tokenHash).run();
    expect((await call(emptyInput)).status).toBe(403);
  });
});
