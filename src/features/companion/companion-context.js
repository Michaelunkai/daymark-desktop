export function buildCompanionContext({ projects = [], tasks = [], bridgeVersion = 2 }) {
  const projectLines = projects
    .map((project) => `- ${project.name}`)
    .join('\n') || '- No projects'
  const taskLines = tasks
    .slice()
    .sort((left, right) => Number(left.completed) - Number(right.completed))
    .map((task) => `- [${task.completed ? 'x' : ' '}] ${task.title} | ${task.projectName} | ${task.due || 'No due date'}`)
    .join('\n') || '- No tasks'

  return [
    'Daymark workspace context',
    `DaymarkAI bridge: v${bridgeVersion}`,
    '',
    'Projects:',
    projectLines,
    '',
    'Tasks:',
    taskLines,
    '',
    'Use the DaymarkAI bridge to read or update this workspace when connected.',
  ].join('\n')
}

export function buildCompanionPrompt({ projects = [], request = '', tasks = [], bridgeVersion = 2 }) {
  return [
    'You are my signed-in Daymark companion.',
    request.trim() || 'Read my Daymark workspace and wait for my next instruction.',
    'Use the live DaymarkAI bridge when available. You may read state, navigate, open items, create tasks, and dispatch supported Daymark actions.',
    '',
    buildCompanionContext({ bridgeVersion, projects, tasks }),
  ].join('\n')
}
