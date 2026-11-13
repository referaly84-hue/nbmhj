import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';

const {
  app,
  db,
  buildDrawTournamentBrief,
  buildFallbackDrawScript,
  generateDrawAiScript,
} = await import('../server.ts');

test('buildDrawTournamentBrief and buildFallbackDrawScript produce 35 preshow and 15 postdraw phrases across all 3 tournaments', () => {
  for (const t of ['cup_rpl', 'cup_regions', 'media_cup']) {
    const brief = buildDrawTournamentBrief(t);
    assert.ok(brief.title.length > 0);
    assert.ok(brief.format.length > 0);
    assert.ok(brief.participantsText.length > 20);

    const preshow = buildFallbackDrawScript('preshow', t);
    assert.equal(preshow.length, 35, `Expected 35 preshow phrases for ${t}`);
    for (const p of preshow) {
      assert.ok(p.speaker && p.role && p.avatar && p.topic && p.text, `Invalid preshow item in ${t}`);
      assert.ok(p.text.length >= 15);
    }

    const sampleSummary = 'Группа A: Зенит, Спартак, Динамо, Акрон\nГруппа B: ЦСКА, Краснодар, Локомотив, Рубин';
    const postdraw = buildFallbackDrawScript('postdraw', t, sampleSummary);
    assert.equal(postdraw.length, 15, `Expected 15 postdraw phrases for ${t}`);
    for (const p of postdraw) {
      assert.ok(p.speaker && p.role && p.avatar && p.topic && p.text, `Invalid postdraw item in ${t}`);
      assert.ok(p.text.length >= 15);
    }
  }
});

test('POST /api/draw/ai-script, GET /api/draw/data, and POST /api/draw/commentary work end-to-end', async () => {
  const dbPath = path.join(process.cwd(), 'data', 'db.json');
  const backupRaw = fs.readFileSync(dbPath, 'utf8');
  const prevLiveDraw = db.liveDraw ? JSON.parse(JSON.stringify(db.liveDraw)) : { active: false };

  const srv = app.listen(0);
  const addr = srv.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Clear any cached scripts so we test fresh generation + caching
    db.liveDraw = { active: false };

    const preResp = await fetch(`${baseUrl}/api/draw/ai-script`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phase: 'preshow',
        tournament: 'cup_rpl',
        force: false,
      }),
    });
    const preJson = (await preResp.json()) as any;
    assert.equal(preJson.ok, 1);
    assert.equal(preJson.phase, 'preshow');
    assert.equal(preJson.count, 35);
    assert.equal(preJson.phrases.length, 35);
    assert.equal(preJson.cached, false);

    // Second request without force should hit cache
    const preCachedResp = await fetch(`${baseUrl}/api/draw/ai-script`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phase: 'preshow',
        tournament: 'cup_rpl',
        force: false,
      }),
    });
    const preCachedJson = (await preCachedResp.json()) as any;
    assert.equal(preCachedJson.ok, 1);
    assert.equal(preCachedJson.cached, true);
    assert.equal(preCachedJson.phrases.length, 35);

    // Post-draw 15-phrase script based on drawn groups
    const postSummary = 'Группа A: Зенит, Спартак, Динамо, Акрон\nГруппа B: Краснодар, ЦСКА, Локомотив, Ростов\nГруппа C: Рубин, Ахмат, Крылья Советов, Пари НН\nГруппа D: Балтика, Сочи, Торпедо, Оренбург';
    const postResp = await fetch(`${baseUrl}/api/draw/ai-script`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phase: 'postdraw',
        tournament: 'cup_rpl',
        resultsSummary: postSummary,
      }),
    });
    const postJson = (await postResp.json()) as any;
    assert.equal(postJson.ok, 1);
    assert.equal(postJson.phase, 'postdraw');
    assert.equal(postJson.count, 15);
    assert.equal(postJson.phrases.length, 15);

    // Direct call with same resultsSummary returns cached=true
    const directCached = await generateDrawAiScript({
      phase: 'postdraw',
      tournament: 'cup_rpl',
      resultsSummary: postSummary,
    });
    assert.equal(directCached.cached, true);
    assert.equal(directCached.phrases.length, 15);

    // GET /api/draw/data includes cached preshowScripts and postdrawScripts
    const drawDataResp = await fetch(`${baseUrl}/api/draw/data`);
    const drawDataJson = (await drawDataResp.json()) as any;
    assert.ok(Array.isArray(drawDataJson.preshowScripts?.cup_rpl));
    assert.equal(drawDataJson.preshowScripts.cup_rpl.length, 35);
    assert.ok(Array.isArray(drawDataJson.postdrawScripts?.cup_rpl));
    assert.equal(drawDataJson.postdrawScripts.cup_rpl.length, 15);
    assert.equal(typeof drawDataJson.aiEnabled, 'boolean');

    // POST /api/draw/commentary returns both commentator & guest
    const team = db.teams.find((t: any) => t.comp === 'rpl');
    assert.ok(team);
    const commResp = await fetch(`${baseUrl}/api/draw/commentary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tournament: 'cup_rpl',
        step: 2,
        team,
        targetSlot: 'Группа A (Корзина 2)',
        assignedGroup: 'A',
        rivalsInSlot: [],
      }),
    });
    const commJson = (await commResp.json()) as any;
    assert.ok(typeof commJson.commentator === 'string' && commJson.commentator.length > 5);
    assert.ok(typeof commJson.guest === 'string' && commJson.guest.length > 3);
  } finally {
    srv.closeAllConnections?.();
    srv.close();
    db.liveDraw = prevLiveDraw;
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(dbPath, backupRaw, 'utf8');
  }
});
