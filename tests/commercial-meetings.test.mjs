import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL('../supabase/migrations/20260829120000_commercial_meeting_center.sql', import.meta.url);
const apiPath = new URL('../app/api/commercial-meetings/route.ts', import.meta.url);
const googlePath = new URL('../lib/google-calendar.ts', import.meta.url);
const htmlPath = new URL('../public/oriva-plataforma.html', import.meta.url);
const managementPath = new URL('../public/management.js', import.meta.url);
const backupPath = new URL('../app/api/backups/route.ts', import.meta.url);

test('commercial meeting schema separates schedules, blocks, meetings and participants', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  for (const table of ['commercial_schedule_partners', 'commercial_availability', 'commercial_schedule_blocks', 'commercial_meetings', 'commercial_meeting_participants']) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
  }
});

test('Luciano is seeded as the only reference and governs booking availability', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  assert.match(migration, /lucianoarsenio\.consultoria@gmail\.com', 'Luciano Arsenio'.*true/);
  assert.match(migration, /commercial_schedule_reference_uidx/);
  assert.match(migration, /where sp\.is_reference = true and sp\.is_active = true/);
  assert.match(migration, /Luciano não está disponível neste horário/);
});

test('booking is atomic and protected against concurrent or overlapping reservations', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('oriva_commercial_schedule'\)\)/);
  assert.match(migration, /exclude using gist \(slot with &&\)/);
  assert.match(migration, /when exclusion_violation/);
});

test('every booked meeting is registered for the three active partners', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  assert.match(migration, /insert into public\.commercial_meeting_participants/);
  assert.match(migration, /from public\.commercial_schedule_partners sp\s+where sp\.is_active = true/);
});

test('status and result remain independent with result required only for completed meetings', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  const api = await readFile(apiPath, 'utf8');
  assert.match(migration, /status in \('agendada', 'realizada', 'no_show', 'cancelada'\)/);
  assert.match(migration, /status = 'realizada' and result in \('qualificado', 'desqualificado'\)/);
  assert.match(migration, /status <> 'realizada' and result is null/);
  assert.match(api, /Informe se a reunião realizada foi qualificada ou desqualificada/);
});

test('Google Calendar creates one Meet event and invites client plus all partners', async () => {
  const google = await readFile(googlePath, 'utf8');
  assert.match(google, /conferenceDataVersion=1&sendUpdates=all/);
  assert.match(google, /conferenceSolutionKey: \{ type: "hangoutsMeet" \}/);
  assert.match(google, /for \(const participant of participants\)/);
  assert.match(google, /attendees\.set\(meeting\.clientEmail/);
});

test('commercial API supports booking, availability, blocks, filters, updates and Google retries', async () => {
  const api = await readFile(apiPath, 'utf8');
  for (const marker of ['action === "availability"', 'action === "block"', 'action === "sync_google"', 'rpc/book_commercial_meeting', 'export async function PATCH', 'export async function DELETE']) {
    assert.match(api, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('agency and client interfaces expose the full meeting workflow responsively', async () => {
  const [html, management] = await Promise.all([readFile(htmlPath, 'utf8'), readFile(managementPath, 'utf8')]);
  assert.match(html, /reunioes-comerciais/);
  assert.match(html, /c-reunioes/);
  assert.match(html, /@media\(max-width:700px\).*meeting-grid/s);
  assert.match(management, /Central de reuniões comerciais/);
  assert.match(management, /Luciano disponível = horário liberado/);
  assert.match(management, /Agendar e gerar Meet/);
  assert.match(management, /Clientes qualificados/);
  assert.match(management, /Principais objeções/);
});

test('commercial meeting records are included in complete backup data', async () => {
  const backup = await readFile(backupPath, 'utf8');
  for (const table of ['commercial_schedule_partners', 'commercial_availability', 'commercial_schedule_blocks', 'commercial_meetings', 'commercial_meeting_participants']) {
    assert.match(backup, new RegExp(`name: "${table}"`));
  }
});
