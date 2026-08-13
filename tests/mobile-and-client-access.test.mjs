import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("mobile navigation and touch-first layout are present", async () => {
  const html = await readFile(new URL("public/oriva-plataforma.html", root), "utf8");

  assert.match(html, /id="mobile-bottom-nav"/);
  assert.match(html, /id="mobile-nav-overlay"/);
  assert.match(html, /@media\(max-width:860px\)/);
  assert.match(html, /\.responsive-table td::before/);
  assert.match(html, /max-height:94dvh/);
  assert.match(html, /enhanceResponsiveTables/);
});

test("company creation asks for email and password and exposes a one-time copy action", async () => {
  const management = await readFile(new URL("public/management.js", root), "utf8");
  const companyRoute = await readFile(new URL("app/api/companies/route.ts", root), "utf8");

  assert.match(management, /E-mail usado como login/);
  assert.match(management, /Crie a senha do cliente/);
  assert.match(management, /copyClientCredentials/);
  assert.match(companyRoute, /password\.length < 8/);
  assert.match(companyRoute, /action: "create_company"/);
});

test("partners can manage companies without gaining team-access administration", async () => {
  const sessionRoute = await readFile(new URL("app/api/session/route.ts", root), "utf8");
  const edgeFunction = await readFile(new URL("supabase/functions/admin-users/index.ts", root), "utf8");

  assert.match(sessionRoute, /canManageCompanies: actor\.role === "super_admin" \|\| actor\.role === "socio"/);
  assert.match(sessionRoute, /canManageAccess: actor\.role === "super_admin"/);
  assert.match(edgeFunction, /\["super_admin", "socio"\]/);
  assert.match(edgeFunction, /requireSuperAdminCaller\(caller\)/);
});

test("password recovery sends email and accepts a secure recovery token", async () => {
  const html = await readFile(new URL("public/oriva-plataforma.html", root), "utf8");
  const management = await readFile(new URL("public/management.js", root), "utf8");
  const forgotRoute = await readFile(new URL("app/api/auth/forgot-password/route.ts", root), "utf8");
  const updateRoute = await readFile(new URL("app/api/auth/update-password/route.ts", root), "utf8");

  assert.match(html, /Esqueci minha senha/);
  assert.match(html, /id="forgot-password-view"/);
  assert.match(html, /id="reset-password-view"/);
  assert.match(management, /openPasswordRecoveryFromUrl/);
  assert.match(management, /Authorization': 'Bearer '/);
  assert.match(forgotRoute, /\/recover\?redirect_to=/);
  assert.doesNotMatch(forgotRoute, /JSON\.stringify\(\{ email, redirect_to:/);
  assert.match(forgotRoute, /password-recovery=1/);
  assert.match(updateRoute, /authenticatedAuthRequest\("\/user"/);
  assert.match(updateRoute, /password\.length < 8/);
});

test("authentication errors and visible navigation are presented in Portuguese", async () => {
  const html = await readFile(new URL("public/oriva-plataforma.html", root), "utf8");
  const management = await readFile(new URL("public/management.js", root), "utf8");
  const calendar = await readFile(new URL("public/content-calendar.js", root), "utf8");
  const dataLayer = await readFile(new URL("lib/oriva-data.ts", root), "utf8");

  assert.match(html, /label:'Visão geral'/);
  assert.doesNotMatch(html, /label:'Dashboard'/);
  assert.match(dataLayer, /email_not_confirmed: "E-mail não confirmado/);
  assert.match(dataLayer, /invalid_credentials: "E-mail ou senha incorretos/);
  assert.match(management, /Não foi possível conectar ao sistema\. Verifique sua internet/);
  assert.match(calendar, /Legenda \/ texto/);
  assert.match(calendar, /Situação inicial/);
  assert.match(calendar, /Todas as situações/);
});
