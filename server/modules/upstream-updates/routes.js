/** Mount the sole upstream API surface. Request fields can never enable an installer. */
export function mountUpstreamRoutes(app, { authenticateToken, requireAdmin, checker }) {
  app.post('/api/system/update', authenticateToken, requireAdmin, (_req, res) => res.status(409).json({
    success: false, code: 'UPSTREAM_APPROVAL_REQUIRED', approvalRequired: true,
    error: 'Установка upstream в этом форке отключена во всех режимах. Сначала согласуйте конкретный SHA и набор изменений; затем отдельная рабочая копия, review, тесты, резервная точка и согласованный rollout.',
  }));
  app.get('/api/system/upstream', authenticateToken, requireAdmin, async (_req, res) => {
    try {
      res.set('Cache-Control', 'no-store').json(await checker.read());
    } catch (error) {
      res.status(500).json({ error: 'Не удалось прочитать локальный отчёт upstream.', approvalRequired: true });
    }
  });
  app.post('/api/system/upstream/check', authenticateToken, requireAdmin, async (_req, res) => {
    try {
      const report = await checker.check();
      res.set('Cache-Control', 'no-store').status(report.status === 'error' ? 502 : report.checking ? 202 : 200).json(report);
    } catch (error) {
      res.status(500).json({ error: 'Не удалось сохранить отчёт upstream. Проверьте доступ к каталогу отчёта.', approvalRequired: true });
    }
  });
}
