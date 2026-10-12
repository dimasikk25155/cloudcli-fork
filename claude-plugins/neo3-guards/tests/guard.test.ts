import { expect, mock, test } from 'claude-code/testing'

const LOOP = 'until curl -sf http://localhost:3000; do sleep 5; done'
const BASH_OK = { stdout: 'ok', stderr: '', interrupted: false }

test('a foreground wait loop over the limit is refused with the background hint', async ($, on) => {
  mock.env(on, {})
  let ran = false
  on('tool.call', { tool: 'Bash' }, () => {
    ran = true
    return { result: BASH_OK }
  })

  const answer = await $.tool.call({ tool: 'Bash', command: LOOP, timeout: 600_000 })

  expect(ran).toBe(false)
  expect(JSON.stringify(answer)).toContain('run_in_background')
})

test('the same loop in the background runs', async ($, on) => {
  mock.env(on, {})
  let ran = false
  on('tool.call', { tool: 'Bash' }, () => {
    ran = true
    return { result: BASH_OK }
  })

  await $.tool.call({ tool: 'Bash', command: LOOP, timeout: 600_000, run_in_background: true })

  expect(ran).toBe(true)
})

test('the limit is read from NEO3_FOREGROUND_LOOP_MAX_SEC', async ($, on) => {
  mock.env(on, { NEO3_FOREGROUND_LOOP_MAX_SEC: '900' })
  let ran = false
  on('tool.call', { tool: 'Bash' }, () => {
    ran = true
    return { result: BASH_OK }
  })

  await $.tool.call({ tool: 'Bash', command: LOOP, timeout: 600_000 })

  expect(ran).toBe(true)
})
