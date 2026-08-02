export default {
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
  },
}
