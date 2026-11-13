export function createAttentionCheckSchedule(durationSeconds, questionCount, minIntervalSeconds, maxIntervalSeconds, random = Math.random) {
  const duration = Number(durationSeconds)
  const count = Number(questionCount)
  const minInterval = Number(minIntervalSeconds)
  const maxInterval = Number(maxIntervalSeconds)

  if (
    !Number.isFinite(duration)
    || !Number.isInteger(count)
    || count < 1
    || !Number.isFinite(minInterval)
    || !Number.isFinite(maxInterval)
    || minInterval < 1
    || maxInterval < minInterval
    || duration < count * minInterval
  ) {
    throw new Error('The video duration cannot fit the configured attention checks and intervals.')
  }

  let position = 0
  const schedule = []
  for (let index = 0; index < count; index += 1) {
    const remainingQuestions = count - index - 1
    const high = Math.min(maxInterval, duration - position - remainingQuestions * minInterval)
    if (high < minInterval) {
      throw new Error('The video duration cannot fit the configured attention checks and intervals.')
    }
    const boundedRandom = Math.min(1, Math.max(0, random()))
    position += minInterval + boundedRandom * (high - minInterval)
    schedule.push(position)
  }

  return schedule
}
