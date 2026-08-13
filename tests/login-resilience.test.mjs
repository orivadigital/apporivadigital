import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("login returns the validated profile without a fragile second session request", async () => {
  const loginRoute = await read("app/api/auth/login/route.ts");
  const management = await read("public/management.js");

  assert.match(loginRoute, /getActorFromAccessToken/);
  assert.match(loginRoute, /profile: actor\.role === "empresa_cliente" \? "cliente" : actor\.role === "parceiro" \? "parceiro" : "socio"/);
  assert.match(management, /var payload = await api\('\/api\/auth\/login'/);
  assert.doesNotMatch(management, /await api\('\/api\/auth\/login'[\s\S]{0,500}await api\('\/api\/session'/);
});

test("session renewal is single-flight across the whole interface", async () => {
  const html = await read("public/oriva-plataforma.html");
  const session = await read("public/auth-session.js");
  const management = await read("public/management.js");
  const calendar = await read("public/content-calendar.js");

  assert.match(html, /<script src="\/auth-session\.js"><\/script>/);
  assert.match(session, /var refreshPromise = null/);
  assert.match(session, /if \(refreshPromise\) return refreshPromise/);
  assert.match(management, /window\.orivaRefreshSession\(\)/);
  assert.match(calendar, /window\.orivaRefreshSession\(\)/);
  assert.doesNotMatch(management, /fetch\('\/api\/auth\/refresh'/);
  assert.doesNotMatch(calendar, /fetch\('\/api\/auth\/refresh'/);
});

test("login prevents duplicate submissions and private auth responses are never cached", async () => {
  const html = await read("public/oriva-plataforma.html");
  const management = await read("public/management.js");
  const dataLayer = await read("lib/oriva-data.ts");
  const refreshRoute = await read("app/api/auth/refresh/route.ts");

  assert.match(html, /id="login-button"/);
  assert.match(management, /loginInProgress/);
  assert.match(management, /button\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(dataLayer, /Cache-Control", "private, no-store, max-age=0"/);
  assert.doesNotMatch(refreshRoute, /clearSessionCookies\(jsonError\(error\)/);
});
