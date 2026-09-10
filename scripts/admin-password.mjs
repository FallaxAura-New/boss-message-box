import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const rawUsername = args[args.indexOf("--username") + 1];
const username = rawUsername?.trim().normalize("NFC").toLowerCase();
const target = args.includes("--remote") ? "--remote" : args.includes("--local") ? "--local" : null;
const create = args.includes("--create");
const hasControlCharacter = Array.from(username ?? "").some((character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 31 || codePoint === 127;
});
if (
  !args.includes("--username") || !username || username.length > 40 || hasControlCharacter ||
  !target || (args.includes("--remote") && args.includes("--local"))
) {
  console.error("用法：pnpm run admin:password --username <账号> --local（新建账号使用 pnpm run admin:create --username <账号> --local；线上数据库请明确使用 --remote）");
  process.exit(1);
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function parseWranglerJson(output) {
  const start = output.search(/^\s*\[/mu);
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new SyntaxError("Wrangler JSON output not found");
  return JSON.parse(output.slice(start, end + 1));
}

function rowsWritten(result) {
  const summary = result?.results?.find((row) => Number.isInteger(row?.["Rows written"]));
  return summary?.["Rows written"] ?? result?.meta?.changes;
}

function hiddenInput(prompt) {
  if (!process.stdin.isTTY) throw new Error("请在交互终端运行，密码不会显示或写入命令历史。");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003" || character === "\u0004") { finish(); reject(new Error("操作已取消")); return; }
        if (character === "\r" || character === "\n") { finish(); resolve(value); return; }
        if (character === "\u007f" || character === "\b") value = Array.from(value).slice(0, -1).join("");
        else if (character >= " ") value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

let directory;
try {
  console.log(`将为${target === "--remote" ? "线上" : "本地"}数据库${create ? "创建" : "更新"}管理员 ${username}${create ? "。" : "，并注销该账号的所有会话。"}`);
  const password = await hiddenInput("新密码（非空，不回显）：");
  if (password.length === 0) throw new Error("密码不能为空");
  if (password.length > 1024) throw new Error("密码超过 1024 字符的技术上限");
  if (password !== await hiddenInput("再次输入新密码：")) throw new Error("两次密码不一致");
  const salt = randomBytes(16);
  const hash = `pbkdf2-sha256$100000$${salt.toString("base64url")}$${pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("base64url")}`;
  directory = mkdtempSync(join(tmpdir(), "studio-password-"));
  const sqlPath = join(directory, "reset.sql");
  const now = Date.now();
  const usernameSql = sqlString(username);
  const hashSql = sqlString(hash);
  const sql = create
    ? `INSERT INTO admins (id, username, password_hash, created_at, updated_at, last_login_at, must_change_password)
VALUES (${sqlString(`admin-${randomUUID()}`)}, ${usernameSql}, ${hashSql}, ${now}, ${now}, NULL, 0);`
    : `UPDATE admins SET password_hash = ${hashSql}, must_change_password = 0, updated_at = ${now} WHERE username = ${usernameSql} COLLATE NOCASE;
DELETE FROM admin_sessions WHERE admin_id IN (SELECT id FROM admins WHERE username = ${usernameSql} COLLATE NOCASE AND password_hash = ${hashSql});`;
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const result = spawnSync("pnpm", ["exec", "wrangler", "d1", "execute", "BOSS_MESSAGE_DB", target, "--file", sqlPath, "--json"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${create ? "创建失败，请检查账号是否已存在" : "设置失败，请检查账号是否存在"}、Cloudflare 登录、数据库绑定及迁移是否完成。未输出可能包含密码散列的命令结果。`);
  }
  const results = parseWranglerJson(result.stdout);
  if (!Array.isArray(results) || results[0]?.success !== true || rowsWritten(results[0]) !== 1) {
    throw new Error(create ? "未创建账号，请核对用户名是否已存在。" : "未修改账号，请核对用户名是否存在。");
  }
  console.log(create ? "管理员已创建，请使用新账号和密码登录 Studio。" : "密码已设置，请使用新密码登录 Studio。");
} catch (error) {
  console.error(error instanceof SyntaxError ? "无法确认执行结果，请尝试用新密码登录，必要时重新设置。" : error.message);
  process.exitCode = 1;
} finally {
  if (directory) rmSync(directory, { recursive: true, force: true });
}
