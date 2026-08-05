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
