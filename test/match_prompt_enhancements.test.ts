import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';

const {
  app,
  db,
  buildCtx,
  buildUser,
  cardLine,
  computePlayerFatigue,
  evaluatePositionFit,
  fakePeriod,
  formationSlots,
  getLineup,
  lineText,
  ROLE_KEYS,
} = await import('../server.ts');

test('evaluatePositionFit treats ЛЗ->ЦЗ as minor and ЦЗ->ЛВ/ОП as forced', () => {
  const lzAtCb = evaluatePositionFit('ЛЗ', 'ЦЗ');
  assert.equal(lzAtCb.severity, 'minor');
  assert.ok(!lzAtCb.note.includes('вынужденная'));

  const cbAtLw = evaluatePositionFit('ЦЗ', 'ЛВ');
  assert.equal(cbAtLw.severity, 'forced');
  assert.ok(cbAtLw.note.includes('вынужденная перестановка'));

  const cbAtDm = evaluatePositionFit('ЦЗ', 'ОП');
  assert.equal(cbAtDm.severity, 'forced');
  assert.ok(cbAtDm.note.includes('вынужденная перестановка'));

  const gkAtCf = evaluatePositionFit('ВР', 'ЦФ');
  assert.equal(gkAtCf.severity, 'critical');

  const slots433 = formationSlots('4-3-3');
  assert.equal(slots433.length, 11);
  assert.equal(slots433[0], 'ВР');
});

test('H2H last 3 matches, position fit, personal fatigue, set-piece roles, and endpoints work end-to-end', async () => {
  const dbPath = path.join(process.cwd(), 'data', 'db.json');
  const backupRaw = fs.readFileSync(dbPath, 'utf8');

  const rplTeams = db.teams.filter((t: any) => t.comp === 'rpl');
  assert.ok(rplTeams.length >= 2);
  const homeTeam = rplTeams[0];
  const awayTeam = rplTeams[1];

  const homeSquad = db.players.filter((p: any) => p.teamId === homeTeam.id);
  const awaySquad = db.players.filter((p: any) => p.teamId === awayTeam.id);
  assert.ok(homeSquad.length >= 11 && awaySquad.length >= 11);

  const gkH = homeSquad.find((p: any) => p.pos === 'ВР') || homeSquad[0];
  const cbsH = homeSquad.filter((p: any) => p.pos === 'ЦЗ');
  const tiredCb = cbsH[0] || homeSquad[1];
  const reshuffledCb = cbsH[1] || homeSquad[2];
  const freshMid = homeSquad.find((p: any) => p.id !== gkH.id && p.id !== tiredCb.id && p.id !== reshuffledCb.id) || homeSquad[3];

  const startersH: string[] = [gkH.id];
  for (const p of homeSquad) {
    if (startersH.length >= 11) break;
    if (!startersH.includes(p.id)) startersH.push(p.id);
  }
  if (!startersH.includes(tiredCb.id)) startersH[1] = tiredCb.id;
  if (!startersH.includes(reshuffledCb.id)) startersH[2] = reshuffledCb.id;
  if (!startersH.includes(freshMid.id)) startersH[3] = freshMid.id;

  const benchH = homeSquad.filter((p: any) => !startersH.includes(p.id)).slice(0, 5).map((p: any) => p.id);

  const slots433 = formationSlots('4-3-3');
  const lwIdx = slots433.lastIndexOf('ЛВ');
  assert.ok(lwIdx >= 0);
  const customSlots = slots433.map((slot: string, idx: number) => ({ slot, pid: startersH[idx] }));
  const curIdxOfReshuffled = customSlots.findIndex((x: any) => x.pid === reshuffledCb.id);
  const prevPidAtLw = customSlots[lwIdx].pid;
  customSlots[lwIdx].pid = reshuffledCb.id;
  customSlots[curIdxOfReshuffled].pid = prevPidAtLw;

  const prevTactic = db.tactics?.[homeTeam.id] ? JSON.parse(JSON.stringify(db.tactics[homeTeam.id])) : undefined;
  const h2hIds = ['test_h2h_1', 'test_h2h_2', 'test_h2h_3', 'test_h2h_4'];
  const targetFxId = 'test_enh_target_fx';
  const targetDate = '2099-05-20';

  const srv = app.listen(0);
  const addr = srv.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    db.fixtures.push(
      {
        id: h2hIds[0],
        season: db.settings.season,
        comp: 'rpl',
        round: 1,
        date: '2099-04-01',
        time: '19:00',
        home: homeTeam.id,
        away: awayTeam.id,
        status: 'done',
        hg: 0,
        ag: 0,
        st: {
          teams: { home: { g: 0 }, away: { g: 0 } },
          players: {
            [tiredCb.id]: { n: tiredCb.name, t: homeTeam.id, min: 90, started: true, g: 0, a: 0, yc: 0, rc: 0 },
          },
        },
      },
      {
        id: h2hIds[1],
        season: db.settings.season,
        comp: 'rpl',
        round: 2,
        date: '2099-05-11',
        time: '19:00',
        home: awayTeam.id,
        away: homeTeam.id,
        status: 'done',
        hg: 1,
        ag: 2,
        st: {
          teams: { home: { g: 1 }, away: { g: 2 } },
          players: {
            [tiredCb.id]: { n: tiredCb.name, t: homeTeam.id, min: 90, started: true, g: 1, a: 0, yc: 0, rc: 0 },
            [freshMid.id]: { n: freshMid.name, t: homeTeam.id, min: 15, started: false, g: 1, a: 0, yc: 0, rc: 0 },
          },
        },
      },
      {
        id: h2hIds[2],
        season: db.settings.season,
        comp: 'rpl',
        round: 3,
        date: '2099-05-14',
        time: '19:00',
        home: homeTeam.id,
        away: awayTeam.id,
        status: 'done',
        hg: 3,
        ag: 1,
        st: {
          teams: { home: { g: 3 }, away: { g: 1 } },
          players: {
            [tiredCb.id]: { n: tiredCb.name, t: homeTeam.id, min: 90, started: true, g: 0, a: 0, yc: 0, rc: 0 },
            [freshMid.id]: { n: freshMid.name, t: homeTeam.id, min: 18, started: false, g: 0, a: 1, yc: 0, rc: 0 },
          },
        },
      },
      {
        id: h2hIds[3],
        season: db.settings.season,
        comp: 'rpl',
        round: 4,
        date: '2099-05-17',
        time: '19:00',
        home: awayTeam.id,
        away: homeTeam.id,
        status: 'done',
        hg: 2,
        ag: 2,
        st: {
          teams: { home: { g: 2 }, away: { g: 2 } },
          players: {
            [tiredCb.id]: { n: tiredCb.name, t: homeTeam.id, min: 90, started: true, g: 0, a: 0, yc: 1, rc: 0 },
          },
        },
      },
      {
        id: targetFxId,
        season: db.settings.season,
        comp: 'rpl',
        round: 5,
        date: targetDate,
        time: '19:00',
        home: homeTeam.id,
        away: awayTeam.id,
        status: 'scheduled',
        hg: null,
        ag: null,
        pos: 0,
      }
    );

    const clubCode = homeTeam.code;
    assert.ok(clubCode, 'Home team must have access code');

    const rolesPayload: Record<string, string> = {};
    for (let i = 0; i < ROLE_KEYS.length; i++) {
      rolesPayload[ROLE_KEYS[i]] = startersH[(i + 1) % startersH.length];
    }
    rolesPayload.captain = tiredCb.id;
    rolesPayload.penalty = freshMid.id;
    rolesPayload.cornerRight = reshuffledCb.id;
    rolesPayload.cornerLeft = reshuffledCb.id;

    // 1. Test POST /api/club/roles
    const rolesResp = await fetch(`${baseUrl}/api/club/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-code': clubCode },
      body: JSON.stringify({ roles: rolesPayload }),
    });
    const rolesJson = (await rolesResp.json()) as any;
    assert.equal(rolesJson.ok, 1);
    assert.equal(rolesJson.roles.captain, tiredCb.id);
    assert.equal(rolesJson.roles.penalty, freshMid.id);

    // 2. Test POST /api/club/lineup with custom slots and roles
    const lineupResp = await fetch(`${baseUrl}/api/club/lineup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-code': clubCode },
      body: JSON.stringify({
        fid: targetFxId,
        formation: '4-3-3',
        starters: startersH,
        bench: benchH,
        slots: customSlots,
        roles: rolesPayload,
        speech: 'Играем дисциплинированно',
        training: 'Стандарты и прессинг',
      }),
    });
    const lineupJson = (await lineupResp.json()) as any;
    assert.equal(lineupJson.ok, 1);
    assert.equal(lineupJson.slots.length, 11);
    assert.equal(lineupJson.roles.cornerRight, reshuffledCb.id);

    // 3. Test POST /api/club/tactics/preview returns slots + fatigueWarnings
    const prevResp = await fetch(`${baseUrl}/api/club/tactics/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-code': clubCode },
      body: JSON.stringify({
        fid: targetFxId,
        formation: '4-3-3',
        starters: startersH,
        slots: customSlots,
        speech: 'Прессинг',
        training: 'Стандарты',
      }),
    });
    const prevJson = (await prevResp.json()) as any;
    assert.equal(prevJson.ok, 1);
    assert.equal(prevJson.slots.length, 11);
    const reshuffledPreviewSlot = prevJson.slots.find((s: any) => s.pid === reshuffledCb.id);
    assert.equal(reshuffledPreviewSlot.slotPos, 'ЛВ');
    assert.equal(reshuffledPreviewSlot.fit.severity, 'forced');
    assert.ok(prevJson.fatigueWarnings.some((w: any) => w.pid === tiredCb.id));

    // 4. Test GET /api/match/:id includes roles, roleNames, slotPos, fitSeverity
    const matchResp = await fetch(`${baseUrl}/api/match/${targetFxId}`, {
      headers: { 'x-code': clubCode },
    });
    const matchJson = (await matchResp.json()) as any;
    assert.equal(matchJson.lineups.home.roles.captain, tiredCb.id);
    assert.equal(matchJson.lineups.home.roleNames.penalty, freshMid.name);
    const starterEntry = matchJson.lineups.home.starters.find((x: any) => x.id === reshuffledCb.id);
    assert.equal(starterEntry.slotPos, 'ЛВ');
    assert.equal(starterEntry.fitSeverity, 'forced');

    // 5. Verify buildCtx + buildUser + cardLine + lineText + computePlayerFatigue
    const targetFx = db.fixtures.find((x: any) => x.id === targetFxId);
    const fatCalc = computePlayerFatigue(homeTeam.id, targetFx);
    const tiredFat = fatCalc.forPlayer(tiredCb.id);
    assert.ok(tiredFat.level === 'exhausted' || tiredFat.level === 'tired');
    assert.ok(tiredFat.label.includes('накопленная усталость'));

    const freshFat = fatCalc.forPlayer(freshMid.id);
    assert.equal(freshFat.level, 'fresh');
    assert.ok(freshFat.label.includes('свежий, выходил только на замену'));

    const savedLineup = getLineup(targetFx, homeTeam.id);
    assert.equal(savedLineup.roles.captain, tiredCb.id);
    assert.equal(savedLineup.slots.length, 11);

    const ctx = await buildCtx(targetFx);
    assert.equal(ctx.h2h.recent.length, 3, 'Should pass up to 3 most recent H2H matches');
    assert.ok(!ctx.h2h.recent.some((m: any) => m.id === h2hIds[0]), 'Should exclude 4th oldest H2H match');
    assert.ok(ctx.h2h.recent.some((m: any) => m.scorers.some((s: string) => s.includes(tiredCb.name) || s.includes(freshMid.name))));

    const userPrompt = buildUser(ctx, 1, 90, null, [], 'full');
    assert.ok(userPrompt.includes('1.1. ПОСЛЕДНИЕ ОЧНЫЕ ВСТРЕЧИ МЕЖДУ СОБОЙ'));
    assert.ok(userPrompt.includes('2:2'));
    assert.ok(userPrompt.includes('3:1'));
    assert.ok(userPrompt.includes('7.2. СООТВЕТСТВИЕ ПОЗИЦИЯМ В СХЕМЕ И ПЕРСОНАЛЬНАЯ УСТАЛОСТЬ'));
    assert.ok(userPrompt.includes('вынужденная перестановка'));
    assert.ok(userPrompt.includes('7.3. КАПИТАН И ШТАТНЫЕ ИСПОЛНИТЕЛИ СТАНДАРТОВ'));
    assert.ok(userPrompt.includes(`Капитан: ${tiredCb.name}`));
    assert.ok(userPrompt.includes(`Пенальти: ${freshMid.name}`));
    assert.ok(userPrompt.includes(`Угловой справа: ${reshuffledCb.name}`));

    const homeLines = lineText(ctx, 'home');
    assert.ok(homeLines.includes('накопленная усталость'));
    assert.ok(homeLines.includes('свежий, выходил только на замену'));
    assert.ok(homeLines.includes('позиция в схеме: ЛВ'));
    assert.ok(homeLines.includes('Штатные роли: Капитан'));

    const singleCard = cardLine(reshuffledCb, targetFx, {
      slotInfo: { slotPos: 'ЛВ', fit: evaluatePositionFit(reshuffledCb.pos, 'ЛВ') },
      fatigueInfo: freshFat,
      roleNames: ['Угловой справа'],
    });
    assert.ok(singleCard.includes('позиция в схеме: ЛВ'));
    assert.ok(singleCard.includes('вынужденная перестановка'));
    assert.ok(singleCard.includes('Штатные роли: Угловой справа'));

    // 6. Verify fakePeriod uses designated corner takers for home corners
    const simEvents = fakePeriod(1, 90, ctx, []);
    const homeCorners = simEvents.filter((ev: any) => ev.type === 'corner' && ev.team === 'home');
    for (const cEv of homeCorners) {
      assert.ok(cEv.players.includes(reshuffledCb.name), 'Home corner should be taken by designated corner taker');
    }
  } finally {
    srv.closeAllConnections?.();
    srv.close();
    const removeIds = new Set([...h2hIds, targetFxId]);
    db.fixtures = db.fixtures.filter((x: any) => !removeIds.has(x.id));
    if (db.lineups) delete db.lineups[`${targetFxId}:${homeTeam.id}`];
    if (prevTactic === undefined) delete db.tactics[homeTeam.id];
    else db.tactics[homeTeam.id] = prevTactic;
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(dbPath, backupRaw, 'utf8');
  }
});

test('Cup match exposes club divisions, league tiers, class gap and domestic stats in buildCtx/buildUser/lineText/fakePeriod', async () => {
  const dbPath = path.join(process.cwd(), 'data', 'db.json');
  const backupRaw = fs.readFileSync(dbPath, 'utf8');

  const rplTeam = db.teams.find((t: any) => t.comp === 'rpl');
  const twoLbTeam = db.teams.find((t: any) => String(t.comp || '').startsWith('2lb_'));
  assert.ok(rplTeam, 'Expected at least one RPL team');
  assert.ok(twoLbTeam, 'Expected at least one 2nd League B team');

  const cupFxId = 'test_cup_rpl_vs_2lb';
  const rplLeagueFxId = 'test_rpl_league_fx_for_cup_ctx';

  try {
    const rplOpponent = db.teams.find((t: any) => t.comp === 'rpl' && t.id !== rplTeam.id);
    assert.ok(rplOpponent);

    db.fixtures.push(
      {
        id: rplLeagueFxId,
        season: db.settings.season,
        comp: 'rpl',
        round: 1,
        date: '2099-06-01',
        time: '19:00',
        home: rplTeam.id,
        away: rplOpponent.id,
        status: 'done',
        hg: 2,
        ag: 0,
        st: {
          teams: { home: { g: 2, xg: 2.1, fo: 9, yc: 1 }, away: { g: 0, xg: 0.4, fo: 12, yc: 2 } },
          players: {},
        },
      },
      {
        id: cupFxId,
        season: db.settings.season,
        comp: 'cup',
        round: 1,
        date: '2099-06-05',
        time: '18:00',
        home: twoLbTeam.id,
        away: rplTeam.id,
        status: 'scheduled',
        hg: null,
        ag: null,
        pos: 0,
      }
    );

    const cupFx = db.fixtures.find((x: any) => x.id === cupFxId);
    const ctx = await buildCtx(cupFx);

    assert.equal(ctx.sides.home.tier, 4);
    assert.equal(ctx.sides.away.tier, 1);
    assert.ok(ctx.sides.home.leagueName.includes('Вторая лига Б'));
    assert.ok(ctx.sides.away.leagueName.includes('РПЛ'));
    assert.ok(ctx.classGap.includes('КОЛОССАЛЬНАЯ РАЗНИЦА В КЛАССЕ'));
    assert.ok(ctx.classGap.includes('разрыв 3 дивизиона'));
    assert.ok(ctx.classGap.includes(`${rplTeam.name} [${ctx.sides.away.leagueName}, 1-й уровень]`));
    assert.ok(ctx.classGap.includes(`${twoLbTeam.name} [${ctx.sides.home.leagueName}, 4-й уровень]`));
    assert.ok(ctx.teamStats.away.includes('В чемпионате ('), 'Cup match should surface domestic league stats');

    const userPrompt = buildUser(ctx, 1, 90, null, [], 'full');
    assert.ok(userPrompt.includes(`${twoLbTeam.name} [${ctx.sides.home.leagueName}]`));
    assert.ok(userPrompt.includes(`${rplTeam.name} [${ctx.sides.away.leagueName}]`));
    assert.ok(userPrompt.includes(`Дивизион и статус ${twoLbTeam.name}: ${ctx.sides.home.leagueName}`));
    assert.ok(userPrompt.includes(`Дивизион и статус ${rplTeam.name}: ${ctx.sides.away.leagueName}`));
    assert.ok(userPrompt.includes('БАЛАНС КЛАССА СОПЕРНИКОВ: КОЛОССАЛЬНАЯ РАЗНИЦА В КЛАССЕ'));

    const homeLine = lineText(ctx, 'home');
    const awayLine = lineText(ctx, 'away');
    assert.ok(homeLine.includes(`[${ctx.sides.home.leagueName}, 4-й уровень]`));
    assert.ok(awayLine.includes(`[${ctx.sides.away.leagueName}, 1-й уровень]`));

    const simEvents = fakePeriod(1, 90, ctx, []);
    assert.ok(Array.isArray(simEvents) && simEvents.length > 0);
  } finally {
    const removeIds = new Set([cupFxId, rplLeagueFxId]);
    db.fixtures = db.fixtures.filter((x: any) => !removeIds.has(x.id));
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(dbPath, backupRaw, 'utf8');
  }
});

