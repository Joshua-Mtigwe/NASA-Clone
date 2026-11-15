import { expect, test, type Page } from '@playwright/test';

async function selectRole(page: Page, role: string) {
  await page.goto('/login');
  await page
    .getByTestId('role-cards')
    .getByRole('button', { name: new RegExp(`^${role}`) })
    .click();
  if (role === 'Astronaut') {
    await page
      .getByRole('region', { name: 'Which astronaut are you?' })
      .getByRole('button', { name: /^AST-001/ })
      .click();
  }
  await expect(page.getByRole('banner', { name: 'Mission status' })).toBeVisible();
}

test('live role selector and astronaut health pages use persisted backend data', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await selectRole(page, 'Astronaut');
  await expect(
    page.getByRole('heading', { name: 'Task Readiness Score', exact: true }),
  ).toBeVisible();
  for (const [path, text] of [
    ['/astronaut/health/vitals', 'Current Vitals'],
    ['/astronaut/health/trends', 'Vital Trends'],
    ['/astronaut/health/body-map', 'Body Map'],
    ['/astronaut/cognition/trends', 'Cognitive Trends'],
    ['/astronaut/cognition/mission-mind', 'Mission Mind'],
    ['/astronaut/schedule', 'My Schedule'],
    ['/astronaut/recovery', 'Recovery and Sleep'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: text, exact: true }).first()).toBeVisible();
    await expect(
      page.getByText('The mission server returned an error. Try again shortly.'),
    ).toHaveCount(0);
  }
  await page.goto('/astronaut/health/vitals');
  await expect(page.getByTestId('vital-card')).toHaveCount(9);
  const summary = await page.evaluate(async () => {
    const response = await fetch('/api/v1/console/astronauts/AST-001/health/summary', {
      headers: { 'X-AEGIS-User': 'USR-001' },
    });
    return response.json() as Promise<{ measurements: Array<{ measure: string; value: number }> }>;
  });
  const heartRate = summary.measurements.find((m) => m.measure === 'heart_rate')!.value;
  await expect(
    page.getByTestId('vital-card').filter({ hasText: 'Heart rate' }).first(),
  ).toContainText(String(Math.round(heartRate)));
  expect(failures).toEqual([]);
});

test('all staff dashboards load using their selected backend persona', async ({ page }) => {
  for (const [role, paths] of [
    [
      'Mission Planning Leader',
      ['/planner', '/planner/tasks', '/planner/schedule', '/planner/recovery'],
    ],
    [
      'Impact Reviewer',
      [
        '/research',
        '/research/analyses',
        '/research/cognition',
        '/research/effectiveness',
        '/research/reports',
      ],
    ],
    [
      'Medical Officer',
      ['/medical', '/medical/programmes', '/medical/access', '/medical/assessments'],
    ],
  ] as const) {
    await selectRole(page, role);
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible();
      await expect(
        page.getByText('The mission server returned an error. Try again shortly.'),
      ).toHaveCount(0);
      await expect(
        page.getByText('Your role does not have access to this information.'),
      ).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Switch role' }).click();
    await expect(page.getByTestId('role-cards')).toBeVisible();
  }
});

test('Mind Companion persists a conversation and truthfully reports unavailable inference', async ({
  page,
  request,
}) => {
  const session = await request.post('/api/v1/console/auth/demo-session', {
    data: { username: 'crew1' },
  });
  expect(session.ok()).toBeTruthy();
  const auth = { Authorization: `Bearer ${(await session.json()).access_token}` };
  const created = await request.post('/api/v1/mind-chat/conversations', {
    headers: auth,
    data: {},
  });
  expect(created.ok()).toBeTruthy();
  const conversation = await created.json();
  const fetched = await request.get(
    `/api/v1/mind-chat/conversations/${conversation.conversation_id}`,
    { headers: auth },
  );
  expect(fetched.ok()).toBeTruthy();
  const message = await request.post(
    `/api/v1/mind-chat/conversations/${conversation.conversation_id}/messages`,
    {
      headers: auth,
      data: { content: 'I feel lonely today.', client_message_id: `smoke-${Date.now()}` },
    },
  );
  expect(message.status()).toBe(503);
  const other = await request.get(
    `/api/v1/mind-chat/conversations/${conversation.conversation_id}`,
    { headers: { Authorization: 'Bearer mock-token.USR-002' } },
  );
  expect(other.status()).toBe(404);
  await selectRole(page, 'Astronaut');
  await expect(page.getByRole('heading', { name: 'AEGIS Mind Companion' })).toBeVisible();
});

test('a real Mission Mind session persists its trials, score and cognitive trend', async ({
  page,
  request,
}) => {
  const state = await (await request.get('/api/v1/console/missions/current/state')).json();
  const medical = { 'X-AEGIS-User': 'USR-008' };
  const template = await request.post('/api/v1/console/assessments/schedule-templates', {
    headers: medical,
    data: {
      mission_phase: 'inflight',
      assessment_condition: 'morning',
      local_hour: 9,
      protocol_ids: 'SWITCH',
      recurrence: 'on_demand',
      description: 'Live browser verification',
    },
  });
  expect(template.ok()).toBeTruthy();
  const assignments = await request.post('/api/v1/console/assessments/assignments', {
    headers: medical,
    data: {
      astronaut_ids: ['AST-001'],
      template_id: (await template.json()).template_id,
      scheduled_at: state.mission_time,
    },
  });
  expect(assignments.ok()).toBeTruthy();
  const assignment = (await assignments.json())[0];
  await selectRole(page, 'Astronaut');
  await page.goto(`/astronaut/cognition/mission-mind/${assignment.assignment_id}`);
  const { completeSession } = await import('../e2e/helpers');
  await completeSession(page, 'f');
  await expect(page.getByTestId('completion')).toContainText('Accuracy');
  const sessions = await (
    await request.get(
      '/api/v1/console/assessments/sessions?astronaut_id=AST-001&protocol_id=SWITCH',
      { headers: { 'X-AEGIS-User': 'USR-001' } },
    )
  ).json();
  const session = sessions.items.find(
    (s: { assignment_id: string }) => s.assignment_id === assignment.assignment_id,
  );
  expect(session.session_status).toBe('completed');
  const trials = await (
    await request.get(`/api/v1/console/assessments/sessions/${session.session_id}/trials`, {
      headers: { 'X-AEGIS-User': 'USR-001' },
    })
  ).json();
  expect(trials.total).toBe(24);
  const daily = await (
    await request.get('/api/v1/console/cognition/daily-results?astronaut_id=AST-001', {
      headers: { 'X-AEGIS-User': 'USR-001' },
    })
  ).json();
  expect(
    daily.some(
      (r: { protocol_id: string; assessment_date: string }) =>
        r.protocol_id === 'SWITCH' && r.assessment_date === state.mission_time.slice(0, 10),
    ),
  ).toBeTruthy();
});

test('publishing a live schedule updates the astronaut timetable after a role switch', async ({
  page,
  request,
}) => {
  await selectRole(page, 'Mission Planning Leader');
  await page.goto('/planner/schedule');
  await expect(page.getByRole('button', { name: /Generate plan/ })).toBeEnabled();
  const previousVersion = await page.getByLabel('Schedule version').inputValue();
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await expect(page.getByLabel('Schedule version')).not.toHaveValue(previousVersion);
  await expect(page.getByText('Draft, not approved')).toBeVisible();
  const versionId = await page.getByLabel('Schedule version').inputValue();
  const detail = await (
    await request.get(`/api/v1/console/planning/schedules/${versionId}`)
  ).json();
  const confirmations = page.getByRole('checkbox');
  for (let i = 0; i < (await confirmations.count()); i++) await confirmations.nth(i).check();
  await page.getByRole('button', { name: 'Approve and publish' }).click();
  await expect(page.getByText('Approved and published')).toBeVisible();
  await page.getByRole('button', { name: 'Switch role' }).click();
  await selectRole(page, 'Astronaut');
  await page.goto('/astronaut/schedule');
  const mine = detail.assignments.filter(
    (a: { astronaut_id: string }) => a.astronaut_id === 'AST-001',
  );
  expect(mine.length).toBeGreaterThan(0);
  await expect(
    page.locator('[data-testid="schedule-item"][data-kind="task"]').first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator('[data-testid="schedule-item"][data-kind="task"]').first(),
  ).toBeVisible();
});

test('an offline routine publication stays pending, then persists and appears on the astronaut timetable', async ({
  page,
  context,
}) => {
  await selectRole(page, 'Mission Planning Leader');
  await page.goto('/planner/recovery');
  await page.getByRole('button', { name: 'Review and publish' }).first().click();
  const panel = page.getByTestId('review-panel');
  await expect(panel.getByRole('button', { name: 'Publish to Astronaut Schedule' })).toBeEnabled();
  await context.setOffline(true);
  await panel.getByRole('button', { name: 'Publish to Astronaut Schedule' }).click();
  await expect(panel.getByText('Pending Synchronization')).toBeVisible();
  await expect(panel.getByText(/Published to/)).toHaveCount(0);
  await context.setOffline(false);
  await expect(panel.getByText(/Published to AST-001/)).toBeVisible({ timeout: 35_000 });
  await page.getByRole('button', { name: 'Switch role' }).click();
  await selectRole(page, 'Astronaut');
  await page.goto('/astronaut/schedule');
  await expect(page.getByTestId('published-routine').first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('published-routine').first()).toBeVisible();
});
